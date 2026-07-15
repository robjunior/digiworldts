/**
 * rng.ts — the injectable RNG seam for the combat turn-route (TASK-158, R-22 slice 19).
 *
 * This is the FIRST injected-RNG seam in the executable engine. It is deliberately
 * TINY, PURE, and FRAMEWORK-FREE (no Nest, no IO — the server twin of the pure
 * combat modules `battle.ts` / `world.map.ts`, A-36 #3 / L-16), so every consumer
 * stays deterministically unit-testable by INJECTING a fixed `rng`.
 *
 * WHY a seam and not a bare `Math.random` call (A-53 / A-126 / A-141): the danger
 * A-53 flagged is that raw randomness breaks every deterministic `toEqual` fixture.
 * The reversible framing removes that danger — the roll is expressed as a pure
 * function `(…, rng: Rng) => …` whose ONLY entropy source is the injected `rng`.
 * Production injects `DEFAULT_RNG`; tests inject a fixed stub. The pure whole-fight
 * engine (`simulateBattle` / `simulateBattleAtb` / `resolveActorTurn`) stays
 * BYTE-FROZEN and RNG-FREE — its executable `Math.random` count STAYS 0. The seam
 * lives ONLY at the interactive flee-roll callsite in `digimon.service.ts`.
 */

/** A source of randomness in the `Math.random` shape: a value in `[0, 1)`. */
export type Rng = () => number;

/**
 * The production default RNG.
 *
 * DELIBERATELY DETERMINISTIC (returns a constant `0`), NOT `Math.random`. This is
 * the A-141 tie-break: a deterministic default keeps EVERY existing flee fixture
 * byte-identical WITHOUT editing it — because `fleeSucceeds` is designed so that at
 * `rng() === 0` (the luckiest possible roll) the escape ALWAYS succeeds regardless
 * of matchup (see {@link fleeSucceeds}), the pre-D-322 "flee always succeeds"
 * contract is preserved on the production path. Real per-player randomness is a
 * LATER wave (swap this constant for `Math.random` — a one-line, two-way-door
 * change) once the odds curve has been playtested; carving that here keeps this
 * slice's suite non-flaky (A-140/A-141 win-for-non-flaky discipline) and the
 * `Math.random` count at 0 even at the production callsite.
 */
export const DEFAULT_RNG: Rng = () => 0;

/**
 * The PRODUCTION live RNG (TASK-177, R-22 slice 38 — "TURN ON REAL PER-PLAYER
 * RANDOMNESS"). This is the "LATER wave" the {@link DEFAULT_RNG} doc-comment names
 * verbatim: swap the constant-0 default for real entropy on the production HTTP path
 * so the FIVE already-built injected-RNG rolls (flee / crit / evade / resist / lucky
 * loot-rarity) finally FIRE for a real player instead of being pinned OFF by
 * `rng() === 0`.
 *
 * WHY it lives here as a named const, drawn at the HTTP boundary (the controller),
 * NOT inside the pure engine: the entropy is INJECTED into the pure `(…, rng: Rng)`
 * seam from the framework edge, exactly as `world.service.ts` draws `Math.random()`
 * for the encounter roll and feeds the RNG-free `rollEncounter`. So the pure engine
 * (`battle.ts` / this file's roll functions / `world/encounter.ts`) stays
 * framework-free and its executable `Math.random` count STAYS 0 — the only
 * `Math.random` call is right here.
 *
 * `DEFAULT_RNG` is UNCHANGED (still `() => 0`), so EVERY existing fixture/e2e that
 * injects it or an explicit stub stays byte-identical (~646 pinned fixtures, NO
 * re-pin — invariant 5). Two-way door: revert = pass `undefined` (→ `DEFAULT_RNG`)
 * again at the controller and drop this const.
 */
export const LIVE_RNG: Rng = () => Math.random();

