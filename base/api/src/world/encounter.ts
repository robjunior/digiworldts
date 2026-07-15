/**
 * TASK-48 (R-17b) — the PURE biome→wild-encounter rules. Framework-free, NO IO, NO RNG:
 * the randomness is INJECTED as two `[0,1)` numbers (`roll`/`pick`) so the rule is fully
 * unit-testable, exactly like {@link battle.ts}'s injected-nothing determinism — the
 * SERVER (WorldService.rollEncounterAt) draws the actual `Math.random()` values at the
 * HTTP boundary and feeds them in. This module never calls `Math.random`.
 *
 * SCOPE (the smallest runnable slice): each biome has a `chance` of an encounter and a
 * small species list drawn from the EXISTING {@link ENEMY_ROSTER} (`battle.ts`), so a
 * rolled encounter's `enemyId` is exactly what the SHIPPED `POST /digimon/:id/battle`
 * accepts — no new enemy stats, no new battle plumbing this slice. CARVED to later R-17
 * children: wild-Digimon CAPTURE, item/resource drops, a richer per-biome roster, level
 * scaling. This file only decides WHICH foe (if any) a step surfaces.
 */

import { BIOMES } from './world.map';
import type { Biome } from './world.map';
import { BATTLE_LOOT_RESOURCE } from '../digimon/battle';
import type { Difficulty } from '../digimon/battle';
import type { Rng } from '../digimon/rng';

/**
 * A wild species that can appear in a biome. `enemyId` MUST be a real
 * {@link ENEMY_ROSTER} id so the encounter routes into the existing battle flow; `name`
 * is the display label (may differ from the roster's canonical name for flavour, but
 * here mirrors it). Validated against the roster by the pure spec.
 */
export interface EncounterSpecies {
  name: string;
  enemyId: string;
}

interface SpawnTable {
  /** Probability in `[0,1]` that a step in this biome surfaces an encounter. */
  chance: number;
  /** The pool an encounter draws from (uniformly, via the injected `pick`). */
  species: readonly EncounterSpecies[];
}

// The two shipped roster foes, referenced by their canonical ids so a rename in
// battle.ts surfaces here as a type/spec failure rather than a silent drift.
const NUMEMON: EncounterSpecies = { name: 'Numemon', enemyId: 'numemon' };
const KUWAGAMON: EncounterSpecies = { name: 'Kuwagamon', enemyId: 'kuwagamon' };
// TASK-254 (R-29 wild-wiring follow-on) — the Tamers trio, now WILD-encounterable. Each is
// wired into the ONE biome affine to its element: Guilmon (Fire) → mountain, Renamon
// (Neutral/Data) → forest, Terriermon (Nature) → swamp. `enemyId` MUST be a real
// ENEMY_ROSTER id (battle.ts) so the roll routes into the shipped POST /digimon/:id/battle
// flow — the encounter.spec referential-integrity test enforces this.
const GUILMON: EncounterSpecies = { name: 'Guilmon', enemyId: 'guilmon' };
const RENAMON: EncounterSpecies = { name: 'Renamon', enemyId: 'renamon' };
const TERRIERMON: EncounterSpecies = { name: 'Terriermon', enemyId: 'terriermon' };
// TASK-310 (R-19 / R-17c-R-8 enemy-side carved child) — the FIRST higher-tier wild enemy,
// Greymon (a genuine Champion-class stat block strictly above the prior roster cap; see
// ENEMY_ROSTER in battle.ts). Wired into the ONE biome affine to its Fire element: mountain
// (the same biome Guilmon(Fire) uses). `enemyId` MUST be a real ENEMY_ROSTER id (battle.ts)
// so the roll routes into the shipped POST /digimon/:id/battle flow — the encounter.spec
// referential-integrity test enforces this. Appended LAST in the biome's species[] so the
// indexed-pick fixtures (which read species[] dynamically) stay green (the TASK-254 precedent).
const GREYMON: EncounterSpecies = { name: 'Greymon', enemyId: 'greymon' };
// TASK-311 (D-655 / A-293) — the SECOND enemy-side slice, a BATCH per the L-220 sterile-clone
// watch: the FIRST two Ultimate-class wild foes. MetalGreymon (Fire) → desert, MegaSeadramon
// (Water) → snow — two biomes that today field ONLY Numemon, so each gains a genuine higher-tier
// foe. `enemyId` MUST be a real ENEMY_ROSTER id (battle.ts) so the roll routes into the shipped
// POST /digimon/:id/battle flow — the encounter.spec referential-integrity test enforces this.
// Appended LAST in each biome's species[] so the indexed-pick fixtures (which read species[]
// dynamically) stay green (the TASK-254/TASK-310 precedent).
const METALGREYMON: EncounterSpecies = { name: 'MetalGreymon', enemyId: 'metalgreymon' };
const MEGASEADRAMON: EncounterSpecies = { name: 'MegaSeadramon', enemyId: 'megaseadramon' };

