import { Inject, Injectable } from '@nestjs/common';
import type { Building, Prisma, ResourceBalance } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PREMIUM_PRODUCTION_MULTIPLIER } from '../shop/shop.seed';
import { STARTING_BUILDINGS } from './farm.seed';
import type { BuildingView, FarmState, ResourceBalanceView } from './farm.types';

/**
 * Compute a building's accrued-but-uncollected production (TASK-15 → shared with
 * TASK-22, R-4/R-4b) — the ONE canonical copy of the accrual formula.
 *
 *   `produced = clamp(floor(ratePerHour · elapsedHours · multiplier), 0, capacity)`
 *   where `elapsedHours = (now − lastCollectedAt) / 1h`.
 *
 * Extracted to a module-level pure function precisely so the READ path
 * ({@link FarmService.toBuildingView}, which exposes `produced` on `GET /farm`) and
 * the COLLECT path ({@link FarmService.collectForUser}, which BANKS `produced`)
 * share ONE implementation. If these two ever disagreed — e.g. the collect banked a
 * different number than the read had displayed — a player would watch a buffer of
 * 120 collect as 118, a real and confusing economy bug. Keeping a single function
 * makes that drift impossible by construction (task friction #2). Pure and
 * side-effect-free (no `this`, no I/O): both `now` and the row are passed in, so it
 * is trivially reused inside a `$transaction` on a re-read row.
 *
 * The `multiplier` (TASK-38, R-13b) is the Premium-Time production boost: the caller
 * passes {@link PREMIUM_PRODUCTION_MULTIPLIER} (+50%) while the owner's Premium Time
 * is active, else `1` (the default — a non-premium player's production is unchanged).
 * BOTH the read and the collect pass the SAME multiplier (computed once per request
 * from the same `User.premiumUntil`), so the banked amount always equals the displayed
 * amount — the whole point of this single shared function. The clamp to `capacity`
 * still applies AFTER the multiplier (a boost fills the buffer faster but never past
 * storage). This boost is farm-ONLY: it is threaded through nothing in `pvp/` or
 * `battle.ts` — premium can never touch ranked combat (the ethical-monetization
 * guarantee).
 *
 * `Math.max(0, …)` guards a clock-skew negative (a `lastCollectedAt` slightly in
 * the future never produces negative), and `Math.min(capacity, …)` is the storage
 * clamp (offline production stops accumulating once the buffer is full).
 * 3_600_000 ms = one real-time hour.
 */
export function computeProduced(
  building: Pick<Building, 'ratePerHour' | 'capacity' | 'lastCollectedAt'>,
  now: Date,
  multiplier = 1,
): number {
  const elapsedMs = now.getTime() - building.lastCollectedAt.getTime();
  const elapsedHours = Math.max(0, elapsedMs) / 3_600_000;
  return Math.min(building.capacity, Math.floor(building.ratePerHour * elapsedHours * multiplier));
}