/** Escape-chance formula constants (a clear monotone curve, clamped to sane bounds). */
export const FLEE_BASE_CHANCE = 0.5;
/** Weight on the SPD-gap term: how strongly the SPD ratio pulls the odds up/down. */
export const FLEE_SPD_WEIGHT = 0.5;
/** A hopeless (much-slower) matchup still keeps at least this escape chance. */
export const FLEE_MIN_CHANCE = 0.1;
/** A dominant (much-faster) matchup still can MISS — cap below certainty. */
export const FLEE_MAX_CHANCE = 0.95;

/**
 * Does a flee attempt SUCCEED? (TASK-158, R-22 slice 19 — the first injected-RNG consumer.)
 *
 * PURE and unit-testable: the ONLY entropy is the injected `rng` (NO `Math.random`
 * inside — the rule lives on the SERVER, never the client, A-36 #3 / L-16). The
 * escape chance rises monotonically with the player's SPD relative to the enemy's:
 *
 *   chance = clamp(BASE + WEIGHT · (playerSpd − enemySpd)/(playerSpd + enemySpd),
 *                  [MIN, MAX])
 *
 * The `(p − e)/(p + e)` term is in `(−1, 1)`: 0 at parity, → +1 as the player
 * dominates, → −1 as the player is hopelessly slow. So a faster Digimon flees more
 * reliably and a slower one often FAILS (burning the turn — the enemy gets its
 * reply). The clamp keeps a hopeless matchup at a small non-zero chance and a
 * dominant one below certainty (a dramatic getaway can still misfire).
 *
 * DETERMINISM CONTRACT (A-141): at `rng() === 0` (the luckiest roll) the result is
 * ALWAYS `true` (0 < any positive clamped chance), so `DEFAULT_RNG` (which returns
 * 0) makes flee deterministically SUCCEED for EVERY matchup — the pre-D-322 flee
 * fixtures stay byte-identical with no edit. Succeeds when `rng() < chance`.
 */
export function fleeSucceeds(playerSpd: number, enemySpd: number, rng: Rng): boolean {
  const total = playerSpd + enemySpd;
  // Guard the degenerate zero-total case (both SPD 0): fall back to the base chance.
  const ratio = total > 0 ? (playerSpd - enemySpd) / total : 0;
  const raw = FLEE_BASE_CHANCE + FLEE_SPD_WEIGHT * ratio;
  const chance = Math.min(FLEE_MAX_CHANCE, Math.max(FLEE_MIN_CHANCE, raw));
  return rng() < chance;
}

/**
 * Critical-hit chance (TASK-159, R-22 slice 20) — the base probability a strike
 * lands a CRIT. Tunable later with zero migration (A-142).
 */
export const CRIT_CHANCE = 0.1;
/** The damage multiplier a critical hit applies (a crit only INCREASES damage — A-42 HELD). */
export const CRIT_MULT = 1.5;

/**
 * Does THIS strike land a CRITICAL hit? (TASK-159, R-22 slice 20 — the SECOND
 * injected-RNG consumer, on the `rng.ts` seam slice 19 landed.)
 *
 * PURE and unit-testable: the ONLY entropy is the injected `rng` (NO `Math.random`
 * inside — the rule lives on the SERVER, never the client, A-36 #3 / L-16). A crit
 * fires ONLY on an UNLUCKY-for-the-defender HIGH roll: crit iff `rng() >= 1 −
 * CRIT_CHANCE`.
 *
 * DETERMINISM CONTRACT (A-142): at `rng() === 0` (the `DEFAULT_RNG` value) the roll
 * is `0 >= 1 − CRIT_CHANCE` = `0 >= 0.9` = FALSE, so it NEVER crits. Because the
 * auto path (`simulateBattle` / `simulateBattleAtb`) and the production interactive
 * callsite pass NO `rng` (default `DEFAULT_RNG = () => 0`), they never crit and every
 * pinned fixture stays BYTE-IDENTICAL — the invariant-5 proof the pre-crit damage
 * arithmetic did not move. A test injects a fixed high `rng` (near 1) to force a crit.
 */
