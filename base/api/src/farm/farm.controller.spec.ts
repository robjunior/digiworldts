import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { STARTING_BUILDINGS } from './farm.seed';
import type { BuildingView, FarmState } from './farm.types';

/**
 * Farm/City API contract (TASK-15, R-4). The runnable proof of the
 * server-authoritative farm: register → log in → `GET /farm` returns the signed-in
 * player's buildings (materialized on the first empty read, A-8), each carrying a
 * computed-on-read `produced` amount, and 401 without a valid Bearer token. It
 * mirrors the acceptance-check curls end to end. This is the API layer TASK-16's
 * `/farm` screen consumes.
 *
 * Harness = the SAME house patterns as `digimon.controller.spec.ts` (P-2 + P-6),
 * copied VERBATIM (the sibling `nest-e2e-and-datastore-tests` skill points at a
 * shared `apps/api/src/test/datastore.ts` helper, but that file does not exist —
 * so this takes the skill's documented fallback and hand-rolls the harness inline).
 * `GET /farm` hits the DB AND is guard-protected, so both halves are needed:
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port,
 *    never collides) + Node's built-in `fetch` (no supertest). Exercises the true
 *    HTTP stack incl. the reused `JwtAuthGuard`.
 *  - Boot via `createApp()`, NOT `Test.createTestingModule(...)`. Only
 *    `createApp()` wires the full `AppModule` — which now imports `FarmModule`,
 *    whose `AuthModule` exports `JwtAuthGuard` + re-exports `JwtModule` (the
 *    cross-module guard reuse). If that export were missing, DI would fail to
 *    CONSTRUCT the guard and the app would not boot — so a green boot here also
 *    proves the guard wiring AND that `FarmService`/`FarmController`'s explicit
 *    `@Inject` DI resolves (a bare param would 500 the first `GET /farm`, L-7/P-7).
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()` — `PrismaService` reads it when `PrismaClient` is constructed).
 *    Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd depth (L-6):
 *    this spec is at `src/farm/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`, where `schema.prisma` lives) —
 *    two levels up, the SAME depth as `src/digimon/`.
 *
 * The accrual math is proven WITHOUT sleeping (L-3): after the first-open grant we
 * reach `PrismaService` via `app.get(PrismaService)` and directly `update` a
 * building's `lastCollectedAt` to a FIXED past instant, then re-read `GET /farm`
 * and assert the clamped integer `produced`. No `setTimeout`, no real elapsed time.
 *
 * Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect frees
 * the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 */
