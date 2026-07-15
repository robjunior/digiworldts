import { describe, expect, it } from 'vitest';
import {
  applyLossPenalty,
  BATTLE_LOSS_XP_PENALTY,
  PER_LEVEL_LOSS_STEP,
  MAX_LOSS_XP_PENALTY,
  lossPenaltyFor,
  type LevelableStats,
} from './training';

/**
 * Pure-unit spec for the PvE on-loss XP penalty (TASK-249, R-31e).
 *
 * The penalty is a PERSISTED-STATE rule that resolves AFTER the fight (never a combat
 * mechanic inside battle.ts), so it is a plain deterministic function unit-testable in
 * isolation — mirroring the applyBattleReward win reward. The load-bearing guarantees a
 * player feels: a loss BLEEDS xp (a felt consequence) but is monotonic-safe — it never
 * de-levels, never drops a stat, and never sends xp negative (A-42 in spirit).
 */
const BASE: LevelableStats = { level: 5, xp: 100, hp: 60, atk: 20, def: 15, spd: 12 };

describe('applyLossPenalty (PvE on-loss XP penalty)', () => {
  it('subtracts the penalty from xp', () => {
    const next = applyLossPenalty(BASE, BATTLE_LOSS_XP_PENALTY);
    expect(next.xp).toBe(BASE.xp - BATTLE_LOSS_XP_PENALTY);
  });

  it('floors xp at 0 when the penalty exceeds current xp (never negative)', () => {
    const low: LevelableStats = { ...BASE, xp: 5 };
    expect(applyLossPenalty(low, BATTLE_LOSS_XP_PENALTY).xp).toBe(0);
    // Exactly-equal drains to 0, not below.
    expect(applyLossPenalty({ ...BASE, xp: BATTLE_LOSS_XP_PENALTY }, BATTLE_LOSS_XP_PENALTY).xp).toBe(0);
  });

  it('leaves level and every stat field UNCHANGED (a loss never de-levels or drops a stat)', () => {
    const next = applyLossPenalty(BASE, BATTLE_LOSS_XP_PENALTY);
    expect(next.level).toBe(BASE.level);
    expect(next.hp).toBe(BASE.hp);
    expect(next.atk).toBe(BASE.atk);
    expect(next.def).toBe(BASE.def);
    expect(next.spd).toBe(BASE.spd);
  });

  it('is deterministic and never throws on a huge or negative penalty', () => {
    expect(applyLossPenalty(BASE, 1e9).xp).toBe(0);
    // A negative penalty would ADD xp arithmetically; the max(0,...) clamp keeps it safe,
    // and it must never throw regardless.
    expect(() => applyLossPenalty(BASE, -50)).not.toThrow();
    expect(applyLossPenalty(BASE, -50).xp).toBe(BASE.xp + 50);
    // Same input → same output (pure).
    expect(applyLossPenalty(BASE, BATTLE_LOSS_XP_PENALTY)).toEqual(
      applyLossPenalty(BASE, BATTLE_LOSS_XP_PENALTY),
    );
  });

  it('BATTLE_LOSS_XP_PENALTY is a positive integer', () => {
    expect(Number.isInteger(BATTLE_LOSS_XP_PENALTY)).toBe(true);
    expect(BATTLE_LOSS_XP_PENALTY).toBeGreaterThan(0);
  });
});

/**
 * Pure-unit spec for the LEVEL-SCALED on-loss XP penalty (TASK-267, R-31e).
 *
 * The load-bearing invariant-5 anchor: `lossPenaltyFor(1) === BATTLE_LOSS_XP_PENALTY`
 * byte-for-byte, so today's lvl-1 loss is unchanged and every existing lvl-1 fixture stays
 * green with NO re-pin. Higher levels lose strictly more (the "meaningful chunk" that keeps
 * pace with the growing XP curve), monotone non-decreasing, floored at the baseline for
 * level <= 1, never throwing.
 */
describe('lossPenaltyFor (level-scaled on-loss XP penalty)', () => {
  it('at level 1 equals the flat baseline byte-for-byte', () => {
    expect(lossPenaltyFor(1)).toBe(BATTLE_LOSS_XP_PENALTY);
    expect(lossPenaltyFor(1)).toBe(20);
  });

  it('level <= 1 (0, negative) returns exactly the baseline floor', () => {
    expect(lossPenaltyFor(0)).toBe(BATTLE_LOSS_XP_PENALTY);
    expect(lossPenaltyFor(-5)).toBe(BATTLE_LOSS_XP_PENALTY);
  });

  it('is strictly greater at a higher level', () => {
    expect(lossPenaltyFor(1)).toBeLessThan(lossPenaltyFor(10));
    expect(lossPenaltyFor(10)).toBe(BATTLE_LOSS_XP_PENALTY + 9 * PER_LEVEL_LOSS_STEP);
  });

  it('is monotone non-decreasing across a range of levels', () => {
    for (let level = 1; level < 40; level++) {
      expect(lossPenaltyFor(level + 1)).toBeGreaterThanOrEqual(lossPenaltyFor(level));
    }
  });

  it('grows by exactly PER_LEVEL_LOSS_STEP per level above 1', () => {
    expect(lossPenaltyFor(3) - lossPenaltyFor(2)).toBe(PER_LEVEL_LOSS_STEP);
  });

  it('never throws on a large / odd level', () => {
    expect(() => lossPenaltyFor(1e9)).not.toThrow();
    expect(() => lossPenaltyFor(3.5)).not.toThrow();
    expect(lossPenaltyFor(1e9)).toBeGreaterThan(0);
  });

  it('PER_LEVEL_LOSS_STEP is a positive integer', () => {
    expect(Number.isInteger(PER_LEVEL_LOSS_STEP)).toBe(true);
    expect(PER_LEVEL_LOSS_STEP).toBeGreaterThan(0);
  });

  // TASK-276 (R-31e): steeper per-level curve + a roguelike CAP. The linear toll now climbs
  // by PER_LEVEL_LOSS_STEP (8) per level until it hits MAX_LOSS_XP_PENALTY (250), where it
  // stops — punishing but not catastrophic for a very-high-level defeat.
  it('is LINEAR below the cap (uncapped mid level)', () => {
    // level 10 → 20 + 9*8 = 92, well under the 250 cap.
    expect(lossPenaltyFor(10)).toBe(BATTLE_LOSS_XP_PENALTY + 9 * PER_LEVEL_LOSS_STEP);
    expect(lossPenaltyFor(10)).toBeLessThan(MAX_LOSS_XP_PENALTY);
  });

  it('the cap BINDS at a very high level', () => {
    // Uncapped a lvl-40 loss would be 20 + 39*8 = 332; the cap clamps it to the ceiling.
    expect(lossPenaltyFor(40)).toBe(MAX_LOSS_XP_PENALTY);
    expect(lossPenaltyFor(1e9)).toBe(MAX_LOSS_XP_PENALTY);
  });

  it('MAX_LOSS_XP_PENALTY is a positive integer greater than the level-1 penalty', () => {
    expect(Number.isInteger(MAX_LOSS_XP_PENALTY)).toBe(true);
    expect(MAX_LOSS_XP_PENALTY).toBeGreaterThan(0);
    expect(MAX_LOSS_XP_PENALTY).toBeGreaterThan(lossPenaltyFor(1));
  });
});
