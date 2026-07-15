import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import type { OwnedDigimon } from './digimon.types';
import {
  applyTraining,
  STAT_GAIN_PER_LEVEL,
  TRAIN_XP_PER_ACTION,
  xpForLevel,
  type TrainableStats,
} from './training';

/**
 * Train API contract (TASK-29, R-6) — the runnable proof of server-authoritative
 * progression, the FIRST feature that MOVES `level`. A signed-in player trains one
 * of THEIR starters (`POST /digimon/:id/train`): the row's `xp` accrues and, when it
 * crosses the per-level threshold, its `level` ticks up with a flat stat gain — all
 * persisted (a subsequent `GET /digimon` re-reads the raised values, so it is
 * server-authoritative, not client-computed). An unauthenticated caller is blocked
 * (401), and a player can never train another player's Digimon (404 — invariant 2).
 *
 * Training grants XP for FREE (invariant 3 NOT triggered), so — unlike the evolve
 * spec — there is NO balance seeding and NO AuditLog assertion here.
 *
 * Harness = the SAME two house patterns as the sibling `evolve.controller.spec.ts`
 * (P-2 + P-6), copied VERBATIM (the shared `apps/api/src/test/datastore.ts` helper
 * the e2e skill names does not exist yet — this inlines the throwaway-DB block per
 * the skill's documented fallback):
 *  - P-2: boot a REAL Nest app via `createApp()` (NOT `Test.createTestingModule` —
 *    only `createApp()` wires the full AppModule incl. the guard export, the `/api`
 *    prefix, and the global ValidationPipe) + `app.listen(0)` + Node's built-in
 *    `fetch`.
 *  - P-6: a per-run throwaway SQLite DB (ABSOLUTE `file:` URL set BEFORE `createApp()`;
 *    `prisma db push --skip-generate` from `join(__dirname, '..', '..')` = `apps/api`,
 *    the CRUCIAL cwd depth — this spec sits at `src/digimon/`).
 */
