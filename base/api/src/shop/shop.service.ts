import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { INVENTORY_SLOT_CAP } from '../inventory/inventory.constants';
import { PREMIUM_CURRENCY, SHOP_ITEMS, STARTER_DIGICREDITS } from './shop.seed';
import type { ShopState } from './shop.types';
import { toItemView } from './shop.types';

/**
 * Premium-shop domain logic (TASK-26, R-13) — the server-authoritative source of
 * the catalog, a player's DigiCredits balance, and the QoL-purchase SPEND. This is
 * where DigiCredits get a purpose and the ethical-monetization pillar goes live.
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link FarmService},
 * copied deliberately): the controller owns HTTP concerns (route, the guard), this
 * owns the rules. It reaches the datastore ONLY through the injected
 * {@link PrismaService} (invariant 1) — nothing bypasses the provider — and never
 * issues a hard delete (invariant 2: reads are owner-scoped + soft-delete-aware
 * where the model has it; no delete path exists here).
 *
 * Two non-obvious rules live here, both mirrored from the farm/roster services:
 *
 *  1. The STARTER GRANT (A-17): a brand-new account has no DigiCredits, but R-13's
 *     headline needs the currency to have a payment-free SOURCE today (real-money
 *     top-up is R-13b, which PARKS on a missing payment key). So the FIRST
 *     `GET /api/shop` materializes `STARTER_DIGICREDITS` once, idempotently — the
 *     same "grant-on-first-read" idiom `FarmService.grantStartingBuildingsIfEmpty`
 *     and `DigimonService.grantStarterRosterIfEmpty` use. Crucially it is a
 *     PROVISIONING grant, NOT an economic mutation, so — exactly like the starter
 *     buildings/roster — it writes NO audit row (invariant 3 records value MOVING
 *     between a player's own holdings and the game, not a first-time provision).
 *
 *  2. The PURCHASE is a DEBIT + effect + audit, ALL in ONE `$transaction`
 *     (invariant 3): it is the L-13 economic-mutation template's 3rd occurrence (a
 *     DEBIT in a NEW guarded route, after collect's CREDIT and evolve's DEBIT). The
 *     debit block is copied VERBATIM from {@link DigimonService.evolve} — findUnique
 *     → guard → decrement (NOT upsert — a debit needs an existing row the guard
 *     proves) — and the audit-row shape from {@link FarmService.collectForUser}. The
 *     QoL effect (raising the target building's `capacity`) and the audit row run
 *     INSIDE the same tx as the debit, so a shortfall throw rolls back EVERYTHING
 *     (no partial spend, no capacity bump without a debit, no orphan audit row).
 */
