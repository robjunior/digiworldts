/**
 * Spike acceptance tests for the pure logic layers (brief section 16).
 * These exercise capacity derivation, the stacking invariant, filters, vault
 * access, and the grid selector WITHOUT a DOM — proving the architecture holds
 * before any rendering concern.
 *
 * Run: pnpm --filter @digiworld/frontend test  (vitest, happy-dom)
 * Or:  npx vitest run src/features/inventory
 */

import { describe, it, expect } from 'vitest';
import type { Stage } from '@digiworld/shared';

import type { Item } from './types';
import {
  deriveInventoryCapacity,
  deriveVaultCapacity,
  inventoryTotalSlots,
  vaultTotalSlots,
} from './capacity';
import { stackItems, addToStacks, totalQuantityFor, compactStacks } from './stacking';
import { filterItems, buildFilterPredicate, countByCategory, CATEGORY_FILTERS } from './filters';
import { resolveVaultAccess } from './vaultAccess';
import { buildSlotGrid, applyFilterToGrid, selectContainerView } from './selectors';

const catalog = new Map<string, Item>([
  ['potion', { id: 'potion', name: 'Potion', category: 'consumable', maxStack: 20, icon: '🧪', usable: true }],
  ['wood', { id: 'wood', name: 'Wood', category: 'material', maxStack: 99, icon: '🪵' }],
  ['sword', { id: 'sword', name: 'Iron Sword', category: 'equipment', maxStack: 1, icon: '⚔️' }],
]);

const party = (stages: Stage[]): { id: string; stage: Stage }[] =>
  stages.map((s, i) => ({ id: `m${i}`, stage: s }));

describe('inventory capacity derivation', () => {
  it('starts at 6 base slots with an empty party', () => {
    const cap = deriveInventoryCapacity({ slots: [], expansions: [], party: [], baseSlots: 6 });
    expect(cap.base).toBe(6);
    expect(cap.party).toBe(0);
    expect(cap.total).toBe(6);
  });

  it('adds party slots from evolutionary stages (Rookie+1, Champion+2, Ultimate+3)', () => {
    const cap = deriveInventoryCapacity({
      slots: [],
      expansions: [],
      party: party(['Rookie', 'Champion', 'Ultimate']),
      baseSlots: 6,
    });
    expect(cap.party).toBe(1 + 2 + 3);
    expect(cap.total).toBe(12);
  });

  it('recalculates automatically when a Digimon changes stage', () => {
    const before = inventoryTotalSlots({
      slots: [],
      expansions: [],
      party: party(['Rookie']),
      baseSlots: 6,
    });
    const after = inventoryTotalSlots({
      slots: [],
      expansions: [],
      party: party(['Mega']),
      baseSlots: 6,
    });
    expect(before).toBe(7); // 6 + 1
    expect(after).toBe(10); // 6 + 4
  });

  it('adds expansion bonus on top of base + party', () => {
    const cap = deriveInventoryCapacity({
      slots: [],
      expansions: [{ id: 'backpack', slots: 3 }],
      party: party(['Rookie', 'Champion']),
      baseSlots: 6,
    });
    expect(cap.expansion).toBe(3);
    expect(cap.total).toBe(6 + (1 + 2) + 3); // 12
  });
});

describe('vault capacity is independent', () => {
  it('vault base is much larger than inventory base', () => {
    const v = deriveVaultCapacity({ slots: [], expansions: [], baseSlots: 100 });
    expect(v.base).toBe(100);
    expect(v.total).toBe(100);
  });

  it('vault expansions do not leak into inventory total', () => {
    const vaultState = { slots: [], expansions: [{ id: 'p1', slots: 50 }], baseSlots: 100 };
    expect(vaultTotalSlots(vaultState)).toBe(150);
    const invState = { slots: [], expansions: [], party: party(['Rookie']), baseSlots: 6 };
    expect(inventoryTotalSlots(invState)).toBe(7); // untouched by vault expansion
  });
});