/**
 * Per-biome spawn tables. Chances sit in a plausible 0.10–0.20 band; `ocean` is low
 * (0.05) because it is impassable anyway (you cannot walk there to trigger a step), but
 * the entry is total so `rollEncounter` is defined for every {@link Biome}. Forest is the
 * densest wilderness; the weaker Numemon dominates most biomes with the tougher Kuwagamon
 * appearing in the wilder forest/mountain/swamp.
 *
 * `satisfies Record<Biome, SpawnTable>` proves at COMPILE time that EVERY biome has a
 * table (a missing biome is a build error), which the pure spec double-checks at runtime.
 */
export const SPAWN_TABLES = {
  forest: { chance: 0.2, species: [NUMEMON, KUWAGAMON, RENAMON] },
  ocean: { chance: 0.05, species: [NUMEMON] },
  desert: { chance: 0.12, species: [NUMEMON, METALGREYMON] },
  snow: { chance: 0.15, species: [NUMEMON, MEGASEADRAMON] },
  mountain: { chance: 0.18, species: [NUMEMON, KUWAGAMON, GUILMON, GREYMON] },
  swamp: { chance: 0.16, species: [NUMEMON, KUWAGAMON, TERRIERMON] },
  barren: { chance: 0.1, species: [NUMEMON] },
} as const satisfies Record<Biome, SpawnTable>;

/**
 * Decide the wild encounter (if any) for a step in `biome`, given two INJECTED `[0,1)`
 * values. PURE + DETERMINISTIC:
 *  - `roll >= chance` → `null` (no encounter this step).
 *  - else the species at `floor(pick * species.length)` (uniform pick over the pool;
 *    `pick` clamped defensively so `pick === 1` never indexes off the end).
 *
 * The RNG-injected shape is what makes the rule unit-testable with exact boundary values
 * (`roll` just below/above `chance`, `pick` at each bucket edge) — the server owns the
 * actual randomness at the boundary.
 */
export function rollEncounter(biome: Biome, roll: number, pick: number): EncounterSpecies | null {
  const table = SPAWN_TABLES[biome];
  if (roll >= table.chance) return null;
  const clampedPick = pick < 0 ? 0 : pick >= 1 ? 0.999999 : pick;
  const index = Math.floor(clampedPick * table.species.length);
  return table.species[index];
}

/**
 * TASK-273 (R-44a — multi-enemy encounter groups): the per-biome CAP on how many wild enemies a
 * single encounter can field at once. Slice 44's team-battle engine made the ENEMY side an ordered
 * list; this DATA closes the loop so a wild encounter in the wilder biomes can surface a small GROUP
 * of 2 distinct foes, while the safe/home edges stay 1v1.
 *
 * PURE + DETERMINISTIC + RNG-free: a total literal map (NOT a combat rule). `satisfies
 * Record<Biome, number>` proves at COMPILE time the mapping is TOTAL over the 7-label `Biome` union,
 * so a new biome is a build error rather than a silent gap. Capped at 2 this slice (the group cap is
 * a two-way-door DATA choice, trivially re-tuned; NO raise past 2 per the task scope). The gradient
 * mirrors `BIOME_DIFFICULTY`/`BIOME_ENEMY_SCALE`'s danger intuition: safe edges (forest/ocean) and
 * the sparse mid biomes stay 1; the wildest biomes (mountain/swamp) — where the tougher Kuwagamon
 * also spawns — can field a PACK of 2.
 *
 * IDENTITY ANCHOR (invariant 5): a biome capped at 1 rolls a length-1 group = today's single
 * encounter byte-for-byte; the whole feature collapses cleanly to the 1v1 path where the cap is 1.
 */
