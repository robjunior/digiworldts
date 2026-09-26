/**
 * Pure capacity derivation.
 *
 * KEY INVARIANT (brief section 1): `totalSlots` is ALWAYS derived from the
 * current game state (base + party stages + expansions). It is never stored
 * as an independent truth, so it recalculates automatically when a Digimon
 * joins/leaves the party or changes stage.
 *
 * No React, no Phaser, no I/O. Every function here is a pure, deterministic
 * derivation that can be unit-tested directly.
 */

import type {
  InventoryCapacityBreakdown,
  InventoryGameState,
  VaultCapacityBreakdown,
  VaultGameState,
} from './types';
import { inventorySlotsForStage, INVENTORY_BASE_SLOTS, VAULT_BASE_SLOTS } from './capacityConfig';

/**
 * Derive the full inventory capacity breakdown from game state.
 * `party` slots are summed from each member's stage via the configurable table.
 */
export function deriveInventoryCapacity(state: InventoryGameState): InventoryCapacityBreakdown {
  const partyByMember = state.party.map((m) => ({
    sourceId: m.id,
    slots: inventorySlotsForStage(m.stage),
  }));
  const party = partyByMember.reduce((sum, p) => sum + p.slots, 0);
  const expansion = state.expansions.reduce((sum, e) => sum + e.slots, 0);

  return {
    base: state.baseSlots,
    party,
    partyByMember,
    expansion,
    expansionById: state.expansions.map((e) => ({ sourceId: e.id, slots: e.slots })),
    total: state.baseSlots + party + expansion,
  };
}

/**
 * Convenience: just the total. Still derived, never stored.
 */
export function inventoryTotalSlots(state: InventoryGameState): number {
  return deriveInventoryCapacity(state).total;
}

/**
 * Derive vault capacity. Vault expansions are a SEPARATE source list from
 * inventory expansions (brief section 7) — they must not leak into the
 * inventory total and vice versa.
 */
export function deriveVaultCapacity(state: VaultGameState): VaultCapacityBreakdown {
  const expansion = state.expansions.reduce((sum, e) => sum + e.slots, 0);
  return {
    base: state.baseSlots,
    expansion,
    expansionById: state.expansions.map((e) => ({ sourceId: e.id, slots: e.slots })),
    total: state.baseSlots + expansion,
  };
}

export function vaultTotalSlots(state: VaultGameState): number {
  return deriveVaultCapacity(state).total;
}

/**
 * Expose the configured base constants so non-state callers (e.g. a config
 * panel or a test fixture) can read the defaults without reconstructing state.
 */
export const INVENTORY_DEFAULTS = {
  base: INVENTORY_BASE_SLOTS,
  vaultBase: VAULT_BASE_SLOTS,
};
