/**
 * UI-independent domain types for the slot-based item container system
 * (Inventory + Vault spike).
 *
 * Nothing in this file imports React, Phaser, or any UI/engine concern.
 * These types are the contract between the backend/game-state layer and the
 * React UI, so they can be reused from a vitest suite, a future Phaser bridge,
 * or a server-side resolver without pulling in rendering code.
 *
 * The model intentionally mirrors the suggested model in the spike brief
 * (Item / ItemStack / capacity sources / vault access) while keeping the
 * capacity a DERIVED value rather than a stored truth.
 */

import type { Rarity } from '@digiworld/shared';
import type { Stage } from '@digiworld/shared';

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemCategory =
  | 'consumable'
  | 'equipment'
  | 'material'
  | 'quest'
  | 'key'
  | 'other';

/**
 * A catalog entry describing WHAT an item is. Stacks are identified by `id`,
 * so two stacks with the same `id` are mergeable.
 */
export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  /** Max quantity that fits in a single slot. Stacking splits across slots beyond this. */
  maxStack: number;
  icon: string;
  rarity?: Rarity;
  description?: string;
  /** Optional flags for future filters (tradable/usable/favorite). Off by default. */
  tradable?: boolean;
  usable?: boolean;
}

// ---------------------------------------------------------------------------
// Raw stored state (server / game state)
// ---------------------------------------------------------------------------

/**
 * A stack of items living in a slot. `quantity` is always >= 1.
 * Slots are stored as a dense array; `null` entries are empty slots.
 * The full slot grid (including empty trailing slots for capacity) is
 * materialised by a pure selector (see selectors.ts), NOT stored here.
 */
export interface ItemStack {
  itemId: string;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Party contribution to inventory capacity
// ---------------------------------------------------------------------------

/**
 * The game state exposes the player's party as Digimon with a stage.
 * Capacity derived from the party reads `stage` off each member — the UI
 * never sees this mapping. The per-stage slot table is configurable
 * (capacityConfig.ts) and not hard-coded into any component.
 */
export interface PartyMember {
  id: string;
  stage: Stage;
}

// ---------------------------------------------------------------------------
// Capacity sources (the "expansion" mechanic)
// ---------------------------------------------------------------------------

export type CapacitySourceType = 'base' | 'party' | 'expansion';

/**
 * A single source of capacity. The component renders slots; it does NOT need
 * to know which of these produced them. Adding a new source kind (e.g. a
 * guild bonus) only requires extending this union + the reducer, never the UI.
 */
export type CapacitySource =
  | { type: 'base'; slots: number }
  | { type: 'party'; slots: number; sourceId: string }
  | { type: 'expansion'; slots: number; sourceId: string };

export interface InventoryCapacityBreakdown {
  base: number;
  party: number;
  partyByMember: ReadonlyArray<{ sourceId: string; slots: number }>;
  expansion: number;
  expansionById: ReadonlyArray<{ sourceId: string; slots: number }>;
  total: number;
}

export interface VaultCapacityBreakdown {
  base: number;
  expansion: number;
  expansionById: ReadonlyArray<{ sourceId: string; slots: number }>;
  total: number;
}

// ---------------------------------------------------------------------------
// Vault access
// ---------------------------------------------------------------------------

/**
 * Sources that may grant vault access. Kept as a closed union so future
 * sources (npc/building/quest/event/premium_item) extend it centrally.
 * The Vault UI consumes ONLY `available` + `source`; it never computes access.
 */
export type VaultAccessSource =
  | 'city'
  | 'item'
  | 'npc'
  | 'building'
  | 'quest'
  | 'event'
  | 'premium_item'
  | null;

export interface VaultAccess {
  available: boolean;
  source: VaultAccessSource;
}

// ---------------------------------------------------------------------------
// Aggregate game state for the container system (server / game state)
// ---------------------------------------------------------------------------

export interface InventoryGameState {
  /** Dense, stable slot contents. Length <= capacity only after compaction. */
  slots: ReadonlyArray<ItemStack>;
  expansions: ReadonlyArray<{ id: string; slots: number }>;
  party: ReadonlyArray<PartyMember>;
  baseSlots: number;
}

export interface VaultGameState {
  slots: ReadonlyArray<ItemStack>;
  expansions: ReadonlyArray<{ id: string; slots: number }>;
  baseSlots: number;
}

// ---------------------------------------------------------------------------
// Filters (UI-independent, reusable across Inventory and Vault)
// ---------------------------------------------------------------------------

export type ItemFilterCategory = ItemCategory | 'all';

export interface ItemFilterState {
  search: string;
  category: ItemFilterCategory;
  /** Future-proof optional facets; the predicate engine reads them when present. */
  rarity: Rarity | undefined;
  usableOnly: boolean;
  tradableOnly: boolean;
  favoriteOnly: boolean;
}

/**
 * A reusable, named filter preset. `predicate` is a pure function so filters
 * can be composed/tested in isolation from components (section 10 of brief).
 */
export interface ItemFilter {
  id: string;
  label: string;
  predicate: (item: Item) => boolean;
}

// ---------------------------------------------------------------------------
// Materialised view consumed by the grid (derived, never stored)
// ---------------------------------------------------------------------------

export interface SlotView {
  index: number;
  item: Item | null;
  quantity: number;
  /** True when this slot is the tail of a multi-slot stack (UI hint only). */
  isStackTail: boolean;
  /** False when an active filter excludes this slot's item. Empty slots are always visible. */
  visible: boolean;
}

export interface FilteredContainerView {
  slots: ReadonlyArray<SlotView>;
  /** Count of occupied (non-empty) slots that pass the active filter. */
  occupied: number;
  /** Capacity-derived total slot count (pre-filter) — drives the "X / Y" header. */
  total: number;
  /** Occupied slots in the full grid, regardless of filter. */
  usedCapacity: number;
}