const BIOME_MAX_GROUP = {
  forest: 1,
  ocean: 1,
  desert: 1,
  snow: 1,
  barren: 1,
  mountain: 2,
  swamp: 2,
} as const satisfies Record<Biome, number>;

export function maxGroupForBiome(biome: Biome): number {
  return BIOME_MAX_GROUP[biome];
}

/**
 * TASK-273 (R-44a) — decide the wild encounter GROUP (an ordered list of 1..min(2, biomeCap) DISTINCT
 * species) for a step in `biome`, given THREE injected `[0,1)` values. The symmetric group sibling of
 * {@link rollEncounter}: the SAME `roll`/`chance` gate decides IF an encounter happens; the SAME
 * `pick` chooses the FRONT species; the NEW `sizeRoll` decides whether a SECOND distinct enemy joins.
 * PURE + DETERMINISTIC + RNG-free (the server owns the randomness at the boundary).
 *
 *  - `roll >= chance` → `[]` (no encounter this step — the empty roll, mirror of `rollEncounter`'s
 *    `null`).
 *  - else the front species at `floor(pick * species.length)` (identical to `rollEncounter`), then —
 *    when the biome cap is ≥2, the pool has ≥2 species, AND `sizeRoll >= 0.5` (a 50% pack chance) — a
 *    SECOND DISTINCT species (the next distinct pool entry after the front, cycling so it is never the
 *    front). A pool of one species, a cap of 1, or a low `sizeRoll` yields a length-1 group.
 *
 * IDENTITY: a length-1 group's `[0]` is EXACTLY `rollEncounter(biome, roll, pick)` (the same front
 * species / the same empty gate), so the single-species path is byte-for-byte today's encounter.
 */
export function rollEncounterGroup(
  biome: Biome,
  roll: number,
  pick: number,
  sizeRoll: number,
): EncounterSpecies[] {
  const front = rollEncounter(biome, roll, pick);
  if (front === null) return [];
  const table = SPAWN_TABLES[biome];
  const cap = maxGroupForBiome(biome);
  const distinct = dedupeById(table.species);
  // A second distinct enemy joins only when the biome allows a pack (cap ≥ 2), the biome actually has
  // ≥ 2 distinct species, and the pack roll fires (>= 0.5 → a 50% chance). Deterministic in sizeRoll.
  if (cap >= 2 && distinct.length >= 2 && sizeRoll >= 0.5) {
    const frontIndex = distinct.findIndex((s) => s.enemyId === front.enemyId);
    // The next DISTINCT species after the front (cycling), so the pair is always two different foes.
    const second = distinct[(frontIndex + 1) % distinct.length];
    return [front, second];
  }
  return [front];
}

/** Reduce a species pool to its DISTINCT entries by `enemyId`, preserving first-seen order. */
function dedupeById(species: readonly EncounterSpecies[]): EncounterSpecies[] {
  const seen = new Set<string>();
  const out: EncounterSpecies[] = [];
  for (const s of species) {
    if (seen.has(s.enemyId)) continue;
    seen.add(s.enemyId);
    out.push(s);
  }
  return out;
}

/**
 * TASK-167 (R-22 slice 28) — map a biome to the interactive-combat {@link Difficulty}
 * the shipped enemy-AI DISPATCH (`chooserForDifficulty`, TASK-165/166) already understands.
 * This LINKS the map's danger to the enemy's SMARTNESS: a wild foe in a dangerous biome
 * opens the fight against the full `chooseSkillBanking` chain (`'hard'`), a mid biome
 * against the finisher-only `'normal'`, a safe biome against the flat `'easy'` AI that
 * trades into its own death.
 *
 * PURE + DETERMINISTIC + RNG-free: a total literal map (NOT a combat rule — `battle.ts`
 * is byte-frozen; this adds ZERO engine code). `satisfies Record<Biome, Difficulty>`
 * proves at COMPILE time the mapping is TOTAL over the 7-label `Biome` union, so a new
 * biome is a build error rather than a silent gap. The assignment mirrors the spawn
 * table's danger intuition (forest/ocean are safe wilderness edges; mountain/swamp are
 * the wildest, where the tougher Kuwagamon also spawns) — A-149.
 */
