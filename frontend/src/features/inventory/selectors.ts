/**
 * Pure selectors that turn RAW game state into the VIEW models the grid
 * renders (brief section 11 + 13).
 *
 * Responsibilities:
 *  - Materialise the full slot grid (dense stacks + empty trail up to capacity)
 *    from the stored dense array. The trailing empties are DERIVED, not stored.
 *  - Apply the active filter without mutating data, marking excluded slots as
 *    `visible: false` so a single memoised pass serves both the grid and the
 *    header counts.
 *
 * These are pure functions: the React layer wraps them in `useMemo` keyed on
 * the raw inputs, so we never run `items.filter().filter()` per render. The
 * filtering logic itself lives in filters.ts (UI-independent).
 */

import type { Item, ItemFilterState, ItemStack, SlotView, FilteredContainerView } from './types';
import { buildFilterPredicate } from './filters';

/**
 * Build the full slot grid (occupied slots + empty padding up to `capacity`)
 * from a dense stack array. `isStackTail` flags the final slot of a run of
 * identical itemId so the UI can draw a continuous "stack" affordance.
 */
export function buildSlotGrid(
  stacks: ReadonlyArray<ItemStack>,
  catalog: ReadonlyMap<string, Item>,
  capacity: number,
): SlotView[] {
  const grid: SlotView[] = [];
  let prevItemId: string | null = null;
  for (let i = 0; i < capacity; i += 1) {
    const stack = i < stacks.length ? stacks[i]! : null;
    const item = stack ? catalog.get(stack.itemId) ?? null : null;
    const isStackTail = !!stack && stack.itemId !== prevItemId;
    grid.push({
      index: i,
      item,
      quantity: stack?.quantity ?? 0,
      isStackTail,
      visible: true,
    });
    prevItemId = stack ? stack.itemId : null;
  }
  return grid;
}

/**
 * Apply a filter to an already-built grid. Pure: returns a NEW grid with
 * `visible` recomputed. Empty slots remain visible (filters only apply to
 * items). Header totals (`total`, `usedCapacity`) describe capacity and are
 * filter-independent; `occupied` counts visible occupied slots.
 */
export function applyFilterToGrid(
  grid: ReadonlyArray<SlotView>,
  filter: ItemFilterState,
): FilteredContainerView {
  const predicate = buildFilterPredicate(filter);
  let occupied = 0;
  let usedCapacity = 0;

  const slots = grid.map((slot) => {
    if (slot.item === null) {
      usedCapacity += 0; // empty slot never counts as used
      return slot;
    }
    usedCapacity += 1;
    const ok = predicate(slot.item);
    if (ok) occupied += 1;
    return ok ? slot : { ...slot, visible: false };
  });

  return {
    slots,
    occupied,
    total: grid.length,
    usedCapacity,
  };
}

/**
 * One-shot convenience used by the hook: grid + filter in a single pure pass.
 * Memoise the result in the component layer.
 */
export function selectContainerView(
  stacks: ReadonlyArray<ItemStack>,
  catalog: ReadonlyMap<string, Item>,
  capacity: number,
  filter: ItemFilterState,
): FilteredContainerView {
  const grid = buildSlotGrid(stacks, catalog, capacity);
  return applyFilterToGrid(grid, filter);
}
