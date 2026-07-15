import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { STARTER_DIGIMON } from './digimon.seed';
import type { OwnedDigimon } from './digimon.types';

/**
 * Roster API contract (TASK-8, R-3). The runnable proof of the server-authoritative
 * roster: register → log in → `GET /digimon` returns the signed-in player's owned
 * Digimon (starter-granted on the first empty read, A-8), and 401 without a valid
 * Bearer token. It mirrors the acceptance-check curls end to end. This is the API
 * layer TASK-9's `/collection` screen consumes.
 *
 * Harness = the SAME two house patterns as `auth.controller.spec.ts` (P-2 + P-6),
 * copied verbatim — `GET /digimon` hits the DB AND is guard-protected, so both
 * halves are needed:
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port,
 *    never collides) + Node's built-in `fetch` (no supertest). Exercises the true
 *    HTTP stack incl. the reused `JwtAuthGuard`.
 *  - FRICTION #1 / friction: boot via `createApp()`, NOT
 *    `Test.createTestingModule(...)`. Only `createApp()` wires the full `AppModule`
 *    — which now imports `DigimonModule`, and whose `AuthModule` additively exports
 *    `JwtAuthGuard` + re-exports `JwtModule` (the one TASK-8 wiring change). If that
 *    export were missing, DI would fail to CONSTRUCT the guard and the app would not
 *    boot — so a green boot here also proves that export. The global `ValidationPipe`
 *    lives here too (unused by this read-only endpoint, but part of the real path).
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()` — `PrismaService` reads it when `PrismaClient` is constructed).
 *    Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd depth (L-6):
 *    this spec is at `src/digimon/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`, where `schema.prisma` lives) —
 *    two levels up, the SAME depth as `src/auth/`.
 *
 * Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect frees
 * the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 */
