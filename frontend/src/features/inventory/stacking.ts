/**
 * Pure item-stacking logic (brief section 4).
 *
 * Rules:
 *  - Stacks of the same `itemId` merge, capped at `maxStack` per slot.
 *  - Overflow spills into the next slot (so `maxStack = 20` turns
 *    `x47` into `x20 + x20 + x7`).
 *  - Empty `quantity`/zero stacks are ignored.
 *  - The result is a DENSE array (no trailing holes) suitable for storage;
 *    the slot-grid with empty tail slots is produced by selectors.ts.
 *
 * No React. Fully testable.
 */

import type { Item, ItemStack } from './types';

export interface StackInput {
  itemId: string;
  quantity: number;
}

/**
 * Given a catalog (for `maxStack`) and a list of (item, qty) additions,
 * return a compact list of ItemStacks (dense, never exceeding capacity here).
 *
 * @param catalog lookup of itemId -> Item (for maxStack).
 * @param inputs raw contributions (may include duplicates across itemId).
 */
export function stackItems(
  catalog: ReadonlyMap<string, Item>,
  inputs: ReadonlyArray<StackInput>,
): ItemStack[] {
  // 1. Sum quantities per itemId.
  const totals = new Map<string, number>();
  for (const { itemId, quantity } of inputs) {
    if (quantity <= 0) continue;
    totals.set(itemId, (totals.get(itemId) ?? 0) + quantity);
  }

  // 2. Split each total into maxStack-sized slots, in stable insertion order.
  const out: ItemStack[] = [];
  for (const [itemId, total] of totals) {
    const item = catalog.get(itemId);
    const maxStack = item?.maxStack ?? 1;
    let remaining = total;
    while (remaining > 0) {
      const chunk = Math.min(remaining, maxStack);
      out.push({ itemId, quantity: chunk });
      remaining -= chunk;
    }
  }
  return out;
}

/**
 * Try to add `quantity` of `itemId` onto an EXISTING dense stack list,
 * filling partial stacks first, then opening new slots, up to `maxSlots`.
 *
 * Returns a NEW array (immutable update) plus the number of items that did
 * NOT fit (`overflow`). `overflow === 0` means everything fit.
 */
export function addToStacks(
  stacks: ReadonlyArray<ItemStack>,
  item: Item,
  quantity: number,
  maxSlots: number,
): { stacks: ItemStack[]; overflow: number } {
  const next = stacks.map((s) => ({ ...s }));
  let remaining = quantity;

  // Fill existing stacks of the same item that aren't full yet.
  for (const slot of next) {
    if (remaining <= 0) break;
    if (slot.itemId !== item.id) continue;
    const free = item.maxStack - slot.quantity;
    if (free <= 0) continue;
    const take = Math.min(free, remaining);
    slot.quantity += take;
    remaining -= take;
  }

  // Open new slots until capacity or quantity runs out.
  for (const _ of Array.from({ length: Math.max(0, maxSlots - next.length) })) {
    if (remaining <= 0) break;
    const take = Math.min(item.maxStack, remaining);
    next.push({ itemId: item.id, quantity: take });
    remaining -= take;
  }

  return { stacks: next, overflow: remaining };
}

/**
 * Compaction helper: re-pack a dense stack array so no slot is partially
 * filled when a later slot has the same item with spare room. Used after
 * removal/transfer to keep stacks tidy (brief: "reorganização futura").
 */
export function compactStacks(
  catalog: ReadonlyMap<string, Item>,
  stacks: ReadonlyArray<ItemStack>,
): ItemStack[] {
  const inputs: StackInput[] = stacks.map((s) => ({ itemId: s.itemId, quantity: s.quantity }));
  return stackItems(catalog, inputs);
}

/**
 * Total quantity held across all slots for an itemId (for badges/counts).
 */
export function totalQuantityFor(
  stacks: ReadonlyArray<ItemStack>,
  itemId: string,
): number {
  return stacks.reduce((sum, s) => (s.itemId === itemId ? sum + s.quantity : sum), 0);
}
