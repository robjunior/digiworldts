/**
 * Reusable, UI-independent item filtering (brief sections 9 & 10).
 *
 * Design: filtering is a PURE function `filterItems(items, state, catalog)`
 * plus a small registry of named category presets. Components never branch on
 * filter identity (`if (selected === 'consumables') …`); instead they hand a
 * declarative `ItemFilterState` to `filterItems`. New facets (rarity/usable/
 * tradable/favorite) extend `ItemFilterState` + the predicate builder without
 * touching the components.
 */

import type { Item, ItemFilter, ItemFilterCategory, ItemFilterState } from './types';

/** Build a single predicate from a declarative filter state. Pure & composable. */
export function buildFilterPredicate(state: ItemFilterState): (item: Item) => boolean {
  const needle = state.search.trim().toLowerCase();
  return (item: Item): boolean => {
    if (state.category !== 'all' && item.category !== state.category) return false;
    if (state.rarity !== undefined && item.rarity !== state.rarity) return false;
    if (state.usableOnly && item.usable !== true) return false;
    if (state.tradableOnly && item.tradable !== true) return false;
    if (state.favoriteOnly) return false; // favorites resolved by caller; default off
    if (needle.length > 0) {
      const hay = `${item.name} ${item.description ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  };
}

/** Filter an array of items by a declarative state. Single pass, no chaining. */
export function filterItems(items: ReadonlyArray<Item>, state: ItemFilterState): Item[] {
  const predicate = buildFilterPredicate(state);
  return items.filter(predicate);
}

/**
 * Named category presets used to render the filter bar. Each carries a pure
 * predicate so the same set drives both the UI chip labels AND an eager
 * per-category count. Adding a category = one entry here + one union member.
 */
export const CATEGORY_FILTERS: ReadonlyArray<ItemFilter & { category: ItemFilterCategory }> = [
  { id: 'all', label: 'All', category: 'all', predicate: () => true },
  {
    id: 'consumable',
    label: 'Consumables',
    category: 'consumable',
    predicate: (i) => i.category === 'consumable',
  },
  {
    id: 'equipment',
    label: 'Equipment',
    category: 'equipment',
    predicate: (i) => i.category === 'equipment',
  },
  {
    id: 'material',
    label: 'Materials',
    category: 'material',
    predicate: (i) => i.category === 'material',
  },
  { id: 'quest', label: 'Quest', category: 'quest', predicate: (i) => i.category === 'quest' },
  { id: 'key', label: 'Key Items', category: 'key', predicate: (i) => i.category === 'key' },
  { id: 'other', label: 'Other', category: 'other', predicate: (i) => i.category === 'other' },
];

/**
 * Count how many items match each preset — lets the UI show "Consumables (12)"
 * without duplicating filter logic. Pure given the inputs.
 */
export function countByCategory(
  items: ReadonlyArray<Item>,
): Readonly<Record<ItemFilterCategory, number>> {
  const counts = {
    all: items.length,
    consumable: 0,
    equipment: 0,
    material: 0,
    quest: 0,
    key: 0,
    other: 0,
  } as Record<ItemFilterCategory, number>;
  for (const it of items) counts[it.category] += 1;
  return counts;
}
