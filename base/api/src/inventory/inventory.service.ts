import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { applyXpGain } from '../digimon/training';
import { SHOP_ITEMS } from '../shop/shop.seed';
import { INVENTORY_SLOT_CAP } from './inventory.constants';
import type {
  DiscardInventoryItemResult,
  InventoryItemView,
  InventoryState,
  UseInventoryItemResult,
} from './inventory.types';

/**
 * Inventory domain logic (TASK-262, R-31b) — the server-authoritative READ of a
 * player's owned consumable-item stacks. The read half of the space-limited
 * inventory pillar; the WRITE (a grant) rides the EXISTING audited shop-purchase
 * `$transaction` in {@link ShopService.purchaseForUser} (invariant 3 — no separate,
 * unaudited value path lives here).
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link FarmService}): the
 * controller owns HTTP concerns (route, the guard), this owns the rules. It reaches
 * the datastore ONLY through the injected {@link PrismaService} (invariant 1) — nothing
 * bypasses the provider — and never issues a hard delete (this slice is read-only).
 */
@Injectable()
export class InventoryService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7): the
  // vitest/esbuild transform does NOT emit constructor `design:paramtypes` (unlike the
  // production `nest build` via tsc), so a bare `private readonly prisma: PrismaService`
  // injects `undefined` under the gate and the first `GET /api/inventory` 500s. Naming
  // the provider needs no reflected metadata, so it resolves identically under esbuild
  // (tests) and tsc (build). The e2e's 200 assertion guards against a regression here.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Return the signed-in player's owned inventory stacks (TASK-262, R-31b).
   *
   * Steps:
   *  1. Read the owner's `InventoryItem` rows owner-scoped by `userId` (invariant 2 —
   *     a player only ever sees their OWN inventory), ordered by `createdAt` so the
   *     rail renders a stable oldest-first list. A player who has bought nothing gets
   *     an empty array (no rows exist until the first purchase grants one).
   *  2. Hide any zero-quantity stack (defensive — a grant only ever increments, but a
   *     future USE/DISCARD path could drain a stack to 0 without deleting the row; a
   *     0-quantity stack is not "owned", so it never reaches the wire).
   *  3. Project each row to the public {@link InventoryItemView}, resolving the display
   *     `name` from the pure `SHOP_ITEMS` catalog by slug (the client never needs the
   *     catalog to render the rail). An unknown slug (a catalog entry later removed)
   *     falls back to the raw slug so the row is still renderable, never blank.
   */
  async getInventoryForUser(userId: string): Promise<InventoryState> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    const items: InventoryItemView[] = rows
      .filter((row) => row.quantity > 0)
      .map((row) => {
        const catalog = SHOP_ITEMS.find((candidate) => candidate.id === row.itemId);
        return {
          itemId: row.itemId,
          // Resolve the display name from the catalog; fall back to the slug so an
          // orphaned row (its catalog entry removed later) is still renderable.
          name: catalog?.name ?? row.itemId,
          quantity: row.quantity,
        };
      });

    // TASK-264 (R-31b child iii): the "space-limited" slot usage, DERIVED server-side
    // from the rows ALREADY read (NO extra query). A "slot" is one distinct non-empty
    // stack (`quantity > 0`) — the SAME rows projected into `items` above (A-246); a
    // multi-unit stack still occupies exactly one slot.
    //
    // TASK-281 (R-31b child iv): the cap is no longer the flat constant — it is
    // `INVENTORY_SLOT_CAP + <the owner's purchased inventorySlotBonus>`. Read the owner's
    // bonus (an additive owner-scoped read; invariant 2 — a player sees only their OWN
    // cap) and add it. This is the SAME `INVENTORY_SLOT_CAP + bonus` the write-side guard
    // (ShopService) computes, so the display and the refusal can never disagree (single
    // source of truth). A user with the default bonus 0 sees the EXACT prior cap of 10
    // (invariant-5 identity). The `InventoryState` contract type is UNCHANGED (still
    // `slotsUsed` + `slotCap` — only the `slotCap` VALUE now varies); the rail already
    // renders it, so a raised cap surfaces for free (no web change). Additive fields —
    // the `items` array shape is byte-unchanged (invariant 5).
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const slotCap = INVENTORY_SLOT_CAP + (user?.inventorySlotBonus ?? 0);
    return { items, slotsUsed: items.length, slotCap };
  }

  /**
   * USE one unit of a consumable on a player-chosen owned Digimon (TASK-263, R-31b child
   * i) — the first inventory-CONSUME slice: spend a stack unit AND grant its `xpBoost`
   * XP to the chosen Digimon, atomically.
   *
   * This is a VALUE-MOVING mutation (the owned stack is the spent resource), so it
   * follows the L-13 guarded-economic-mutation template — ONE `$transaction` that
   * re-reads the target rows owner-scoped, GUARDS, mutates, and appends an immutable
   * `AuditLog` row (invariant 3). Everything commits together or not at all: a rejection
   * (no unit owned, not the caller's Digimon, an item with no `xpBoost`) rolls back the
   * WHOLE thing — no decrement without an XP grant, no XP grant without a decrement, no
   * orphan audit row.
   *
   * Steps (all inside the one tx):
   *  (a) OWNER-SCOPED re-read the `InventoryItem` stack (`userId_itemId` composite) →
   *      422 if missing OR `quantity < 1` (a player can only spend a unit they OWN;
   *      invariant 2). NO write on this path.
   *  (b) OWNER-SCOPED, soft-delete-aware re-read the target `Digimon`
   *      (`{ id, userId, deletedAt: null }`) → a `null` collapses to a generic 404 so the
   *      response never reveals whether the id exists for someone else (a player boosts
   *      ONLY their own Digimon; invariant 2).
   *  (c) Resolve the item's `xpBoost` from the server-authoritative `SHOP_ITEMS` catalog
   *      by slug → 422 if the item bears none (only a USABLE consumable can be used; the
   *      client never dictates the boost — A-36 #3).
   *  (d) DECREMENT the stack `quantity` by 1 (owner-scoped `update`). The read hides
   *      0-quantity stacks, so spending the last unit leaves the rail on the next read.
   *  (e) Apply XP through the shipped pure `applyXpGain` (the SAME canonical curve
   *      training/battle share — D-8 #1, NOT re-derived here) and `update` the Digimon's
   *      `level`/`xp`/stats to the returned ABSOLUTE values (mirroring the train update
   *      in `DigimonService`). This is DOMAIN progression (XP), NOT a spendable balance,
   *      so there is NO `ResourceBalance` write (invariant 3 is triggered by the STACK
   *      decrement, which the audit row below covers; A-42 is untriggered — XP only rises).
   *  (f) Append the immutable audit row (`action: 'use'`, `entity: 'InventoryItem'`,
   *      `entityId: itemId`) INSIDE the SAME transaction (invariant 3 — the decrement is
   *      a value move). No `resource`/`amount*` (the stack is not a `ResourceBalance`
   *      currency; those columns are optional on the ledger — mirrors how the row spans
   *      many entity kinds).
   *
   * Returns a small {@link UseInventoryItemResult} (the new stack quantity + the updated
   * Digimon's xp/level) so the client can confirm the move; it re-reads `/inventory` (and
   * the roster) for the full state.
   */
  async useItemForUser(
    userId: string,
    itemId: string,
    digimonId: string,
  ): Promise<UseInventoryItemResult> {
    // Resolve the catalog boost BEFORE the tx: an item that bears no `xpBoost` is not a
    // usable consumable — reject with a 422 with no transaction needed. The boost is
    // SERVER-authoritative, resolved from this frozen catalog by slug, never the client.
    const catalog = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    const xpBoost = catalog?.xpBoost;
    if (xpBoost === undefined || xpBoost <= 0) {
      throw new UnprocessableEntityException('This item cannot be used.');
    }

    return this.prisma.$transaction(async (tx) => {
      // (a) Owner-scoped re-read the stack. Missing OR drained → 422, NO write.
      const stack = await tx.inventoryItem.findUnique({
        where: { userId_itemId: { userId, itemId } },
      });
      if (stack === null || stack.quantity < 1) {
        throw new UnprocessableEntityException('You do not own this item.');
      }

      // (b) Owner-scoped, soft-delete-aware re-read the target Digimon. A null result
      // (bad id, another player's Digimon, or soft-deleted) collapses to a 404 so the
      // response never leaks another user's ids (invariant 2).
      const digimon = await tx.digimon.findFirst({
        where: { id: digimonId, userId, deletedAt: null },
      });
      if (digimon === null) {
        throw new NotFoundException('Digimon not found.');
      }

      // (d) Decrement the stack by 1 (owner-scoped). The guard above proved a coverable
      // unit exists, so this never drives the quantity negative.
      const decremented = await tx.inventoryItem.update({
        where: { userId_itemId: { userId, itemId } },
        data: { quantity: { decrement: 1 } },
      });

      // (e) Apply the XP boost through the SINGLE canonical level-up rule (the same
      // `applyXpGain` train/battle share — no divergent progression math, D-8 #1) and
      // persist the returned ABSOLUTE level/xp/stats (mirroring the train update). XP is
      // domain progression, monotonically non-decreasing (A-42 untriggered — no combat HP
      // moves), so there is no ResourceBalance write here.
      const next = applyXpGain(
        {
          level: digimon.level,
          xp: digimon.xp,
          hp: digimon.hp,
          atk: digimon.atk,
          def: digimon.def,
          spd: digimon.spd,
        },
        xpBoost,
      );
      const updatedDigimon = await tx.digimon.update({
        where: { id: digimonId },
        data: {
          level: next.level,
          xp: next.xp,
          hp: next.hp,
          atk: next.atk,
          def: next.def,
          spd: next.spd,
        },
      });

      // (f) Append the immutable audit row for THIS value move (the stack decrement),
      // inside the SAME tx (atomic — all commit or none). Append-only; the ledger spans
      // many entity kinds, and this row names the spent stack by its slug. `resource` is
      // NULL (the owned stack is not a `ResourceBalance` currency), and `amountBefore`/
      // `amountAfter` (required Int columns) record the stack quantity before → after the
      // decrement, so the ledger still carries a self-contained before/after of the move.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'use',
          entity: 'InventoryItem',
          entityId: itemId,
          resource: null,
          amountBefore: stack.quantity,
          amountAfter: decremented.quantity,
        },
      });

      return {
        itemId,
        quantity: decremented.quantity,
        digimonId,
        xp: updatedDigimon.xp,
        level: updatedDigimon.level,
      };
    });
  }

  /**
   * DISCARD an owned stack (TASK-265, R-31b child ii) — the first inventory SUBTRACTIVE
   * slice: destroy a whole owned stack to FREE a slot in the space-limited inventory. No
   * refund (A-247 — pure destruction; moves no `ResourceBalance`).
   *
   * The owned stack IS the destroyed resource, so this is a VALUE-MOVING mutation and
   * follows the L-13 guarded-economic-mutation template — ONE `$transaction` that re-reads
   * the target row owner-scoped, GUARDS, mutates, and appends an immutable `AuditLog` row
   * (invariant 3). Everything commits together or not at all: a rejection (no stack owned,
   * an already-drained stack) rolls back the WHOLE thing — no zero-out without an audit
   * row, no orphan audit row.
   *
   * Steps (all inside the one tx):
   *  (a) OWNER-SCOPED re-read the `InventoryItem` stack (`userId_itemId` composite) →
   *      422 if missing OR `quantity < 1` (a player can only discard a stack they OWN;
   *      invariant 2 — a foreign/unknown itemId collapses to the SAME 422 so the response
   *      never reveals whether the id exists for someone else). NO write on this path.
   *  (b) OWNER-SCOPED `update` the stack setting `quantity: 0` (a soft zero-out, NOT a hard
   *      row DELETE — the read hides a 0-quantity stack so it disappears from the rail and
   *      the freed slot drops the running `N / 10`; this matches the module's
   *      soft-delete-never-hard-delete discipline). Capture the prior quantity for the audit.
   *  (c) Append the immutable audit row for THIS value move (the stack destruction), inside
   *      the SAME tx: `action: 'discard'`, `entity: 'InventoryItem'`, `entityId: itemId`,
   *      `resource: null` (the owned stack is not a `ResourceBalance` currency; there is NO
   *      refund so NO balance credit), `amountBefore` = prior quantity → `amountAfter: 0`
   *      (the ledger carries a self-contained before/after of the destruction).
   *
   * Returns a small {@link DiscardInventoryItemResult} (the itemId + the new quantity `0`)
   * so the client can confirm the move; it re-reads `/inventory` for the full state.
   */
  async discardItemForUser(userId: string, itemId: string): Promise<DiscardInventoryItemResult> {
    return this.prisma.$transaction(async (tx) => {
      // (a) Owner-scoped re-read the stack. Missing OR already-drained → 422, NO write.
      // A foreign/unknown itemId is not found under THIS userId, so it 422s identically —
      // the response never leaks another user's ownership (invariant 2).
      const stack = await tx.inventoryItem.findUnique({
        where: { userId_itemId: { userId, itemId } },
      });
      if (stack === null || stack.quantity < 1) {
        throw new UnprocessableEntityException('You do not own this item.');
      }

      // (b) Zero the WHOLE stack (owner-scoped soft zero-out, NEVER a hard delete — the
      // read hides 0-quantity stacks so the stack vanishes from the rail and the slot
      // frees). The guard above proved an owned non-empty stack exists.
      await tx.inventoryItem.update({
        where: { userId_itemId: { userId, itemId } },
        data: { quantity: 0 },
      });

      // (c) Append the immutable audit row for the destruction, inside the SAME tx (atomic
      // — the zero-out and its ledger row commit or roll back together). `resource` is NULL
      // (the owned stack is not a `ResourceBalance` currency, and there is NO refund); the
      // required `amountBefore`/`amountAfter` Int columns record the stack quantity before
      // → after (0), so the ledger self-contains the whole move.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'discard',
          entity: 'InventoryItem',
          entityId: itemId,
          resource: null,
          amountBefore: stack.quantity,
          amountAfter: 0,
        },
      });

      return { itemId, quantity: 0 };
    });
  }
}