describe('item stacking invariant', () => {
  it('splits Potion x47 into 20 + 20 + 7 under maxStack 20', () => {
    const stacked = stackItems(catalog, [{ itemId: 'potion', quantity: 47 }]);
    expect(stacked).toHaveLength(3);
    expect(stacked[0]!.quantity).toBe(20);
    expect(stacked[1]!.quantity).toBe(20);
    expect(stacked[2]!.quantity).toBe(7);
  });

  it('merges separate potion pickups into one dense set', () => {
    const stacked = stackItems(catalog, [
      { itemId: 'potion', quantity: 20 },
      { itemId: 'potion', quantity: 20 },
      { itemId: 'potion', quantity: 7 },
    ]);
    expect(stacked).toHaveLength(3);
    expect(totalQuantityFor(stacked, 'potion')).toBe(47);
  });

  it('adds to existing stacks then opens new slots up to capacity', () => {
    const item = catalog.get('potion')!;
    // existing slot already full (20). Adding 25 opens new slots within capacity 3.
    const { stacks, overflow } = addToStacks([{ itemId: 'potion', quantity: 20 }], item, 25, 3);
    expect(stacks).toHaveLength(3); // 20 (full) + 20 + 5
    expect(stacks[0]!.quantity).toBe(20);
    expect(stacks[1]!.quantity).toBe(20);
    expect(stacks[2]!.quantity).toBe(5);
    expect(overflow).toBe(0);
  });

  it('reports overflow when capacity is exceeded', () => {
    const item = catalog.get('potion')!;
    const { overflow } = addToStacks([], item, 100, 2); // 2 slots * 20 = 40 max
    expect(overflow).toBe(60);
  });

  it('compacts scattered partial stacks', () => {
    const compacted = compactStacks(catalog, [
      { itemId: 'potion', quantity: 5 },
      { itemId: 'potion', quantity: 10 },
    ]);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]!.quantity).toBe(15);
  });
});

describe('filters (UI-independent, reusable)', () => {
  const items: Item[] = [...catalog.values()];

  it('filters by category', () => {
    const out = filterItems(items, { search: '', category: 'consumable', rarity: undefined, usableOnly: false, tradableOnly: false, favoriteOnly: false });
    expect(out.every((i) => i.category === 'consumable')).toBe(true);
    expect(out).toHaveLength(1);
  });

  it('filters by search name', () => {
    const predicate = buildFilterPredicate({ search: 'wood', category: 'all', rarity: undefined, usableOnly: false, tradableOnly: false, favoriteOnly: false });
    expect(items.filter(predicate)).toHaveLength(1);
  });

  it('counts per category for chip badges', () => {
    const counts = countByCategory(items);
    expect(counts.all).toBe(3);
    expect(counts.material).toBe(1);
    expect(counts.equipment).toBe(1);
  });

  it('exposes a fixed, extensible category preset list', () => {
    expect(CATEGORY_FILTERS.map((f) => f.category)).toContain('key');
  });
});

describe('vault access permission resolver', () => {
  it('is unavailable with no city and no item', () => {
    const a = resolveVaultAccess({ inVaultArea: false, ownedAccessItemIds: [], remoteAccessItemIds: ['remote-vault'] });
    expect(a.available).toBe(false);
    expect(a.source).toBeNull();
  });

  it('opens via city', () => {
    const a = resolveVaultAccess({ inVaultArea: true, ownedAccessItemIds: [], remoteAccessItemIds: ['remote-vault'] });
    expect(a).toEqual({ available: true, source: 'city' });
  });

  it('opens via remote-access item when not in a city', () => {
    const a = resolveVaultAccess({ inVaultArea: false, ownedAccessItemIds: ['remote-vault'], remoteAccessItemIds: ['remote-vault'] });
    expect(a).toEqual({ available: true, source: 'item' });
  });

  it('city precedence over item', () => {
    const a = resolveVaultAccess({ inVaultArea: true, ownedAccessItemIds: ['remote-vault'], remoteAccessItemIds: ['remote-vault'] });
    expect(a.source).toBe('city');
  });
});

describe('slot grid selector', () => {
  it('materialises empty trailing slots up to capacity', () => {
    const grid = buildSlotGrid([{ itemId: 'potion', quantity: 20 }], catalog, 6);
    expect(grid).toHaveLength(6);
    expect(grid[0]!.item?.id).toBe('potion');
    expect(grid[1]!.item).toBeNull(); // empty padding
  });

  it('marks non-matching slots hidden under a filter but keeps header totals', () => {
    const grid = buildSlotGrid([{ itemId: 'potion', quantity: 20 }], catalog, 6);
    const view = applyFilterToGrid(grid, { search: '', category: 'material', rarity: undefined, usableOnly: false, tradableOnly: false, favoriteOnly: false });
    expect(view.total).toBe(6);
    expect(view.usedCapacity).toBe(1);
    expect(view.slots[0]!.visible).toBe(false);
    expect(view.occupied).toBe(0);
  });

  it('one-shot selector produces a coherent view', () => {
    const view = selectContainerView([{ itemId: 'wood', quantity: 14 }], catalog, 8, { search: '', category: 'all', rarity: undefined, usableOnly: false, tradableOnly: false, favoriteOnly: false });
    expect(view.occupied).toBe(1);
    expect(view.slots[0]!.item?.id).toBe('wood');
  });
});