describe('Farm API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const farmUrl = () => `${baseUrl}/farm`;

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

  const getFarm = (token?: string) =>
    fetch(farmUrl(), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-farm-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'farm.db')}`;
    // src/farm/ → up TWO levels to apps/api (friction / L-6). NOT a single '..'.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    // createApp() installs the full AppModule (incl. FarmModule + the AuthModule
    // guard export) — the same code path main.ts runs. A successful boot proves the
    // guard constructs AND FarmService/FarmController's explicit @Inject DI resolves.
    app = await createApp();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    // R-15: the server owns the global `/api` prefix (createApp → setGlobalPrefix('api')),
    // so the REAL external addresses are /api/farm and /api/auth/* — the exact URLs the SPA
    // calls over the (rewrite-free) Vite dev proxy. Prefixing baseUrl once makes every
    // `${baseUrl}/farm` and the jsonPost helper hit /api/..., so this e2e is the regression
    // cover: drop the prefix and it goes red.
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('rejects GET /farm with NO Authorization header → 401 (the guard protects it)', async () => {
    // The endpoint is unreachable without a valid Bearer token — this is the
    // "server-authoritative, unreachable signed out" guarantee.
    const res = await getFarm();
    expect(res.status).toBe(401);
  });

  it('rejects GET /farm with a garbage token → 401', async () => {
    const res = await getFarm('not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('materializes the starting buildings on the first read for a new player → 200 FarmState', async () => {
    const token = await registerAndLogin('alice@example.test');

    const res = await getFarm(token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const farm = (await res.json()) as FarmState;
    // The 200 body is an OBJECT { buildings }, NOT a bare array (A-11) — so future
    // economy facts can be added additively (invariant 5).
    expect(Array.isArray(farm)).toBe(false);
    expect(Array.isArray(farm.buildings)).toBe(true);

    // A brand-new account owned no buildings; the endpoint granted the starters
    // (A-8), so the farm is NON-EMPTY and matches the seed size (three).
    const buildings = farm.buildings;
    expect(buildings).toHaveLength(STARTING_BUILDINGS.length);

    // It contains exactly the seeded starting buildings (assert by kind — the
    // observable identity — and that rate/capacity match the fixed seed values).
    const byKind = new Map(buildings.map((b) => [b.kind, b]));
    for (const starter of STARTING_BUILDINGS) {
      const building = byKind.get(starter.kind);
      expect(building).toBeDefined();
      expect(building?.resource).toBe(starter.resource);
      expect(building?.ratePerHour).toBe(starter.ratePerHour);
      expect(building?.capacity).toBe(starter.capacity);
    }

    // Every item carries the full public BuildingView field set with the right
    // types, and — freshly materialized — has accrued ~nothing yet.
    for (const building of buildings) {
      expect(typeof building.id).toBe('string');
      expect(building.id.length).toBeGreaterThan(0);
      expect(typeof building.kind).toBe('string');
      expect(typeof building.resource).toBe('string');
      expect(Number.isInteger(building.ratePerHour)).toBe(true);
      expect(Number.isInteger(building.capacity)).toBe(true);
      expect(Number.isInteger(building.produced)).toBe(true);
      // Just granted (lastCollectedAt defaulted to now()): produced is 0 within the
      // same second (SQLite DATETIME is second-precision; allow a tiny slack in
      // case the second ticks over between the grant and this read).
      expect(building.produced).toBeGreaterThanOrEqual(0);
      expect(building.produced).toBeLessThanOrEqual(1);

      // NO internal/leaked columns cross the API boundary (invariant 1/2 hygiene —
      // the same discipline auth applies to passwordHash). Crucially the accrual
      // input `lastCollectedAt` is DERIVED-then-DROPPED, never exposed.
      const leaky = building as Record<string, unknown>;
      expect(leaky).not.toHaveProperty('userId');
      expect(leaky).not.toHaveProperty('lastCollectedAt');
      expect(leaky).not.toHaveProperty('createdAt');
      expect(leaky).not.toHaveProperty('deletedAt');
    }
  });

  it('is idempotent — a second read for the SAME player returns the same buildings (grant fires once)', async () => {
    const token = await registerAndLogin('bob@example.test');

    const first = (await (await getFarm(token)).json()) as FarmState;
    expect(first.buildings).toHaveLength(STARTING_BUILDINGS.length);

    // Re-read: the starter grant must NOT fire again (no duplicate buildings) —
    // same count AND the same instance ids (proves it is the same persisted rows,
    // not a fresh grant).
    const second = (await (await getFarm(token)).json()) as FarmState;
    expect(second.buildings).toHaveLength(first.buildings.length);
    expect(second.buildings.map((b) => b.id).sort()).toEqual(
      first.buildings.map((b) => b.id).sort(),
    );
  });

  it("scopes the farm per user — a second player gets their OWN buildings, not the first's rows", async () => {
    // Two distinct players each get their own starting buildings; the userId filter
    // (invariant 1's owner scoping) must keep one player's buildings out of the
    // other's response.
    const carolToken = await registerAndLogin('carol@example.test');
    const daveToken = await registerAndLogin('dave@example.test');

    const carolFarm = (await (await getFarm(carolToken)).json()) as FarmState;
    const daveFarm = (await (await getFarm(daveToken)).json()) as FarmState;

    expect(carolFarm.buildings).toHaveLength(STARTING_BUILDINGS.length);
    expect(daveFarm.buildings).toHaveLength(STARTING_BUILDINGS.length);

    // Distinct instance ids — each player owns their OWN rows (no shared/leaked
    // buildings across accounts).
    const carolIds = new Set(carolFarm.buildings.map((b) => b.id));
    const daveIds = daveFarm.buildings.map((b) => b.id);
    expect(daveIds.every((id) => !carolIds.has(id))).toBe(true);
  });

  it('AUTO-BANKS accrued production on the READ path (R-37) — GET /farm banks + resets + audits, idempotently (no sleep, L-3)', async () => {
    const token = await registerAndLogin('erin@example.test');

    // First open materializes the three starters (all accrual clocks ≈ now) and, per
    // R-37, banks their ~0 buffers (a no-op — nothing accrued, so no audit noise).
    const initial = (await (await getFarm(token)).json()) as FarmState;
    const meatFarm = initial.buildings.find((b) => b.kind === 'MeatFarm');
    const dataCenter = initial.buildings.find((b) => b.kind === 'DataCenter');
    expect(meatFarm).toBeDefined();
    expect(dataCenter).toBeDefined();
    // Just granted → nothing accrued yet, nothing banked.
    expect(meatFarm?.produced).toBeLessThanOrEqual(1);
    expect(initial.balance).toEqual([]);

    // Reach PrismaService (the SAME instance the app uses — it reads the throwaway
    // DATABASE_URL) and rewind two buildings' accrual clocks to FIXED past instants,
    // so the NEXT GET /farm accrues a real buffer to bank. No real sleeping (L-3).
    const prisma = app.get(PrismaService);
    const now = Date.now();

    // MeatFarm (rate 60/h, cap 1440): 2 hours ago → 60·2 = 120, under the cap.
    await prisma.building.update({
      where: { id: meatFarm!.id },
      data: { lastCollectedAt: new Date(now - 2 * 3_600_000) },
    });
    // DataCenter (rate 12/h, cap 288): 30 DAYS ago → 12·720 = 8640, clamped to the
    // 288 capacity (offline production stops accumulating once full).
    await prisma.building.update({
      where: { id: dataCenter!.id },
      data: { lastCollectedAt: new Date(now - 30 * 24 * 3_600_000) },
    });

    // (a) The bare GET /farm BANKS the accrued buffers into the running balance — with
    // NO Collect click — and returns the grown balance. The Data key banks its
    // cap-clamped 288; Meat banks its ~120.
    const after = (await (await getFarm(token)).json()) as FarmState;
    const meatBalance = after.balance.find((b) => b.resource === 'Meat');
    const dataBalance = after.balance.find((b) => b.resource === 'Data');
    expect(meatBalance).toBeDefined();
    expect(dataBalance).toBeDefined();
    // ±1 unit slack for the second that may tick between our fixed `now` and the
    // server's request-time `now` (SQLite DATETIME is second-precision).
    expect(meatBalance!.amount).toBeGreaterThanOrEqual(119);
    expect(meatBalance!.amount).toBeLessThanOrEqual(121);
    // Far-past elapsed → clamped EXACTLY to capacity (the storage cap).
    expect(dataBalance!.amount).toBe(288);

    // ...and the buildings' `produced` re-rendered RESET (their clocks were stamped to
    // ~now by the bank), the write R-4's read path deliberately never made pre-R-37.
    const meatAfter = after.buildings.find((b) => b.id === meatFarm!.id) as BuildingView;
    const dataAfter = after.buildings.find((b) => b.id === dataCenter!.id) as BuildingView;
    expect(meatAfter.produced).toBeLessThanOrEqual(1);
    expect(dataAfter.produced).toBeLessThanOrEqual(1);

    // (b) A subsequent DB read confirms the ResourceBalance was persisted + the
    // buildings' lastCollectedAt advanced to ~now (not still 2h/30d in the past).
    const meatBuildingRow = await prisma.building.findUnique({ where: { id: meatFarm!.id } });
    expect(meatBuildingRow).not.toBeNull();
    expect(now - meatBuildingRow!.lastCollectedAt.getTime()).toBeLessThan(60_000);
    const persistedBalances = await prisma.resourceBalance.findMany({
      where: { userId: meatBuildingRow!.userId, deletedAt: null },
    });
    expect(persistedBalances.find((b) => b.resource === 'Data')?.amount).toBe(288);

    // (c) An AuditLog row was appended for the auto-bank (invariant 3 — value moved
    // via the READ path still writes the append-only ledger, byte-identical shape).
    const auditRows = await prisma.auditLog.findMany({
      where: { userId: meatBuildingRow!.userId, action: 'collect' },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(2); // one per banked building (Meat, Data)
    const dataAudit = auditRows.find((r) => r.resource === 'Data');
    expect(dataAudit).toBeDefined();
    expect(dataAudit!.entity).toBe('Building');
    expect(dataAudit!.amountAfter - dataAudit!.amountBefore).toBe(288);

    // (d) An IMMEDIATE second GET /farm banks nothing further (idempotent — the
    // buffers were just reset, so produced ≈ 0, so no balance change + NO new audit
    // row). This keeps the ledger honest (no spam per read).
    const auditCountBefore = auditRows.length;
    const reread = (await (await getFarm(token)).json()) as FarmState;
    const dataRebalance = reread.balance.find((b) => b.resource === 'Data');
    expect(dataRebalance!.amount).toBe(288); // unchanged
    const auditAfter = await prisma.auditLog.findMany({
      where: { userId: meatBuildingRow!.userId, action: 'collect' },
    });
    expect(auditAfter.length).toBe(auditCountBefore); // no new rows
  });
});
