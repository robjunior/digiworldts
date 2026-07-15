import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import type { FarmState } from '../farm/farm.types';
import { PrismaService } from '../prisma/prisma.service';
import type { PvpOutcomeView } from '../pvp/pvp.types';
import {
  PREMIUM_CURRENCY,
  PREMIUM_PRODUCTION_MULTIPLIER,
  SHOP_ITEMS,
  STARTER_DIGICREDITS,
} from './shop.seed';
import type { ShopState } from './shop.types';

/**
 * Shop API contract (TASK-26, R-13) — the runnable proof that DigiCredits get a
 * purpose and the ethical-monetization pillar is live: a signed-in player opens a
 * premium shop, is GRANTED starter DigiCredits on first visit (a payment-free EARN,
 * A-17), sees a catalog with prices, and BUYS a quality-of-life item — the purchase
 * DEBITS DigiCredits, applies the effect (the Meat Farm's `capacity` rises), and —
 * because it MOVES value — appends an `action:'purchase'` audit row, all atomically
 * in ONE `$transaction`. An unaffordable purchase is blocked with a 422 and NOTHING
 * changes. This is the L-13 economic-mutation template's 3rd occurrence (a DEBIT in
 * a NEW guarded route) and the ledger's 3rd action. It is the API TASK-27's UI drives.
 *
 * Harness = the SAME two house patterns as the sibling `evolve.controller.spec.ts`
 * (P-2 + P-6), copied VERBATIM — `GET/POST /api/shop*` hits the DB AND is
 * guard-protected, so both halves are needed. (The shared
 * `apps/api/src/test/datastore.ts` helper the e2e skill's primary path names does
 * NOT exist yet — extracting it is a separate DISTILL item — so this spec inlines
 * the throwaway-DB block per the skill's documented fallback, matching every other
 * apps/api e2e today.)
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port,
 *    never collides) + Node's built-in `fetch` (no supertest). Exercises the true
 *    HTTP stack incl. the reused `JwtAuthGuard` and the global `ValidationPipe`.
 *  - FRICTION #8: boot via `createApp()`, NOT `Test.createTestingModule(...)`. Only
 *    `createApp()` wires the full `AppModule` (incl. `ShopModule`, the AuthModule
 *    guard export, the global `/api` prefix, cookie-parser, and the global
 *    `ValidationPipe`) — the same code path `main.ts` runs. A green boot here also
 *    proves the shop guard constructs across the module boundary; the global pipe is
 *    what makes the malformed-body → 400 case fire.
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()` — `PrismaService` reads it when `PrismaClient` is constructed).
 *    Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd depth (L-6,
 *    friction #7): this spec is at `src/shop/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`, where `schema.prisma` lives) —
 *    two levels up, the SAME depth as the evolve/collect specs.
 *
 * The DEBIT/effect state is verified by re-reading through `app.get(PrismaService)`
 * (the ledger + the raw balance/building are internal, not on the API) — the SAME
 * escape hatch the evolve/collect specs use (L-3). The target Meat Farm is
 * materialized the honest way, via a single `GET /api/farm` before purchasing
 * (friction #6 — a player visits their farm, then buys storage).
 *
 * R-15: `createApp()` owns the global `/api` prefix, so the REAL external paths are
 * `/api/shop`, `/api/shop/purchase`, `/api/farm`, `/api/auth/*`; `baseUrl` is
 * prefixed once so every call hits `/api/...`.
 *
 * Teardown closes the app FIRST (PrismaService.onModuleDestroy → $disconnect frees
 * the SQLite handle) THEN removes the temp dir and restores `DATABASE_URL`.
 */
