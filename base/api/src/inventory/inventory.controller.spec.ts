import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { bootHttpTestApp } from '../test/datastore';
import { PrismaService } from '../prisma/prisma.service';
import { INVENTORY_SLOT_CAP } from './inventory.constants';
import type { LoginResponse, RegisterResponse } from '../auth/auth.types';
import { SHOP_ITEMS } from '../shop/shop.seed';
import type { InventoryState, UseInventoryItemResult } from './inventory.types';

/**
 * Inventory API contract (TASK-262, R-31b) — the runnable proof of the buy→own→see
 * arc: a signed-in player BUYS an `'inventory_item'`-kind shop entry (the purchase
 * DEBITS DigiCredits + appends the audited `'purchase'` AuditLog row + GRANTS one unit
 * into the NEW `InventoryItem` table, all in the ONE existing shop `$transaction`,
 * invariant 3), buys AGAIN (the stack upsert-increments to 2, never a second row), and
 * `GET /api/inventory` reads the owned stacks OWNER-SCOPED. A DIFFERENT user does NOT see
 * them (invariant 2), and an unauthenticated read is 401 (the guard is live).
 *
 * Harness: the shared `bootHttpTestApp()` (nest-e2e-and-datastore-tests primary path) —
 * `createApp()` (the full AppModule incl. the global ValidationPipe + the /api prefix +
 * InventoryModule + the AuthModule guard export) inside a hermetic per-run throwaway
 * SQLite DB. The grant's balance/audit/inventory rows are internal, verified via the
 * public HTTP surface (the debited balance on the purchase response, the inventory rows
 * on GET /api/inventory) rather than reaching into Prisma — the buy→see arc is exactly
 * what a player observes.
 */
