/**
 * Game-state store for the container system (brief section 13 — SERVER/GAME STATE).
 *
 * This store owns the authoritative, persisted-shaped data: inventory & vault
 * slot contents, expansions, party, base slots. It is deliberately SEPARATE
 * from the UI state (active filter, search, hover) which lives in component
 * local state / the `useItemContainer` hook.
 *
 * The store exposes plain reducers that mutate only RAW state. Capacity and the
 * slot grid are derived elsewhere (capacity.ts / selectors.ts) from this state,
 * so there is no stored `totalSlots` to drift out of sync.
 *
 * Built on Zustand because the rest of the frontend already uses it for
 * cross-cutting state (wsStore). This keeps the spike consistent with the repo.
 */

import { create } from 'zustand';
import type { Stage } from '@digiworld/shared';

import type { Item, ItemStack, InventoryGameState, VaultGameState } from './types';
import { stackItems, type StackInput } from './stacking';
import { INVENTORY_BASE_SLOTS, VAULT_BASE_SLOTS } from './capacityConfig';

export type ItemCatalogMap = ReadonlyMap<string, Item>;

export interface ContainerStoreState {
  inventory: InventoryGameState;
  vault: VaultGameState;
  catalog: ItemCatalogMap;

  // --- Inventory reducers ---
  addInventoryItems: (inputs: ReadonlyArray<StackInput>) => void;
  setInventoryExpansions: (expansions: ReadonlyArray<{ id: string; slots: number }>) => void;
  setParty: (party: ReadonlyArray<{ id: string; stage: Stage }>) => void;
  setInventoryBaseSlots: (n: number) => void;

  // --- Vault reducers ---
  addVaultItems: (inputs: ReadonlyArray<StackInput>) => void;
  setVaultExpansions: (expansions: ReadonlyArray<{ id: string; slots: number }>) => void;
  setVaultBaseSlots: (n: number) => void;

  // --- Misc ---
  setCatalog: (catalog: ReadonlyArray<Item>) => void;
}

const EMPTY_INVENTORY: InventoryGameState = {
  slots: [],
  expansions: [],
  party: [],
  baseSlots: INVENTORY_BASE_SLOTS,
};
const EMPTY_VAULT: VaultGameState = {
  slots: [],
  expansions: [],
  baseSlots: VAULT_BASE_SLOTS,
};

function toInputs(stacks: ReadonlyArray<ItemStack>): StackInput[] {
  return stacks.map((s) => ({ itemId: s.itemId, quantity: s.quantity }));
}

function makeCatalogMap(items: ReadonlyArray<Item>): ItemCatalogMap {
  const m = new Map<string, Item>();
  for (const it of items) m.set(it.id, it);
  return m;
}

export function createContainerStore(
  initialCatalog: ReadonlyArray<Item> = [],
  initialInventory: InventoryGameState = EMPTY_INVENTORY,
  initialVault: VaultGameState = EMPTY_VAULT,
) {
  return create<ContainerStoreState>((set) => ({
    inventory: initialInventory,
    vault: initialVault,
    catalog: makeCatalogMap(initialCatalog),

    addInventoryItems: (inputs) =>
      set((s) => {
        const merged = stackItems(s.catalog, [...toInputs(s.inventory.slots), ...inputs]);
        return { inventory: { ...s.inventory, slots: merged } };
      }),

    setInventoryExpansions: (expansions) =>
      set((s) => ({ inventory: { ...s.inventory, expansions } })),

    setParty: (party) => set((s) => ({ inventory: { ...s.inventory, party } })),

    setInventoryBaseSlots: (n) =>
      set((s) => ({ inventory: { ...s.inventory, baseSlots: n } })),

    addVaultItems: (inputs) =>
      set((s) => {
        const merged = stackItems(s.catalog, [...toInputs(s.vault.slots), ...inputs]);
        return { vault: { ...s.vault, slots: merged } };
      }),

    setVaultExpansions: (expansions) =>
      set((s) => ({ vault: { ...s.vault, expansions } })),

    setVaultBaseSlots: (n) => set((s) => ({ vault: { ...s.vault, baseSlots: n } })),

    setCatalog: (catalog) => set({ catalog: makeCatalogMap(catalog) }),
  }));
}
