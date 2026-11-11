/**
 * Element archetypes — the canonical mapping of an element's design archetypes
 * to the `slot_role` grid.
 *
 * Source of truth is the seed pool files (`skills/seeds/<element>.ts`): each
 * file is organised into `---- Archetype ----` sections whose skills carry the
 * `slot_role`s this map enumerates. A signature skill represents one of these
 * archetypes when its `slot_role` is in that element's allowed set — that is
 * the rule the signature-selection endpoint enforces ("a signature must
 * represent one of the archetypes within that element's archetype").
 *
 * `null` has no archetype sections in its pool (nullelem.ts), but null
 * signature seeds span the whole grid, so it is pinned to a single identity
 * archetype covering every role rather than hard-blocked.
 */
import type { Element } from '@digiworld/shared/digimon';

export type SlotRole =
  | 'primary_attack'
  | 'sustain_dot'
  | 'control'
  | 'buff_support'
  | 'utility'
  | 'identity_finisher';

export const SLOT_ROLES: readonly SlotRole[] = [
  'primary_attack',
  'sustain_dot',
  'control',
  'buff_support',
  'utility',
  'identity_finisher',
];

export type ElementArchetype = {
  readonly name: string;
  readonly slotRoles: readonly SlotRole[];
};

export const ELEMENT_ARCHETYPES: Record<Element, readonly ElementArchetype[]> = {
  fire: [
    { name: 'Berserker', slotRoles: ['buff_support', 'identity_finisher', 'primary_attack'] },
    { name: 'Burst', slotRoles: ['control', 'primary_attack', 'utility'] },
    { name: 'DoT', slotRoles: ['control', 'sustain_dot', 'utility'] },
  ],
  water: [
    { name: 'Controller', slotRoles: ['control', 'identity_finisher', 'utility'] },
    { name: 'Displacer', slotRoles: ['control', 'primary_attack', 'utility'] },
    { name: 'Sustain', slotRoles: ['buff_support', 'primary_attack', 'sustain_dot'] },
  ],
  plant: [
    { name: 'DoT', slotRoles: ['identity_finisher', 'primary_attack', 'sustain_dot', 'utility'] },
    { name: 'Healer', slotRoles: ['buff_support', 'identity_finisher', 'utility'] },
    { name: 'Zone Control', slotRoles: ['control', 'primary_attack', 'utility'] },
  ],
  ice: [
    { name: 'Controller', slotRoles: ['control', 'identity_finisher', 'utility'] },
    { name: 'Lockdown', slotRoles: ['buff_support', 'control', 'primary_attack'] },
    { name: 'Debuffer', slotRoles: ['primary_attack', 'sustain_dot', 'utility'] },
  ],
  electricity: [
    { name: 'Combo', slotRoles: ['buff_support', 'identity_finisher', 'primary_attack', 'utility'] },
    { name: 'Chain', slotRoles: SLOT_ROLES },
    { name: 'Stun', slotRoles: ['buff_support', 'control', 'primary_attack', 'sustain_dot', 'utility'] },
  ],
  earth: [
    { name: 'Tank', slotRoles: ['buff_support', 'identity_finisher', 'primary_attack'] },
    { name: 'Guardian', slotRoles: ['primary_attack', 'sustain_dot', 'utility'] },
    { name: 'Terrain Control', slotRoles: ['control', 'identity_finisher', 'sustain_dot', 'utility'] },
  ],
  steel: [
    { name: 'Tank', slotRoles: ['buff_support', 'identity_finisher', 'primary_attack'] },
    { name: 'Counter', slotRoles: ['primary_attack', 'sustain_dot', 'utility'] },
    { name: 'Fortress', slotRoles: ['buff_support', 'control', 'identity_finisher'] },
  ],
  wind: [
    { name: 'Skirmisher', slotRoles: ['control', 'primary_attack', 'sustain_dot'] },
    { name: 'Speedster', slotRoles: ['buff_support', 'identity_finisher', 'primary_attack'] },
    { name: 'Evasion', slotRoles: ['buff_support', 'control', 'utility'] },
  ],
  light: [
    { name: 'Healer', slotRoles: ['buff_support', 'sustain_dot', 'utility'] },
    { name: 'Buffer', slotRoles: ['buff_support', 'control', 'primary_attack'] },
    { name: 'Purifier', slotRoles: ['identity_finisher', 'primary_attack', 'utility'] },
  ],
  dark: [
    { name: 'Assassin', slotRoles: ['buff_support', 'control', 'identity_finisher', 'primary_attack', 'utility'] },
    { name: 'Debuffer', slotRoles: ['control', 'primary_attack', 'sustain_dot', 'utility'] },
    { name: 'Drain', slotRoles: ['buff_support', 'identity_finisher', 'primary_attack', 'sustain_dot', 'utility'] },
  ],
  null: [{ name: 'Identity', slotRoles: SLOT_ROLES }],
};

/** Roles a signature of this element may legally carry (union across archetypes). */
export function elementAllowedSlotRoles(element: Element): ReadonlySet<SlotRole> {
  const set = new Set<SlotRole>();
  for (const arch of ELEMENT_ARCHETYPES[element] ?? []) {
    for (const role of arch.slotRoles) set.add(role);
  }
  return set;
}

/** First archetype (in seed order) that covers the role, or null when none does. */
export function slotRoleToArchetype(element: Element, slotRole: string | null): ElementArchetype | null {
  if (slotRole === null) return null;
  for (const arch of ELEMENT_ARCHETYPES[element] ?? []) {
    if (arch.slotRoles.includes(slotRole as SlotRole)) return arch;
  }
  return null;
}

/** True when the role is a legal archetype role for the element. */
export function signatureRepresentsElementArchetype(element: Element, slotRole: string | null): boolean {
  return slotRoleToArchetype(element, slotRole) !== null;
}