describe('Train API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const jsonPost = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** Register + log in a fresh account and return its access token. */
  const registerAndLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as RegisterResponse;
    expect(registered.email).toBe(email);

    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  /** `GET /digimon` for a token → the player's roster (starter-granted on first read). */
  const getRoster = async (token: string): Promise<OwnedDigimon[]> => {
    const res = await fetch(`${baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as OwnedDigimon[];
  };

  /** `POST /digimon/:id/train`, with an optional Bearer token (omitted → no header). */
  const postTrain = (id: string, token?: string) =>
    fetch(`${baseUrl}/digimon/${id}/train`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /** The mutable progression fields, plucked from an OwnedDigimon. */
  const progressionOf = (d: OwnedDigimon): TrainableStats => ({
    level: d.level,
    xp: d.xp,
    hp: d.hp,
    atk: d.atk,
    def: d.def,
    spd: d.spd,
    // TASK-30 (R-16): TrainableStats now carries dataFire — plucked from the wire
    // (OwnedDigimon additively exposes it) so applyTraining round-trips it here.
    dataFire: d.dataFire,
  });

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-train-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'train.db')}`;
    // src/digimon/ → up TWO levels to apps/api (friction / L-6). NOT a single '..'.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    app = await createApp();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('rejects POST /digimon/:id/train with NO Authorization header → 401', async () => {
    // The mutation is unreachable without a valid Bearer token — the guard runs before
    // the body, so the id need not exist.
    const res = await postTrain('any-id');
    expect(res.status).toBe(401);
  });

  it('rejects POST /digimon/:id/train with a garbage token → 401', async () => {
    const res = await postTrain('any-id', 'not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('grants XP and LEVELS UP a starter on a train click → 200 with the exact applyTraining result', async () => {
    // R-6 headline: a signed-in player trains their level-1 starter and it levels up
    // with a flat stat gain. The chosen constants (TRAIN_XP_PER_ACTION=25 ≥
    // xpForLevel(1)=20) make ONE click level a starter from 1→2 — the SUCCESS path is
    // observable in a single call, and asserted against the pure rule applied once.
    const token = await registerAndLogin('alice-train@example.test');
    const roster = await getRoster(token);
    const starter = roster[0]!;

    // Precondition: a freshly seeded starter starts at level 1 with 0 XP and carries
    // the derived xpToNext for level 1 (proves the additive projection fields).
    expect(starter.level).toBe(1);
    expect(starter.xp).toBe(0);
    expect(starter.xpToNext).toBe(xpForLevel(1));

    const before = progressionOf(starter);
    const res = await postTrain(starter.id, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const trained = (await res.json()) as OwnedDigimon;

    // Same row mutated in place (not replaced), and the exact result of applying the
    // pure training rule ONCE to the starter's initial progression.
    expect(trained.id).toBe(starter.id);
    const expected = applyTraining(before);
    expect(trained.level).toBe(expected.level);
    expect(trained.xp).toBe(expected.xp);
    expect(trained.hp).toBe(expected.hp);
    expect(trained.atk).toBe(expected.atk);
    expect(trained.def).toBe(expected.def);
    expect(trained.spd).toBe(expected.spd);

    // The observable "level up + get stronger" outcome: the constants guarantee a
    // 1→2 tick, and the flat per-level stat gain landed exactly.
    expect(trained.level).toBe(2);
    expect(trained.hp).toBe(starter.hp + STAT_GAIN_PER_LEVEL.hp);
    expect(trained.atk).toBe(starter.atk + STAT_GAIN_PER_LEVEL.atk);
    expect(trained.def).toBe(starter.def + STAT_GAIN_PER_LEVEL.def);
    expect(trained.spd).toBe(starter.spd + STAT_GAIN_PER_LEVEL.spd);
    // The overflow XP carried into the new level, and xpToNext tracked the new level.
    expect(trained.xp).toBe(TRAIN_XP_PER_ACTION - xpForLevel(1));
    expect(trained.xpToNext).toBe(xpForLevel(trained.level));

    // type/element/stage/name are NOT touched by training (only stats + level move).
    expect(trained.type).toBe(starter.type);
    expect(trained.element).toBe(starter.element);
    expect(trained.stage).toBe(starter.stage);
    expect(trained.name).toBe(starter.name);

    // No internal/owner columns leak across the API boundary.
    const leaky = trained as Record<string, unknown>;
    expect(leaky).not.toHaveProperty('userId');
    expect(leaky).not.toHaveProperty('createdAt');
    expect(leaky).not.toHaveProperty('deletedAt');
  });

  it('persists the raised level/xp/stats — a subsequent GET /digimon re-reads them (server-authoritative)', async () => {
    // Train the SAME starter three times and assert the persisted state equals the
    // pure rule applied three times to the initial progression — proving the server
    // (not the client) accumulates XP across calls, and it survives a fresh read.
    const token = await registerAndLogin('bob-train@example.test');
    const roster = await getRoster(token);
    const starter = roster[0]!;
    const initial = progressionOf(starter);

    for (let i = 0; i < 3; i += 1) {
      const res = await postTrain(starter.id, token);
      expect(res.status).toBe(200);
    }

    // The pure rule applied N times is the single source of truth for the expected
    // absolute state (the service applies exactly this each call).
    let expected = initial;
    for (let i = 0; i < 3; i += 1) expected = applyTraining(expected);

    const after = await getRoster(token);
    expect(after).toHaveLength(roster.length); // train mutates, never adds/removes
    const persisted = after.find((d) => d.id === starter.id)!;
    expect(persisted.level).toBe(expected.level);
    expect(persisted.xp).toBe(expected.xp);
    expect(persisted.hp).toBe(expected.hp);
    expect(persisted.atk).toBe(expected.atk);
    expect(persisted.def).toBe(expected.def);
    expect(persisted.spd).toBe(expected.spd);
    // The raised level is now available to R-8's level-gated evolution (which reads it).
    expect(persisted.level).toBeGreaterThan(starter.level);
    expect(persisted.xpToNext).toBe(xpForLevel(persisted.level));
  });

  it("never trains another player's Digimon → 404 (per-user isolation, invariant 2)", async () => {
    // Player A owns a roster; capture one of their Digimon ids.
    const tokenA = await registerAndLogin('owner-a-train@example.test');
    const rosterA = await getRoster(tokenA);
    const victim = rosterA[0]!;

    // Player B is a genuinely separate account with their OWN starters (distinct ids).
    const tokenB = await registerAndLogin('intruder-b-train@example.test');
    const rosterB = await getRoster(tokenB);
    const aIds = new Set(rosterA.map((d) => d.id));
    expect(rosterB.every((d) => !aIds.has(d.id))).toBe(true);

    // B attempts to train A's Digimon by id → 404 (owner-scoped find misses; a generic
    // not-found leaks no existence info, and A's row is never mutated).
    const res = await postTrain(victim.id, tokenB);
    expect(res.status).toBe(404);

    // Proof of non-mutation: A re-reads and the targeted Digimon is untouched (still
    // level 1 with 0 XP — B's attempt granted nothing).
    const rosterAafter = await getRoster(tokenA);
    const untouched = rosterAafter.find((d) => d.id === victim.id)!;
    expect(untouched.level).toBe(victim.level);
    expect(untouched.xp).toBe(victim.xp);
  });
});