const BIOME_DIFFICULTY = {
  forest: 'easy',
  ocean: 'easy',
  desert: 'normal',
  snow: 'normal',
  barren: 'normal',
  mountain: 'hard',
  swamp: 'hard',
} as const satisfies Record<Biome, Difficulty>;

export function difficultyForBiome(biome: Biome): Difficulty {
  return BIOME_DIFFICULTY[biome];
}

/**
 * TASK-168 (R-22 slice 29) — map a biome to a wild-enemy STRENGTH SCALE. Slice 28's
 * `difficultyForBiome` linked the world's danger to the enemy's SMARTNESS (which AI runs);
 * this SECOND cross-system axis links it to the enemy's raw POWER: a wild foe in a dangerous
 * biome opens the interactive fight with visibly MORE HP and a HARDER hit (its stat block is
 * multiplied ONCE, before the fight, by this factor — see `scaleEnemy` in `battle.ts`), while
 * a safe-biome foe fights the byte-identical baseline block.
 *
 * PURE + DETERMINISTIC + RNG-free: a total literal map (NOT a combat rule — `battle.ts`'s
 * round loop is untouched; this scales the INPUT stat block, not a rule). `satisfies
 * Record<Biome, number>` proves at COMPILE time the mapping is TOTAL over the 7-label `Biome`
 * union, so a new biome is a build error rather than a silent gap.
 *
 * HARD RULES (A-150, A-42): every value is `>= 1` so scaling only makes the foe TOUGHER,
 * never weaker (the round loop still only DECREASES HP — a bigger START is not a mid-fight
 * heal); the SAFE biomes return EXACTLY `1.0` so a low-danger encounter is byte-identical to
 * today (the `scale === 1` identity guard in `scaleEnemy` then returns the roster block
 * verbatim). The gradient mirrors `BIOME_DIFFICULTY`'s danger intuition (forest/ocean safe →
 * 1.0; desert/snow/barren mid → 1.25; mountain/swamp wildest → 1.5).
 */
const BIOME_ENEMY_SCALE = {
  forest: 1.0,
  ocean: 1.0,
  desert: 1.25,
  snow: 1.25,
  barren: 1.25,
  mountain: 1.5,
  swamp: 1.5,
} as const satisfies Record<Biome, number>;

export function enemyScaleForBiome(biome: Biome): number {
  return BIOME_ENEMY_SCALE[biome];
}

/**
 * TASK-169 (R-22 slice 30) — a map-POSITION term on the wild-enemy strength scale. Slices
 * 28/29 keyed the enemy's smartness AND raw power on the biome LABEL only, so the tile's
 * GEOGRAPHY was still cosmetic to combat: a `swamp` one step outside the safe city and a
 * `swamp` 40 tiles into the deep wilderness spawned the IDENTICAL foe. This folds the pure,
 * already-tested `distanceToNearestCity` primitive into the scale so the farther a player
 * roams from home, the tougher the wild foe they meet.
 *
 * PURE + DETERMINISTIC + RNG-free (no engine import, no React, no Math.random). A
 * monotonically-NON-DECREASING STEP function, every value `>= 1.0` (A-42: a foe never gets
 * weaker), with an IDENTITY FLOOR near the city (`d < 15 → 1.0`) so a near-city encounter is
 * BYTE-UNCHANGED from slice 29 (the world `enemyScale` for the home region is unchanged, the
 * `scale === 1` identity guard in `scaleEnemy` still returns the roster block verbatim). The
 * bands are a two-way-door DATA choice (A-151), trivially re-tuned: safe home region (identity),
 * a mid ring, then the deep wilderness beyond `MIN_SPAWN_DISTANCE` (30).
 */
export function distanceScaleForTile(distanceToCity: number): number {
  if (distanceToCity < 15) return 1.0;
  if (distanceToCity < 30) return 1.15;
  return 1.3;
}

/**
 * TASK-169 — the combinator: COMPOUND the biome baseline (slice 29) with the distance term
 * (slice 30) into the single wild-enemy strength scale carried on the shipped `enemyScale?`
 * field. Rounded to 2 decimals so it stays a clean finite number `>= 1` for the DTO's
 * `@Min(1)` guard and the display-only `Danger ×N` banner.
 *
 * Because both factors are `>= 1`, so is the product; because `distanceScaleForTile` has a
 * near-city identity floor of `1.0`, a near-city tile yields EXACTLY `enemyScaleForBiome(biome)`
 * (the identity-floor byte-proof — a near-city encounter is unchanged from slice 29), while a
 * far tile is strictly greater. PURE + DETERMINISTIC + RNG-free.
 */
