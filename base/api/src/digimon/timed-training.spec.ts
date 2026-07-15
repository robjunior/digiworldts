import { describe, expect, it } from 'vitest';
import {
  applyTimedTraining,
  timedTrainingXp,
  xpForLevel,
  TRAIN_MIN_XP,
  TRAIN_XP_CAP,
  TRAIN_XP_PER_HOUR,
  type TrainableStats,
} from './training';

/**
 * TASK-189 (R-26 slice 48) — the PURE elapsed-time training rule. These units pin the
 * load-bearing properties the duration-based `collectTraining` seam relies on: the gain
 * SCALES with elapsed (train longer ⇒ gain more), is deterministic (no RNG), has a
 * FLOOR (a near-instant collect still pays something) and a CAP (an idle-for-days
 * session cannot dump unbounded XP). No app/DB boot — the whole curve is testable in
 * isolation, exactly like `applyTraining`.
 */
describe('timedTrainingXp (elapsed-scaled XP curve)', () => {
  const HOUR = 60 * 60 * 1000;

  it('is MONOTONE non-decreasing and strictly grows across representative durations', () => {
    // A longer session pays a gain >= a shorter one — the R-26 "train longer, gain
    // more" property. Strictly greater across two mid-range durations (both between the
    // floor and cap) proves the ramp actually moves, not just clamps.
    const short = timedTrainingXp(0.5 * HOUR);
    const long = timedTrainingXp(2 * HOUR);
    expect(long).toBeGreaterThan(short);
    // Monotone across a sweep of increasing durations.
    let prev = -1;
    for (const hours of [0, 0.1, 0.5, 1, 2, 4, 100]) {
      const xp = timedTrainingXp(hours * HOUR);
      expect(xp).toBeGreaterThanOrEqual(prev);
      prev = xp;
    }
  });

  it('is DETERMINISTIC — same elapsed, same output (no RNG)', () => {
    expect(timedTrainingXp(1.234 * HOUR)).toBe(timedTrainingXp(1.234 * HOUR));
  });

  it('honours the FLOOR — a near-zero elapsed still grants the minimal amount', () => {
    expect(timedTrainingXp(0)).toBe(TRAIN_MIN_XP);
    expect(timedTrainingXp(1)).toBe(TRAIN_MIN_XP);
    // A negative elapsed (clock skew / mis-seed) clamps up to the floor, never below.
    expect(timedTrainingXp(-5 * HOUR)).toBe(TRAIN_MIN_XP);
  });

  it('honours the CAP — an arbitrarily long session cannot exceed the ceiling', () => {
    expect(timedTrainingXp(1000 * HOUR)).toBe(TRAIN_XP_CAP);
    // At exactly one hour the linear rate is TRAIN_XP_PER_HOUR (well under the cap).
    expect(timedTrainingXp(HOUR)).toBe(TRAIN_XP_PER_HOUR);
  });

  it('is tuned FAIR-BUT-TOUGH — one hour cannot clear even the first level gate (TASK-196)', () => {
    // R-26a slice 55 / I-14: meaningful levels must take days-to-weeks, not minutes. One
    // elapsed hour must bank strictly LESS XP than the L1→2 gate (`xpForLevel(1)` = 20),
    // so an hour never levels a fresh creature — pinning the retuned days-to-weeks slope
    // in real-world terms (not just symbolically to the constant above).
    expect(timedTrainingXp(HOUR)).toBeLessThan(xpForLevel(1));
    // A full 24h day banks only ~96 XP — enough for a couple of early levels but far
    // from the deep curve: reaching a high level (e.g. L10, whose cumulative cost is
    // sum(20..180) = 1100 XP) takes many days, the "tough" long tail I-14 asks for.
    let cumulativeToTen = 0;
    for (let l = 1; l < 10; l++) cumulativeToTen += xpForLevel(l);
    expect(timedTrainingXp(24 * HOUR)).toBeLessThan(cumulativeToTen);
  });
});

describe('applyTimedTraining (absolute progression via the shared level-up curve)', () => {
  const HOUR = 60 * 60 * 1000;
  const base: TrainableStats = {
    level: 1,
    xp: 0,
    hp: 50,
    atk: 10,
    def: 8,
    spd: 6,
    dataFire: 0,
  };

  it('grants more level/stat progression for a longer session', () => {
    const short = applyTimedTraining(base, 0.25 * HOUR);
    const long = applyTimedTraining(base, 4 * HOUR);
    // A longer session accumulates strictly more total XP-worth of progression: either a
    // higher level or (same level) more banked xp — captured by total absolute XP.
    const totalXp = (s: TrainableStats): number => {
      // Recompose a comparable magnitude: level contributes via crossed thresholds.
      return s.level * 1000 + s.xp;
    };
    expect(totalXp(long)).toBeGreaterThan(totalXp(short));
    // Stats never decrease (A-42-adjacent: training only grows the roster).
    expect(long.hp).toBeGreaterThanOrEqual(short.hp);
    expect(long.atk).toBeGreaterThanOrEqual(short.atk);
  });

  it('is pure — leaves the input untouched and returns a fresh object', () => {
    const snapshot = { ...base };
    applyTimedTraining(base, HOUR);
    expect(base).toEqual(snapshot);
  });

  it('days-to-weeks ramp — one hour no longer levels a fresh creature, but a multi-day session does (TASK-196)', () => {
    // R-26a slice 55 / I-14 "fair but tough": a single elapsed hour must NOT level a
    // level-1 rookie at all (the retuned ~4 XP/hr banks < the 20-XP L1→2 gate).
    const afterOneHour = applyTimedTraining(base, HOUR);
    expect(afterOneHour.level).toBe(1);
    // A multi-day (3×24h) accrued session reaches a modest but >1 level — proving days
    // accumulate meaningfully (the reward for leaving a digimon training for days).
    const afterThreeDays = applyTimedTraining(base, 3 * 24 * HOUR);
    expect(afterThreeDays.level).toBeGreaterThan(1);
  });
});
