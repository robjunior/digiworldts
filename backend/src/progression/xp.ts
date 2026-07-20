/**
 * Digimon progression — Pokemon Fire Red style.
 *
 * Growth-rate curves (cubic, keyed by stage via STAGE_GROWTH_RATE):
 *   fast       xp(L) = floor(4L^3 / 5)                           L100 = 800,000
 *   mediumFast xp(L) = L^3                                       L100 = 1,000,000
 *   mediumSlow xp(L) = max(0, floor(1.2L^3 - 15L^2 + 100L - 140)) L100 = 1,059,860
 *   slow       xp(L) = floor(5L^3 / 4)                           L100 = 1,250,000
 *
 * Species base XP (STAGE_BASE_EXP): Baby=30, In-Training=45, Rookie=65,
 * Champion=120, Ultimate=175, Mega=220.
 *
 * XP each participant receives per KO:
 *   floor((a * base_exp * defeatedLevel) / (7 * participants))
 *   a = 1 for wild, 1.5 for trainer.
 */
import { MAX_LEVEL } from '../digimon/element.js';
import type { BaseStats, GrowthRate, Stage, StagePools } from '../digimon/types.js';
import { combatCapFor, combatSum, defaultMaxedPools, hpenCapFor, hpenSum, STAGE_BASE_EXP, STAGE_GROWTH_RATE } from '../digimon/types.js';

const STAGE_GROWTH: Record<Stage, BaseStats> = {
  Baby: { hp: 4, en: 0, atk: 1, def: 1, int: 1, spd: 1 },
  'In-Training': { hp: 6, en: 0, atk: 2, def: 1, int: 1, spd: 1 },
  Rookie: { hp: 10, en: 0, atk: 3, def: 2, int: 2, spd: 2 },
  Champion: { hp: 16, en: 0, atk: 5, def: 3, int: 4, spd: 3 },
  Ultimate: { hp: 22, en: 0, atk: 7, def: 5, int: 6, spd: 4 },
  Mega: { hp: 30, en: 0, atk: 10, def: 7, int: 9, spd: 5 },
};

function xpAtLevelForRate(level: number, rate: GrowthRate): number {
  if (level <= 1) return 0;
  const l = Math.min(MAX_LEVEL, level);
  switch (rate) {
    case 'fast':
      return Math.floor((4 * l * l * l) / 5);
    case 'mediumFast':
      return l * l * l;
    case 'mediumSlow':
      return Math.max(0, Math.floor(1.2 * l * l * l - 15 * l * l + 100 * l - 140));
    case 'slow':
      return Math.floor((5 * l * l * l) / 4);
  }
}

export function xpToReach(level: number, stage: Stage): number {
  return xpAtLevelForRate(level, STAGE_GROWTH_RATE[stage]);
}

export function levelFromXp(xp: number, stage: Stage): number {
  if (xp <= 0) return 1;
  const rate = STAGE_GROWTH_RATE[stage];
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (xpAtLevelForRate(mid, rate) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function xpBetween(fromLevel: number, toLevel: number, stage: Stage): number {
  return Math.max(0, xpToReach(toLevel, stage) - xpToReach(fromLevel, stage));
}

export type MatchOutcome = 'win' | 'loss' | 'draw' | 'fled';

export type DefeatedFoe = {
  readonly stage: Stage;
  readonly level: number;
};

/**
 * XP each participant receives from a completed match. Zero when no KOs happened
 * (loss, draw with no kills, fled) or no eligible participants.
 */
export function xpFromDefeats(
  defeated: ReadonlyArray<DefeatedFoe>,
  participants: number,
  isTrainer: boolean,
): number {
  if (participants <= 0 || defeated.length === 0) return 0;
  const a = isTrainer ? 1.5 : 1;
  let total = 0;
  for (const foe of defeated) {
    const level = Math.max(1, foe.level);
    const b = STAGE_BASE_EXP[foe.stage];
    total += Math.max(1, Math.floor((a * b * level) / (7 * participants)));
  }
  return total;
}

export function growthPerLevel(stage: Stage): BaseStats {
  return { ...STAGE_GROWTH[stage] };
}

export function applyGrowth(currentBonus: BaseStats, stage: Stage, levelsGained: number): BaseStats {
  if (levelsGained <= 0) return { ...currentBonus };
  const g = STAGE_GROWTH[stage];
  return {
    hp: currentBonus.hp + g.hp * levelsGained,
    en: currentBonus.en + g.en * levelsGained,
    atk: currentBonus.atk + g.atk * levelsGained,
    def: currentBonus.def + g.def * levelsGained,
    int: currentBonus.int + g.int * levelsGained,
    spd: currentBonus.spd + g.spd * levelsGained,
  };
}

export function clampBonusToCap(
  bonus: BaseStats,
  baseStats: BaseStats,
  stage: Stage,
  stagePools: StagePools | undefined,
): BaseStats {
  const pools = stagePools ?? defaultMaxedPools(stage);
  const combatCap = combatCapFor(stage, pools);
  const hpenCap = hpenCapFor(stage, pools);
  const combatRoom = Math.max(0, combatCap - combatSum(baseStats));
  const hpenRoom = Math.max(0, hpenCap - hpenSum(baseStats));
  const bonusCombat = bonus.atk + bonus.def + bonus.int + bonus.spd;
  const bonusHpEn = bonus.hp + bonus.en;
  const combatScale = bonusCombat === 0 || bonusCombat <= combatRoom ? 1 : combatRoom / bonusCombat;
  const hpenScale = bonusHpEn === 0 || bonusHpEn <= hpenRoom ? 1 : hpenRoom / bonusHpEn;
  return {
    hp: Math.max(0, Math.floor(bonus.hp * hpenScale)),
    en: Math.max(0, Math.floor(bonus.en * hpenScale)),
    atk: Math.max(0, Math.floor(bonus.atk * combatScale)),
    def: Math.max(0, Math.floor(bonus.def * combatScale)),
    int: Math.max(0, Math.floor(bonus.int * combatScale)),
    spd: Math.max(0, Math.floor(bonus.spd * combatScale)),
  };
}

export type AwardResult = {
  level: number;
  xp: number;
  bonus: BaseStats;
  gainedLevels: number;
};

export function awardXp(
  currentLevel: number,
  currentXp: number,
  currentBonus: BaseStats,
  stage: Stage,
  deltaXp: number,
  baseStats?: BaseStats,
  stagePools?: StagePools,
): AwardResult {
  const newXp = Math.max(0, currentXp + deltaXp);
  const derivedLevel = levelFromXp(newXp, stage);
  const newLevel = Math.max(currentLevel, derivedLevel);
  const gained = Math.max(0, newLevel - currentLevel);
  const grown = applyGrowth(currentBonus, stage, gained);
  const capped = baseStats ? clampBonusToCap(grown, baseStats, stage, stagePools) : grown;
  return { level: newLevel, xp: newXp, bonus: capped, gainedLevels: gained };
}