/**
 * Farm/City domain logic (TASK-15, R-4) — the server-authoritative source of a
 * player's owned buildings and their computed-on-read production.
 *
 * House feature-service shape (P-1, the DIRECT analogue of {@link DigimonService}
 * — copied deliberately): the controller owns HTTP concerns (route, the guard),
 * this owns the rules. It reaches the datastore ONLY through the injected
 * {@link PrismaService} (invariant 1) — nothing bypasses the provider — and never
 * issues a hard delete (invariant 2: reads filter `deletedAt: null`; no delete
 * path exists this slice at all).
 *
 * Two non-obvious rules live here, both mirrored from the roster:
 *
 *  1. The STARTER GRANT (A-8): a brand-new account owns no buildings, but R-4's
 *     headline is "a signed-in player opens /farm and sees their starting
 *     buildings" — so the farm must never be empty for a real user. Rather than a
 *     migrate-time `prisma db seed` (a `ts-node` runner for one constant array,
 *     which could not know WHICH user to grant to) or a boot hook, we materialize
 *     STARTING_BUILDINGS server-side on the FIRST empty read, idempotently. This
 *     keeps the seed definition pure (farm.seed.ts) and the single write path
 *     behind the provider, here.
 *
 *  2. The ACCRUAL is COMPUTED ON READ (R-4's headline, no scheduler): `produced`
 *     is derived from `now − lastCollectedAt` in {@link computeProduced}, so
 *     production accrues while the player is OFFLINE and is credited on their next
 *     read — with NO background job (no cron / BullMQ / @nestjs/schedule). The read
 *     path ({@link getFarmForUser}) writes NOTHING to `lastCollectedAt`; resetting
 *     it — banking the buffer into a spendable {@link ResourceBalance} — is the
 *     COLLECT mutation ({@link collectForUser}, R-4b). Because collecting MOVES
 *     spendable value, invariant 3 binds THERE: each non-zero collect appends an
 *     append-only `AuditLog` row inside the same `$transaction` as the balance
 *     change. (The materialize `createMany` in {@link grantStartingBuildingsIfEmpty}
 *     is a one-time provisioning grant, the same class as the starter-Digimon grant
 *     — not an economic mutation, so it writes no audit row.)
 */
