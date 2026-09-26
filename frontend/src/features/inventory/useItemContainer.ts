/**
 * `useItemContainer` — the React glue that connects RAW game state to the
 * derived grid view, while keeping UI state (filter/search/hover/selection)
 * local to the hook (brief sections 11, 13).
 *
 * Pure derivations (selectContainerView) are memoised on their inputs so we
 * never recompute `filter`/`build grid` on every render. The filtering logic
 * itself is in filters.ts (UI-independent); this hook only orchestrates it.
 *
 * Inventory and Vault are IDENTICAL consumers of this hook — the only
 * difference is which raw state + capacity they feed in. That is the whole
 * point of the spike: one container system, two instances.
 */

import { useMemo, useState } from 'react';

import type { Item, ItemFilterState, ItemStack, SlotView } from './types';
import type { ItemCatalogMap } from './store';
import { selectContainerView } from './selectors';
import { CATEGORY_FILTERS, countByCategory } from './filters';
import type { FilteredContainerView } from './types';

export interface UseItemContainerArgs {
  stacks: ReadonlyArray<ItemStack>;
  catalog: ItemCatalogMap;
  capacity: number;
  /** Initial UI filter (defaults to no filter). */
  initialFilter?: Partial<ItemFilterState>;
}

export interface UseItemContainerResult {
  /** Derived grid + counts, memoised on (stacks, catalog, capacity, filter). */
  view: FilteredContainerView;
  /** The full grid before filtering (for drag/drop future use, memoised). */
  grid: ReadonlyArray<SlotView>;
  /** Per-category counts for the filter chips, memoised. */
  categoryCounts: Readonly<Record<string, number>>;
  // --- UI state (local; NOT game state) ---
  filter: ItemFilterState;
  setCategory: (category: ItemFilterState['category']) => void;
  setSearch: (search: string) => void;
  setRarity: (rarity: ItemFilterState['rarity']) => void;
  setUsableOnly: (v: boolean) => void;
  setTradableOnly: (v: boolean) => void;
  clearFilters: () => void;
  // --- Convenience ---
  categoryFilters: typeof CATEGORY_FILTERS;
}

const DEFAULT_FILTER: ItemFilterState = {
  search: '',
  category: 'all',
  rarity: undefined,
  usableOnly: false,
  tradableOnly: false,
  favoriteOnly: false,
};

export function useItemContainer(args: UseItemContainerArgs): UseItemContainerResult {
  const { stacks, catalog, capacity, initialFilter } = args;

  const [filter, setFilter] = useState<ItemFilterState>({
    ...DEFAULT_FILTER,
    ...initialFilter,
  });

  // Derived grid view — recomputed only when inputs change.
  const view = useMemo(
    () => selectContainerView(stacks, catalog, capacity, filter),
    [stacks, catalog, capacity, filter],
  );

  const grid = useMemo(
    () => selectContainerView(stacks, catalog, capacity, DEFAULT_FILTER).slots,
    [stacks, catalog, capacity],
  );

  // Per-category counts use UNFILTERED items so chip badges always show totals.
  const categoryCounts = useMemo(() => {
    const items = stacks
      .map((s) => catalog.get(s.itemId))
      .filter((i): i is Item => i !== undefined);
    return countByCategory(items);
  }, [stacks, catalog]);

  const patch = (p: Partial<ItemFilterState>): void =>
    setFilter((prev) => ({ ...prev, ...p }));

  return {
    view,
    grid,
    categoryCounts,
    filter,
    setCategory: (category) => patch({ category }),
    setSearch: (search) => patch({ search }),
    setRarity: (rarity) => patch({ rarity }),
    setUsableOnly: (usableOnly) => patch({ usableOnly }),
    setTradableOnly: (tradableOnly) => patch({ tradableOnly }),
    clearFilters: () => setFilter({ ...DEFAULT_FILTER }),
    categoryFilters: CATEGORY_FILTERS,
  };
}