export function critRoll(rng: Rng): boolean {
  return rng() >= 1 - CRIT_CHANCE;
}

/**
 * Evade / miss chance (TASK-160, R-22 slice 21) — the base probability a strike
 * MISSES entirely (deals 0 damage). Tunable later with zero migration (A-143).
 */
export const EVADE_CHANCE = 0.1;

/**
 * Does THIS strike MISS / get EVADED? (TASK-160, R-22 slice 21 — the THIRD
 * injected-RNG consumer, crit's direct MIRROR-IMAGE on the SAME `resolveDamageStrike`
 * seam. Crit multiplies damage UP; evade zeroes it DOWN.)
 *
 * PURE and unit-testable: the ONLY entropy is the injected `rng` (NO `Math.random`
 * inside — the rule lives on the SERVER, never the client, A-36 #3 / L-16). An evade
 * fires ONLY on a HIGH roll — MIRRORING `critRoll` exactly: evade iff `rng() >= 1 −
 * EVADE_CHANCE`.
 *
 * DETERMINISM CONTRACT (A-143): at `rng() === 0` (the `DEFAULT_RNG` value) the roll
 * is `0 >= 1 − EVADE_CHANCE` = `0 >= 0.9` = FALSE, so it NEVER evades. Because the
 * auto path (`simulateBattle` / `simulateBattleAtb`) and the production interactive
 * callsite pass NO `rng` (default `DEFAULT_RNG = () => 0`), every landed strike still
 * lands and every pinned fixture stays BYTE-IDENTICAL — the invariant-5 proof the
 * pre-evade damage arithmetic did not move. A-42 holds even more strongly than crit:
 * an evade only DECREASES damage to 0, so HP stays monotonically non-increasing. A
 * test injects a fixed high `rng` (near 1) to force an evade.
 */
export function evadeRoll(rng: Rng): boolean {
  return rng() >= 1 - EVADE_CHANCE;
}

/**
 * Status-resist chance (TASK-161, R-22 slice 22) — the base probability that an
 * OFFENSIVE status ailment (Burn / Poison / Weaken / …) a skill tries to apply
 * FAILS TO LAND on the defender. Tunable later with zero migration (A-144).
 */
export const RESIST_CHANCE = 0.1;

/**
 * Does the defender RESIST the incoming offensive status? (TASK-161, R-22 slice 22
 * — the FOURTH injected-RNG consumer, and the FIRST to gate a genuinely NEW seam:
 * status APPLICATION, not damage finalization. It mirrors `critRoll`/`evadeRoll`
 * exactly.)
 *
 * PURE and unit-testable: the ONLY entropy is the injected `rng` (NO `Math.random`
 * inside — the rule lives on the SERVER, never the client, A-36 #3 / L-16). A resist
 * fires ONLY on a HIGH roll — mirroring `critRoll`/`evadeRoll`: resist iff `rng() >=
 * 1 − RESIST_CHANCE`.
 *
 * DETERMINISM CONTRACT (A-144): at `rng() === 0` (the `DEFAULT_RNG` value) the roll
 * is `0 >= 1 − RESIST_CHANCE` = `0 >= 0.9` = FALSE, so it NEVER resists — the status
 * ALWAYS lands. Because the auto path (`simulateBattle` / `simulateBattleAtb`) and
 * the production interactive callsite pass NO `rng` (default `DEFAULT_RNG = () => 0`),
 * every offensive status still lands and every pinned fixture stays BYTE-IDENTICAL —
 * the invariant-5 proof the pre-resist status-landing behavior did not move. A-42
 * holds: a resisted status only REMOVES a would-be DoT/debuff, so HP stays
 * monotonically non-increasing (a resist can only make the fight LESS damaging to the
 * defender, never heal). A test injects a fixed high `rng` (near 1) to force a resist.
 */
