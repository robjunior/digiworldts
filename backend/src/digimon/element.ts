import type { Attribute, BaseStats, Element, ResistanceMap, ResistanceMult, Stage } from './types.js';

export const ATTRIBUTE_TO_ELEMENT: Record<Attribute, Element> = {
  Data: 'water',
  Vaccine: 'plant',
  Virus: 'fire',
  Free: 'electricity',
  Variable: 'wind',
  Unknown: 'null',
  NoData: 'null',
};

export function attributeToElement(attribute: Attribute): Element {
  return ATTRIBUTE_TO_ELEMENT[attribute];
}

const WEAK: Record<Element, Element | undefined> = {
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

const RESIST: Record<Element, Element | undefined> = {
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

export type AffinityKind = 'weak' | 'resist' | null;

export function affinity(attackerEl: Element, defenderEl: Element): AffinityKind {
  if (WEAK[attackerEl] === defenderEl) return 'weak';
  if (RESIST[attackerEl] === defenderEl) return 'resist';
  return null;
}

export const AFFINITY_MULT: Record<Exclude<AffinityKind, null>, number> = {
  weak: 1.5,
  resist: 0.5,
};

const ATTR_STRONG: Record<Attribute, Attribute | undefined> = {
  Vaccine: 'Virus',
  Virus: 'Data',
  Data: 'Vaccine',
  Free: undefined,
  Variable: undefined,
  Unknown: undefined,
  NoData: undefined,
};

export const ATTRS_TRIANGLE_ELIGIBLE: ReadonlySet<Attribute> = new Set<Attribute>(['Vaccine', 'Virus', 'Data']);

export type AttrAffinityKind = 'advantage' | 'disadvantage' | null;

export function attrAffinity(attackerAttr: Attribute, defenderAttr: Attribute): AttrAffinityKind {
  if (ATTR_STRONG[attackerAttr] === defenderAttr) return 'advantage';
  if (ATTR_STRONG[defenderAttr] === attackerAttr) return 'disadvantage';
  return null;
}

export const ATTR_MULT: Record<Exclude<AttrAffinityKind, null>, number> = {
  advantage: 2.0,
  disadvantage: 0.5,
};

export function resolveResistance(
  attackerEl: Element,
  defenderEl: Element,
  defenderResistances: ResistanceMap | undefined,
): ResistanceMult {
  const override = defenderResistances?.[attackerEl];
  if (override !== undefined) return override;
  const kind = affinity(attackerEl, defenderEl);
  if (kind === 'weak') return 1.5;
  if (kind === 'resist') return 0.5;
  return 1;
}

export const STAGE_MULTIPLIER: Record<Stage, number> = {
  Baby: 0.4,
  'In-Training': 0.6,
  Rookie: 1.0,
  Champion: 1.5,
  Ultimate: 2.2,
  Mega: 3.0,
};

export const ROOKIE_BASELINE: BaseStats = {
  hp: 500,
  en: 30,
  atk: 100,
  def: 80,
  int: 90,
  spd: 100,
};

export function defaultStatsForStage(stage: Stage): BaseStats {
  const m = STAGE_MULTIPLIER[stage];
  return {
    hp: Math.round(ROOKIE_BASELINE.hp * m),
    en: Math.min(41, Math.round(ROOKIE_BASELINE.en * m)),
    atk: Math.round(ROOKIE_BASELINE.atk * m),
    def: Math.round(ROOKIE_BASELINE.def * m),
    int: Math.round(ROOKIE_BASELINE.int * m),
    spd: Math.round(ROOKIE_BASELINE.spd * m),
  };
}

export const MAX_LEVEL = 99;

export function scaleForLevel(base: number, level: number): number {
  const l = Math.min(MAX_LEVEL, Math.max(1, level));
  const factor = 1 + 0.06 * (l - 1);
  return Math.floor(base * factor);
}

export function scaleStatsForLevel(base: BaseStats, level: number, bonus: BaseStats): BaseStats {
  return {
    hp: scaleForLevel(base.hp, level) + bonus.hp,
    en: Math.min(41, scaleForLevel(base.en, level) + bonus.en),
    atk: scaleForLevel(base.atk, level) + bonus.atk,
    def: scaleForLevel(base.def, level) + bonus.def,
    int: scaleForLevel(base.int, level) + bonus.int,
    spd: scaleForLevel(base.spd, level) + bonus.spd,
  };
}
