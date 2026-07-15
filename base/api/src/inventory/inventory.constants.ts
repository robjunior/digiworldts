/**
 * Inventory capacity constants (TASK-264, R-31b follow-on child iii — the
 * "space-limited" pillar R-31b names).
 *
 * The SINGLE SOURCE OF TRUTH for the BASE slot cap: both the WRITE-side guard (the shop
 * purchase refuses to grant an 11th DISTINCT stack — `ShopService.purchaseForUser`)
 * and the READ-side derived field (`slotsUsed` / `slotCap` on `InventoryState`,
 * surfaced by `InventoryService.getInventoryForUser`) read this ONE constant, so the
 * guard and the display can never disagree (never hard-code `10` twice — A-246).
 *
 * TASK-281 (R-31b child iv): the EFFECTIVE cap is now `INVENTORY_SLOT_CAP +
 * User.inventorySlotBonus` — a player can BUY the `inventory_slot`-kind shop item to
 * raise their per-user cap. This base constant is UNCHANGED (10 stays); the bonus is a
 * purely additive term BOTH the guard and the display add on top of it (so they still
 * agree by construction). A user with the default bonus 0 sees the exact flat 10.
 *
 * A "slot" is one DISTINCT non-empty stack (a row with `quantity > 0`), NOT a unit
 * count (A-246): buying a 2nd unit of an already-owned item type fills NO new slot and
 * is always allowed; only a NEW distinct stack at/over the cap is refused. This is the
 * reading most consistent with R-31b's "10-slot capacity" framing and the shipped read
 * (which already keys distinct `quantity > 0` stacks).
 */
export const INVENTORY_SLOT_CAP = 10;
