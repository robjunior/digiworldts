/**
 * Element and stat helpers.
 *
 *   attributeToElement — map Digimon attribute (Data/Vaccine/Virus/Free)
 *     onto the base/ design's 4-element combat palette. Choice rationale:
 *       Data    → water     (cool / analytical)
 *       Vaccine → nature    (healing / protection)
 *       Virus   → fire      (aggressive / corrupting)
 *       Free    → electric  (unpredictable)
 *       Unknown → neutral   (fallback)
 *
 *   affinity — mirrors base/combat.html: WEAK cycle
 *     fire  → nature → water → fire   and   electric → water
 *
 *   stageMultiplier — scales Rookie baseline (1.0) up to Mega (3.0).
 *
 *   scaleForLevel — level 1 = 100%, +6% additive per level, capped at level 99.
 *     Rounded down. Same formula in engine.ts so stats stay predictable.
 */
import type { Attribute, BaseStats, Element, Stage } from './types.js';

export const ATTRIBUTE_TO_ELEMENT: Record<Attribute, Element> = {
  Data: 'water',
  Vaccine: 'nature',
  Virus: 'fire',
  Free: 'electric',
  Unknown: 'neutral',
};

export function attributeToElement(attribute: Attribute): Element {
  return ATTRIBUTE_TO_ELEMENT[attribute];
}

const WEAK: Record<Element, Element | undefined> = {
  fire: 'nature',
  nature: 'water',
  water: 'fire',
  electric: 'water',
  neutral: undefined,
};

const RESIST: Record<Element, Element | undefined> = {
  fire: 'water',
  water: 'nature',
  nature: 'fire',
  electric: 'nature',
  neutral: undefined,
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
