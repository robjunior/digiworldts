import { describe, expect, it } from 'vitest';
import {
  CRIT_CHANCE,
  DEFAULT_RNG,
  EVADE_CHANCE,
  FLEE_MAX_CHANCE,
  FLEE_MIN_CHANCE,
  LIVE_RNG,
  RESIST_CHANCE,
  RARITY_LADDER,
  RARITY_UPGRADE_CHANCE,
  critRoll,
  evadeRoll,
  fleeSucceeds,
  rollLootRarity,
  statusResists,
  type Rng,
} from './rng';

/**
 * rng.spec.ts (TASK-158, R-22 slice 19) — the pure, injected-RNG flee-roll seam.
 *
 * Every case injects a FIXED `rng` (NO `Math.random` in this suite — the roll is
 * deterministic by injection), proving `fleeSucceeds` is a pure monotone function of
 * the SPD gap whose ONLY entropy is the seam. This is the invariant that keeps the
 * whole engine deterministically testable while production still gets randomness.
 */
describe('fleeSucceeds — the injected-RNG flee-success roll', () => {
  const rngOf =
    (v: number): Rng =>
    () =>
      v;

  it('a large SPD lead escapes across the whole rng range (up to the clamp ceiling)', () => {
    // A dominant matchup: chance is clamped to FLEE_MAX_CHANCE (0.95). Any roll BELOW
    // that succeeds; the ceiling means even a fast Digimon can miss on an unlucky roll.
    expect(fleeSucceeds(300, 5, rngOf(0))).toBe(true);
    expect(fleeSucceeds(300, 5, rngOf(FLEE_MAX_CHANCE - 0.001))).toBe(true);
    // …but the clamp keeps success BELOW certainty — an unlucky roll at/above the
    // ceiling still FAILS (a dramatic getaway can misfire — present ≠ guaranteed).
    expect(fleeSucceeds(300, 5, rngOf(FLEE_MAX_CHANCE))).toBe(false);
    expect(fleeSucceeds(300, 5, rngOf(0.99))).toBe(false);
  });

  it('a hopeless (much slower) matchup FAILS at an unlucky roll but keeps the min floor', () => {
    // The clamp floor FLEE_MIN_CHANCE (0.1) guarantees a slow Digimon still has a
    // small chance: a lucky roll below the floor succeeds…
    expect(fleeSucceeds(5, 300, rngOf(0))).toBe(true);
    expect(fleeSucceeds(5, 300, rngOf(FLEE_MIN_CHANCE - 0.001))).toBe(true);
    // …but an unlucky roll at/above the floor FAILS — the flee attempt is wasted.
    expect(fleeSucceeds(5, 300, rngOf(FLEE_MIN_CHANCE))).toBe(false);
    expect(fleeSucceeds(5, 300, rngOf(0.99))).toBe(false);
  });

  it('is monotone in the SPD gap: a faster player escapes at rolls a slower one cannot', () => {
    // At the SAME unlucky-ish roll, a faster relative SPD succeeds where a slower one fails.
    const roll = 0.6;
    expect(fleeSucceeds(300, 5, rngOf(roll))).toBe(true); // chance ~0.95 > 0.6
    expect(fleeSucceeds(8, 8, rngOf(roll))).toBe(false); // parity chance 0.5 < 0.6
    expect(fleeSucceeds(5, 300, rngOf(roll))).toBe(false); // hopeless, floor 0.1 < 0.6
  });

  it('at parity the chance is the base 0.5 (below succeeds, at/above fails)', () => {
    expect(fleeSucceeds(8, 8, rngOf(0.49))).toBe(true);
    expect(fleeSucceeds(8, 8, rngOf(0.5))).toBe(false);
  });

  it('DEFAULT_RNG (deterministic 0) makes flee ALWAYS succeed — the pre-D-322 contract', () => {
    // The A-141 determinism contract: at rng()===0 the luckiest roll always wins, so
    // the production default preserves "flee always succeeds" for EVERY matchup — the
    // existing flee fixtures stay byte-identical with no edit.
    expect(DEFAULT_RNG()).toBe(0);
    expect(fleeSucceeds(8, 5, DEFAULT_RNG)).toBe(true); // the shipped agumon(8)-vs-numemon(5)
    expect(fleeSucceeds(5, 300, DEFAULT_RNG)).toBe(true); // even a hopeless matchup
    expect(fleeSucceeds(300, 5, DEFAULT_RNG)).toBe(true);
  });

  it('the degenerate zero-total SPD case falls back to the base chance (no divide-by-zero)', () => {
    expect(fleeSucceeds(0, 0, rngOf(0.49))).toBe(true);
    expect(fleeSucceeds(0, 0, rngOf(0.5))).toBe(false);
  });
});