@Injectable()
export class ShopService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7):
  // the vitest/esbuild transform does NOT emit constructor `design:paramtypes`
  // (unlike the production `nest build` via tsc), so bare `private readonly
  // prisma: PrismaService` injects `undefined` under the gate and the first
  // `GET /api/shop` 500s. Naming the provider needs no reflected metadata, so it
  // resolves identically under esbuild (tests) and tsc (build). NO other ctor
  // param — the balance, the audit ledger, AND the target building are all reached
  // through this one PrismaService (friction #3). The e2e's 200 assertion guards
  // against a regression here.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Return the signed-in player's shop state, granting the starter DigiCredits on
   * the first visit (A-17) then returning the catalog + balance.
   *
   * Steps:
   *  1. Read the owner's DigiCredits balance by the `@@unique([userId, resource])`
   *     composite accessor `userId_resource` (the SAME accessor collect/evolve use;
   *     a wrong name is a `tsc` error — friction #2). Owner-scoped by `userId`, so a
   *     player only ever sees their OWN balance (invariant 2).
   *  2. If there is NO row yet, this is a first visit: `create` the row at
   *     `STARTER_DIGICREDITS` — the one-time grant. Idempotent by the existing-row
   *     check (a returning player already has a row, so the create never repeats —
   *     mirrors `grantStartingBuildingsIfEmpty`'s count-guard). A provisioning grant,
   *     so it writes NO audit row (same rationale as the starter buildings/roster).
   *  3. Project `SHOP_ITEMS` → the public catalog (dropping the effect params) and
   *     return `{ items, balance: <the row's amount> }`.
   *
   * NOTE the grant is a bare `findUnique`/`create` pair, NOT a `$transaction`: two
   * concurrent first `GET /api/shop`s for the same fresh account could in principle
   * both see no row and both `create`, but the `@@unique([userId, resource])`
   * constraint makes the second `create` throw (P2002) rather than silently
   * double-grant — the constraint is the race guard the buildings grant gets from
   * its count-inside-a-tx. A duplicate starter grant is thus impossible; the rare
   * loser's 500 is acceptable for a read (the client simply retries and sees the
   * committed grant). The purchase DEBIT, which MOVES value, is fully transactional
   * (see {@link purchaseForUser}).
   */
  async getShopForUser(userId: string): Promise<ShopState> {
    let balance = await this.prisma.resourceBalance.findUnique({
      where: { userId_resource: { userId, resource: PREMIUM_CURRENCY } },
    });

    // First visit → grant the A-17 starter DigiCredits once. Idempotent: a
    // returning player already has a row and this branch is skipped. This is a
    // provisioning grant (not an economic mutation), so — like the starter
    // buildings/roster — it writes NO audit row.
    if (balance === null) {
      balance = await this.prisma.resourceBalance.create({
        data: { userId, resource: PREMIUM_CURRENCY, amount: STARTER_DIGICREDITS },
      });
    }

    // The player's Premium-Time status (TASK-38, R-13b): read `premiumUntil` and
    // project it as an ISO string ONLY while it is still in the future (an expired or
    // never-bought premium reads `null`). Owner-scoped by `userId` (invariant 2 — a
    // player sees only their own premium). Snapshot `now` once for a stable comparison.
    const now = new Date();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const premiumUntil =
      user?.premiumUntil && user.premiumUntil > now ? user.premiumUntil.toISOString() : null;

    return {
      items: SHOP_ITEMS.map(toItemView),
      // Defensive `?? 0`: after the grant `balance` is always a row, but this keeps
      // the projection total even if a future refactor makes the grant conditional.
      balance: balance?.amount ?? 0,
      premiumUntil,
    };
  }

  /**
   * Buy the named catalog item for `userId` (TASK-26, R-13) — the game's premium
   * QoL SPEND: DEBIT DigiCredits → apply the effect → append the audit row, ALL in
   * ONE `$transaction` (invariant 3). The L-13 template's 3rd occurrence (a DEBIT
   * in a NEW guarded route), copied from {@link FarmService.collectForUser}'s tx
   * skeleton and INVERTED to a debit exactly as {@link DigimonService.evolve} does.
   *
   * The WHOLE mutation runs inside a single interactive `$transaction` so
   * "re-read the balance → guard affordability → debit → apply the effect → audit"
   * is ATOMIC: two concurrent purchases for the same account cannot both read the
   * pre-purchase balance and both spend it (double-spend), and — critically for
   * invariant 3 — an insufficient-balance throw rolls back EVERYTHING, so there is
   * never a partial spend, a capacity bump without a matching debit, or an orphan
   * audit row. On SQLite the writer is serialized, so a second transaction observes
   * the first's committed debit and re-derives its own outcome from the now-current
   * balance.
   *
   * Steps:
   *  1. Resolve the item from the PURE catalog (`SHOP_ITEMS.find`). A bad `itemId`
   *     → a 404 `NotFoundException` BEFORE the tx (no point opening a transaction to
   *     spend on a non-existent item; the price/effect are server-authoritative, so
   *     an unknown slug is simply not-found).
   *  2. Inside the tx (all with `tx.*`, never `this.prisma.*`):
   *     a. READ the owner's DigiCredits balance owner-scoped (`userId_resource`).
   *     b. AFFORDABILITY GUARD (the DEBIT half — invariant 3). If there is NO row OR
   *        `amount < priceCredits`, throw a 422 with a player-facing
   *        "Requires N DigiCredits to buy <item>." reason. A pure DEBIT NEVER
   *        upserts (that would create a row at a negative/absent balance — friction
   *        #1); the guard proves a coverable row exists before the decrement.
   *     c. DEBIT: capture `amountBefore`/`amountAfter`, then
   *        `update({ amount: { decrement: priceCredits } })` (NOT an upsert).
   *     d. APPLY THE EFFECT (`kind === 'building_capacity'`): find the caller's
   *        target building owner-scoped (by the produced `resource`, e.g. 'Meat')
   *        and raise its `capacity` by `capacityDelta`. If the player has no such
   *        building (they never opened `/farm`, so it was never materialized), throw
   *        a 422 — the spend rolls back (they get their DigiCredits back). The e2e
   *        materializes the Meat Farm via `GET /api/farm` first (friction #6), the
   *        honest runtime order (visit the farm, then buy storage).
   *     e. APPEND the invariant-3 audit row (copied from `collectForUser`'s shape):
   *        `action:'purchase'`, `entity:'ShopItem'`, `entityId: item.id`,
   *        `resource: PREMIUM_CURRENCY`, `amountBefore`→`amountAfter` (a NEGATIVE
   *        delta — a spend). Append-only: the ledger's 3rd action, never updated/
   *        deleted.
   *  3. Re-read the fresh {@link ShopState} via {@link getShopForUser} OUTSIDE the
   *     tx (a plain post-commit read) so the response carries the dropped balance.
   *     Note it will NOT re-grant here — the row now exists.
   */
  async purchaseForUser(userId: string, itemId: string): Promise<ShopState> {
    // Resolve BEFORE the tx: an unknown itemId is a 404, no transaction needed. The
    // price + effect come from this server-authoritative catalog, never the client.
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    if (item === undefined) {
      throw new NotFoundException('Unknown shop item.');
    }

    await this.prisma.$transaction(async (tx) => {
      // ONE clock for the whole purchase tx (TASK-38): the premium-time extension
      // measures its base and expiry against a single instant (never call new Date()
      // twice within the mutation, or a stacked extension could drift).
      const now = new Date();

      // ── The DEBIT half (invariant 3) — copied from DigimonService.evolve ──
      // Read the owner's DigiCredits balance. The composite `@@unique([userId,
      // resource])` accessor is `userId_resource` (a wrong name is a tsc error —
      // friction #2). Owner-scoped by `userId`, so a player can only ever spend
      // their OWN DigiCredits (invariant 2).
      const balance = await tx.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource: PREMIUM_CURRENCY } },
      });

      // Sufficiency guard. A pure DEBIT must NOT upsert (that would silently create
      // a row at a negative/absent balance — friction #1): if there is no balance
      // row yet OR it can't cover the price, block with a 422 carrying a
      // player-facing reason. Throwing inside the tx rolls back EVERYTHING, so no
      // partial spend and no orphan audit row (the unaffordable e2e proves it). In
      // the normal flow the row exists (granted on the first GET /api/shop), so this
      // fires on genuine insufficiency, not a missing grant.
      if (balance === null || balance.amount < item.priceCredits) {
        throw new UnprocessableEntityException(
          `Requires ${item.priceCredits} ${PREMIUM_CURRENCY} to buy ${item.name}.`,
        );
      }

      // before → after for the audit ledger (both halves stored, not a delta — the
      // row is self-contained). The delta is NEGATIVE here: a spend (like evolve).
      const amountBefore = balance.amount;
      const amountAfter = amountBefore - item.priceCredits;

      // Debit (NOT an upsert — the guard just proved a coverable row exists). The
      // `decrement` mirrors collect's `increment`, inverted.
      await tx.resourceBalance.update({
        where: { userId_resource: { userId, resource: PREMIUM_CURRENCY } },
        data: { amount: { decrement: item.priceCredits } },
      });

      // ── Apply the QoL effect ──
      // This slice ships ONE kind (`building_capacity`): raise the caller's target
      // building's storage cap. Find it owner-scoped by the resource it produces
      // (invariant 2 — a player upgrades only their OWN building) + soft-delete-aware
      // (`deletedAt: null`, the way FarmService reads buildings). The `if` on `kind`
      // is where the union grows additively later (R-13b) — TypeScript's exhaustive
      // narrowing means a new kind without a branch is a compile-time gap to fill.
      if (item.kind === 'building_capacity') {
        const building = await tx.building.findFirst({
          where: { userId, resource: item.targetResource, deletedAt: null },
        });
        // No such building (the player never opened /farm, so it was never
        // materialized): block with a 422 and roll back the debit — they keep their
        // DigiCredits. The e2e materializes the Meat Farm via GET /api/farm first
        // (friction #6), so this is an edge, not the happy path.
        if (building === null) {
          throw new UnprocessableEntityException(`No ${item.targetResource} building to upgrade.`);
        }
        await tx.building.update({
          where: { id: building.id },
          data: { capacity: { increment: item.capacityDelta } },
        });
      } else if (item.kind === 'premium_time') {
        // TASK-38 (R-13b): grant TIMED premium — extend the buyer's `premiumUntil` by
        // `durationHours`. Owner-scoped by the authed `userId` (invariant 2 — a player
        // boosts only their OWN production). Read the current row inside the SAME tx so
        // the extension is atomic with the debit + audit (a rollback undoes it too).
        //
        // Extend from max(now, existing premiumUntil) so STACKING purchases ADD their
        // durations rather than reset the clock: buying a second while premium is still
        // active pushes the expiry further out; buying after it lapsed starts from now.
        const user = await tx.user.findUnique({ where: { id: userId } });
        const base = user?.premiumUntil && user.premiumUntil > now ? user.premiumUntil : now;
        // durationHours is defined for the premium_time kind (the catalog guarantees it);
        // `?? 0` is a defensive no-op that also keeps the arithmetic total-typed.
        const premiumUntil = new Date(base.getTime() + (item.durationHours ?? 0) * 3_600_000);
        await tx.user.update({
          where: { id: userId },
          data: { premiumUntil },
        });
      } else if (item.kind === 'inventory_item') {
        // TASK-262 (R-31b): grant ONE unit of the bought consumable into the player's
        // inventory. Owner-scoped by the authed `userId` (invariant 2 — a player fills
        // only their OWN inventory). An UPSERT-INCREMENT keyed on the
        // `@@unique([userId, itemId])` composite: the FIRST buy creates the stack at
        // quantity 1, a re-buy increments the SAME row to 2 (never a second row) — so
        // stacks sum cleanly. Runs INSIDE the SAME tx as the debit + audit, so a
        // rollback undoes the grant too (no item without a matching debit, no orphan).
        // The item is granted by SLUG (item.id) — the SAME `SHOP_ITEMS` slug the
        // catalog/read resolve the display name from, so the inventory row round-trips
        // to a real catalog entry. No effect params (targetResource/capacityDelta) are
        // read for this kind; owning the stack IS the effect (USE/DISCARD are R-31e).
        //
        // TASK-264 (R-31b child iii): the SPACE-LIMITED capacity cap. Before the grant,
        // determine whether it would create a NEW DISTINCT stack. A "slot" is one
        // distinct non-empty stack (a row with `quantity > 0`), NOT a unit count (A-246):
        // an INCREMENT of an already-owned stack fills NO new slot and is always allowed;
        // only a NEW distinct stack at/over `INVENTORY_SLOT_CAP` is refused. Owner-scoped
        // by the authed `userId` inside this SAME tx (invariant 2 — a player's cap is
        // computed only over their OWN rows), and thrown BEFORE the upsert so — being
        // inside the outer purchase `$transaction` — the whole purchase (debit + audit +
        // grant) rolls back and NO value moves + NO audit row is written on the refused
        // path (invariant 3). `INVENTORY_SLOT_CAP` is the ONE shared constant the read
        // field (`slotsUsed`/`slotCap`) also uses — the guard and the display never
        // disagree (single source of truth, A-246).
        const existingStack = await tx.inventoryItem.findUnique({
          where: { userId_itemId: { userId, itemId: item.id } },
        });
        // Only a grant that creates a brand-new distinct non-empty stack consumes a slot.
        // An already-owned non-empty stack just increments (always allowed); a drained-to-0
        // row (a future USE path) re-fills its own slot, not a new one.
        const wouldCreateNewSlot = existingStack === null || existingStack.quantity <= 0;
        if (wouldCreateNewSlot) {
          // TASK-281 (R-31b child iv): the cap is no longer the flat constant — it is
          // `INVENTORY_SLOT_CAP + <the buyer's purchased inventorySlotBonus>`. Read the
          // buyer's row in the SAME tx (owner-scoped by the authed `userId`, invariant
          // 2 — a player's cap is computed only over their OWN bonus) so the guard and
          // the read-side display (InventoryService, which adds the same bonus) can
          // never disagree. A user with the default bonus 0 sees the EXACT prior flat-10
          // behaviour (invariant-5 identity: `INVENTORY_SLOT_CAP + 0` === the old bare
          // constant).
          const buyer = await tx.user.findUnique({ where: { id: userId } });
          const effectiveCap = INVENTORY_SLOT_CAP + (buyer?.inventorySlotBonus ?? 0);
          const usedSlots = await tx.inventoryItem.count({
            where: { userId, quantity: { gt: 0 } },
          });
          if (usedSlots >= effectiveCap) {
            throw new UnprocessableEntityException(
              `Inventory full (${usedSlots}/${effectiveCap}).`,
            );
          }
        }
        await tx.inventoryItem.upsert({
          where: { userId_itemId: { userId, itemId: item.id } },
          create: { userId, itemId: item.id, quantity: 1 },
          update: { quantity: { increment: 1 } },
        });
      } else if (item.kind === 'inventory_slot') {
        // TASK-281 (R-31b child iv): grant an INVENTORY SLOT-EXPANSION — raise the
        // buyer's per-user distinct-stack cap by increasing `User.inventorySlotBonus`.
        // Owner-scoped by the authed `userId` (invariant 2 — a player raises only their
        // OWN cap). Mirrors the `premium_time` arm's owner-scoped `tx.user.update`
        // shape. Runs INSIDE the SAME tx as the debit + the 'purchase' audit row, so a
        // refusal/rollback undoes the grant too (invariant 3 — no cap raise without a
        // matching audited DigiCredits debit). ADDITIVE increment only (there is no
        // slot downgrade/reset this slice). `capacityDelta` carries the slots granted
        // (the catalog guarantees it for this kind; `?? 0` is a defensive total-typed
        // no-op). The effective cap the write guard above + the read display enforce is
        // then `INVENTORY_SLOT_CAP + inventorySlotBonus`.
        await tx.user.update({
          where: { id: userId },
          data: { inventorySlotBonus: { increment: item.capacityDelta ?? 0 } },
        });
      }

      // Invariant 3: append the immutable audit row for THIS economic mutation,
      // inside the SAME transaction as the balance debit + the effect (atomic — all
      // commit or none). Append-only: the ledger's 3rd action ('purchase', after
      // 'collect' and 'evolve'), never updated/deleted. `entity`/`entityId` reference
      // the shop item by its stable slug without a hard FK (the ledger spans many
      // entity kinds — 'Building', 'Digimon', now 'ShopItem'). The shape is copied
      // verbatim from FarmService.collectForUser.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'purchase',
          entity: 'ShopItem',
          entityId: item.id,
          resource: PREMIUM_CURRENCY,
          amountBefore,
          amountAfter,
        },
      });
    });

    // Re-read the committed state so the response reflects the dropped balance (the
    // catalog is unchanged). Outside the tx = a plain post-commit read; it will NOT
    // re-grant, as the row now exists.
    return this.getShopForUser(userId);
  }
}
