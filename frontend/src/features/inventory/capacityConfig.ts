/**
 * Configuration for how inventory/vault capacity is derived.
 *
 * This is the SINGLE place where the "each evolutionary stage gives N slots"
 * rule lives. Components and selectors read these numbers; they never
 * hard-code them. To change the economy (e.g. Mega gives +6 instead of +4),
 * edit this file only.
 */

import type { Stage } from '@digiworld/shared';

/** Slots contributed to the player's inventory per Digimon stage. */
export const INVENTORY_SLOTS_PER_STAGE: Readonly<Record<Stage, number>> = {
  Baby: 0,
  'In-Training': 0,
  Rookie: 1,
  Champion: 2,
  Ultimate: 3,
  Mega: 4,
};

/** The inventory always has this many slots before any bonus. */
export const INVENTORY_BASE_SLOTS = 6;

/** Vault base capacity — intentionally much larger than the inventory. */
export const VAULT_BASE_SLOTS = 100;

/**
 * Per-stage lookup with a safe fallback for unknown stages (defensive:
 * `noUncheckedIndexedAccess` makes a direct index return `number | undefined`).
 */
export function inventorySlotsForStage(stage: Stage): number {
  return INVENTORY_SLOTS_PER_STAGE[stage] ?? 0;
}