/**
 * critRoll (TASK-159, R-22 slice 20) — the SECOND injected-RNG consumer: the
 * critical-hit roll. A crit fires ONLY on an UNLUCKY-for-the-defender HIGH roll
 * (`rng() >= 1 − CRIT_CHANCE`), so the `DEFAULT_RNG` value `0` NEVER crits — which is
 * what keeps every pinned battle fixture byte-identical (invariant 5). Every case
 * injects a FIXED `rng` (NO `Math.random` here — deterministic, non-flaky).
 */
describe('critRoll', () => {
  const rngOf =
    (v: number): Rng =>
    () =>
      v;
  const threshold = 1 - CRIT_CHANCE; // e.g. 0.9

  it('NEVER crits at rng()===0 (the DEFAULT_RNG value) — the byte-identity guard', () => {
    expect(critRoll(rngOf(0))).toBe(false);
    expect(critRoll(DEFAULT_RNG)).toBe(false);
  });

  it('crits on a HIGH roll (near 1)', () => {
    expect(critRoll(rngOf(1))).toBe(true);
    expect(critRoll(rngOf(0.999))).toBe(true);
  });

  it('is FALSE across the whole sub-threshold range', () => {
    expect(critRoll(rngOf(0.1))).toBe(false);
    expect(critRoll(rngOf(0.5))).toBe(false);
    expect(critRoll(rngOf(threshold - 0.001))).toBe(false);
  });

  it('the crit-threshold boundary is pinned (>= 1 − CRIT_CHANCE crits, just below does not)', () => {
    expect(critRoll(rngOf(threshold))).toBe(true); // inclusive at the boundary
    expect(critRoll(rngOf(threshold - 0.0001))).toBe(false);
  });
});

/**
 * evadeRoll (TASK-160, R-22 slice 21) — the THIRD injected-RNG consumer, crit's direct
 * MIRROR-IMAGE. Written EXACTLY like `critRoll` so a HIGH roll evades
 * (`rng() >= 1 − EVADE_CHANCE`), so the `DEFAULT_RNG` value `0` NEVER evades — which is
 * what keeps every pinned fixture byte-identical on the default-driven auto path.
 */
describe('evadeRoll', () => {
  const rngOf =
    (v: number): Rng =>
    () =>
      v;
  const threshold = 1 - EVADE_CHANCE; // e.g. 0.9

  it('NEVER evades at rng()===0 / DEFAULT_RNG (the guard the byte-identity proof rests on)', () => {
    expect(evadeRoll(rngOf(0))).toBe(false);
    expect(evadeRoll(DEFAULT_RNG)).toBe(false);
  });

  it('evades on a HIGH roll (near 1)', () => {
    expect(evadeRoll(rngOf(1))).toBe(true);
    expect(evadeRoll(rngOf(0.999))).toBe(true);
  });

  it('does NOT evade across the sub-threshold range', () => {
    expect(evadeRoll(rngOf(0.1))).toBe(false);
    expect(evadeRoll(rngOf(0.5))).toBe(false);
    expect(evadeRoll(rngOf(threshold - 0.001))).toBe(false);
  });

  it('the evade-threshold boundary is pinned (>= 1 − EVADE_CHANCE evades, just below does not)', () => {
    expect(evadeRoll(rngOf(threshold))).toBe(true); // inclusive at the boundary
    expect(evadeRoll(rngOf(threshold - 0.0001))).toBe(false);
  });
});

/**
 * statusResists (TASK-161, R-22 slice 22) — the FOURTH injected-RNG consumer, gating
 * the NEW status-APPLICATION seam. Written EXACTLY like `critRoll`/`evadeRoll` so a
 * HIGH roll resists (`rng() >= 1 − RESIST_CHANCE`), so the `DEFAULT_RNG` value `0`
 * NEVER resists — which is what keeps every pinned fixture byte-identical on the
 * default-driven auto path (the status always lands there).
 */
describe('statusResists', () => {
  const rngOf =
    (v: number): Rng =>
    () =>
      v;
  const threshold = 1 - RESIST_CHANCE; // e.g. 0.9

  it('NEVER resists at rng()===0 / DEFAULT_RNG (the guard the byte-identity proof rests on)', () => {
    expect(statusResists(rngOf(0))).toBe(false);
    expect(statusResists(DEFAULT_RNG)).toBe(false);
  });

  it('resists on a HIGH roll (near 1)', () => {
    expect(statusResists(rngOf(1))).toBe(true);
    expect(statusResists(rngOf(0.999))).toBe(true);
  });

  it('does NOT resist across the sub-threshold range', () => {
    expect(statusResists(rngOf(0.1))).toBe(false);
    expect(statusResists(rngOf(0.5))).toBe(false);
    expect(statusResists(rngOf(threshold - 0.001))).toBe(false);
  });

  it('the resist-threshold boundary is pinned (>= 1 − RESIST_CHANCE resists, just below does not)', () => {
    expect(statusResists(rngOf(threshold))).toBe(true); // inclusive at the boundary
    expect(statusResists(rngOf(threshold - 0.0001))).toBe(false);
  });
});

