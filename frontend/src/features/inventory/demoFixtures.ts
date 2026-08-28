/**
 * Demo fixtures for the spike: a small item catalog + initial game state that
 * prove the acceptance criteria (6 base slots, party bonuses, expansions,
 * stacking, a much larger vault, vault access gating).
 *
 * Pure data only — used by the spike route (runtime) and by the vitest suite
 * (so the tests assert against the SAME realistic shape the UI shows).
 */

import type { Stage } from '@digiworld/shared';

import type { Item } from './types';
import { INVENTORY_BASE_SLOTS, VAULT_BASE_SLOTS } from './capacityConfig';

/** Catalog: icons are emoji so the spike renders without asset pipeline. */
export const DEMO_CATALOG: ReadonlyArray<Item> = [
  { id: 'potion', name: 'Potion', category: 'consumable', maxStack: 20, icon: '🧪', rarity: 'common', usable: true, tradable: true, description: 'Restores HP' },
  { id: 'wood', name: 'Wood', category: 'material', maxStack: 99, icon: '🪵', rarity: 'common', tradable: true, description: 'Crafting material' },
  { id: 'sword', name: 'Iron Sword', category: 'equipment', maxStack: 1, icon: '⚔️', rarity: 'uncommon', tradable: true, description: 'A basic blade' },
  { id: 'stone', name: 'Stone', category: 'material', maxStack: 99, icon: '🪨', rarity: 'common', tradable: true, description: 'Crafting material' },
  { id: 'quest_orb', name: 'Quest Orb', category: 'quest', maxStack: 1, icon: '🔮', rarity: 'rare', description: 'Turn in for the quest' },
  { id: 'key', name: 'Vault Key', category: 'key', maxStack: 1, icon: '🗝️', rarity: 'rare', description: 'Opens restricted doors' },
  { id: 'elixir', name: 'Elixir', category: 'consumable', maxStack: 10, icon: '⚗️', rarity: 'epic', usable: true, tradable: true, description: 'Restores everything' },
];

/**
 * Party: a Rookie (+1), a Champion (+2) and an Ultimate (+3) => +6 party slots.
 * Plus the 6 base => 12 total inventory slots at start.
 */
export const DEMO_PARTY: ReadonlyArray<{ id: string; stage: Stage }> = [
  { id: 'mon-1', stage: 'Rookie' },
  { id: 'mon-2', stage: 'Champion' },
  { id: 'mon-3', stage: 'Ultimate' },
];

/** Inventory expansions (an extra backpack). Independent of vault expansions. */
export const DEMO_INVENTORY_EXPANSIONS: ReadonlyArray<{ id: string; slots: number }> = [
  { id: 'backpack', slots: 3 },
];

/** Vault expansions (premium tiers). Do NOT affect the inventory. */
export const DEMO_VAULT_EXPANSIONS: ReadonlyArray<{ id: string; slots: number }> = [
  { id: 'premium-1', slots: 50 },
  { id: 'premium-2', slots: 100 },
  { id: 'premium-3', slots: 250 },
];

/** Dense starting inventory: demonstrates multi-slot stacking (Potion x47 -> 20+20+7). */
export const DEMO_INVENTORY_SLOTS: ReadonlyArray<{ itemId: string; quantity: number }> = [
  { itemId: 'potion', quantity: 20 },
  { itemId: 'potion', quantity: 20 },
  { itemId: 'potion', quantity: 7 }, // => three potion slots (20/20/7)
  { itemId: 'wood', quantity: 14 },
  { itemId: 'sword', quantity: 1 },
];

/** Dense starting vault: fewer items but huge capacity ceiling. */
export const DEMO_VAULT_SLOTS: ReadonlyArray<{ itemId: string; quantity: number }> = [
  { itemId: 'wood', quantity: 30 },
  { itemId: 'wood', quantity: 30 },
  { itemId: 'potion', quantity: 12 },
  { itemId: 'sword', quantity: 1 },
  { itemId: 'stone', quantity: 40 },
  { itemId: 'quest_orb', quantity: 1 },
];

export const DEMO_BASE = {
  inventoryBase: INVENTORY_BASE_SLOTS,
  vaultBase: VAULT_BASE_SLOTS,
};
