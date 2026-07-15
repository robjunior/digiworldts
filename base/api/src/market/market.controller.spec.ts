import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import type { OwnedDigimon } from '../digimon/digimon.types';
import { PrismaService } from '../prisma/prisma.service';
import { PREMIUM_CURRENCY } from '../shop/shop.seed';
import type { MarketListingView, MarketState } from './market.types';

/**
 * Player-market API contract (TASK-42, R-10) — the runnable proof of the core market
 * fantasy: a player lists ONE of their OWNED Digimon for a DigiCredits price, every
 * player sees the open offers, and a DIFFERENT player BUYS one — DigiCredits transfer
 * seller↔buyer, the Digimon changes hands (`userId` reassignment), and — because value
 * MOVES between two accounts — TWO append-only `market-sale` AuditLog rows are written
 * (buyer DEBIT + seller CREDIT), all atomically in ONE `$transaction`. A self-buy /
 * insufficient balance / double-buy / list-what-you-don't-own is rejected and NOTHING
 * moves. This is the L-13 template applied to BOTH signs at once + the ledger's 5th
 * action. It is the API TASK-43's `/market` UI drives.
 *
 * Harness = the SAME two house patterns as the sibling `shop.controller.spec.ts`
 * (P-2 + P-6), copied VERBATIM — `/api/market*` hits the DB AND is guard-protected, so
 * both halves are needed. (The shared `apps/api/src/test/datastore.ts` helper the e2e
 * skill's primary path names does NOT exist yet — extracting it is a separate DISTILL
 * item — so this spec inlines the throwaway-DB block per the skill's documented
 * fallback, matching every other apps/api e2e today.)
 *
 *  - P-2 (endpoint e2e): boot a REAL Nest app + `app.listen(0)` (ephemeral port) +
 *    Node's built-in `fetch` (no supertest).
 *  - FRICTION #8: boot via `createApp()`, NOT `Test.createTestingModule(...)` — only
 *    `createApp()` wires the full `AppModule` (incl. MarketModule, the AuthModule guard
 *    export, the `/api` prefix, and the global `ValidationPipe` the 400 case needs).
 *  - P-6 (hermetic throwaway DB): NEVER touch the shared `apps/api/prisma/dev.db`.
 *    `DATABASE_URL` → a per-run temp SQLite file (ABSOLUTE path, set BEFORE
 *    `createApp()`). Schema applied with `prisma db push --skip-generate`. CRUCIAL cwd
 *    depth (L-6, friction #7): this spec is at `src/market/`, so `db push` runs from
 *    `join(__dirname, '..', '..')` (= `apps/api`) — two levels up, same as shop/pvp.
 *
 * The DEBIT/CREDIT/ownership/ledger state is verified by re-reading through
 * `app.get(PrismaService)` (the raw balances + ledger + Digimon owner are internal, not
 * on the API) — the SAME escape hatch the shop/evolve specs use (L-3).
 *
 * R-15: `createApp()` owns the global `/api` prefix, so the REAL external paths are
 * `/api/market`, `/api/market/list`, `/api/market/<id>/buy`, `/api/shop`, `/api/digimon`,
 * `/api/auth/*`; `baseUrl` is prefixed once.
 */
