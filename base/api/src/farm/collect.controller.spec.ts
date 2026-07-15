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
import type { FarmState, ResourceBalanceView } from './farm.types';

/**
 * `POST /farm/collect` API contract (TASK-22, R-4b) — the runnable proof of the
 * game's FIRST economic mutation and FIRST invariant-3 audit write.
 *
 * R-4 was carved read-only: `GET /farm` computes `produced` on read but writes
 * nothing economic. THIS endpoint is where value first MOVES: a signed-in player
 * collects, every ready building's accrued buffer is BANKED into a persisted,
 * spendable per-resource `ResourceBalance`, the accrual clock resets, and — because
 * it is an economic mutation — an append-only `AuditLog` row is written inside the
 * SAME transaction (invariant 3). This spec exercises the whole thing end to end,
 * mirroring the acceptance-check curls.
 *
 * Harness = the SAME house patterns as `farm.controller.spec.ts` (P-2 + P-6),
 * hand-rolled inline VERBATIM (the sibling `nest-e2e-and-datastore-tests` skill
 * points at a shared `apps/api/src/test/datastore.ts` helper, but that file does
 * NOT exist yet — so this takes the skill's documented fallback and copies the
 * throwaway-DB block). `POST /farm/collect` hits the DB AND is guard-protected, so
 * both halves are needed:
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port,
 *    never collides) + Node's built-in `fetch` (no supertest). Exercises the true
 *    HTTP stack incl. the reused `JwtAuthGuard` on the mutation.
 *  - Boot via `createApp()`, NOT `Test.createTestingModule(...)` — only
 *    `createApp()` installs the global `ValidationPipe` AND wires the full
 *    `AppModule` (incl. FarmModule + the AuthModule guard export), so the 401-guard
 *    assertion is meaningful and `FarmService`/`FarmController`'s explicit `@Inject`
 *    DI is proven to resolve (a bare param would 500 the first request; L-7/P-7).
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()` — `PrismaService` reads it when `PrismaClient` is constructed).
 *    Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd depth (L-6):
 *    this spec is at `src/farm/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`, where `schema.prisma` lives) —
 *    two levels up, the SAME depth as `farm.controller.spec.ts`.
 *
 * A KNOWN accrued amount is set up WITHOUT sleeping (L-3): after the first-open
 * grant we reach `PrismaService` via `app.get(PrismaService)` and directly `update`
 * a building's `lastCollectedAt` to a FIXED past instant, then `POST /farm/collect`
 * and assert the clamped integer banked amount. No `setTimeout`, no real elapsed
 * time.
 *
 * Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect frees
 * the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 */