/**
 * TASK-170 (R-22 slice 31) — a PLAYER-PROGRESSION term on the wild-enemy strength scale.
 * Slices 29/30 keyed the enemy's raw power on the MAP alone (biome + distance from the
 * safe city), so a level-1 starter and a fully-levelled veteran met the byte-identical foe
 * on the same tile. This adds the RPG "level-appropriate encounter" backbone the map axes
 * cannot express: the wild foe scales with the PLAYER'S OWN team level, so venturing out
 * stays a real fight as the player's Digimon grow.
 *
 * PURE + DETERMINISTIC + RNG-free (no engine import, no React, no Math.random). Monotonically
 * NON-DECREASING in `teamLevel`, every value `>= 1.0` (A-42: a foe never gets weaker), with an
 * IDENTITY FLOOR at the beginner baseline: a level-1 solo starter (`teamLevel === 1`) returns
 * EXACTLY `1.0`, so today's early-game encounters are BYTE-UNCHANGED (the `scale === 1`
 * identity guard in `scaleEnemy` still returns the roster block verbatim). A small per-level
 * step with a cap keeps the number clean, finite and bounded (a deep-wilderness high-level
 * fight stays winnable — Flee is live). The band shape is a two-way-door DATA choice (A-152),
 * trivially re-tuned.
 */
const PLAYER_LEVEL_SCALE_STEP = 0.05;
const PLAYER_LEVEL_SCALE_CAP = 2.0;

export function playerLevelScale(teamLevel: number): number {
  const levelsAboveStart = Math.max(0, teamLevel - 1);
  const raw = 1 + levelsAboveStart * PLAYER_LEVEL_SCALE_STEP;
  return Math.min(raw, PLAYER_LEVEL_SCALE_CAP);
}

/**
 * TASK-170 — reduce a player's roster to a single representative team level. Uses the MAX
 * level so a single strong Digimon is felt (a levelled veteran is not diluted by fresh
 * additions), and so a level-1 solo starter — and an EMPTY roster — yield exactly `1`, the
 * identity that keeps `playerLevelScale` at its byte-proof floor. PURE + total + deterministic.
 */
export function teamLevel(roster: readonly { level: number }[]): number {
  let max = 1;
  for (const member of roster) {
    if (member.level > max) max = member.level;
  }
  return max;
}

/**
 * TASK-169 + TASK-170 — the combinator: COMPOUND the biome baseline (slice 29), the distance
 * term (slice 30) AND the player's team-level term (slice 31) into the single wild-enemy
 * strength scale carried on the shipped `enemyScale?` field. Rounded to 2 decimals so it
 * stays a clean finite number `>= 1` for the DTO's `@Min(1)` guard and the display-only
 * `Danger ×N` banner.
 *
 * `teamLevel` is a BACK-COMPAT DEFAULT of `1` so every existing caller/test compiles
 * unchanged and, at the default, multiplies by exactly `playerLevelScale(1) === 1.0` — the
 * identity byte-proof that slices 29/30's fixtures stay verbatim. Because every factor is
 * `>= 1`, so is the product; a near-city beginner tile yields EXACTLY `enemyScaleForBiome(biome)`,
 * a far/high-level tile is strictly greater. PURE + DETERMINISTIC + RNG-free.
 */
export function wildEnemyScale(biome: Biome, distanceToCity: number, teamLevel = 1): number {
  const raw =
    enemyScaleForBiome(biome) * distanceScaleForTile(distanceToCity) * playerLevelScale(teamLevel);
  return Math.round(raw * 100) / 100;
}

