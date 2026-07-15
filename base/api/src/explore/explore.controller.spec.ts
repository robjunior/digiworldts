import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { BATTLE_XP_REWARD } from '../digimon/battle';
import { PrismaService } from '../prisma/prisma.service';
import type { ExploreOutcomeView, TileView } from './explore.types';

/**
 * Exploration API contract (TASK-40, R-9) — the runnable proof of the FIRST exploration
 * slice: a player fetches the server-authoritative procedural tile map, explores an
 * ENCOUNTER tile (the EXISTING deterministic `simulateBattle` resolves the fight and a
 * WIN persists XP), and explores an EMPTY tile (no fight, no write). Proves the whole
 * "move → encounter → combat → reward" fantasy end to end AND every guard/validation
 * edge.
 *
 * Harness = the SAME two house patterns as the sibling `pvp.controller.spec.ts` /
 * `shop.controller.spec.ts` (P-2 + P-6), copied VERBATIM — both routes hit the DB (the
 * explore route reads/writes the Digimon) and are guard-protected. (The shared
 * `apps/api/src/test/datastore.ts` helper the e2e skill's primary path names does NOT
 * exist yet — extracting it is a separate DISTILL item — so this spec inlines the
 * throwaway-DB block per the skill's documented fallback, matching every apps/api e2e.)
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port) +
 *    Node's built-in `fetch` (no supertest). Exercises the true HTTP stack incl. the
 *    reused `JwtAuthGuard`.
 *  - FRICTION #8: boot via `createApp()`, NOT `Test.createTestingModule(...)`. Only
 *    `createApp()` wires the full `AppModule` (incl. `ExploreModule`, the AuthModule
 *    guard exports, the global `/api` prefix, and the global `ValidationPipe`). A green
 *    boot proves the explore guard constructs across the module boundary.
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()`). Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd
 *    depth (L-6, friction #7): this spec is at `src/explore/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`) — two levels up, the SAME depth as the
 *    pvp/shop/admin specs.
 *
 * A player's roster (their explorer Digimon) is materialized by hitting `GET /api/digimon`
 * once after registration (starters are granted on the first roster read, TASK-8). The XP
 * write is verified by re-reading the Digimon rows through `app.get(PrismaService)` (the
 * SAME escape hatch the pvp/shop specs use for server-internal state).
 */
