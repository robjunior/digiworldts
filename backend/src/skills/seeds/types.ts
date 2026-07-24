import type { Element, Stage } from '@digiworld/shared/digimon';
import type { Action, SkillInput } from '../dsl.js';

export type SlotRole =
  | 'primary_attack'
  | 'sustain_dot'
  | 'control'
  | 'buff_support'
  | 'utility'
  | 'identity_finisher';

export type SkillSeed = SkillInput & {
  id: string;
  name_pt: string;
  description_pt: string;
  stage: Stage;
  slot_role: SlotRole;
  upgrade_of?: string;
  tier_2?: boolean;
};

export type SkillFactoryParams = {
  idSuffix: string;
  name: string;
  name_pt: string;
  description: string;
  description_pt: string;
  stage: Stage;
  slot_role: SlotRole;
  energyCost: number;
  actions: Action[];
  upgrade_of?: string;
  tier_2?: boolean;
  cooldown?: number;
};

export function makeSkillFactory(element: Element, elementPrefix: string): (p: SkillFactoryParams) => SkillSeed {
  return (p) => ({
    id: `sk-${elementPrefix}-${p.idSuffix}`,
    name: p.name,
    name_pt: p.name_pt,
    description: p.description,
    description_pt: p.description_pt,
    element,
    energyCost: p.energyCost,
    actions: p.actions,
    stage: p.stage,
    slot_role: p.slot_role,
    ...(p.upgrade_of !== undefined && { upgrade_of: p.upgrade_of }),
    ...(p.tier_2 !== undefined && { tier_2: p.tier_2 }),
    ...(p.cooldown !== undefined && { cooldown: p.cooldown }),
  });
}
