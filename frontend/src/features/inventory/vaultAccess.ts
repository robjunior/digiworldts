/**
 * Pure vault-access permission resolver (brief sections 5 & 6).
 *
 * The Vault UI must NEVER decide whether it is available. That decision lives
 * here, derived from game state (current area, owned access items). The UI
 * only consumes the resulting `VaultAccess` (`available` + `source`).
 *
 * New access sources (npc/building/quest/event/premium_item) are added by
 * extending `VaultAccessSource` + this resolver — the component is untouched.
 */

import type { VaultAccess, VaultAccessSource } from './types';

export interface VaultAccessInput {
  /** Area the player currently stands in grants vault access (e.g. a city). */
  inVaultArea: boolean;
  /** Item ids the player owns that grant remote vault access. */
  ownedAccessItemIds: ReadonlyArray<string>;
  /** Item ids that grant remote vault access (premium or otherwise). */
  remoteAccessItemIds: ReadonlyArray<string>;
}

/**
 * Resolve vault availability. Precedence: city > item. Returns the winning
 * source so the UI can show a reason ("Available via City") without knowing
 * the rule. When neither condition holds, `available: false, source: null`.
 */
export function resolveVaultAccess(input: VaultAccessInput): VaultAccess {
  if (input.inVaultArea) {
    return { available: true, source: 'city' satisfies VaultAccessSource };
  }
  const hasItem = input.ownedAccessItemIds.some((id) => input.remoteAccessItemIds.includes(id));
  if (hasItem) {
    return { available: true, source: 'item' satisfies VaultAccessSource };
  }
  return { available: false, source: null };
}

/** Human-readable reason for the current access state (UI label helper). */
export function vaultAccessLabel(access: VaultAccess): string {
  switch (access.source) {
    case 'city':
      return 'Available in town';
    case 'item':
      return 'Remote access item';
    case 'npc':
      return 'Granted by NPC';
    case 'building':
      return 'Building access';
    case 'quest':
      return 'Quest reward';
    case 'event':
      return 'Event access';
    case 'premium_item':
      return 'Premium item';
    case null:
    default:
      return 'Vault unavailable';
  }
}