describe('Inventory API (end-to-end)', () => {
  let baseUrl: string;
  let dispose: () => Promise<void>;
  let app: INestApplication;

  // The frozen `'inventory_item'` catalog entry this slice grants (heal-chip-1).
  const ITEM = SHOP_ITEMS.find((i) => i.kind === 'inventory_item')!;

  const jsonPost = (path: string, body: unknown, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  /** Register + log in a fresh account and return its access token. */
  const registerAndLogin = async (email: string): Promise<string> => {
    const password = 'password123';
    const register = await jsonPost('/auth/register', { email, password });
    expect(register.status).toBe(201);
    expect(((await register.json()) as RegisterResponse).email).toBe(email);
    const login = await jsonPost('/auth/login', { email, password });
    expect(login.status).toBe(200);
    const { accessToken } = (await login.json()) as LoginResponse;
    expect(typeof accessToken).toBe('string');
    expect(accessToken.length).toBeGreaterThan(0);
    return accessToken;
  };

  /** `GET /api/shop` for a token — grants the starter DigiCredits on the first read. */
  const getShop = async (token: string): Promise<void> => {
    const res = await fetch(`${baseUrl}/shop`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  };

  /** `GET /api/inventory` for a token → the owned-items state. */
  const getInventory = async (token: string): Promise<InventoryState> => {
    const res = await fetch(`${baseUrl}/inventory`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as InventoryState;
  };

  /** `GET /api/digimon` for a token → the owned roster (grants the starter on first read). */
  const getRoster = async (token: string): Promise<Array<{ id: string; xp: number; level: number }>> => {
    const res = await fetch(`${baseUrl}/digimon`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Array<{ id: string; xp: number; level: number }>;
  };

  beforeAll(async () => {
    ({ app, baseUrl, dispose } = await bootHttpTestApp('inventory'));
  });

  afterAll(async () => {
    await dispose();
  });

  it('starts empty for a fresh player', async () => {
    const token = await registerAndLogin('inv-empty@example.test');
    const inventory = await getInventory(token);
    expect(inventory.items).toEqual([]);
  });

  it('buying an inventory item GRANTS one unit; buying again UPSERT-INCREMENTS the same stack', async () => {
    const token = await registerAndLogin('inv-buyer@example.test');
    await getShop(token); // grants the starter DigiCredits so the purchase can afford the item

    // First buy → the stack appears at quantity 1 with its resolved display name.
    const buy1 = await jsonPost('/shop/purchase', { itemId: ITEM.id }, token);
    expect(buy1.status).toBe(200);
    const afterOne = await getInventory(token);
    const stack = afterOne.items.find((i) => i.itemId === ITEM.id);
    expect(stack).toBeDefined();
    expect(stack?.quantity).toBe(1);
    expect(stack?.name).toBe(ITEM.name);
    // Exactly ONE stack row for this item (the grant created one, never two).
    expect(afterOne.items.filter((i) => i.itemId === ITEM.id)).toHaveLength(1);

    // Second buy → the SAME stack increments to 2 (upsert-increment, never a 2nd row).
    const buy2 = await jsonPost('/shop/purchase', { itemId: ITEM.id }, token);
    expect(buy2.status).toBe(200);
    const afterTwo = await getInventory(token);
    expect(afterTwo.items.filter((i) => i.itemId === ITEM.id)).toHaveLength(1);
    expect(afterTwo.items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(2);
  });

  it('the inventory is OWNER-SCOPED — a different user does NOT see another player owned items', async () => {
    const owner = await registerAndLogin('inv-owner@example.test');
    await getShop(owner);
    expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, owner)).status).toBe(200);
    // The owner sees their item…
    expect((await getInventory(owner)).items.some((i) => i.itemId === ITEM.id)).toBe(true);

    // …a fresh, separate player sees an EMPTY inventory (invariant 2 — no cross-user leak).
    const other = await registerAndLogin('inv-other@example.test');
    expect((await getInventory(other)).items).toEqual([]);
  });

  it('rejects an unauthenticated GET /api/inventory → 401 (the guard is live)', async () => {
    const res = await fetch(`${baseUrl}/inventory`);
    expect(res.status).toBe(401);
  });

  // ── POST /api/inventory/use — the consume slice (TASK-263, R-31b child i) ──

  it('a positive xpBoost on the Training Chip catalog entry (the usable-consumable guarantee)', () => {
    // The item bears a positive whole XP boost — the ONLY thing that makes it USABLE
    // (the USE path 422s an inventory_item with no xpBoost). Reframed from a battle-heal
    // (a no-op — no persisted current-HP, A-245) to a training-XP boost.
    expect(typeof ITEM.xpBoost).toBe('number');
    expect(ITEM.xpBoost).toBeGreaterThan(0);
  });

  it('USING a chip DECREMENTS the stack, GROWS the Digimon XP, and audits — all in one tx', async () => {
    const token = await registerAndLogin('inv-use@example.test');
    await getShop(token); // fund the purchase
    // Buy TWO chips so we can prove decrement-to-1 first, then decrement-to-gone.
    expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, token)).status).toBe(200);
    expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, token)).status).toBe(200);
    expect((await getInventory(token)).items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(2);

    // Own a Digimon and read its pre-use XP/level (the starter roster is granted on read).
    const roster = await getRoster(token);
    const target = roster[0];
    expect(target).toBeDefined();
    const xpBefore = target.xp;

    // USE one unit on that Digimon.
    const use1 = await jsonPost('/inventory/use', { itemId: ITEM.id, digimonId: target.id }, token);
    expect(use1.status).toBe(200);
    const result = (await use1.json()) as UseInventoryItemResult;
    expect(result.itemId).toBe(ITEM.id);
    expect(result.quantity).toBe(1); // 2 → 1
    expect(result.digimonId).toBe(target.id);

    // The stack decremented to 1 (still present) and the Digimon's XP grew.
    expect((await getInventory(token)).items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(1);
    const rosterAfter = await getRoster(token);
    const targetAfter = rosterAfter.find((d) => d.id === target.id)!;
    // XP grew by the boost, possibly ticking a level (the result mirrors the persisted row).
    expect(targetAfter.xp).toBe(result.xp);
    expect(targetAfter.level).toBe(result.level);
    // Either XP rose (no level tick) or the level ticked up (a threshold-crossing boost).
    expect(targetAfter.level > target.level || targetAfter.xp > xpBefore).toBe(true);

    // USE the LAST unit → quantity 0 → the stack drops off GET /api/inventory.
    const use2 = await jsonPost('/inventory/use', { itemId: ITEM.id, digimonId: target.id }, token);
    expect(use2.status).toBe(200);
    expect((await use2.json() as UseInventoryItemResult).quantity).toBe(0);
    expect((await getInventory(token)).items.find((i) => i.itemId === ITEM.id)).toBeUndefined();
  });

  it('USING with 0 owned → 422, NO XP change (the guard rolls back the whole tx)', async () => {
    const token = await registerAndLogin('inv-use-none@example.test');
    const roster = await getRoster(token); // owns Digimon but has bought NO chip
    const target = roster[0];
    const xpBefore = target.xp;

    const res = await jsonPost('/inventory/use', { itemId: ITEM.id, digimonId: target.id }, token);
    expect(res.status).toBe(422);

    // No XP moved (the reject rolled back before any write).
    const rosterAfter = await getRoster(token);
    expect(rosterAfter.find((d) => d.id === target.id)?.xp).toBe(xpBefore);
  });

  it('USING on ANOTHER user Digimon → 404 (owner-scoped, invariant 2)', async () => {
    const owner = await registerAndLogin('inv-use-owner@example.test');
    await getShop(owner);
    expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, owner)).status).toBe(200);

    const other = await registerAndLogin('inv-use-other@example.test');
    const otherRoster = await getRoster(other);
    const foreignDigimon = otherRoster[0];

    // owner owns the chip but names ANOTHER user's Digimon → 404 (never leaks the id).
    const res = await jsonPost(
      '/inventory/use',
      { itemId: ITEM.id, digimonId: foreignDigimon.id },
      owner,
    );
    expect(res.status).toBe(404);
    // The chip was NOT spent (the reject rolled back).
    expect((await getInventory(owner)).items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(1);
  });

  it('rejects an unauthenticated POST /api/inventory/use → 401 (the guard is live)', async () => {
    const res = await fetch(`${baseUrl}/inventory/use`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: ITEM.id, digimonId: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed POST /api/inventory/use body → 400 (the pipe is active)', async () => {
    const token = await registerAndLogin('inv-use-bad@example.test');
    const res = await jsonPost('/inventory/use', { itemId: '' }, token); // missing digimonId + empty itemId
    expect(res.status).toBe(400);
  });

  // ── The 10-slot capacity CAP (TASK-264, R-31b child iii) ──
  //
  // The catalog ships ONE `inventory_item` slug (heal-chip-1), so a player cannot reach
  // 10 DISTINCT stacks via the shop alone. The cap counts distinct non-empty ROWS
  // (A-246), so to drive a player to the cap we seed distinct stacks DIRECTLY into the
  // datastore via the injected PrismaService (the harness exposes the booted `app`),
  // then exercise the REAL observable refusal through the public purchase HTTP surface —
  // exactly what a real player hits when their inventory is full.

  /** Resolve a user's id from their email (to seed owner-scoped rows). */
  const userIdForEmail = async (email: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return user.id;
  };

  /** Seed `count` DISTINCT non-empty inventory stacks for a user (occupying `count` slots). */
  const seedDistinctStacks = async (userId: string, count: number): Promise<void> => {
    const prisma = app.get(PrismaService);
    for (let i = 0; i < count; i += 1) {
      await prisma.inventoryItem.create({
        data: { userId, itemId: `cap-filler-${i}`, quantity: 1 },
      });
    }
  };

  it('the shipped cap is 10 (single source of truth)', () => {
    expect(INVENTORY_SLOT_CAP).toBe(10);
  });

  it('GET /api/inventory exposes slotsUsed / slotCap derived from the owned rows', async () => {
    const email = 'inv-slots@example.test';
    const token = await registerAndLogin(email);
    // Fresh player: 0 used, cap = INVENTORY_SLOT_CAP.
    const empty = await getInventory(token);
    expect(empty.slotsUsed).toBe(0);
    expect(empty.slotCap).toBe(INVENTORY_SLOT_CAP);

    // Seed three distinct stacks → slotsUsed reflects the distinct-row count.
    await seedDistinctStacks(await userIdForEmail(email), 3);
    const filled = await getInventory(token);
    expect(filled.slotsUsed).toBe(3);
    expect(filled.items).toHaveLength(3);
  });

  it('refuses to grant an 11th DISTINCT stack → 422, purchase fully rolled back (no value moves, no audit)', async () => {
    const email = 'inv-cap-full@example.test';
    const token = await registerAndLogin(email);
    await getShop(token); // grant the starter DigiCredits so affordability is not the gate
    const userId = await userIdForEmail(email);
    const prisma = app.get(PrismaService);

    // Fill the inventory to EXACTLY the cap with distinct dummy stacks (10/10).
    await seedDistinctStacks(userId, INVENTORY_SLOT_CAP);
    const atCap = await getInventory(token);
    expect(atCap.slotsUsed).toBe(INVENTORY_SLOT_CAP);

    // Snapshot the value state that must NOT move on the refused path.
    const creditsBefore = (
      await prisma.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource: 'DigiCredits' } },
      })
    )?.amount;
    const auditCountBefore = await prisma.auditLog.count({ where: { userId } });

    // Buying a NEW distinct item type (heal-chip-1, not among the fillers) → 422 refusal.
    const res = await jsonPost('/shop/purchase', { itemId: ITEM.id }, token);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('Inventory full');

    // The whole purchase rolled back: DigiCredits UNCHANGED, NO new audit row, NO 11th stack.
    const creditsAfter = (
      await prisma.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource: 'DigiCredits' } },
      })
    )?.amount;
    expect(creditsAfter).toBe(creditsBefore);
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(auditCountBefore);
    expect(await prisma.inventoryItem.count({ where: { userId } })).toBe(INVENTORY_SLOT_CAP);
    // The chip stack was never created.
    expect((await getInventory(token)).items.find((i) => i.itemId === ITEM.id)).toBeUndefined();
  });

  it('at the cap, re-buying an ALREADY-OWNED stack is ALLOWED (it fills no new slot)', async () => {
    const email = 'inv-cap-increment@example.test';
    const token = await registerAndLogin(email);
    await getShop(token);
    const userId = await userIdForEmail(email);

    // Own the chip (1 slot) + fill the REST of the cap with distinct fillers → 10/10.
    expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, token)).status).toBe(200);
    await seedDistinctStacks(userId, INVENTORY_SLOT_CAP - 1);
    const atCap = await getInventory(token);
    expect(atCap.slotsUsed).toBe(INVENTORY_SLOT_CAP);

    // Re-buying the ALREADY-OWNED chip increments its stack (fills no new slot) → allowed.
    const res = await jsonPost('/shop/purchase', { itemId: ITEM.id }, token);
    expect(res.status).toBe(200);
    const after = await getInventory(token);
    expect(after.slotsUsed).toBe(INVENTORY_SLOT_CAP); // still 10 distinct stacks
    expect(after.items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(2);
  });

  // ── POST /api/inventory/discard — free a slot (TASK-265, R-31b child ii) ──
  //
  // DISCARD destroys the WHOLE owned stack by zeroing its quantity (A-247, soft, no hard
  // delete, no refund). The read hides zero-quantity rows so the stack vanishes and the
  // freed slot drops the running slotsUsed by one. The destruction is fully audited
  // (invariant 3) — a `discard` AuditLog row with amountBefore → amountAfter: 0.

  it('DISCARDING an owned stack zeros it, frees the slot, and audits — all in one tx', async () => {
    const email = 'inv-discard@example.test';
    const token = await registerAndLogin(email);
    await getShop(token); // fund the purchase

    // Own a MULTI-unit stack (buy 3) so we prove the WHOLE stack is destroyed, not one unit.
    for (let i = 0; i < 3; i += 1) {
      expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, token)).status).toBe(200);
    }
    const before = await getInventory(token);
    expect(before.items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(3);
    expect(before.slotsUsed).toBe(1);

    const userId = await userIdForEmail(email);
    const prisma = app.get(PrismaService);
    const auditBefore = await prisma.auditLog.count({ where: { userId, action: 'discard' } });

    // Discard the stack → 200, quantity 0.
    const res = await jsonPost('/inventory/discard', { itemId: ITEM.id }, token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { quantity: number }).quantity).toBe(0);

    // The stack is GONE from GET /api/inventory (slot freed → slotsUsed drops to 0).
    const gone = await getInventory(token);
    expect(gone.items.find((i) => i.itemId === ITEM.id)).toBeUndefined();
    expect(gone.slotsUsed).toBe(0);

    // The row was zeroed, NOT hard-deleted (soft) — it still exists at quantity 0.
    const row = await prisma.inventoryItem.findUnique({
      where: { userId_itemId: { userId, itemId: ITEM.id } },
    });
    expect(row).not.toBeNull();
    expect(row?.quantity).toBe(0);

    // A `discard` AuditLog row was written with amountBefore = 3 → amountAfter: 0.
    const discardRows = await prisma.auditLog.findMany({
      where: { userId, action: 'discard' },
      orderBy: { createdAt: 'desc' },
    });
    expect(discardRows.length).toBe(auditBefore + 1);
    const audit = discardRows[0];
    expect(audit.entity).toBe('InventoryItem');
    expect(audit.entityId).toBe(ITEM.id);
    expect(audit.amountBefore).toBe(3);
    expect(audit.amountAfter).toBe(0);

    // The freed slot lets the type be bought again (the buy re-grants the stack).
    expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, token)).status).toBe(200);
    expect((await getInventory(token)).items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(1);
  });

  it('DISCARDING an item the player does NOT own → 422, NO audit row / NO change', async () => {
    const email = 'inv-discard-none@example.test';
    const token = await registerAndLogin(email);
    const userId = await userIdForEmail(email);
    const prisma = app.get(PrismaService);
    const auditBefore = await prisma.auditLog.count({ where: { userId, action: 'discard' } });

    const res = await jsonPost('/inventory/discard', { itemId: ITEM.id }, token);
    expect(res.status).toBe(422);

    // No audit row, no stack created.
    expect(await prisma.auditLog.count({ where: { userId, action: 'discard' } })).toBe(auditBefore);
    expect(await prisma.inventoryItem.count({ where: { userId } })).toBe(0);
  });

  it('DISCARD is OWNER-SCOPED — a different user cannot discard the owner stack', async () => {
    const owner = await registerAndLogin('inv-discard-owner@example.test');
    await getShop(owner);
    expect((await jsonPost('/shop/purchase', { itemId: ITEM.id }, owner)).status).toBe(200);
    expect((await getInventory(owner)).items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(1);

    // Another user discards the SAME itemId → 422 (not found under THEIR userId).
    const other = await registerAndLogin('inv-discard-other@example.test');
    expect((await jsonPost('/inventory/discard', { itemId: ITEM.id }, other)).status).toBe(422);

    // The owner's stack is UNTOUCHED (still quantity 1).
    expect((await getInventory(owner)).items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(1);
  });

  it('rejects an unauthenticated POST /api/inventory/discard → 401 (the guard is live)', async () => {
    const res = await fetch(`${baseUrl}/inventory/discard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemId: ITEM.id }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed POST /api/inventory/discard body → 400 (the pipe is active)', async () => {
    const token = await registerAndLogin('inv-discard-bad@example.test');
    const res = await jsonPost('/inventory/discard', { itemId: '' }, token);
    expect(res.status).toBe(400);
  });

  // ── Purchasable inventory SLOT-EXPANSION (TASK-281, R-31b child iv) ──
  //
  // Where the distinct-stack cap is otherwise a flat, unchangeable 10, a player whose
  // inventory is FULL can BUY an `inventory_slot`-kind shop item that increments their
  // per-user `User.inventorySlotBonus`, raising their effective cap
  // (INVENTORY_SLOT_CAP + bonus). The previously-refused 11th distinct stack then
  // succeeds, and GET /api/inventory reports the raised `slotCap`. The whole grant rides
  // the EXISTING audited purchase `$transaction` (invariant 3), so an unaffordable buy
  // rolls back with no cap raise and no audit row. A user with the default bonus 0 sees
  // the EXACT prior flat-10 behaviour (invariant-5 identity).

  const SLOT = SHOP_ITEMS.find((i) => i.kind === 'inventory_slot')!;

  it('the slot-expansion catalog entry is well-formed (a positive integer slot delta)', () => {
    expect(SLOT.kind).toBe('inventory_slot');
    expect(typeof SLOT.capacityDelta).toBe('number');
    expect(SLOT.capacityDelta).toBeGreaterThan(0);
    expect(Number.isInteger(SLOT.capacityDelta)).toBe(true);
    expect(SLOT.priceCredits).toBeGreaterThan(0);
  });

  it('a full inventory (10/10) refuses an 11th distinct stack, then a slot-expansion buy UNBLOCKS it', async () => {
    const email = 'inv-slot-buy@example.test';
    const token = await registerAndLogin(email);
    await getShop(token); // grant the starter DigiCredits so affordability is not the gate
    const userId = await userIdForEmail(email);
    const prisma = app.get(PrismaService);

    // Fill the inventory to EXACTLY the base cap with distinct dummy stacks (10/10).
    await seedDistinctStacks(userId, INVENTORY_SLOT_CAP);
    const atCap = await getInventory(token);
    expect(atCap.slotsUsed).toBe(INVENTORY_SLOT_CAP);
    expect(atCap.slotCap).toBe(INVENTORY_SLOT_CAP);

    // The 11th DISTINCT stack (the Training Chip, not among the fillers) is refused 422.
    const blocked = await jsonPost('/shop/purchase', { itemId: ITEM.id }, token);
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as { message?: string }).message).toContain('Inventory full');

    // Snapshot the value state so we can assert the slot-expansion buy is a real audited move.
    const creditsBefore = (
      await prisma.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource: 'DigiCredits' } },
      })
    )?.amount;
    const auditCountBefore = await prisma.auditLog.count({ where: { userId } });

    // Buy the slot-expansion → 200: DigiCredits debited by exactly the price, the bonus
    // incremented by exactly capacityDelta, exactly ONE 'purchase' audit row appended.
    const buy = await jsonPost('/shop/purchase', { itemId: SLOT.id }, token);
    expect(buy.status).toBe(200);

    const creditsAfter = (
      await prisma.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource: 'DigiCredits' } },
      })
    )?.amount;
    expect(creditsAfter).toBe((creditsBefore ?? 0) - SLOT.priceCredits);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.inventorySlotBonus).toBe(SLOT.capacityDelta);
    const purchaseRows = await prisma.auditLog.findMany({
      where: { userId, entity: 'ShopItem', entityId: SLOT.id, action: 'purchase' },
    });
    expect(purchaseRows).toHaveLength(1);
    expect(purchaseRows[0]!.amountAfter - purchaseRows[0]!.amountBefore).toBe(-SLOT.priceCredits);
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(auditCountBefore + 1);

    // (b) The read display reflects the raised cap; slotsUsed unchanged by the buy.
    const afterExpansion = await getInventory(token);
    expect(afterExpansion.slotCap).toBe(INVENTORY_SLOT_CAP + SLOT.capacityDelta);
    expect(afterExpansion.slotsUsed).toBe(INVENTORY_SLOT_CAP);

    // (a) The SAME previously-refused 11th distinct stack now SUCCEEDS (the new stack is created).
    const nowAllowed = await jsonPost('/shop/purchase', { itemId: ITEM.id }, token);
    expect(nowAllowed.status).toBe(200);
    const filled = await getInventory(token);
    expect(filled.items.find((i) => i.itemId === ITEM.id)?.quantity).toBe(1);
    expect(filled.slotsUsed).toBe(INVENTORY_SLOT_CAP + SLOT.capacityDelta);
  });

  it('an unaffordable slot-expansion buy → 422, atomic rollback (no bonus raise, no audit row)', async () => {
    const email = 'inv-slot-broke@example.test';
    const token = await registerAndLogin(email);
    await getShop(token); // grant + create the balance row
    const userId = await userIdForEmail(email);
    const prisma = app.get(PrismaService);

    // Drain DigiCredits STRICTLY below the price so the affordability guard fires.
    await prisma.resourceBalance.update({
      where: { userId_resource: { userId, resource: 'DigiCredits' } },
      data: { amount: SLOT.priceCredits - 1 },
    });
    const auditCountBefore = await prisma.auditLog.count({ where: { userId } });

    const res = await jsonPost('/shop/purchase', { itemId: SLOT.id }, token);
    expect(res.status).toBe(422);

    // Rollback: balance untouched, bonus NOT raised, NO audit row.
    const balance = await prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: 'DigiCredits' } },
    });
    expect(balance?.amount).toBe(SLOT.priceCredits - 1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.inventorySlotBonus).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId } })).toBe(auditCountBefore);
  });

  it('IDENTITY: a default-bonus user (0) sees the flat cap of 10 and the flat-10 refusal (invariant 5)', async () => {
    const email = 'inv-slot-identity@example.test';
    const token = await registerAndLogin(email);
    await getShop(token);
    const userId = await userIdForEmail(email);

    // Default bonus → cap is exactly the flat constant.
    expect((await getInventory(token)).slotCap).toBe(INVENTORY_SLOT_CAP);

    // At the flat cap, the 11th distinct stack is refused (byte-identical prior behaviour).
    await seedDistinctStacks(userId, INVENTORY_SLOT_CAP);
    const refused = await jsonPost('/shop/purchase', { itemId: ITEM.id }, token);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { message?: string }).message).toContain('Inventory full');
  });

  it('stacking: buying the slot-expansion TWICE raises the cap additively', async () => {
    const email = 'inv-slot-stack@example.test';
    const token = await registerAndLogin(email);
    await getShop(token);
    const userId = await userIdForEmail(email);

    expect((await jsonPost('/shop/purchase', { itemId: SLOT.id }, token)).status).toBe(200);
    expect((await jsonPost('/shop/purchase', { itemId: SLOT.id }, token)).status).toBe(200);
    const user = await app.get(PrismaService).user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.inventorySlotBonus).toBe(SLOT.capacityDelta * 2);
    expect((await getInventory(token)).slotCap).toBe(INVENTORY_SLOT_CAP + SLOT.capacityDelta * 2);
  });
});