/**
 * TASK-174 (R-22 slice 35) — map a biome to the SPENDABLE resource its wild wins DROP.
 * Slices 28/29 keyed the enemy's SMARTNESS and raw POWER on the biome; slice 34 gave the
 * interactive WIN its first economic reward (a danger-scaled DigiCredits credit). This adds
 * the FIRST biome → economy-KIND cross-system LINK: a win's loot RESOURCE now depends on the
 * biome you won it in — the RPG "different zones drop different materials" backbone, and the
 * first step toward loot tiers/rarity. Only the KIND varies here; the AMOUNT
 * (`battleLootAmount`) is untouched and still scales with danger (slice 34).
 *
 * PURE + DETERMINISTIC + RNG-free: a total literal map (NOT a combat rule — `battle.ts`'s
 * loot AMOUNT + round loop are byte-frozen; this only picks WHICH free-form resource string
 * is credited, in the world domain). `satisfies Record<Biome, string>` proves at COMPILE time
 * the mapping is TOTAL over the 7-label `Biome` union, so a new biome is a build error rather
 * than a silent gap.
 *
 * IDENTITY ANCHOR (invariant 5): safe/home biomes (forest/ocean — the same low-danger edges
 * that map to `easy`/`1.0` above) return EXACTLY `BATTLE_LOOT_RESOURCE` (imported from
 * `battle.ts`, NOT re-typed), so a safe-biome win banks the byte-identical resource slice 34
 * shipped — its `ResourceBalance`/`AuditLog`/`reward.loot` shape and value are unchanged. The
 * distinctive biomes map to thematically-flavoured spendable strings (a two-way-door DATA
 * choice, A-156: trivially re-tuned; each is a free-form resource string, NO migration).
 */
const BIOME_LOOT_RESOURCE = {
  forest: BATTLE_LOOT_RESOURCE,
  ocean: BATTLE_LOOT_RESOURCE,
  desert: 'SunScale',
  snow: 'FrostShard',
  barren: 'ScrapMetal',
  mountain: 'EmberShard',
  swamp: 'AquaPearl',
} as const satisfies Record<Biome, string>;

export function lootResourceForBiome(biome: Biome): string {
  return BIOME_LOOT_RESOURCE[biome];
}

/**
 * TASK-178 (R-22 slice 39) — the WEIGHTED per-drop loot TABLE. Slice 35 keyed a win's
 * loot RESOURCE on the biome via a single FIXED value (`lootResourceForBiome`), so a
 * `mountain` win ALWAYS paid `EmberShard`, a `desert` win ALWAYS `SunScale` — the drop
 * never surprised. Now that slice 38 (`LIVE_RNG`) turned on real per-player entropy at
 * the HTTP boundary, this replaces the fixed lookup with a biome-anchored WEIGHTED DRAW
 * through the SAME injected-RNG seam the win reward already carries, so which item you
 * get actually VARIES per fight — the RPG loot-table backbone.
 *
 * PURE + DETERMINISTIC + RNG-free (the ONLY entropy is the injected `rng: Rng`; NO
 * `Math.random` inside — the world domain, like `battle.ts`, stays framework-free and
 * its executable `Math.random` count STAYS 0). `satisfies Record<Biome, …>` proves at
 * COMPILE time the table is TOTAL over the 7-label `Biome` union — a new biome is a
 * build error, never a silent gap.
 *
 * LOAD-BEARING (invariant-5 identity byte-proof, `add-injected-rng-combat-roll`): each
 * biome's FIRST entry MUST be its PRIMARY resource `= lootResourceForBiome(biome)` and
 * owns the cumulative bucket `[0, w0)`, so a low roll — in particular `rng() === 0` (=
 * `DEFAULT_RNG`, the auto / PvP / explore / no-biome / loss paths) — DRAWS THE PRIMARY
 * VERBATIM. The auto/production-default reward shapes + all ~646 pinned fixtures stay
 * byte-frozen with NO re-pin. The secondary entries (a two-way-door DATA choice, A-160:
 * trivially re-tuned; each a free-form resource string → a valid `ResourceBalance` row,
 * NO migration) only surface on higher rolls, so the drop KIND now varies for a real
 * `LIVE_RNG`-fed player. Weights per biome sum to 1.0 for readability (the walk divides
 * by the actual total, so exact sums are not required).
 */