@Injectable()
export class FarmService {
  // Explicit @Inject(PrismaService) token — REQUIRED, not decorative (L-7/P-7):
  // the vitest/esbuild transform does NOT emit constructor `design:paramtypes`
  // (unlike the production `nest build` via tsc), so bare `private readonly
  // prisma: PrismaService` injects `undefined` under the gate and the first
  // `GET /farm` 500s. Naming the provider needs no reflected metadata, so it
  // resolves identically under esbuild (tests) and tsc (build). The e2e's 200
  // assertion is the guard against a regression here.
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Return the signed-in player's farm state, granting the starting buildings on
   * the first empty read and computing each building's accrued `produced` amount.
   *
   * Steps:
   *  1. Read the owner's active buildings (owner-scoped + soft-delete-aware —
   *     invariant 1/2). Ordered by `createdAt` (then `id` as a stable tiebreaker
   *     for rows granted in the same `createMany` with identical timestamps) so
   *     the client sees a deterministic order across reads.
   *  2. If it is empty, grant `STARTING_BUILDINGS` once and re-read (see
   *     {@link grantStartingBuildingsIfEmpty}).
   *  3. Snapshot `now` ONCE (so every building's accrual is measured against a
   *     single shared clock within the request), then project rows →
   *     {@link BuildingView}, computing `produced` and dropping internal columns.
   *  4. Read the owner's spendable balances (R-4b addition — owner-scoped +
   *     soft-delete-aware) and project them → {@link ResourceBalanceView}. This is
   *     the `balance` sibling A-11 reserved room for; it is purely additive (the
   *     `buildings[]` shape is byte-unchanged, invariant 5). A player who has never
   *     collected has no balance row yet, so this is `[]` until the first non-zero
   *     collect (TASK-22) creates one.
   */
  async getFarmForUser(userId: string): Promise<FarmState> {
    let buildings = await this.prisma.building.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (buildings.length === 0) {
      buildings = await this.grantStartingBuildingsIfEmpty(userId);
    }

    // R-37 (TASK-204, D-431/A-186): AUTO-BANK on the read path. Opening/reloading
    // /farm now BANKS every ready building's accrued buffer — with NO "Collect"
    // click — via the SAME economic-mutation write shape the manual collect used
    // (see {@link bankAccrued}), inside ONE `$transaction`. This is the smallest
    // behaviour-only change that satisfies I-22: the write moves from a click
    // trigger to a read trigger, but the write ITSELF (upsert-increment + clock
    // stamp + append-only AuditLog row) is byte-identical, so invariant 3 stays
    // exactly as honest as before. It fires ONLY when the player actually loads
    // /farm — as often as they used to click — so NO background scheduler/worker
    // is introduced (the operating-cost constraint the human flagged, A-186). A
    // building with `produced <= 0` writes nothing, so a repeat read that accrues
    // nothing is idempotent (no ledger spam, invariant 3 stays honest).
    //
    // We bank BEFORE re-reading the rows below so the returned FarmState reflects
    // the just-committed reset buffers (`produced ≈ 0`) and grown balance. The
    // wire SHAPE (FarmState/BuildingView/ResourceBalanceView) is BYTE-UNCHANGED
    // (invariant 5) — only the numbers reflect the bank.
    await this.prisma.$transaction((tx) => this.bankAccrued(tx, userId, new Date()));

    // Re-read the (now banked) building rows so `produced` reflects the reset
    // clocks committed by the bank above. (A grant above may have created rows;
    // the bank never touches a just-granted building because its `produced === 0`.)
    buildings = await this.prisma.building.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    // ONE clock per request: read `now` a single time so all buildings' accrual is
    // measured against the same instant (a per-building `new Date()` could drift
    // across a large farm and make two buildings disagree on "now").
    const now = new Date();

    // The Premium-Time production multiplier (TASK-38, R-13b): +50% while the owner's
    // `premiumUntil` is in the future, else 1. Loaded owner-scoped by the authed
    // `userId` (invariant 2) and passed to computeProduced so the boost shows up in
    // the EXISTING `produced` numbers (FarmState shape byte-unchanged, invariant 5).
    const multiplier = await this.premiumMultiplier(userId, now);

    // The spendable balances (R-4b): a PERSISTED running total, unlike `produced`
    // which is computed-on-read. Owner-scoped + `deletedAt: null` (invariant 2).
    // Ordered by `resource` so the client sees a stable order across reads.
    const balances = await this.prisma.resourceBalance.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ resource: 'asc' }],
    });

    return {
      buildings: buildings.map((building) => this.toBuildingView(building, now, multiplier)),
      balance: balances.map((balance) => this.toResourceBalanceView(balance)),
    };
  }

  /**
   * Collect (bank) every ready building's accrued production into the player's
   * spendable {@link ResourceBalance}s (TASK-22, R-4b) — the game's FIRST economic
   * mutation and the FIRST write to invariant 3's append-only {@link AuditLog}.
   *
   * R-4 was carved read-only (D-36): `GET /farm` computes `produced` on read but
   * writes nothing economic, so invariant 3 was not yet engaged. THIS method is
   * where it becomes real — collecting MOVES spendable value, so every non-zero
   * collect writes an audit row (who / what / when / before→after) INSIDE the same
   * transaction as the balance change. The `collectForUser`-in-a-`$transaction`-
   * with-an-audit-row shape here is the template R-8b (evolve spend), R-13 (shop)
   * and R-14 (admin) reuse.
   *
   * The WHOLE mutation runs inside a single interactive `$transaction`, copied from
   * {@link DigimonService.evolve}'s tx (TASK-18) and the grant tx above: it makes
   * "re-read the buildings, then bank + reset + audit each" atomic. Two concurrent
   * collects for the same account cannot both read the same pre-collect
   * `lastCollectedAt` and both bank the buffer (a double-collect). On SQLite the
   * writer is serialized, so the second transaction observes the first's committed
   * `lastCollectedAt = now` update and re-derives `produced ≈ 0` — the mutation is
   * safe to repeat (acceptance check 5).
   *
   * Per owner-scoped building (`findMany({ where: { userId, deletedAt: null } })` —
   * invariant 2, a user only ever collects their OWN buildings and banks into their
   * OWN balance), with `now` snapshotted ONCE:
   *  - compute `produced` via the SHARED {@link computeProduced} (the exact formula
   *    the read path exposed — NOT a second copy, so the banked amount always
   *    equals what the player saw; friction #2);
   *  - a building with `produced === 0` is SKIPPED — no balance write, no clock
   *    reset, no audit noise (an empty-buffer collect is a no-op success);
   *  - otherwise read the current `(userId, resource)` balance (`amountBefore` = its
   *    `amount`, or 0 if no row exists yet), UPSERT-add `produced` onto it (the
   *    `@@unique([userId, resource])` composite is the `userId_resource` accessor,
   *    so two credits to the same pair SUM onto one row — friction #6), STAMP
   *    `lastCollectedAt = now` (resetting the buffer to ~0 on the next read), and
   *    APPEND the {@link AuditLog} row (`action: 'collect'`, `entity: 'Building'`,
   *    `entityId`, `resource`, `amountBefore` → `amountAfter`). The audit write is
   *    inside the tx, so it commits atomically with the balance change or not at all
   *    (invariant 3). The ledger is append-only — this is the only write to it and
   *    there is NO update/delete path against it anywhere.
   *
   * After the tx, re-read the fresh {@link FarmState} via {@link getFarmForUser} so
   * the response carries the reset `produced` values AND the updated `balance`
   * sibling — exactly what TASK-23's Collect UI renders. The re-read is outside the
   * tx (a plain read) so it reflects the committed state.
   *
   * NO request body / DTO (the controller passes only `userId` from the guard), NO
   * new ctor param (reuses the existing `@Inject(PrismaService)` — friction #1), and
   * NO scheduler (collect is synchronous + transactional; accrual stays
   * computed-on-read — D-11 keeps SQLite).
   */
  async collectForUser(userId: string): Promise<FarmState> {
    // Delegate to the shared bank step (R-37/TASK-204 extraction): the click and
    // the read path now BANK through the exact same tx body, so they can never
    // drift. This method is retained as a harmless behaviour-identical alias (the
    // POST /farm/collect route still works) even though the web Collect button was
    // removed — reverting R-37 is just re-adding the button.
    await this.prisma.$transaction((tx) => this.bankAccrued(tx, userId, new Date()));

    // Re-read the committed state so the response reflects the reset buffers AND the
    // updated spendable balance (the `balance` sibling A-11 reserved room for).
    return this.getFarmForUser(userId);
  }

  /**
   * Bank (collect) every ready building's accrued production into the owner's
   * spendable {@link ResourceBalance}s, inside the caller's `$transaction` (TASK-22
   * → extracted at TASK-204/R-37 so BOTH the manual collect AND the on-read
   * auto-bank share ONE write body — the game's economic-mutation template and the
   * FIRST writer to invariant 3's append-only {@link AuditLog}).
   *
   * Runs entirely on the passed-in `tx` (so the balance change + its audit row + the
   * clock reset commit together or not at all) with `now` snapshotted ONCE by the
   * caller. Per owner-scoped building (`findMany({ where: { userId, deletedAt: null }
   * })` — invariant 2, a user only ever banks their OWN buildings into their OWN
   * balance):
   *  - compute `produced` via the SHARED {@link computeProduced} (the exact formula
   *    the read path exposes — NOT a second copy, so the banked amount always equals
   *    the displayed amount; friction #2);
   *  - a building with `produced <= 0` is SKIPPED — no balance write, no clock reset,
   *    no audit noise (an empty-buffer bank is a no-op success, which is why a second
   *    immediate read/collect banks ~0 more and writes no row: idempotent);
   *  - otherwise read the current `(userId, resource)` balance (`amountBefore`),
   *    UPSERT-add `produced` onto it (the `@@unique([userId, resource])` composite is
   *    the `userId_resource` accessor, so credits SUM onto one row — friction #6),
   *    STAMP `lastCollectedAt = now` (resetting the buffer to ~0 on the next read),
   *    and APPEND the {@link AuditLog} row (`action: 'collect'`, `entity: 'Building'`,
   *    `entityId`, `resource`, `amountBefore` → `amountAfter`) — inside the SAME tx,
   *    so it commits atomically with the balance change (invariant 3). The ledger is
   *    append-only — this is the only write to it, never updated/deleted.
   *
   * On SQLite the writer is serialized, so two concurrent banks for the same account
   * cannot both read the same pre-bank `lastCollectedAt` and double-bank the buffer:
   * the second observes the first's committed reset and re-derives `produced ≈ 0`.
   *
   * NOTE the `action` stays `'collect'` (A-186): the audit ledger's meaning is
   * unchanged (value banked from a building), and keeping the string byte-identical
   * means the existing collect-spec assertions and any ledger consumer stay green —
   * a two-way-door choice (R-37 changes the TRIGGER, not the ledger contract).
   */
  private async bankAccrued(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<void> {
    const buildings = await tx.building.findMany({
      where: { userId, deletedAt: null },
    });

    // The SAME Premium-Time multiplier the read path uses (TASK-38, R-13b), loaded
    // from the owner's `premiumUntil` inside the tx (owner-scoped, invariant 2) so the
    // banked amount always equals the amount the player saw on GET /api/farm.
    const premiumUser = await tx.user.findUnique({ where: { id: userId } });
    const multiplier =
      premiumUser?.premiumUntil && premiumUser.premiumUntil > now
        ? PREMIUM_PRODUCTION_MULTIPLIER
        : 1;

    for (const building of buildings) {
      const produced = computeProduced(building, now, multiplier);
      // An empty buffer is a no-op: no balance change, no clock reset, no audit
      // row (invariant 3 records mutations that MOVE value; a 0-bank moves none).
      if (produced <= 0) continue;

      // The current banked amount for this (user, resource), or 0 if no row yet.
      // Read BEFORE the upsert so `amountBefore` is the true pre-mutation state.
      const existing = await tx.resourceBalance.findUnique({
        where: { userId_resource: { userId, resource: building.resource } },
      });
      const amountBefore = existing?.amount ?? 0;
      const amountAfter = amountBefore + produced;

      // Upsert-add: create the row at `produced` if absent, else increment. The
      // `@@unique([userId, resource])` composite (accessor `userId_resource`) is
      // the key, so repeated credits SUM onto ONE row, never split into two.
      await tx.resourceBalance.upsert({
        where: { userId_resource: { userId, resource: building.resource } },
        create: { userId, resource: building.resource, amount: produced },
        update: { amount: { increment: produced } },
      });

      // Reset the accrual clock: the buffer we just banked is now spent.
      await tx.building.update({
        where: { id: building.id },
        data: { lastCollectedAt: now },
      });

      // Invariant 3: append the immutable audit row for THIS economic mutation,
      // inside the SAME transaction as the balance change (atomic). Append-only.
      await tx.auditLog.create({
        data: {
          userId,
          action: 'collect',
          entity: 'Building',
          entityId: building.id,
          resource: building.resource,
          amountBefore,
          amountAfter,
        },
      });
    }
  }

  /**
   * Grant the starting buildings to `userId` IFF they currently own none, then
   * return the (now non-empty) raw building rows. Idempotent and race-safe.
   *
   * Returns raw Prisma `Building[]` (NOT `BuildingView[]`) — the accrual mapping
   * happens once, back in {@link getFarmForUser}, against the shared `now`. This
   * mirrors `DigimonService.grantStarterRosterIfEmpty` returning raw `Digimon[]`.
   *
   * Why the count-guard runs INSIDE an interactive `$transaction` and re-checks
   * the count (rather than trusting the caller's earlier empty read): two rapid
   * concurrent first requests from the same fresh account could BOTH observe an
   * empty farm in step 1 above and both try to grant — doubling the starters. The
   * transaction makes "count, then (if 0) createMany" atomic. On SQLite the writer
   * is serialized, so the second transaction sees the first's inserts and its
   * `count > 0` short-circuits — the starters are granted exactly once. A
   * returning player (buildings already non-empty) is likewise never re-granted.
   *
   * The read-back happens OUTSIDE the transaction (a plain `findMany`) so the
   * returned set reflects whatever is committed — the grant we just made, or the
   * concurrent grant that won the race — with the same deterministic order as
   * {@link getFarmForUser}. `lastCollectedAt` is left to the schema default
   * (`now()`), so a freshly granted building starts accruing immediately (and its
   * first read yields `produced === 0`).
   */
  private async grantStartingBuildingsIfEmpty(userId: string): Promise<Building[]> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.building.count({
        where: { userId, deletedAt: null },
      });
      // Only seed a genuinely empty farm; a racing grant that already committed
      // makes this > 0 and we skip (no duplicate buildings).
      if (existing > 0) return;

      const starters: Prisma.BuildingCreateManyInput[] = STARTING_BUILDINGS.map((building) => ({
        ...building,
        userId,
      }));
      await tx.building.createMany({ data: starters });
    });

    return this.prisma.building.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Project a persisted `Building` row to its public {@link BuildingView} shape.
   *
   * UNLIKE `DigimonService.toOwnedDigimon` — which is a pure scalar field-copy —
   * this mapper DERIVES a field: the `Building` row carries an extra internal
   * column `lastCollectedAt` which is NOT re-exposed; instead it is the INPUT to
   * the computed-on-read `produced` amount and is then DROPPED. Every field is
   * still named explicitly so internal columns (`userId`, `lastCollectedAt`,
   * `createdAt`, `deletedAt`) can NEVER accidentally leak across the API boundary —
   * the same discipline the auth handlers apply to `passwordHash`. If a new public
   * field is ever added it must be added here deliberately (invariant 5: additive).
   *
   * The accrual math (whole integer units, R-4's offline-production headline) is
   * the SHARED {@link computeProduced} — the ONE canonical copy, reused verbatim by
   * the collect path ({@link collectForUser}) so the amount banked always equals the
   * amount this read displayed (no read/collect drift). `now` is passed IN
   * (snapshotted once per request by the caller) so all buildings share one clock.
   * This projection is READ-ONLY: it never writes `lastCollectedAt` — that reset
   * (banking the buffer) is the collect mutation, R-4b's {@link collectForUser}.
   */
  private toBuildingView(building: Building, now: Date, multiplier = 1): BuildingView {
    return {
      id: building.id,
      kind: building.kind,
      resource: building.resource,
      ratePerHour: building.ratePerHour,
      capacity: building.capacity,
      produced: computeProduced(building, now, multiplier),
    };
  }

  /**
   * The Premium-Time production multiplier for `userId` at `now` (TASK-38, R-13b):
   * {@link PREMIUM_PRODUCTION_MULTIPLIER} (+50%) while the owner's `User.premiumUntil`
   * is a future instant, else `1` (no boost — the default for a player who never
   * bought premium or whose premium lapsed). Owner-scoped by the authed `userId`
   * (invariant 2 — a player boosts only their OWN production) and reached only through
   * {@link PrismaService} (invariant 1). Used by the READ path; the COLLECT path
   * re-derives the SAME value inside its tx (from the identical `premiumUntil`) so the
   * two never disagree.
   *
   * This is the ONLY place farm production reads premium status. It is deliberately
   * NOT called anywhere in `pvp/` or `battle.ts`: the boost is PvE/QoL only and NEVER
   * touches ranked combat (the ethical-monetization guarantee — no pay-to-win).
   */
  private async premiumMultiplier(userId: string, now: Date): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.premiumUntil && user.premiumUntil > now ? PREMIUM_PRODUCTION_MULTIPLIER : 1;
  }

  /**
   * Project a persisted `ResourceBalance` row to its public
   * {@link ResourceBalanceView} shape (TASK-22, R-4b).
   *
   * Exposes ONLY `resource` + `amount`, dropping the internal/owner columns (`id`,
   * `userId`, `createdAt`, `updatedAt`, `deletedAt`) at the API boundary — the same
   * leak-proofing discipline {@link toBuildingView} applies to `Building` and the
   * auth surface applies to `passwordHash`. If a new public field is ever added it
   * must be added here deliberately (invariant 5: additive).
   */
  private toResourceBalanceView(balance: ResourceBalance): ResourceBalanceView {
    return {
      resource: balance.resource,
      amount: balance.amount,
    };
  }
}