describe('Exploration API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const jsonPost = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

  const authGet = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /**
   * Register + log in a fresh account, materialize its starter roster (so it has a
   * Digimon to explore with), and return its access token. Each call uses a unique email.
   */
  const registerLoginWithRoster = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost0('/auth/register', { email, password });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as RegisterResponse;
    expect(registered.email).toBe(email);

    const login = await jsonPost0('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);

    const roster = await authGet('/digimon', accessToken);
    expect(roster.status).toBe(200);
    const digimon = (await roster.json()) as unknown[];
    expect(digimon.length).toBeGreaterThan(0);
    return accessToken;
  };

  /** Register + log in a fresh account but do NOT materialize a roster (no Digimon). */
  const registerLoginNoRoster = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost0('/auth/register', { email, password });
    expect(register.status).toBe(201);
    const login = await jsonPost0('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    return accessToken;
  };

  /** A body-carrying POST — only auth register/login need a body in this spec. */
  const jsonPost0 = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /**
   * The STRONGEST owned Digimon for an email, read straight from the DB (L-3) — the same
   * champion the service explores with (orderBy level desc, id asc). Returns the
   * mutable progression fields the XP-persistence assertions compare.
   */
  const strongestDigimon = async (
    email: string,
  ): Promise<{ id: string; level: number; xp: number }> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) throw new Error(`test setup: no user for ${email}`);
    const digimon = await prisma.digimon.findFirst({
      where: { userId: user.id, deletedAt: null },
      orderBy: [{ level: 'desc' }, { id: 'asc' }],
    });
    if (digimon === null) throw new Error(`test setup: no digimon for ${email}`);
    return { id: digimon.id, level: digimon.level, xp: digimon.xp };
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-explore-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'explore.db')}`;
    // src/explore/ → up TWO levels to apps/api (friction #7 / L-6). NOT a single '..'.
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

  it('GET /api/explore/map → 200 leak-safe TileView[] (id/terrain/hasEncounter, NO enemy id leaked; both encounter + empty tiles present)', async () => {
    // Case 1: the map read is leak-safe. Every tile carries id/terrain/hasEncounter and
    // NOTHING reveals which enemy waits (invariant 2). The map has BOTH kinds of tile so
    // both explore paths below are reachable.
    const token = await registerLoginWithRoster('explore-map@example.test');

    const res = await authGet('/explore/map', token);
    expect(res.status).toBe(200);
    const tiles = (await res.json()) as TileView[];

    expect(Array.isArray(tiles)).toBe(true);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(typeof tile.id).toBe('string');
      expect(tile.id.length).toBeGreaterThan(0);
      expect(typeof tile.terrain).toBe('string');
      expect(typeof tile.hasEncounter).toBe('boolean');
      // The server-only enemy id must NEVER cross the boundary.
      expect((tile as Record<string, unknown>).encounterEnemyId).toBeUndefined();
    }
    expect(tiles.some((t) => t.hasEncounter === true)).toBe(true);
    expect(tiles.some((t) => t.hasEncounter === false)).toBe(true);

    // No enemy id string leaks anywhere in the serialized map.
    const raw = JSON.stringify(tiles);
    expect(raw).not.toContain('numemon');
    expect(raw).not.toContain('kuwagamon');
    expect(raw).not.toContain('encounterEnemyId');
  });

  it('exploring an ENCOUNTER tile → 200 win/loss + non-empty deterministic turns; a WIN persists BATTLE_XP_REWARD', async () => {
    // Case 2 (the headline): exploring a wild-encounter tile runs the deterministic
    // simulateBattle. We pick the WEAK-foe tile (`whispering-woods` → numemon) a level-1
    // starter reliably WINS, so the "explore → encounter → win → get stronger" payoff is
    // observable AND the XP persistence is provable by re-reading the DB.
    const email = 'explore-win@example.test';
    const token = await registerLoginWithRoster(email);
    const before = await strongestDigimon(email);
    expect(before.level).toBe(1); // fresh starter

    const res = await jsonPost('/explore/whispering-woods/explore', token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as ExploreOutcomeView;

    expect(['win', 'loss']).toContain(body.outcome);
    expect(Array.isArray(body.turns)).toBe(true);
    expect(body.turns.length).toBeGreaterThan(0);
    expect(body.enemy).toBeDefined();
    expect(body.enemy!.name.length).toBeGreaterThan(0);
    expect(body.digimon).toBeDefined();

    // The weak-foe tile is a WIN for a level-1 starter (deterministic, RNG-free).
    expect(body.outcome).toBe('win');
    expect(body.reward.xpGained).toBe(BATTLE_XP_REWARD);

    // PERSISTED: re-reading the DB shows the XP applied through the shared curve (40 XP
    // crosses the level-1 threshold of 20, so the starter levels up).
    const after = await strongestDigimon(email);
    expect(after.level).toBeGreaterThan(before.level);
    // The wire echoes the persisted post-reward Digimon.
    expect(body.digimon!.level).toBe(after.level);
    expect(body.digimon!.xp).toBe(after.xp);

    // Deterministic: a fresh identical explorer exploring the same tile wins identically.
    const token2 = await registerLoginWithRoster('explore-win2@example.test');
    const res2 = await jsonPost('/explore/whispering-woods/explore', token2);
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as ExploreOutcomeView;
    expect(body2.outcome).toBe(body.outcome);
    expect(body2.turns.length).toBe(body.turns.length);
  });

  // TASK-157 (R-22 slice 18): the wild-encounter auto-resolve callsite
  // (explore.service.exploreTile) was re-pointed by TASK-156/D-319 from the frozen
  // `simulateBattle` → the byte-frozen ATB sibling `simulateBattleAtb`, so a fast
  // explorer's banked capped mini-combo now lands in a wild encounter exactly as it
  // does interactively and on the PvE auto-resolve path (proven at
  // battle.controller.spec.ts:298). But that re-point shipped correct-but-UNEXERCISED
  // in any spec — the pinned explore fixtures never reach ATB_THRESHOLD, so the
  // divergence-close was REAL for fast live matchups but INVISIBLE in tests (present ≠
  // observable, L-17/L-55). This fixture closes that gap by mirroring the PvE proof:
  // bump the explorer's SPD far above ATB_THRESHOLD (banking ≥ 1 full threshold in
  // round 1), explore the weak-foe tile (`whispering-woods` → numemon) it reliably
  // WINS, and assert the returned turn log now shows the banked EXTRA player action
  // WITHIN round 1 (more than the one action/side/round the pure SPD order allows).
  // The win-path FREE-XP reward is UNCHANGED (invariant 3 untriggered). NO production
  // code moved — battle.ts + the service callsite stay byte-frozen (this is a
  // test-only observability guard).
  it('surfaces the banked ATB mini-combo in the wild-encounter turn log (TASK-157 divergence-close)', async () => {
    const email = 'explore-atb-combo@example.test';
    const token = await registerLoginWithRoster(email);
    const before = await strongestDigimon(email);

    // Bump the explorer's SPD far above ATB_THRESHOLD so it banks ≥ 1 full threshold in
    // round 1, earning at least one capped bonus action the SPD-order-only path would
    // never grant. The champion the service explores with is the strongest owned
    // Digimon (orderBy level desc, id asc) — the SAME row strongestDigimon() reads.
    const prisma = app.get(PrismaService);
    await prisma.digimon.update({ where: { id: before.id }, data: { spd: 300 } });

    const res = await jsonPost('/explore/whispering-woods/explore', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExploreOutcomeView;

    // The fast-banking explorer WINS the deterministic fight (clean, non-flaky signal).
    expect(body.outcome).toBe('win');

    // A player action that dealt damage in round 1. Under the pure SPD order
    // simulateBattle grants exactly ONE such action per round; the banked ATB mini-combo
    // (now honored via simulateBattleAtb, D-319) grants MORE.
    const round1PlayerHits = body.turns.filter(
      (t) => t.round === 1 && t.actor === 'player' && t.damage > 0,
    ).length;
    expect(round1PlayerHits).toBeGreaterThan(1);
  });

  it('exploring an EMPTY tile → 200 outcome:empty, empty turns, xpGained:0, and NO Digimon change', async () => {
    // Case 3: an empty tile is safe travel — no fight, no write. Re-reading the Digimon
    // proves nothing changed.
    const email = 'explore-empty@example.test';
    const token = await registerLoginWithRoster(email);
    const before = await strongestDigimon(email);

    const res = await jsonPost('/explore/greenfield-entry/explore', token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ExploreOutcomeView;

    expect(body.outcome).toBe('empty');
    expect(body.turns).toEqual([]);
    expect(body.reward.xpGained).toBe(0);
    expect(body.enemy).toBeUndefined();
    expect(body.digimon).toBeUndefined();

    const after = await strongestDigimon(email);
    expect(after.level).toBe(before.level);
    expect(after.xp).toBe(before.xp);
  });

  it('a player with NO Digimon exploring → 422 (nothing to explore with)', async () => {
    // Case 4: no champion to field → 422, before any write.
    const token = await registerLoginNoRoster('explore-noroster@example.test');
    const res = await jsonPost('/explore/whispering-woods/explore', token);
    expect(res.status).toBe(422);
  });

  it('exploring an unknown tileId → 404 (before any read)', async () => {
    // Case 5: an unknown tile is rejected up front — no roster read, no fight.
    const token = await registerLoginWithRoster('explore-badtile@example.test');
    const res = await jsonPost('/explore/no-such-tile/explore', token);
    expect(res.status).toBe(404);
  });

  it('both routes with NO Authorization header → 401 (the guard is live)', async () => {
    // Case 6: both explore routes are unreachable without a token — the JwtAuthGuard runs
    // before the handler.
    const map = await authGet('/explore/map');
    expect(map.status).toBe(401);

    const explore = await jsonPost('/explore/whispering-woods/explore');
    expect(explore.status).toBe(401);
  });
});