describe('Player market API (end-to-end)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tmpDir: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /** POST a bodyless route (the buy), with an optional Bearer token. */
  const post = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  /** Register + log in a fresh account → its access token (a real principal). */
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

  /** `GET /api/digimon` → the caller's roster (starter-granted on first read). */
  const getRoster = async (token: string): Promise<OwnedDigimon[]> => {
    const res = await fetch(`${baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as OwnedDigimon[];
  };

  /** `GET /api/shop` → grants the starter 300 DigiCredits (we ignore the body). */
  const grantStarterCredits = async (token: string): Promise<void> => {
    const res = await fetch(`${baseUrl}/shop`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  };

  /** `GET /api/market` → the open listings, with an optional token. */
  const getMarket = (token?: string) =>
    fetch(`${baseUrl}/market`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  // ── DB escape-hatch helpers (L-3) — the raw balances/ledger/owner are internal. ──
  const userIdForEmail = async (email: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findFirst({ where: { email } });
    if (user === null) throw new Error(`test setup: no user for ${email}`);
    return user.id;
  };

  const digiCredits = async (email: string): Promise<number | undefined> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    const row = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: PREMIUM_CURRENCY } },
    });
    return row?.amount;
  };

  const setDigiCredits = async (email: string, amount: number): Promise<void> => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    await prisma.resourceBalance.update({
      where: { userId_resource: { userId, resource: PREMIUM_CURRENCY } },
      data: { amount },
    });
  };

  const digimonOwnerId = async (digimonId: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const row = await prisma.digimon.findUnique({ where: { id: digimonId } });
    if (row === null) throw new Error(`test setup: no digimon ${digimonId}`);
    return row.userId;
  };

  const listingStatus = async (listingId: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const row = await prisma.marketListing.findUnique({ where: { id: listingId } });
    if (row === null) throw new Error(`test setup: no listing ${listingId}`);
    return row.status;
  };

  const saleAuditRows = async (email: string) => {
    const prisma = app.get(PrismaService);
    const userId = await userIdForEmail(email);
    return prisma.auditLog.findMany({
      where: { userId, action: 'market-sale' },
    });
  };

  /**
   * Register a seller + buyer, grant both starter credits + rosters, and have the
   * seller list their first Digimon at `price`. Returns everything a case needs.
   */
  const setUpListing = async (
    sellerEmail: string,
    buyerEmail: string,
    price: number,
  ): Promise<{
    sellerToken: string;
    buyerToken: string;
    digimonId: string;
    listing: MarketListingView;
  }> => {
    const sellerToken = await registerAndLogin(sellerEmail);
    const buyerToken = await registerAndLogin(buyerEmail);
    await grantStarterCredits(sellerToken);
    await grantStarterCredits(buyerToken);
    const roster = await getRoster(sellerToken);
    await getRoster(buyerToken);
    const digimonId = roster[0]!.id;

    const res = await jsonPost('/market/list', { digimonId, priceCredits: price }, sellerToken);
    expect(res.status).toBe(200);
    const listing = (await res.json()) as MarketListingView;
    return { sellerToken, buyerToken, digimonId, listing };
  };

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'digimon-api-market-'));
    process.env.DATABASE_URL = `file:${join(tmpDir, 'market.db')}`;
    // src/market/ → up TWO levels to apps/api (friction #7 / L-6). NOT a single '..'.
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

  it('lists an owned Digimon and shows it OPEN + leak-safe in GET /api/market', async () => {
    // Cases 1 + 2. GET /api/market is a leak-safe MarketListingView[]; after a seller
    // lists their Digimon it appears OPEN with the seller's DISPLAY NAME (email local
    // part) + the Digimon's public fields — and never `sellerId`/email.
    const { sellerToken, listing } = await setUpListing(
      'mkt-seller-list@example.test',
      'mkt-buyer-list@example.test',
      100,
    );

    // The create response is already leak-safe.
    expect(listing.sellerDisplayName).toBe('mkt-seller-list');
    const leakyCreate = listing as Record<string, unknown>;
    expect(leakyCreate).not.toHaveProperty('sellerId');
    expect(leakyCreate).not.toHaveProperty('email');

    const res = await getMarket(sellerToken);
    expect(res.status).toBe(200);
    const market = (await res.json()) as MarketListingView[];
    expect(Array.isArray(market)).toBe(true);
    const found = market.find((l) => l.id === listing.id);
    expect(found).toBeDefined();
    expect(found?.priceCredits).toBe(100);
    // Leak-safe: a display name + the Digimon's public fields, NEVER sellerId/email.
    expect(found?.sellerDisplayName).toBe('mkt-seller-list');
    const leaky = found as unknown as Record<string, unknown>;
    expect(leaky).not.toHaveProperty('sellerId');
    expect(leaky).not.toHaveProperty('email');
    expect(typeof found?.digimon.name).toBe('string');
    expect(typeof found?.digimon.level).toBe('number');
    const leakyDigimon = found?.digimon as unknown as Record<string, unknown>;
    expect(leakyDigimon).not.toHaveProperty('userId');
  });

  it('buys an open listing → 200: ownership + DigiCredits move both ways, listing sold, TWO audit rows', async () => {
    // Case 3 — the headline. A different player buys the listing: the Digimon's userId
    // becomes the buyer's, the buyer's DigiCredits drop by exactly the price, the
    // seller's rise by exactly the price, the listing is `sold`, and EXACTLY two
    // `market-sale` audit rows exist (one negative to the buyer, one positive to the
    // seller) — all atomic.
    const price = 120;
    const sellerEmail = 'mkt-seller-buy@example.test';
    const buyerEmail = 'mkt-buyer-buy@example.test';
    const { buyerToken, digimonId, listing } = await setUpListing(sellerEmail, buyerEmail, price);

    const buyerCreditsBefore = (await digiCredits(buyerEmail))!;
    const sellerCreditsBefore = (await digiCredits(sellerEmail))!;
    const sellerId = await userIdForEmail(sellerEmail);
    const buyerId = await userIdForEmail(buyerEmail);
    // Pre-condition: the seller still owns the Digimon.
    expect(await digimonOwnerId(digimonId)).toBe(sellerId);

    const res = await post(`/market/${listing.id}/buy`, buyerToken);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const state = (await res.json()) as MarketState;

    // The response carries the buyer's DEBITED balance + the ACQUIRED Digimon.
    expect(state.balance).toBe(buyerCreditsBefore - price);
    expect(state.digimon?.id).toBe(digimonId);

    // Ownership moved: the Digimon now belongs to the BUYER.
    expect(await digimonOwnerId(digimonId)).toBe(buyerId);

    // Currency moved BOTH ways by exactly the price.
    expect(await digiCredits(buyerEmail)).toBe(buyerCreditsBefore - price);
    expect(await digiCredits(sellerEmail)).toBe(sellerCreditsBefore + price);

    // The listing is closed (sold) → it leaves GET /api/market.
    expect(await listingStatus(listing.id)).toBe('sold');
    const market = (await (await getMarket(buyerToken)).json()) as MarketListingView[];
    expect(market.find((l) => l.id === listing.id)).toBeUndefined();

    // Invariant 3: exactly TWO market-sale audit rows — one negative (buyer), one
    // positive (seller), owner-attributed to the party whose balance moved (A-23).
    const buyerRows = await saleAuditRows(buyerEmail);
    expect(buyerRows).toHaveLength(1);
    expect(buyerRows[0]!.entity).toBe('MarketListing');
    expect(buyerRows[0]!.entityId).toBe(listing.id);
    expect(buyerRows[0]!.resource).toBe(PREMIUM_CURRENCY);
    expect(buyerRows[0]!.amountAfter - buyerRows[0]!.amountBefore).toBe(-price);

    const sellerRows = await saleAuditRows(sellerEmail);
    expect(sellerRows).toHaveLength(1);
    expect(sellerRows[0]!.entityId).toBe(listing.id);
    expect(sellerRows[0]!.amountAfter - sellerRows[0]!.amountBefore).toBe(price);
  });

  it('rejects a self-buy → 422 and NOTHING moves', async () => {
    // Case 4. The seller buying their OWN listing is a 422 before any balance move —
    // ownership, both balances, and the listing status are all unchanged.
    const sellerEmail = 'mkt-self-seller@example.test';
    const { sellerToken, digimonId, listing } = await setUpListing(
      sellerEmail,
      'mkt-self-buyer@example.test',
      100,
    );
    const sellerId = await userIdForEmail(sellerEmail);
    const creditsBefore = (await digiCredits(sellerEmail))!;

    const res = await post(`/market/${listing.id}/buy`, sellerToken);
    expect(res.status).toBe(422);

    expect(await digimonOwnerId(digimonId)).toBe(sellerId); // still the seller's
    expect(await digiCredits(sellerEmail)).toBe(creditsBefore); // untouched
    expect(await listingStatus(listing.id)).toBe('open'); // still open
    expect(await saleAuditRows(sellerEmail)).toHaveLength(0); // no ledger row
  });

  it('rejects an unaffordable buy → 422 + atomic rollback (no move, no audit row)', async () => {
    // Case 5. With the buyer's DigiCredits drained BELOW the price, the buy 422s and the
    // whole tx rolls back: ownership unchanged, both balances unchanged, listing still
    // open, and NO audit row on either side.
    const price = 200;
    const sellerEmail = 'mkt-broke-seller@example.test';
    const buyerEmail = 'mkt-broke-buyer@example.test';
    const { buyerToken, digimonId, listing } = await setUpListing(sellerEmail, buyerEmail, price);
    const sellerId = await userIdForEmail(sellerEmail);
    const seeded = price - 1; // strictly below the price → the amount guard fires
    await setDigiCredits(buyerEmail, seeded);
    const sellerCreditsBefore = (await digiCredits(sellerEmail))!;

    const res = await post(`/market/${listing.id}/buy`, buyerToken);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain(String(price));
    expect(body.message).toContain(PREMIUM_CURRENCY);

    // Rollback: nothing moved.
    expect(await digimonOwnerId(digimonId)).toBe(sellerId);
    expect(await digiCredits(buyerEmail)).toBe(seeded);
    expect(await digiCredits(sellerEmail)).toBe(sellerCreditsBefore);
    expect(await listingStatus(listing.id)).toBe('open');
    expect(await saleAuditRows(buyerEmail)).toHaveLength(0);
    expect(await saleAuditRows(sellerEmail)).toHaveLength(0);
  });

  it('rejects buying an already-sold listing → 409 on the second buy', async () => {
    // Case 6. The first buy sells the listing; a second buy (by anyone) sees it is no
    // longer `open` and 404/409s. The service resolves a non-open listing as not-found
    // (404) since the `status:'open'` filter excludes it; the task allows 409 for a
    // stale listing — here the second buyer gets the not-found path (the listing is
    // gone from `open`), so we accept the 4xx and assert nothing double-moved.
    const price = 100;
    const buyerBEmail = 'mkt-second-buyer@example.test';
    const { buyerToken, listing } = await setUpListing(
      'mkt-sold-seller@example.test',
      'mkt-first-buyer@example.test',
      price,
    );
    const buyerBToken = await registerAndLogin(buyerBEmail);
    await grantStarterCredits(buyerBToken);
    await getRoster(buyerBToken);

    const first = await post(`/market/${listing.id}/buy`, buyerToken);
    expect(first.status).toBe(200);

    const second = await post(`/market/${listing.id}/buy`, buyerBToken);
    // A now-sold listing is excluded by the `status:'open'` filter → not-found (404).
    expect(second.status).toBe(404);
    // The second buyer's balance never moved (their starter credits are intact).
    expect(await saleAuditRows(buyerBEmail)).toHaveLength(0);
  });

  it("rejects listing a Digimon you don't own → 404", async () => {
    // Case 7. The buyer tries to list the SELLER's Digimon id → the owner-scoped resolve
    // misses (it is not the buyer's) → a generic 404, no listing created.
    const sellerToken = await registerAndLogin('mkt-owner-seller@example.test');
    const buyerToken = await registerAndLogin('mkt-thief-buyer@example.test');
    await grantStarterCredits(buyerToken);
    const sellerRoster = await getRoster(sellerToken);
    await getRoster(buyerToken);
    const sellersDigimonId = sellerRoster[0]!.id;

    const res = await jsonPost(
      '/market/list',
      { digimonId: sellersDigimonId, priceCredits: 50 },
      buyerToken,
    );
    expect(res.status).toBe(404);
  });

  it('rejects a malformed list body → 400 (the expectedType ValidationPipe runs)', async () => {
    // The P-7 guard: a body missing/mistyping the fields is rejected by the parameter-
    // scoped ValidationPipe BEFORE the handler (if it were silently skipped, a bad body
    // would 2xx). An empty object, a non-string digimonId, and a price < 1 all 400.
    const token = await registerAndLogin('mkt-badbody@example.test');

    expect((await jsonPost('/market/list', {}, token)).status).toBe(400);
    expect(
      (await jsonPost('/market/list', { digimonId: 123, priceCredits: 10 }, token)).status,
    ).toBe(400);
    expect(
      (await jsonPost('/market/list', { digimonId: 'x', priceCredits: 0 }, token)).status,
    ).toBe(400);
  });

  it('rejects unauthenticated access to all three routes → 401', async () => {
    // No Authorization header: the listings, the list write, and the buy are all
    // unreachable — the reused JwtAuthGuard is live on every route.
    expect((await getMarket()).status).toBe(401);
    expect((await jsonPost('/market/list', { digimonId: 'x', priceCredits: 10 })).status).toBe(401);
    expect((await post('/market/some-id/buy')).status).toBe(401);
  });
});