const BIOME_LOOT_TABLE = {
  // Safe/home edges (forest/ocean) keep the shipped primary dominant, adding a modest
  // secondary chance so even a low-danger win can occasionally surprise.
  forest: [[BATTLE_LOOT_RESOURCE, 0.75], ['Herb', 0.25]],
  ocean: [[BATTLE_LOOT_RESOURCE, 0.75], ['PearlDust', 0.25]],
  desert: [['SunScale', 0.7], ['CactusSap', 0.3]],
  snow: [['FrostShard', 0.7], ['IcePetal', 0.3]],
  barren: [['ScrapMetal', 0.7], ['RustFlake', 0.3]],
  mountain: [['EmberShard', 0.65], ['ObsidianChip', 0.25], ['MagmaCore', 0.1]],
  swamp: [['AquaPearl', 0.65], ['BogMoss', 0.25], ['VenomSac', 0.1]],
} as const satisfies Record<Biome, ReadonlyArray<readonly [string, number]>>;

/**
 * TASK-178 — draw the win's loot RESOURCE from `biome`'s weighted table via a SINGLE
 * injected `rng()` draw (L-58 multi-draw footgun avoided: exactly one draw). Walks the
 * table by cumulative weight: the roll `r = rng() * total` lands in the first bucket
 * `[0, w0)` whenever `r < w0`, so at `rng() === 0` (`DEFAULT_RNG`) it returns the
 * PRIMARY (first) entry verbatim — the invariant-5 identity anchor (asserted in the
 * spec that `table[0] === lootResourceForBiome(biome)`). A high roll reaches the later
 * buckets, so the KIND varies. Total + deterministic; the final `?? primary` guards
 * against any float-edge fallthrough so it can never return `undefined`.
 */
export function rollLootResource(biome: Biome, rng: Rng): string {
  const table = BIOME_LOOT_TABLE[biome];
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  const r = rng() * total;
  let cumulative = 0;
  for (const [resource, weight] of table) {
    cumulative += weight;
    if (r < cumulative) return resource;
  }
  return table[0][0];
}

/**
 * TASK-175 (R-22 slice 36) — map a biome to the RARITY TIER its wild wins DROP.
 * Slice 34 gave loot its danger-scaled AMOUNT; slice 35 gave it a biome-keyed KIND
 * (`lootResourceForBiome`). This adds the orthogonal QUALITY dimension: a win's loot now
 * carries a display-only rarity tier that TRACKS the shipped danger ladder — the RPG
 * "harder zones drop rarer loot" backbone and the first step toward a full loot-table
 * rarity system.
 *
 * PURE + DETERMINISTIC + RNG-free: a total literal map (NOT a combat rule — `battle.ts`'s
 * loot AMOUNT + resource + round loop are byte-frozen; this only derives a DISPLAY string,
 * in the world domain). `satisfies Record<Biome, string>` proves at COMPILE time the mapping
 * is TOTAL over the 7-label `Biome` union, so a new biome is a build error rather than a
 * silent gap.
 *
 * The tiers line up with `BIOME_ENEMY_SCALE`/`BIOME_DIFFICULTY` so the SAME biomes that are
 * harder / scale higher also drop rarer loot (the ladder AGREES on ordering):
 *   safe/home (forest/ocean — `enemyScale` 1.0, `difficulty:'easy'`)      → 'Common'  (the
 *     IDENTITY ANCHOR: a safe/home/no-biome win reports the same baseline tier an un-tiered
 *     slice-35 drop implicitly had, so invariant 5 is a mechanical byte-proof);
 *   mid (desert/snow/barren — `enemyScale` 1.25, `difficulty:'normal'`)   → 'Uncommon';
 *   wildest (mountain/swamp — `enemyScale` 1.5, `difficulty:'hard'`)      → 'Rare'.
 * Rarity is DISPLAY-ONLY (not credited/audited/persisted, mirroring the `baseXp?`/`scaleBonus?`
 * precedent, L-70), so NO migration — a two-way-door DATA choice (A-157), trivially re-tuned.
 */
const BIOME_LOOT_RARITY = {
  forest: 'Common',
  ocean: 'Common',
  desert: 'Uncommon',
  snow: 'Uncommon',
  barren: 'Uncommon',
  mountain: 'Rare',
  swamp: 'Rare',
} as const satisfies Record<Biome, string>;

export function lootRarityForBiome(biome: Biome): string {
  return BIOME_LOOT_RARITY[biome];
}

// Re-export BIOMES for callers that want to iterate/validate the table (kept local so
// consumers of the encounter rules need not reach into world.map for the biome list).
export { BIOMES };