describe('Roster API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const digimonUrl = () => `${baseUrl}/digimon`;

  const jsonPost = (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /**
   * Register + log in a fresh account and return its access token — a real
   * authenticated principal, exactly as a client would obtain one. Each call uses
   * a unique email so tests get independent players (per-user isolation check).
   */
  const registerAndLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    // (sanity: registration returns the identity, never a token — login does)
    const registered = (await register.json()) as RegisterResponse;
    expect(registered.email).toBe(email);

    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  const getRoster = (token?: string) =>
    fetch(digimonUrl(), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-roster-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'roster.db')}`;
    // src/digimon/ → up TWO levels to apps/api (friction / L-6). NOT a single '..'.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    // createApp() installs the full AppModule (incl. DigimonModule + the AuthModule
    // guard export) — the same code path main.ts runs. A successful boot proves the
    // friction-#1 wiring (the guard constructs).
    app = await createApp();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    // R-15: the server owns the global `/api` prefix (createApp → setGlobalPrefix('api')),
    // so the REAL external addresses are /api/digimon and /api/auth/* — the exact URLs the
    // SPA calls over the (rewrite-free) Vite dev proxy. Prefixing baseUrl once makes every
    // `${baseUrl}/digimon` and `${baseUrl}${path}` hit /api/..., so this e2e is the
    // regression cover: drop the prefix and it goes red.
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('rejects GET /digimon with NO Authorization header → 401 (the guard protects it)', async () => {
    // The endpoint is unreachable without a valid Bearer token — this is the
    // "server-authoritative, unreachable signed out" guarantee.
    const res = await getRoster();
    expect(res.status).toBe(401);
  });

  it('rejects GET /digimon with a garbage token → 401', async () => {
    const res = await getRoster('not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('returns the starter roster on the first read for a new player → 200 OwnedDigimon[]', async () => {
    const token = await registerAndLogin('alice@example.test');

    const res = await getRoster(token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const roster = (await res.json()) as OwnedDigimon[];
    // A brand-new account owned nothing; the endpoint granted the starters (A-8),
    // so the roster is NON-EMPTY and matches the seed size.
    expect(Array.isArray(roster)).toBe(true);
    expect(roster).toHaveLength(STARTER_DIGIMON.length);

    // It contains the seeded starters (assert by name — the observable identity).
    const names = roster.map((d) => d.name).sort();
    const expectedNames = STARTER_DIGIMON.map((d) => d.name).sort();
    expect(names).toEqual(expectedNames);

    // Every item carries the full public field set with the right types...
    for (const digimon of roster) {
      expect(typeof digimon.id).toBe('string');
      expect(digimon.id.length).toBeGreaterThan(0);
      expect(typeof digimon.name).toBe('string');
      expect(typeof digimon.type).toBe('string');
      expect(typeof digimon.element).toBe('string');
      expect(typeof digimon.stage).toBe('string');
      expect(Number.isInteger(digimon.hp)).toBe(true);
      expect(Number.isInteger(digimon.atk)).toBe(true);
      expect(Number.isInteger(digimon.def)).toBe(true);
      expect(Number.isInteger(digimon.spd)).toBe(true);
      expect(Number.isInteger(digimon.level)).toBe(true);

      // ...and NO internal/leaked columns cross the API boundary (invariant 1/2
      // hygiene — the same discipline auth applies to passwordHash).
      const leaky = digimon as Record<string, unknown>;
      expect(leaky).not.toHaveProperty('userId');
      expect(leaky).not.toHaveProperty('createdAt');
      expect(leaky).not.toHaveProperty('deletedAt');
    }
  });

  it('grants canonical first-3-season species end-to-end (TASK-190, R-29) — a new player SEES them on their roster', async () => {
    // The observable headline of R-29 slice 49 proven at the API surface a new
    // player first meets: after the empty-roster grant, `GET /digimon` returns real
    // Adventure/02/Tamers species beyond the founding trio (they render as-is on
    // /collection with zero client change). This confirms the seeded catalog reaches
    // the wire, not just the pure array.
    const token = await registerAndLogin('rookie-collector@example.test');
    const res = await getRoster(token);
    expect(res.status).toBe(200);
    const roster = (await res.json()) as OwnedDigimon[];

    const names = roster.map((d) => d.name);
    // The founding trio is still granted (existing behaviour unchanged).
    expect(names).toEqual(expect.arrayContaining(['Agumon', 'Gabumon', 'Patamon']));
    // At least one new first-3-season species is now surfaced end-to-end.
    expect(names).toEqual(
      expect.arrayContaining(['Biyomon', 'Tentomon', 'Palmon', 'Gomamon', 'Veemon']),
    );
    expect(names).toEqual(
      expect.arrayContaining(['Guilmon', 'Renamon', 'Terriermon']),
    );
    // The roster genuinely grew beyond the original three.
    expect(roster.length).toBeGreaterThan(3);
  });

  it('is idempotent — a second read for the SAME player returns the same roster (grant fires once)', async () => {
    const token = await registerAndLogin('bob@example.test');

    const first = await getRoster(token);
    expect(first.status).toBe(200);
    const firstRoster = (await first.json()) as OwnedDigimon[];
    expect(firstRoster).toHaveLength(STARTER_DIGIMON.length);

    // Re-read: the starter grant must NOT fire again (no duplicate roster) — same
    // count AND the same instance ids (proves it is the same persisted rows, not a
    // fresh grant).
    const second = await getRoster(token);
    expect(second.status).toBe(200);
    const secondRoster = (await second.json()) as OwnedDigimon[];
    expect(secondRoster).toHaveLength(firstRoster.length);
    expect(secondRoster.map((d) => d.id).sort()).toEqual(firstRoster.map((d) => d.id).sort());
  });

  it("scopes the roster per user — a second player gets their OWN starters, not the first's rows", async () => {
    // Two distinct players each get their own starter roster; the userId filter
    // (invariant 1's owner scoping) must keep one player's Digimon out of the
    // other's response.
    const carolToken = await registerAndLogin('carol@example.test');
    const daveToken = await registerAndLogin('dave@example.test');

    const carolRoster = (await (await getRoster(carolToken)).json()) as OwnedDigimon[];
    const daveRoster = (await (await getRoster(daveToken)).json()) as OwnedDigimon[];

    expect(carolRoster).toHaveLength(STARTER_DIGIMON.length);
    expect(daveRoster).toHaveLength(STARTER_DIGIMON.length);

    // Distinct instance ids — each player owns their OWN rows (no shared/leaked
    // Digimon across accounts).
    const carolIds = new Set(carolRoster.map((d) => d.id));
    const daveIds = daveRoster.map((d) => d.id);
    expect(daveIds.every((id) => !carolIds.has(id))).toBe(true);
  });
});