export function statusResists(rng: Rng): boolean {
  return rng() >= 1 - RESIST_CHANCE;
}

/**
 * The ordered loot-rarity ladder, worst → best. Index position IS the tier's rank, so
 * an "upgrade" is +1 index and a "downgrade" is −1 index. This is the SERVER twin of the
 * biome→tier map (`lootRarityForBiome`, world/encounter.ts): that map picks the BASE
 * tier deterministically from the biome; `rollLootRarity` (below) then draws AROUND it.
 */
export const RARITY_LADDER = ['Common', 'Uncommon', 'Rare'] as const;
export type LootRarity = (typeof RARITY_LADDER)[number];

/**
 * The chance a wild-win drop rolls UP one tier from its biome baseline (a lucky drop).
 * Tunable later with zero migration (A-158). NOTE we deliberately model ONLY an upgrade
 * band and NO downgrade band: this keeps `rng()===0` (the `DEFAULT_RNG` value) in the
 * "stay at base" outcome (see the threshold direction in {@link rollLootRarity}), which
 * is the load-bearing move that keeps the default/production path byte-identical to the
 * slice-36 fixed tier. A downgrade band is a trivial future add-only tune.
 */
export const RARITY_UPGRADE_CHANCE = 0.15;

/**
 * Roll the wild-win loot rarity around its biome BASE tier. (TASK-176, R-22 slice 37 —
 * the FIFTH injected-RNG consumer, and the FIRST loot OUTCOME that actually *varies*:
 * slices 34–36 gave the drop a deterministic AMOUNT/KIND/TIER; this makes the TIER a
 * seeded ROLL so a mountain win *usually* reads `[Rare]` but can roll UP to a rarer tier.)
 *
 * PURE and unit-testable: the ONLY entropy is the injected `rng` (NO `Math.random`
 * inside — the rule lives on the SERVER, never the client, A-36 #3 / L-16). A single
 * `rng()` draw (L-58 multi-draw footgun avoided): an UPGRADE fires ONLY on a HIGH roll,
 * mirroring `critRoll`/`evadeRoll`/`statusResists`: upgrade iff `rng() >= 1 −
 * RARITY_UPGRADE_CHANCE`, and only when the base tier is not already the top of the ladder.
 *
 * DETERMINISM CONTRACT (A-158): at `rng() === 0` (the `DEFAULT_RNG` value) the roll is
 * `0 >= 1 − RARITY_UPGRADE_CHANCE` = `0 >= 0.85` = FALSE, so it NEVER upgrades — the roll
 * returns EXACTLY `baseTier`, byte-identical to slice 36's fixed biome tier. Because the
 * win-reward path passes NO `rng` (default `DEFAULT_RNG = () => 0`), every existing test /
 * production HTTP win reports the same tier and every pinned fixture stays BYTE-IDENTICAL
 * — the invariant-5 proof (and this is display-only, so no economic value ever rolls;
 * the credit AMOUNT/RESOURCE/audit row are untouched). A test injects a fixed high `rng`
 * (near 1) to force an upgrade.
 *
 * `baseTier` is accepted as a plain `string` (the shape `lootRarityForBiome` returns);
 * an unrecognized/off-ladder base is treated as the bottom of the ladder for the +1 math
 * but returned verbatim on the default (no-upgrade) path, so it can never emit a tier off
 * the ladder.
 */
export function rollLootRarity(baseTier: string, rng: Rng): LootRarity | string {
  if (rng() < 1 - RARITY_UPGRADE_CHANCE) {
    // Default / low-roll path: stay at the biome baseline verbatim (byte-identical to slice 36).
    return baseTier;
  }
  const idx = (RARITY_LADDER as readonly string[]).indexOf(baseTier);
  // Already at (or above) the top of the ladder, or an unknown tier → nothing to upgrade to.
  if (idx < 0 || idx >= RARITY_LADDER.length - 1) {
    return baseTier;
  }
  return RARITY_LADDER[idx + 1];
}
