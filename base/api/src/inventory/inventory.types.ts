/**
 * Public shape of the `GET /api/inventory` response (TASK-262, R-31b).
 *
 * The signed-in player's OWNED consumable-item stacks — the read half of the
 * space-limited inventory pillar (the buy→own→see arc). Written, like every other
 * public contract (`HealthStatus`, the `/auth/*` types, `OwnedDigimon`, `FarmState`,
 * `ShopState`), as an explicit exported interface. TASK-262's SPA keeps a LOCAL
 * mirror of these types (no cross-workspace import — the house rule D-8 #1); keep the
 * two in lock-step. Per invariant 5 (additive, never a silent break) fields may be
 * ADDED in later slices (a capacity cap, a per-item effect descriptor — R-31e) but an
 * existing one must not change meaning or vanish.
 *
 * Why the response is an OBJECT `{ items }` and not a bare array: it mirrors why
 * `FarmState`/`ShopState` wrap their lists — future inventory facts (the 10-slot
 * capacity, the used/free slot count) will arrive as sibling fields additively; a
 * top-level array would have no additive room.
 */

/**
 * One owned inventory stack as returned to the client (TASK-262, R-31b).
 *
 * The public projection of an `InventoryItem` row: the item's stable `itemId` slug,
 * its player-facing `name` (resolved server-side from `SHOP_ITEMS` by slug — the
 * client never needs the catalog to render the rail), and the `quantity` currently
 * owned. The internal/owner columns (`id`/`userId`/`createdAt`/`updatedAt`) are
 * DROPPED at the API boundary (the same discipline `ResourceBalanceView` applies to a
 * `ResourceBalance` row). A zero-quantity stack is hidden by the service, so every
 * returned entry has `quantity >= 1`.
 */
export interface InventoryItemView {
  /** The catalog slug this stack holds (the `itemId` a purchase named). */
  itemId: string;
  /** Player-facing name resolved from `SHOP_ITEMS` (falls back to the slug if unknown). */
  name: string;
  /** The whole units of this item the player currently owns (>= 1). */
  quantity: number;
}

/**
 * The `GET /api/inventory` 200 body — the signed-in player's owned item stacks.
 *
 * A wrapper object (not a bare array) so future inventory facts can be added as
 * sibling fields additively (invariant 5). As of R-31b it carries one sibling:
 *
 *  - `items` — the owned stacks (each with its resolved display `name` + `quantity`).
 *    A brand-new player who has bought nothing gets an EMPTY array (no stack row
 *    exists until the first purchase grants one — see `InventoryService`).
 *  - `slotsUsed` — the current count of DISTINCT non-empty stacks (= `items.length`);
 *    the "space-limited" usage (TASK-264, R-31b child iii). A multi-unit stack counts
 *    as ONE slot (A-246 — a slot is a distinct item TYPE, not a unit).
 *  - `slotCap` — the maximum distinct stacks a player may hold (= the shared
 *    `INVENTORY_SLOT_CAP`, 10). The shop refuses to grant an 11th distinct stack; the
 *    rail renders `slotsUsed / slotCap` (`N / 10`). One source of truth with the guard.
 */
export interface InventoryState {
  items: InventoryItemView[];
  slotsUsed: number;
  slotCap: number;
}

/**
 * The `POST /api/inventory/use` 200 body (TASK-263, R-31b child i) — the observable
 * result of USING one unit of a consumable on a chosen owned Digimon: the stack's new
 * quantity (0 once the last unit is spent — it then drops off `GET /api/inventory`),
 * and the target Digimon's post-use `xp`/`level` (the USE granted `xpBoost` XP through
 * the SAME canonical `applyXpGain` curve training/battle share, so the level may have
 * ticked). A small view — the client re-reads `/inventory` (and its roster) for the full
 * state; this just confirms the move. Written as an explicit exported interface (the SPA
 * keeps a LOCAL mirror, D-8 #1); keep the two in lock-step. Fields are additive only
 * (invariant 5).
 */
export interface UseInventoryItemResult {
  /** The catalog slug of the used stack. */
  itemId: string;
  /** The stack's quantity AFTER the decrement (>= 0; 0 means the last unit was spent). */
  quantity: number;
  /** The id of the Digimon the boost was applied to. */
  digimonId: string;
  /** That Digimon's XP after the boost (through the shared `applyXpGain` curve). */
  xp: number;
  /** That Digimon's level after the boost (may have ticked up). */
  level: number;
}

/**
 * The `POST /api/inventory/discard` 200 body (TASK-265, R-31b child ii) — the observable
 * result of DISCARDING an owned stack: the whole stack's `quantity` is zeroed (destroyed,
 * no refund — A-247), so the returned `quantity` is always 0 and the stack then drops off
 * `GET /api/inventory` (freeing exactly one slot — `slotsUsed` drops by one). A small view
 * — the client re-reads `/inventory` for the full state; this just confirms the move.
 * Written as an explicit exported interface (the SPA keeps a LOCAL mirror, D-8 #1); keep
 * the two in lock-step. Fields are additive only (invariant 5).
 */
export interface DiscardInventoryItemResult {
  /** The catalog slug of the discarded stack. */
  itemId: string;
  /** The stack's quantity AFTER the discard — always 0 (the whole stack is destroyed). */
  quantity: number;
}