describe('Shop API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  // The single shippable catalog item this slice offers (frozen — SHOP_ITEMS[0]).
  const ITEM = SHOP_ITEMS[0]!;

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /**
   * Register + log in a fresh account and return its access token — a real
   * authenticated principal, exactly as a client would obtain one. Each call uses a
   * unique email so tests get independent players (the per-user isolation the shop's
   * owner-scoping relies on depends on genuinely separate accounts).
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

  /** `GET /api/shop` for a token → the shop state (starter DigiCredits granted on first read). */
  const getShop = async (token: string): Promise<ShopState> => {
    const res = await fetch(`${baseUrl}/shop`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ShopState;
  };

  /**
   * `GET /api/farm` for a token — materializes the starting buildings (incl. the
   * Meat Farm the `meat-storage-1` effect upgrades) on the first empty read
   * (friction #6). Called once before a purchase so the effect has a building to
   * bump; also the honest runtime order (visit the farm, then buy storage).
   */
  const materializeFarm = async (token: string): Promise<void> => {
    const res = await fetch(`${baseUrl}/farm`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  };

  /** `POST /api/shop/purchase`, with an optional Bearer token (omitted → no header). */
  const postPurchase = (body: unknown, token?: string) =>
    fetch(`${baseUrl}/shop/purchase`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /**
   * The user id for a registered email, read straight from the datastore via
   * `app.get(PrismaService)` (the same escape hatch the evolve/collect specs use).
   * `registerAndLogin` only surfaces a token, but asserting the raw balance/building/
   * ledger needs the owner's id — this looks it up. Throws a clear error if the user
   * is absent (a test-setup bug) rather than returning a misleading `null`.
   */
  const userIdForEmail = async (email: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) {
      throw new Error(`test setup: no user registered for ${email}`);
    }
    return user.id;
  };

  /** The current banked DigiCredits `amount` for a user, or `undefined` if no row. */
  const digiCreditsAmount = async (email: string): Promise<number | undefined> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: PREMIUM_CURRENCY } },
    });
    return row?.amount;
  };

  /**
   * Force a user's DigiCredits balance to an exact amount via `app.get(PrismaService)`
   * (L-3 — no need to buy repeatedly to drain it). Uses `update` because the row
   * already exists (the starter grant created it on the first `GET /api/shop`); this
   * is the escape hatch the evolve/collect specs use to set up a known DB state.
   */
  const setDigiCredits = async (email: string, amount: number): Promise<void> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    await prisma.resourceBalance.update({
      where: { userId_resource: { userId, resource: PREMIUM_CURRENCY } },
      data: { amount },
    });
  };

  /** The caller's Meat Farm building row (the `targetResource` the item upgrades). */
  const meatBuilding = async (email: string) => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const building = await prisma.building.findFirst({
      where: { userId, resource: ITEM.targetResource, deletedAt: null },
    });
    if (building === null) {
      throw new Error(`test setup: no ${ITEM.targetResource} building for ${email}`);
    }
    return building;
  };

  /** All `action:'purchase'` audit rows recorded against a given user + item id. */
  const purchaseAuditRows = async (email: string, itemId: string) => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    return prisma.auditLog.findMany({
      where: { userId, entity: 'ShopItem', entityId: itemId, action: 'purchase' },
    });
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-shop-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'shop.db')}`;
    // src/shop/ → up TWO levels to apps/api (friction #7 / L-6). NOT a single '..'.
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'], {
      cwd: join(__dirname, '..', '..'),
      env: process.env,
      stdio: 'pipe',
    });

    // createApp() installs the full AppModule (incl. ShopModule + the AuthModule
    // guard export + the /api prefix + the global ValidationPipe). A successful boot
    // proves the guard constructs; the global pipe is what fires the 400 case.
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

  it('grants starter DigiCredits on the first GET /api/shop and returns the catalog (idempotent)', async () => {
    // Case 1: the payment-free EARN (A-17). A brand-new account's first shop visit
    // materializes STARTER_DIGICREDITS and returns the priced catalog; a SECOND visit
    // returns the SAME balance (the grant did not repeat — idempotent by the
    // existing-row check).
    const email = 'shopper-grant@example.test';
    const token = await registerAndLogin(email);

    const shop = await getShop(token);

    // The catalog: at least one item, each projected to exactly the public fields
    // (the SERVER-only effect params kind/targetResource/capacityDelta must NOT leak).
    expect(Array.isArray(shop.items)).toBe(true);
    expect(shop.items.length).toBeGreaterThanOrEqual(1);
    for (const item of shop.items) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.name).toBe('string');
      expect(typeof item.description).toBe('string');
      expect(typeof item.priceCredits).toBe('number');
      const leaky = item as Record<string, unknown>;
      expect(leaky).not.toHaveProperty('kind');
      expect(leaky).not.toHaveProperty('targetResource');
      expect(leaky).not.toHaveProperty('capacityDelta');
    }
    // The shippable item is present with its real price.
    const listed = shop.items.find((i) => i.id === ITEM.id);
    expect(listed).toBeDefined();
    expect(listed?.priceCredits).toBe(ITEM.priceCredits);

    // The starter grant landed: the balance is exactly STARTER_DIGICREDITS.
    expect(shop.balance).toBe(STARTER_DIGICREDITS);

    // Idempotent: a second read grants nothing more — same balance, not doubled.
    const again = await getShop(token);
    expect(again.balance).toBe(STARTER_DIGICREDITS);
    // And there is exactly ONE balance row (the grant created one, never two).
    expect(await digiCreditsAmount(email)).toBe(STARTER_DIGICREDITS);
  });

  it('buys an affordable item → 200 + DEBIT + capacity effect + append-only audit row', async () => {
    // Case 2: the happy path end-to-end. Grant credits (GET /api/shop) + materialize
    // the Meat Farm (GET /api/farm, friction #6), then buy: the balance drops by
    // exactly the price, the Meat Farm's capacity rises by exactly capacityDelta, and
    // ONE 'purchase' audit row is appended with a NEGATIVE delta — all atomic.
    const email = 'shopper-buy@example.test';
    const token = await registerAndLogin(email);

    await getShop(token); // grants the starter DigiCredits
    await materializeFarm(token); // materializes the Meat Farm the effect upgrades
    const capacityBefore = (await meatBuilding(email)).capacity;

    const res = await postPurchase({ itemId: ITEM.id }, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const after = (await res.json()) as ShopState;

    // The returned shop state shows the DEBITED balance (starter − price). The catalog
    // is unchanged (still lists the item at the same price — a purchase does not
    // consume the catalog entry, only the balance).
    expect(after.balance).toBe(STARTER_DIGICREDITS - ITEM.priceCredits);
    expect(after.items.find((i) => i.id === ITEM.id)?.priceCredits).toBe(ITEM.priceCredits);

    // Persisted DEBIT: the raw balance row reads exactly starter − price (a decrement,
    // not an upsert, not a no-op).
    expect(await digiCreditsAmount(email)).toBe(STARTER_DIGICREDITS - ITEM.priceCredits);

    // The QoL EFFECT applied: the Meat Farm's capacity rose by EXACTLY capacityDelta,
    // visible on the raw building row (and therefore on a future GET /api/farm).
    const capacityAfter = (await meatBuilding(email)).capacity;
    expect(capacityAfter).toBe(capacityBefore + ITEM.capacityDelta);

    // Invariant 3: exactly ONE append-only audit row for this purchase, read back
    // through PrismaService (the ledger is internal, not on the API). It records the
    // mutation with the correct action/entity/entityId/resource and a NEGATIVE delta
    // (a spend): amountAfter − amountBefore === −priceCredits.
    const rows = await purchaseAuditRows(email, ITEM.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('purchase');
    expect(row.entity).toBe('ShopItem');
    expect(row.entityId).toBe(ITEM.id);
    expect(row.resource).toBe(PREMIUM_CURRENCY);
    expect(row.amountBefore).toBe(STARTER_DIGICREDITS);
    expect(row.amountAfter).toBe(STARTER_DIGICREDITS - ITEM.priceCredits);
    expect(row.amountAfter - row.amountBefore).toBe(-ITEM.priceCredits);
    // Append-only ledgers are time-ordered — the row carries a real creation time.
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('blocks an unaffordable purchase → 422 and NOTHING is mutated (atomic rollback)', async () => {
    // Case 3: the load-bearing rollback proof. With the balance drained BELOW the
    // price, the purchase is blocked with a clear 422 reason AND the whole transaction
    // rolls back — the balance is untouched, the Meat Farm's capacity is untouched, and
    // NO 'purchase' audit row is written (no partial spend, no orphan ledger row).
    const email = 'shopper-broke@example.test';
    const token = await registerAndLogin(email);

    await getShop(token); // grants the starter DigiCredits (creates the balance row)
    await materializeFarm(token); // materialize the Meat Farm so the guard reached is affordability, not "no building"

    // Drain STRICTLY below the price (price − 1) — a real balance row exists but cannot
    // cover the cost, so the guard's `amount < priceCredits` branch fires (this also
    // proves the guard checks the AMOUNT, not merely row-existence).
    const seeded = ITEM.priceCredits - 1;
    await setDigiCredits(email, seeded);
    const capacityBefore = (await meatBuilding(email)).capacity;

    const res = await postPurchase({ itemId: ITEM.id }, token);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(typeof body.message).toBe('string');
    // The player-facing reason names the requirement (amount + currency) so the UI
    // can surface it in a role="alert" (TASK-27).
    expect(body.message).toContain(String(ITEM.priceCredits));
    expect(body.message).toContain(PREMIUM_CURRENCY);

    // Rollback proof #1: the balance is UNCHANGED (the failed debit was rolled back —
    // it still reads exactly what we drained it to, not seeded − price, and certainly
    // not a negative amount).
    expect(await digiCreditsAmount(email)).toBe(seeded);

    // Rollback proof #2: the Meat Farm's capacity is UNCHANGED (the effect never
    // applied — the tx threw before/at the debit and rolled everything back).
    const capacityAfter = (await meatBuilding(email)).capacity;
    expect(capacityAfter).toBe(capacityBefore);

    // Rollback proof #3: NO audit row was written for this blocked purchase — the
    // ledger records only mutations that actually committed.
    const rows = await purchaseAuditRows(email, ITEM.id);
    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown itemId → 404', async () => {
    // Case 4: a bad slug is not-found (the price/effect are server-authoritative, so
    // an unknown item is simply unknown). Resolved BEFORE the tx — no spend attempted.
    const email = 'shopper-unknown@example.test';
    const token = await registerAndLogin(email);
    await getShop(token); // grant credits so this is genuinely an unknown-item 404, not an affordability 422

    const res = await postPurchase({ itemId: 'does-not-exist' }, token);
    expect(res.status).toBe(404);
  });

  it('rejects a malformed body → 400 (the expectedType ValidationPipe runs)', async () => {
    // Case 5a (the P-7 pair, half one): a body missing/mistyping `itemId` is rejected
    // by the parameter-scoped ValidationPipe BEFORE the handler runs. This is the
    // guard against the P-7 footgun (a bare @Body would silently skip validation under
    // the esbuild gate and a bad body would pass as 2xx). Both an empty object and a
    // non-string itemId must 400.
    const email = 'shopper-badbody@example.test';
    const token = await registerAndLogin(email);
    await getShop(token);

    const missing = await postPurchase({}, token);
    expect(missing.status).toBe(400);

    const wrongType = await postPurchase({ itemId: 123 }, token);
    expect(wrongType.status).toBe(400);

    const empty = await postPurchase({ itemId: '' }, token);
    expect(empty.status).toBe(400);
  });

  it('rejects a purchase with NO Authorization header → 401 (the guard is live)', async () => {
    // Case 5b (the P-7 pair, half two): the spend is unreachable without a valid
    // Bearer token — no unauthenticated caller can debit anyone's DigiCredits. The
    // guard runs before the body is even validated, so a well-formed body still 401s.
    const res = await postPurchase({ itemId: ITEM.id });
    expect(res.status).toBe(401);
  });

  // ── TASK-38 (R-13b) — Premium Time: a timed +50% farm-production boost that
  // provably NEVER affects PvP. ────────────────────────────────────────────────

  // The Premium-Time catalog item + its constants (server-only fields). Frozen.
  const PREMIUM = SHOP_ITEMS.find((i) => i.kind === 'premium_time')!;

  /** The raw `premiumUntil` column for a user, or null if unset. */
  const premiumUntilFor = async (email: string): Promise<Date | null> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user?.premiumUntil ?? null;
  };

  /** `GET /api/farm` for a token → the farm state (materializes buildings on first read). */
  const getFarm = async (token: string): Promise<FarmState> => {
    const res = await fetch(`${baseUrl}/farm`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as FarmState;
  };

  /**
   * Force a building's `lastCollectedAt` back by `hours` via app.get(PrismaService)
   * so a deterministic amount has accrued for an assertion (L-3 escape hatch — no
   * real-time waiting). Backdates the caller's Meat Farm.
   */
  const backdateMeatFarm = async (email: string, hours: number): Promise<void> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const building = await prisma.building.findFirst({
      where: { userId, resource: ITEM.targetResource, deletedAt: null },
    });
    if (building === null) {
      throw new Error(`test setup: no ${ITEM.targetResource} building for ${email}`);
    }
    await prisma.building.update({
      where: { id: building.id },
      data: { lastCollectedAt: new Date(Date.now() - hours * 3_600_000) },
    });
  };

  it('buys Premium Time → 200 + DEBIT + a future premiumUntil + one purchase audit row; a second buy EXTENDS it (stacking)', async () => {
    // TASK-38 acceptance 1 + 2. Buying premium-time debits DigiCredits by exactly the
    // price, sets ShopState.premiumUntil to a future ISO ~168h out, and writes ONE
    // negative-delta 'purchase' audit row. A GET /api/shop still shows it. A SECOND buy
    // EXTENDS the expiry (stacking extends, never resets).
    const email = 'premium-buyer@example.test';
    const token = await registerAndLogin(email);

    const before = await getShop(token); // grants starter DigiCredits
    expect(before.premiumUntil).toBeNull(); // no premium before buying

    const res = await postPurchase({ itemId: PREMIUM.id }, token);
    expect(res.status).toBe(200);
    const after = (await res.json()) as ShopState;

    // The DEBIT: balance dropped by exactly priceCredits.
    expect(after.balance).toBe(STARTER_DIGICREDITS - PREMIUM.priceCredits);
    expect(await digiCreditsAmount(email)).toBe(STARTER_DIGICREDITS - PREMIUM.priceCredits);

    // premiumUntil is a FUTURE ISO instant ~durationHours out.
    expect(typeof after.premiumUntil).toBe('string');
    const firstExpiry = new Date(after.premiumUntil!).getTime();
    const now = Date.now();
    expect(firstExpiry).toBeGreaterThan(now);
    const targetMs = (PREMIUM.durationHours ?? 0) * 3_600_000;
    // Within ~1 minute of now + durationHours (the tx snapshot vs test `now` skew).
    expect(Math.abs(firstExpiry - (now + targetMs))).toBeLessThan(60_000);

    // Exactly ONE negative-delta 'purchase' audit row (invariant 3 — the SPEND is a
    // real economic mutation; premium_time reuses the existing 'purchase' action).
    const rows = await purchaseAuditRows(email, PREMIUM.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountAfter - rows[0]!.amountBefore).toBe(-PREMIUM.priceCredits);

    // A subsequent GET /api/shop still shows premiumUntil set (persisted).
    const reread = await getShop(token);
    expect(reread.premiumUntil).toBe(after.premiumUntil);

    // STACKING: top up DigiCredits and buy again → the expiry EXTENDS (is later than
    // the first), it does NOT reset to now + duration.
    await setDigiCredits(email, PREMIUM.priceCredits);
    const second = await postPurchase({ itemId: PREMIUM.id }, token);
    expect(second.status).toBe(200);
    const secondState = (await second.json()) as ShopState;
    const secondExpiry = new Date(secondState.premiumUntil!).getTime();
    expect(secondExpiry).toBeGreaterThan(firstExpiry);
    // Extended by ~another durationHours (from the still-active first expiry).
    expect(Math.abs(secondExpiry - (firstExpiry + targetMs))).toBeLessThan(60_000);
  });

  it('GET /api/farm while premium is active BANKS the BOOSTED amount (auto-bank on read, R-37; no drift)', async () => {
    // TASK-38 acceptance 3, re-expressed for R-37 (auto-bank on read): a premium
    // player's banked amount for a given elapsed time is PREMIUM_PRODUCTION_MULTIPLIER×
    // a non-premium control's. Since GET /api/farm now BANKS on read (no click), we
    // assert the boost on the banked BALANCE the read produced — the read banks
    // exactly the boosted amount (read/bank agree by construction, one shared fn).
    const premiumEmail = 'premium-farmer@example.test';
    const controlEmail = 'plain-farmer@example.test';
    const premiumToken = await registerAndLogin(premiumEmail);
    const controlToken = await registerAndLogin(controlEmail);

    // Materialize each player's Meat Farm (fresh → banks ~0).
    await getFarm(premiumToken);
    await getFarm(controlToken);

    // Give the premium player active premium (buy it).
    await getShop(premiumToken); // grant starter DigiCredits
    const buy = await postPurchase({ itemId: PREMIUM.id }, premiumToken);
    expect(buy.status).toBe(200);

    // Backdate BOTH Meat Farms by the SAME small elapsed time so a deterministic,
    // uncapped amount has accrued (1h stays well under the seeded cap).
    await backdateMeatFarm(premiumEmail, 1);
    await backdateMeatFarm(controlEmail, 1);

    // The next GET /api/farm AUTO-BANKS each player's accrued buffer into their
    // balance (R-37) — the boosted amount for premium, the flat amount for control.
    const premiumFarm = await getFarm(premiumToken);
    const controlFarm = await getFarm(controlToken);
    const premiumBanked = premiumFarm.balance.find((b) => b.resource === ITEM.targetResource);
    const controlBanked = controlFarm.balance.find((b) => b.resource === ITEM.targetResource);
    expect(controlBanked).toBeDefined();
    expect(premiumBanked).toBeDefined();

    // The control is unboosted; the premium banked amount is 1.5× it (floor of the
    // same rate·hours, clamped to capacity — 1h is well under cap for the seeded rate).
    expect(controlBanked!.amount).toBeGreaterThan(0);
    expect(premiumBanked!.amount).toBe(
      Math.floor(controlBanked!.amount * PREMIUM_PRODUCTION_MULTIPLIER),
    );

    // And the banked balance is persisted in the datastore (no drift between the
    // read's returned balance and the stored row).
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(premiumEmail);
    const meatBalance = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: ITEM.targetResource } },
    });
    expect(meatBalance?.amount).toBe(premiumBanked!.amount);
  });

  it('blocks an unaffordable Premium-Time purchase → 422, atomic rollback (no premium granted, no audit row)', async () => {
    // TASK-38 acceptance 4. With DigiCredits drained below the price, the purchase 422s
    // and NOTHING changes: no premium granted, balance unchanged, no audit row.
    const email = 'premium-broke@example.test';
    const token = await registerAndLogin(email);
    await getShop(token);

    const seeded = PREMIUM.priceCredits - 1;
    await setDigiCredits(email, seeded);

    const res = await postPurchase({ itemId: PREMIUM.id }, token);
    expect(res.status).toBe(422);

    expect(await digiCreditsAmount(email)).toBe(seeded); // balance untouched
    expect(await premiumUntilFor(email)).toBeNull(); // no premium granted
    expect(await purchaseAuditRows(email, PREMIUM.id)).toHaveLength(0); // no orphan row
  });

  it('PvP is provably UNAFFECTED by premium: same rosters → same outcome + same Elo deltas whether or not the challenger has premium', async () => {
    // TASK-38 acceptance 5 — the ethical-monetization guarantee. Two challengers with
    // IDENTICAL starter rosters challenge IDENTICAL opponents; one has premium active,
    // the other does not. The deterministic sim + Elo step must be BYTE-IDENTICAL —
    // premium touches farm production ONLY, never PvP.
    const withPremiumEmail = 'pvp-premium@example.test';
    const noPremiumEmail = 'pvp-plain@example.test';
    const opponentAEmail = 'pvp-opp-a@example.test';
    const opponentBEmail = 'pvp-opp-b@example.test';

    const materializeRoster = async (token: string) => {
      const res = await fetch(`${baseUrl}/digimon`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    };
    const withPremiumToken = await registerAndLogin(withPremiumEmail);
    const noPremiumToken = await registerAndLogin(noPremiumEmail);
    const opponentAToken = await registerAndLogin(opponentAEmail);
    const opponentBToken = await registerAndLogin(opponentBEmail);
    await materializeRoster(withPremiumToken);
    await materializeRoster(noPremiumToken);
    await materializeRoster(opponentAToken);
    await materializeRoster(opponentBToken);

    // Give ONE challenger active premium; leave the other with none.
    await getShop(withPremiumToken);
    expect((await postPurchase({ itemId: PREMIUM.id }, withPremiumToken)).status).toBe(200);
    expect(await premiumUntilFor(withPremiumEmail)).not.toBeNull();
    expect(await premiumUntilFor(noPremiumEmail)).toBeNull();

    const opponentAId = await userIdForEmail(opponentAEmail);
    const opponentBId = await userIdForEmail(opponentBEmail);

    const challenge = async (token: string, opponentId: string) => {
      const res = await jsonPost('/pvp/challenge', { opponentId }, token);
      expect(res.status).toBe(200);
      return (await res.json()) as PvpOutcomeView;
    };

    const premiumOutcome = await challenge(withPremiumToken, opponentAId);
    const plainOutcome = await challenge(noPremiumToken, opponentBId);

    // Identical fresh starter rosters (all at mmr 1000) → identical outcome AND
    // identical symmetric Elo deltas. Premium changed NOTHING about the fight.
    expect(premiumOutcome.outcome).toBe(plainOutcome.outcome);
    expect(premiumOutcome.challenger.mmrBefore).toBe(plainOutcome.challenger.mmrBefore);
    expect(premiumOutcome.challenger.mmrAfter).toBe(plainOutcome.challenger.mmrAfter);
    expect(premiumOutcome.opponent.mmrBefore).toBe(plainOutcome.opponent.mmrBefore);
    expect(premiumOutcome.opponent.mmrAfter).toBe(plainOutcome.opponent.mmrAfter);
    // The full deterministic turn log is byte-identical (the sim ignored premium).
    expect(premiumOutcome.turns).toEqual(plainOutcome.turns);
  });
});
