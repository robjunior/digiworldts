export const STAGES = ['Baby', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega'] as const;
export type Stage = (typeof STAGES)[number];

export const ATTRIBUTES = ['Data', 'Vaccine', 'Virus', 'Free', 'Variable', 'Unknown', 'NoData'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];

export const ELEMENTS = [
  'fire', 'water', 'plant', 'ice', 'electricity',
  'earth', 'steel', 'wind', 'light', 'dark', 'null',
] as const;
export type Element = (typeof ELEMENTS)[number];

export type ResistanceMult = 0 | 0.5 | 1 | 1.5 | 2;
export type ResistanceMap = Partial<Record<Element, ResistanceMult>>;

export const AILMENTS = [
  'burn', 'poison', 'weaken', 'freeze', 'stun', 'sleep',
  'blind', 'silence', 'root', 'petrify', 'curse', 'corruption', 'confusion', 'charm',
] as const;
export type Ailment = (typeof AILMENTS)[number];

export const BUFF_KINDS = [
  'shield_absorb',
  'damage_reduction',
  'invulnerable',
  'accuracy_up', 'accuracy_down',
  'evasion_up', 'evasion_down',
  'crit_up',
  'atk_up', 'def_up', 'spd_up', 'int_up',
  'atk_down', 'def_down', 'spd_down', 'int_down',
] as const;
export type BuffKind = (typeof BUFF_KINDS)[number];

export type BaseStats = {
  hp: number;
  en: number;
  atk: number;
  def: number;
  int: number;
  spd: number;
};

export type SkillEffect = {
  kind: Ailment;
  chance: number;
  turns: number;
};

export type Skill = {
  id: string;
  name: string;
  element: Element;
  energyCost: number;
  power: number;
  effect?: SkillEffect;
  description?: string;
  /** DSL actions_json parsed. Loose at shared boundary; backend casts to Action[] after Zod. Non-empty = DSL path. */
  actions?: unknown[];
};

export type Assets = {
  portrait: string;
  dot: string;
};

export type EvolveEdge = {
  targetId: string;
  requiredLevel?: number;
  requiredMood?: number;
  requiredAttribute?: Attribute;
};

export type TemplateDigimon = {
  id: string;
  name: string;
  stage: Stage;
  attribute: Attribute;
  element: Element;
  baseStats: BaseStats;
  skillPool: Skill[];
  assets: Assets;
  sourceUrl?: string;
  wikimonSlug?: string;
  evolvesInto?: EvolveEdge[];
  resistances?: ResistanceMap;
  type?: string;
  signatureSkillId?: string;
};

export type RosterDigimon = {
  id: string;
  userId: string;
  catalogId: string;
  nickname: string;
  level: number;
  xp: number;
  statBonus: BaseStats;
  status: 'resting' | 'training' | 'party';
  slotIndex: number | null;
  stagePools?: StagePools;
};

export type Catalog = {
  version: string;
  updatedAt: number;
  digimons: TemplateDigimon[];
};

export const MAX_ENERGY = 41;
export const ATB_THRESHOLD = 100;
export const PARTY_SIZE = 3;
export const SKILLS_PER_DIGIMON = 4;

export const EQUIPPED_SLOTS_PER_STAGE: Record<Stage, number> = {
  Baby: 4,
  'In-Training': 4,
  Rookie: 4,
  Champion: 6,
  Ultimate: 8,
  Mega: 10,
};

export const EVOLUTION_LEVELS: Record<Stage, number> = {
  Baby: 0,
  'In-Training': 0,
  Rookie: 0,
  Champion: 20,
  Ultimate: 40,
  Mega: 60,
};

export function nextStageAfter(stage: Stage): Stage | null {
  const idx = STAGES.indexOf(stage);
  if (idx === -1 || idx === STAGES.length - 1) return null;
  return STAGES[idx + 1] ?? null;
}

export const TRAINING_STATS = ['hp', 'en', 'atk', 'def', 'int', 'spd'] as const;
export type TrainingStat = (typeof TRAINING_STATS)[number];

export const STAGE_REWARD_MULT: Record<Stage, number> = {
  Baby: 0.5,
  'In-Training': 0.7,
  Rookie: 1.0,
  Champion: 1.5,
  Ultimate: 2.0,
  Mega: 3.0,
};

export const GROWTH_RATES = ['fast', 'mediumFast', 'mediumSlow', 'slow'] as const;
export type GrowthRate = (typeof GROWTH_RATES)[number];

export const STAGE_GROWTH_RATE: Record<Stage, GrowthRate> = {
  Baby: 'fast',
  'In-Training': 'fast',
  Rookie: 'mediumFast',
  Champion: 'mediumSlow',
  Ultimate: 'slow',
  Mega: 'slow',
};

export const STAGE_BASE_EXP: Record<Stage, number> = {
  Baby: 30,
  'In-Training': 45,
  Rookie: 65,
  Champion: 120,
  Ultimate: 175,
  Mega: 220,
};

export const MOOD_MIN_FOR_STAGE: Partial<Record<Stage, number>> = {
  Champion: 40,
  Ultimate: 60,
  Mega: 80,
};

export const STAGE_COMBAT_POOL: Record<Stage, number> = {
  Baby: 700,
  'In-Training': 700,
  Rookie: 700,
  Champion: 700,
  Ultimate: 700,
  Mega: 700,
};

export const STAGE_HPEN_POOL: Record<Stage, number> = {
  Baby: 1000,
  'In-Training': 1000,
  Rookie: 1000,
  Champion: 1000,
  Ultimate: 1000,
  Mega: 1000,
};

export type StageAlloc = { combat: number; hpen: number };
export type StagePools = Partial<Record<Stage, StageAlloc>>;

export function defaultMaxedPools(currentStage: Stage): StagePools {
  const pools: StagePools = {};
  for (const s of STAGES) {
    if (s === currentStage) break;
    pools[s] = { combat: STAGE_COMBAT_POOL[s], hpen: STAGE_HPEN_POOL[s] };
  }
  return pools;
}

export function combatCapFor(stage: Stage, priorPools: StagePools): number {
  let locked = 0;
  for (const s of STAGES) {
    if (s === stage) break;
    locked += priorPools[s]?.combat ?? 0;
  }
  return locked + STAGE_COMBAT_POOL[stage];
}

export function hpenCapFor(stage: Stage, priorPools: StagePools): number {
  let locked = 0;
  for (const s of STAGES) {
    if (s === stage) break;
    locked += priorPools[s]?.hpen ?? 0;
  }
  return locked + STAGE_HPEN_POOL[stage];
}

export function combatSum(stats: BaseStats): number {
  return stats.atk + stats.def + stats.int + stats.spd;
}

export function hpenSum(stats: BaseStats): number {
  return stats.hp + stats.en;
}

export type MoodState = 'miserable' | 'sad' | 'neutral' | 'content' | 'happy';

export function moodState(mood: number): MoodState {
  if (mood >= 80) return 'happy';
  if (mood >= 60) return 'content';
  if (mood >= 40) return 'neutral';
  if (mood >= 20) return 'sad';
  return 'miserable';
}

export const ATTRIBUTE_TO_ELEMENT: Record<Attribute, Element> = {
  Data: 'water',
  Vaccine: 'plant',
  Virus: 'fire',
  Free: 'electricity',
  Variable: 'wind',
  Unknown: 'null',
  NoData: 'null',
};

export const WEAK_MAP: Record<Element, Element | undefined> = {
  fire: 'plant',
  water: 'fire',
  plant: 'water',
  ice: 'wind',
  electricity: 'water',
  earth: 'electricity',
  steel: 'ice',
  wind: 'earth',
  light: 'dark',
  dark: 'light',
  null: undefined,
};

export const RESIST_MAP: Record<Element, Element | undefined> = {
  fire: 'water',
  water: 'electricity',
  plant: 'fire',
  ice: 'fire',
  electricity: 'earth',
  earth: 'plant',
  steel: 'electricity',
  wind: 'ice',
  light: undefined,
  dark: undefined,
  null: undefined,
};

export const ATTR_STRONG: Record<Attribute, Attribute | undefined> = {
  Vaccine: 'Virus',
  Virus: 'Data',
  Data: 'Vaccine',
  Free: undefined,
  Variable: undefined,
  Unknown: undefined,
  NoData: undefined,
};

export function resolveResistance(
  attackerEl: Element,
  defenderEl: Element,
  defenderResistances: ResistanceMap | undefined,
): ResistanceMult {
  if (defenderResistances !== undefined) {
    return defenderResistances[attackerEl] ?? 1;
  }
  if (WEAK_MAP[attackerEl] === defenderEl) return 1.5;
  if (RESIST_MAP[attackerEl] === defenderEl) return 0.5;
  return 1;
}

export function attrMultiplier(attackerAttr: Attribute, defenderAttr: Attribute): 2 | 0.5 | 1 {
  if (ATTR_STRONG[attackerAttr] === defenderAttr) return 2;
  if (ATTR_STRONG[defenderAttr] === attackerAttr) return 0.5;
  return 1;
}