describe('Farm collect API (end-to-end)', () => {
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

  /**
   * Register + log in a fresh account and return its access token — a real
   * authenticated principal, exactly as a client would obtain one. Each call uses
   * a unique email so tests get independent players (per-user isolation check).
   */
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

  const getFarm = (token?: string) =>
    fetch(`${baseUrl}/farm`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  // The collect endpoint takes NO body — "collect all ready buildings" needs none
  // (so no DTO/ValidationPipe). A missing token means an empty header set → 401.
  const collect = (token?: string) =>
    fetch(`${baseUrl}/farm/collect`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /** Find one balance entry by resource in a FarmState response (or undefined). */
  const balanceOf = (farm: FarmState, resource: string): ResourceBalanceView | undefined =>
    farm.balance.find((b) => b.resource === resource);

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-collect-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'collect.db')}`;
    // src/farm/ → up TWO levels to apps/api (friction #3 / L-6). NOT a single '..'.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    // createApp() installs the full AppModule (FarmModule + the AuthModule guard
    // export + the global ValidationPipe) — the same path main.ts runs. A green
    // boot proves the guard constructs AND FarmService/FarmController's explicit
    // @Inject DI resolves (a bare param would 500 the first collect; L-7/P-7).
    app = await createApp();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    // R-15: the server owns the global `/api` prefix (createApp → setGlobalPrefix),
    // so the REAL external addresses are /api/farm and /api/farm/collect — the exact
    // URLs the SPA calls over the (rewrite-free) Vite dev proxy. Prefixing baseUrl
    // once makes every request hit /api/..., so this e2e is the regression cover.
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app?.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('rejects POST /farm/collect with NO Authorization header → 401 (the guard protects the mutation)', async () => {
    // The mutation is unreachable without a valid Bearer token — the
    // "server-authoritative, unreachable signed out" guarantee for a WRITE
    // (acceptance check 6). If the guard were missing, collect would be an
    // unauthenticated economic mutation.
    const res = await collect();
    expect(res.status).toBe(401);
  });

  it('rejects POST /farm/collect with a garbage token → 401', async () => {
    const res = await collect('not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it("banks a building's accrued buffer into a spendable balance, resets its clock, and the balance PERSISTS (acceptance 1-3)", async () => {
    const token = await registerAndLogin('collector@example.test');

    // First open materializes the three starters (all accrual clocks ≈ now).
    const initial = (await (await getFarm(token)).json()) as FarmState;
    const meatFarm = initial.buildings.find((b) => b.kind === 'MeatFarm');
    expect(meatFarm).toBeDefined();
    // Freshly granted → nothing accrued yet, and NO balance banked yet.
    expect(meatFarm?.produced).toBeLessThanOrEqual(1);
    expect(initial.balance).toEqual([]);

    // Rewind the MeatFarm's accrual clock to a FIXED past instant so it has a KNOWN
    // accrued buffer WITHOUT sleeping (L-3). MeatFarm = rate 60/h, cap 1440; 2h ago
    // → 60·2 = 120, under the cap.
    const prisma = app.get(PrismaService);
    const now = Date.now();
    await prisma.building.update({
      where: { id: meatFarm!.id },
      data: { lastCollectedAt: new Date(now - 2 * 3_600_000) },
    });
    const expectedMeat = 120;

    // (1) POST /farm/collect → 200 and the response `balance` reflects the banked
    // amount for Meat (= clamp(floor(rate·hours), 0, cap) = 120, ±1 for SQLite
    // second-precision between our fixed `now` and the server's request-time now).
    const collectRes = await collect(token);
    expect(collectRes.status).toBe(200);
    expect(collectRes.headers.get('content-type')).toContain('application/json');
    const collected = (await collectRes.json()) as FarmState;

    const meatBalance = balanceOf(collected, 'Meat');
    expect(meatBalance).toBeDefined();
    expect(meatBalance!.amount).toBeGreaterThanOrEqual(expectedMeat - 1);
    expect(meatBalance!.amount).toBeLessThanOrEqual(expectedMeat + 1);
    const banked = meatBalance!.amount;

    // The freshly-granted starters (BitBank/DataCenter) accrued ~0, so they were
    // SKIPPED (no-op) — no Bits/Data balance row was created.
    expect(balanceOf(collected, 'Bits')).toBeUndefined();
    expect(balanceOf(collected, 'Data')).toBeUndefined();

    // (2) A re-read GET /farm shows THAT building's produced === 0 (its accrual
    // clock was reset to `now` by the collect — the write R-4's read never made).
    const afterCollect = (await (await getFarm(token)).json()) as FarmState;
    const meatAfter = afterCollect.buildings.find((b) => b.id === meatFarm!.id);
    expect(meatAfter).toBeDefined();
    expect(meatAfter!.produced).toBeLessThanOrEqual(1);

    // (3) The balance PERSISTS — a second, independent GET /farm STILL shows it
    // (it lives in ResourceBalance, not recomputed from the buildings). This is the
    // "reload and your resources are still there" guarantee.
    const reread = (await (await getFarm(token)).json()) as FarmState;
    const meatReread = balanceOf(reread, 'Meat');
    expect(meatReread).toBeDefined();
    expect(meatReread!.amount).toBe(banked);
  });

  it('writes an append-only AuditLog row for the collect (invariant 3, acceptance 4)', async () => {
    const token = await registerAndLogin('audited@example.test');

    const initial = (await (await getFarm(token)).json()) as FarmState;
    const dataCenter = initial.buildings.find((b) => b.kind === 'DataCenter');
    expect(dataCenter).toBeDefined();

    // DataCenter = rate 12/h, cap 288; 5h ago → 12·5 = 60, under the cap.
    const prisma = app.get(PrismaService);
    const now = Date.now();
    await prisma.building.update({
      where: { id: dataCenter!.id },
      data: { lastCollectedAt: new Date(now - 5 * 3_600_000) },
    });

    const collected = (await (await collect(token)).json()) as FarmState;
    const dataBalance = balanceOf(collected, 'Data');
    expect(dataBalance).toBeDefined();
    const banked = dataBalance!.amount; // ~60

    // The invariant-3 ledger row exists, read back through PrismaService (the
    // datastore, not the API — the audit trail is internal). Retrieve it via the
    // @@index([entity, entityId]) access path TASK-21 built: "the full audit trail
    // for THIS building". Append-only, so exactly ONE row exists for this collect.
    const auditRows = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: dataCenter!.id },
    });
    expect(auditRows).toHaveLength(1);
    const row = auditRows[0]!;
    expect(row.action).toBe('collect');
    expect(row.entity).toBe('Building');
    expect(row.entityId).toBe(dataCenter!.id);
    expect(row.resource).toBe('Data');
    // before → after: the row is self-contained (both halves stored, not a delta),
    // and the delta is EXACTLY the banked amount (produced). Starting from an empty
    // balance, amountBefore is 0.
    expect(row.amountBefore).toBe(0);
    expect(row.amountAfter).toBe(banked);
    expect(row.amountAfter - row.amountBefore).toBe(banked);
    // It is stamped with a real creation time (append-only ledgers are time-ordered).
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('is safe to repeat — a second immediate collect banks ~0 more (the buffer is drained; acceptance 5)', async () => {
    const token = await registerAndLogin('twice@example.test');

    const initial = (await (await getFarm(token)).json()) as FarmState;
    const meatFarm = initial.buildings.find((b) => b.kind === 'MeatFarm');
    expect(meatFarm).toBeDefined();

    // Force a known buffer (MeatFarm 60/h, 3h ago → 180, under the 1440 cap).
    const prisma = app.get(PrismaService);
    const now = Date.now();
    await prisma.building.update({
      where: { id: meatFarm!.id },
      data: { lastCollectedAt: new Date(now - 3 * 3_600_000) },
    });

    // First collect banks ~180.
    const first = (await (await collect(token)).json()) as FarmState;
    const afterFirst = balanceOf(first, 'Meat');
    expect(afterFirst).toBeDefined();
    expect(afterFirst!.amount).toBeGreaterThanOrEqual(179);
    expect(afterFirst!.amount).toBeLessThanOrEqual(181);
    const bankedFirst = afterFirst!.amount;

    // Second immediate collect: the clock was reset to `now`, so ~0 more has
    // accrued — the balance is essentially unchanged (±1 for a second ticking over).
    // The mutation being safe to repeat is what lets a UI fire it freely.
    const second = (await (await collect(token)).json()) as FarmState;
    const afterSecond = balanceOf(second, 'Meat');
    expect(afterSecond).toBeDefined();
    expect(afterSecond!.amount).toBeGreaterThanOrEqual(bankedFirst);
    expect(afterSecond!.amount).toBeLessThanOrEqual(bankedFirst + 1);

    // And a second collect on an ALREADY-drained buffer wrote no NEW audit row for
    // the (now zero-buffer) building: it produced 0 → skipped → no audit noise.
    // Exactly one collect row exists per non-zero collect (here, the first only).
    const auditRows = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: meatFarm!.id, action: 'collect' },
    });
    expect(auditRows).toHaveLength(1);
  });

  it("is owner-scoped — one player's collect does NOT touch another player's buildings or balance (invariant 2, acceptance 6)", async () => {
    const aliceToken = await registerAndLogin('alice-collect@example.test');
    const bobToken = await registerAndLogin('bob-collect@example.test');

    // Both players open their farms (each granted their own three starters).
    const aliceInitial = (await (await getFarm(aliceToken)).json()) as FarmState;
    const bobInitial = (await (await getFarm(bobToken)).json()) as FarmState;
    const aliceMeat = aliceInitial.buildings.find((b) => b.kind === 'MeatFarm');
    const bobMeat = bobInitial.buildings.find((b) => b.kind === 'MeatFarm');
    expect(aliceMeat).toBeDefined();
    expect(bobMeat).toBeDefined();
    // Distinct instance ids — each owns their OWN rows (no shared/leaked buildings).
    expect(aliceMeat!.id).not.toBe(bobMeat!.id);

    // Rewind BOTH players' MeatFarm clocks so both have a buffer to collect.
    const prisma = app.get(PrismaService);
    const now = Date.now();
    await prisma.building.update({
      where: { id: aliceMeat!.id },
      data: { lastCollectedAt: new Date(now - 4 * 3_600_000) }, // 240
    });
    await prisma.building.update({
      where: { id: bobMeat!.id },
      data: { lastCollectedAt: new Date(now - 4 * 3_600_000) },
    });

    // ONLY Alice collects.
    const aliceCollected = (await (await collect(aliceToken)).json()) as FarmState;
    expect(balanceOf(aliceCollected, 'Meat')!.amount).toBeGreaterThanOrEqual(239);

    // Bob is UNTOUCHED by Alice's collect. Because R-37 makes GET /farm auto-bank,
    // we prove Alice's collect left Bob's rows alone by reading Bob's DB state
    // DIRECTLY (before Bob himself reads /farm, which would bank his own buffer):
    // his MeatFarm clock is still 4h in the past (Alice's collect never reset it),
    // he has no balance row yet, and no AuditLog row exists against his building.
    const bobMeatRowBeforeRead = await prisma.building.findUnique({ where: { id: bobMeat!.id } });
    expect(bobMeatRowBeforeRead).not.toBeNull();
    expect(now - bobMeatRowBeforeRead!.lastCollectedAt.getTime()).toBeGreaterThan(3 * 3_600_000);
    const bobUserId = bobMeatRowBeforeRead!.userId;
    const bobBalanceBeforeRead = await prisma.resourceBalance.findMany({
      where: { userId: bobUserId, deletedAt: null },
    });
    expect(bobBalanceBeforeRead).toEqual([]);
    const bobAudit = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: bobMeat!.id },
    });
    expect(bobAudit).toHaveLength(0);

    // Now Bob opens his OWN farm: R-37 auto-banks HIS ~240 buffer into HIS balance
    // (his read, his bank — never Alice's). Balance grows, buffer resets.
    const bobFarm = (await (await getFarm(bobToken)).json()) as FarmState;
    expect(balanceOf(bobFarm, 'Meat')!.amount).toBeGreaterThanOrEqual(239);
    const bobMeatAfter = bobFarm.buildings.find((b) => b.id === bobMeat!.id);
    expect(bobMeatAfter).toBeDefined();
    // Buffer banked on read → reset to ~0.
    expect(bobMeatAfter!.produced).toBeLessThanOrEqual(1);

    // Alice's own building carries exactly her one collect audit row.
    const aliceAudit = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: aliceMeat!.id },
    });
    expect(aliceAudit).toHaveLength(1);
    expect(aliceAudit[0]!.userId).not.toBe('');
  });

  it('collects MULTIPLE resources in one mutation — banks each into its own balance and audits each non-zero building (acceptance 7)', async () => {
    const token = await registerAndLogin('multi@example.test');

    const initial = (await (await getFarm(token)).json()) as FarmState;
    const meatFarm = initial.buildings.find((b) => b.kind === 'MeatFarm');
    const bitBank = initial.buildings.find((b) => b.kind === 'BitBank');
    const dataCenter = initial.buildings.find((b) => b.kind === 'DataCenter');
    expect(meatFarm).toBeDefined();
    expect(bitBank).toBeDefined();
    expect(dataCenter).toBeDefined();

    // Rewind two of the three (different resources) to accrue; leave DataCenter
    // fresh (~0) so we also prove a zero-buffer building is SKIPPED in a mixed batch.
    const prisma = app.get(PrismaService);
    const now = Date.now();
    // MeatFarm 60/h, 2h → 120 (Meat).
    await prisma.building.update({
      where: { id: meatFarm!.id },
      data: { lastCollectedAt: new Date(now - 2 * 3_600_000) },
    });
    // BitBank 30/h, 2h → 60 (Bits).
    await prisma.building.update({
      where: { id: bitBank!.id },
      data: { lastCollectedAt: new Date(now - 2 * 3_600_000) },
    });

    // ONE collect banks BOTH ready buildings into their respective balances.
    const collected = (await (await collect(token)).json()) as FarmState;

    const meatBalance = balanceOf(collected, 'Meat');
    const bitsBalance = balanceOf(collected, 'Bits');
    expect(meatBalance).toBeDefined();
    expect(bitsBalance).toBeDefined();
    expect(meatBalance!.amount).toBeGreaterThanOrEqual(119);
    expect(meatBalance!.amount).toBeLessThanOrEqual(121);
    expect(bitsBalance!.amount).toBeGreaterThanOrEqual(59);
    expect(bitsBalance!.amount).toBeLessThanOrEqual(61);

    // DataCenter was fresh (~0 buffer) → SKIPPED: no Data balance row created.
    expect(balanceOf(collected, 'Data')).toBeUndefined();

    // One audit row per NON-ZERO building (two here: Meat + Bits), none for the
    // skipped DataCenter — an empty-buffer collect writes no audit noise.
    const meatAudit = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: meatFarm!.id, action: 'collect' },
    });
    const bitAudit = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: bitBank!.id, action: 'collect' },
    });
    const dataAudit = await prisma.auditLog.findMany({
      where: { entity: 'Building', entityId: dataCenter!.id, action: 'collect' },
    });
    expect(meatAudit).toHaveLength(1);
    expect(bitAudit).toHaveLength(1);
    expect(dataAudit).toHaveLength(0);
    expect(meatAudit[0]!.resource).toBe('Meat');
    expect(bitAudit[0]!.resource).toBe('Bits');
  });
});