/**
 * rollLootRarity (TASK-176, R-22 slice 37) — the FIFTH injected-RNG consumer and the
 * FIRST loot OUTCOME that actually *varies*. Written EXACTLY like `critRoll`/`evadeRoll`/
 * `statusResists` so a HIGH roll upgrades (`rng() >= 1 − RARITY_UPGRADE_CHANCE`), so the
 * `DEFAULT_RNG` value `0` NEVER upgrades — the load-bearing byte-identity guard: on the
 * default/production path the rolled tier is EXACTLY the slice-36 fixed biome baseline.
 */
describe('rollLootRarity', () => {
  const rngOf =
    (v: number): Rng =>
    () =>
      v;

  it('returns the base tier EXACTLY at rng()===0 / DEFAULT_RNG for every ladder tier (the byte-identity proof)', () => {
    for (const base of RARITY_LADDER) {
      expect(rollLootRarity(base, rngOf(0))).toBe(base);
      expect(rollLootRarity(base, DEFAULT_RNG)).toBe(base);
    }
  });

  it('upgrades a non-top tier to a strictly-rarer tier on a HIGH roll', () => {
    expect(rollLootRarity('Common', rngOf(0.99))).toBe('Uncommon');
    expect(rollLootRarity('Uncommon', rngOf(0.99))).toBe('Rare');
    // the ladder ranks Common < Uncommon < Rare, so an upgrade moves strictly rarer
    expect(RARITY_LADDER.indexOf('Uncommon')).toBeGreaterThan(RARITY_LADDER.indexOf('Common'));
  });

  it('cannot upgrade past the top of the ladder (a HIGH roll on the rarest tier stays put)', () => {
    expect(rollLootRarity('Rare', rngOf(0.99))).toBe('Rare');
    expect(rollLootRarity('Rare', rngOf(1))).toBe('Rare');
  });

  it('is deterministic (same rng → same pick) and never emits a tier off the ladder', () => {
    const r = rngOf(0.99);
    expect(rollLootRarity('Common', r)).toBe(rollLootRarity('Common', r));
    for (const base of RARITY_LADDER) {
      for (const v of [0, 0.5, 0.85, 0.99, 1]) {
        expect(RARITY_LADDER).toContain(rollLootRarity(base, rngOf(v)));
      }
    }
  });

  it('the upgrade-threshold boundary is pinned (>= 1 − RARITY_UPGRADE_CHANCE upgrades, just below stays)', () => {
    const threshold = 1 - RARITY_UPGRADE_CHANCE; // e.g. 0.85
    expect(rollLootRarity('Common', rngOf(threshold))).toBe('Uncommon'); // inclusive at boundary
    expect(rollLootRarity('Common', rngOf(threshold - 0.0001))).toBe('Common');
  });

  it('returns an unknown/off-ladder base verbatim on the default path (can never fabricate a tier)', () => {
    expect(rollLootRarity('Legendary', rngOf(0))).toBe('Legendary');
    expect(rollLootRarity('Legendary', rngOf(0.99))).toBe('Legendary'); // no next rung → stays
  });
});

/**
 * LIVE_RNG (TASK-177, R-22 slice 38 — TURN ON REAL PER-PLAYER RANDOMNESS). Proves the
 * production live RNG is `Math.random`-backed: it draws real entropy in `[0, 1)` and is
 * NOT the constant-0 `DEFAULT_RNG`. This is the const the controller now feeds into the
 * `battleTurn` `rng` seam so the five injected-RNG rolls finally fire for a real player.
 * The ROLLED-OUTCOME behaviour of each consumer stays covered by the existing injected-stub
 * tests above (non-flaky discipline, L-55/L-56); this only asserts LIVE_RNG's own shape.
 */
describe('LIVE_RNG — the production live entropy source', () => {
  it('returns values in [0, 1) (the Math.random shape)', () => {
    for (let i = 0; i < 100; i++) {
      const v = LIVE_RNG();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is NOT the constant-0 DEFAULT_RNG (it actually varies across draws)', () => {
    // Distinct from the identity default: several draws are not all 0. (Astronomically
    // unlikely to be a false failure — Math.random() returning 0 fifty times running.)
    const draws = Array.from({ length: 50 }, () => LIVE_RNG());
    expect(draws.some((v) => v !== 0)).toBe(true);
    expect(DEFAULT_RNG()).toBe(0); // the default it replaces stays pinned OFF, unchanged
  });
});
