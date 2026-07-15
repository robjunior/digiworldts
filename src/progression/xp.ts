/**
 * Player and Digimon progression: XP curve, level threshold table, and the
 * derived stat bonuses granted on level up.
 *
 * Formula choices, kept deliberately simple so behavior is predictable and
 * shows up cleanly in the UI:
 *
 *   xpToReach(L)   = round(120 * L^1.55)          # xp needed to hit level L
 *   xpBetween(L)   = xpToReach(L) - xpToReach(L-1)
 *   levelFromXp(x) = largest L such that xpToReach(L) <= x, capped at MAX_LEVEL
 *
 *   growthPerLevel(stage) = fixed per-stage vector, applied additively when
 *     the player is awarded XP that crosses a threshold. Higher stages grow
 *     more per level because their base stats are larger.
 *
 *   xpReward(outcome, myLevel, oppLevel) = 45 for a win vs same-level foe,
 *     scaled up if you overcame a higher-level opponent, scaled down if you
 *     lost or stomped a much weaker one.
 *
 * The reward function does NOT touch the DB — callers apply the delta.
 */
import { MAX_LEVEL } from '../digimon/element.js';
import type { BaseStats, Stage } from '../digimon/types.js';

export function xpToReach(level: number): number {
  if (level <= 1) return 0;
  const l = Math.min(MAX_LEVEL, level);
  return Math.round(120 * Math.pow(l, 1.55));
}

export function levelFromXp(xp: number): number {
  if (xp <= 0) return 1;
  let lo = 1;
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (xpToReach(mid) <= xp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function xpBetween(fromLevel: number, toLevel: number): number {
  return Math.max(0, xpToReach(toLevel) - xpToReach(fromLevel));
}

export type MatchOutcome = 'win' | 'loss' | 'draw' | 'fled';

/**
 * XP granted for a completed match. Awards range roughly 5-140 per fight.
 * Overcoming a higher-level opponent yields a bonus; steamrolling a much
 * weaker one is heavily discounted (anti-farm signal).
 */
export function xpReward(outcome: MatchOutcome, myLevel: number, oppLevel: number): number {
  const gap = oppLevel - myLevel;
  const baseWin = 45;
  const baseLoss = 12;
  const baseDraw = 20;
  const baseFled = 3;
  const gapBonus = 1 + Math.max(-0.6, Math.min(1.6, gap * 0.08));
  const base =
    outcome === 'win' ? baseWin : outcome === 'loss' ? baseLoss : outcome === 'draw' ? baseDraw : baseFled;
  const raw = base * gapBonus;
  return Math.max(1, Math.round(raw));
}

const STAGE_GROWTH: Record<Stage, BaseStats> = {
  Baby: { hp: 4, en: 0, atk: 1, def: 1, int: 1, spd: 1 },
  'In-Training': { hp: 6, en: 0, atk: 2, def: 1, int: 1, spd: 1 },
  Rookie: { hp: 10, en: 0, atk: 3, def: 2, int: 2, spd: 2 },
  Champion: { hp: 16, en: 0, atk: 5, def: 3, int: 4, spd: 3 },
  Ultimate: { hp: 22, en: 0, atk: 7, def: 5, int: 6, spd: 4 },
  Mega: { hp: 30, en: 0, atk: 10, def: 7, int: 9, spd: 5 },
};

export function growthPerLevel(stage: Stage): BaseStats {
  return { ...STAGE_GROWTH[stage] };
}

/**
 * Apply `levelsGained` growth to an existing stat-bonus vector.
 * Pure function — returns a new object.
 */
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

/**
 * Convenience: given a Digimon's current level+xp+stage+bonus, add `deltaXp`
 * and return the new level/xp/bonus. Used by the battle result processor.
 */
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
): AwardResult {
  const newXp = Math.max(0, currentXp + deltaXp);
  const newLevel = levelFromXp(newXp);
  const gained = Math.max(0, newLevel - currentLevel);
  const newBonus = applyGrowth(currentBonus, stage, gained);
  return { level: newLevel, xp: newXp, bonus: newBonus, gainedLevels: gained };
}
