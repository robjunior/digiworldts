import { describe, expect, it } from 'vitest';
import { evolutionTrainingBonus, STAT_GAIN_PER_LEVEL } from './training';

/**
 * TASK-195 (R-26a slice 54) — the PURE "trained evolves stronger" bonus rule. These
 * units pin the load-bearing properties the evolve seam relies on: the IDENTITY at base
 * level (an untrained evolve is byte-identical to today — the invariant-5 anchor),
 * MONOTONICITY (a higher pre-evolution level yields a >= per-stat bonus, strictly
 * positive at a well-trained level), and DETERMINISM (a pure function of `level`, no
 * RNG/clock). No app/DB boot — the whole rule is testable in isolation, exactly like
 * `applyTraining`/`timedTrainingXp`.
 */
describe('evolutionTrainingBonus (trained-evolves-stronger rule)', () => {
  const ZERO = { hp: 0, atk: 0, def: 0, spd: 0 };

  it('is the IDENTITY at the base level (<= 1) → {0,0,0,0} (invariant-5 anchor)', () => {
    // An untrained fresh creature (level 1, and any level <= 1 from a bad seed/clock)
    // carries NO bonus, so an untrained evolve writes the verbatim catalog stats —
    // byte-identical to R-8/TASK-188. This identity is what keeps every existing evolve
    // fixture (all seed BASE-level starters) green with NO re-pin.
    expect(evolutionTrainingBonus(1)).toEqual(ZERO);
    expect(evolutionTrainingBonus(0)).toEqual(ZERO);
    expect(evolutionTrainingBonus(-5)).toEqual(ZERO);
  });

  it('is MONOTONE non-decreasing on each stat across increasing levels', () => {
    let prev = ZERO;
    for (const level of [1, 2, 5, 10, 20, 50, 100]) {
      const bonus = evolutionTrainingBonus(level);
      expect(bonus.hp).toBeGreaterThanOrEqual(prev.hp);
      expect(bonus.atk).toBeGreaterThanOrEqual(prev.atk);
      expect(bonus.def).toBeGreaterThanOrEqual(prev.def);
      expect(bonus.spd).toBeGreaterThanOrEqual(prev.spd);
      prev = bonus;
    }
  });

  it('is STRICTLY positive on every stat at a well-trained level', () => {
    // A meaningfully trained creature (level 20 / 50) evolves measurably stronger than
    // an untrained one — the observable a player asked for (R-26a / I-14).
    for (const level of [20, 50]) {
      const bonus = evolutionTrainingBonus(level);
      expect(bonus.hp).toBeGreaterThan(0);
      expect(bonus.atk).toBeGreaterThan(0);
      expect(bonus.def).toBeGreaterThan(0);
      expect(bonus.spd).toBeGreaterThan(0);
    }
  });

  it('is DETERMINISTIC — same level, same bonus (no RNG/clock)', () => {
    expect(evolutionTrainingBonus(37)).toEqual(evolutionTrainingBonus(37));
  });

  it('scales with STAT_GAIN_PER_LEVEL (HP moves most, SPD least — the stat spread)', () => {
    // The bonus reuses the STAT_GAIN_PER_LEVEL shape, so its ordering mirrors the flat
    // per-level gain: HP >= ATK/DEF >= SPD. This ties the evolve bonus to the same
    // progression math training uses (no divergent curve).
    const bonus = evolutionTrainingBonus(50);
    expect(STAT_GAIN_PER_LEVEL.hp).toBeGreaterThan(STAT_GAIN_PER_LEVEL.spd);
    expect(bonus.hp).toBeGreaterThan(bonus.spd);
  });
});
