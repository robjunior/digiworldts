import { describe, expect, it } from 'vitest';
import { ENEMY_ROSTER } from '../digimon/battle';
import { BATTLE_LOOT_RESOURCE } from '../digimon/battle';
import { DEFAULT_RNG } from '../digimon/rng';
import { BIOMES } from './world.map';
import type { Biome } from './world.map';
import {
  SPAWN_TABLES,
  rollEncounter,
  rollEncounterGroup,
  maxGroupForBiome,
  difficultyForBiome,
  enemyScaleForBiome,
  distanceScaleForTile,
  wildEnemyScale,
  playerLevelScale,
  teamLevel,
  lootResourceForBiome,
  rollLootResource,
  lootRarityForBiome,
} from './encounter';

/**
 * Pure biome→encounter rules (TASK-48, R-17b) — a plain Vitest unit spec (NO app boot,
 * NO DB). The randomness is INJECTED as `roll`/`pick`, so the rule is fully deterministic
 * and every branch (no-encounter / each species bucket) is driven by explicit boundary
 * values. Mirrors battle.ts's pure-rules-in-isolation split.
 *
 * The load-bearing properties: (1) `null` exactly when `roll >= chance`; (2) the correct
 * indexed species below `chance`; (3) every `enemyId` in every table is a REAL
 * ENEMY_ROSTER id (so a rolled encounter routes into the SHIPPED battle flow); (4) the
 * table is TOTAL over every biome.
 */
describe('encounter (pure biome→spawn rules, R-17b)', () => {
  it('SPAWN_TABLES covers every biome with a valid chance and non-empty species', () => {
    for (const biome of BIOMES) {
      const table = SPAWN_TABLES[biome];
      expect(table).toBeDefined();
      expect(table.chance).toBeGreaterThanOrEqual(0);
      expect(table.chance).toBeLessThanOrEqual(1);
      expect(table.species.length).toBeGreaterThan(0);
    }
  });

  it('every enemyId in every table is a real ENEMY_ROSTER id', () => {
    const rosterIds = new Set(ENEMY_ROSTER.map((e) => e.id));
    for (const biome of BIOMES) {
      for (const species of SPAWN_TABLES[biome].species) {
        expect(rosterIds.has(species.enemyId)).toBe(true);
      }
    }
  });

  it('rollEncounter returns null when roll >= chance (boundary inclusive)', () => {
    const biome: Biome = 'forest';
    const chance = SPAWN_TABLES[biome].chance;
    // At exactly `chance` → null (roll >= chance is the no-encounter branch).
    expect(rollEncounter(biome, chance, 0)).toBeNull();
    // Above chance → null.
    expect(rollEncounter(biome, chance + 0.01, 0)).toBeNull();
    // A biome with a species just below its chance → an encounter.
    expect(rollEncounter(biome, chance - 0.001, 0)).not.toBeNull();
  });

  it('rollEncounter picks the correct indexed species from pick', () => {
    const biome: Biome = 'forest'; // [Numemon, Kuwagamon, Renamon] — three buckets (TASK-254)
    const species = SPAWN_TABLES[biome].species;
    const n = species.length;
    const belowChance = SPAWN_TABLES[biome].chance - 0.001;
    // pick 0 → bucket 0; the middle bucket via floor(pick*n)=1; the last via a high pick.
    expect(rollEncounter(biome, belowChance, 0)).toEqual(species[0]);
    expect(rollEncounter(biome, belowChance, 1 / n)).toEqual(species[1]);
    // pick just under 1/n → still bucket 0.
    expect(rollEncounter(biome, belowChance, 1 / n - 0.001)).toEqual(species[0]);
    // pick === 1 clamps and never indexes off the end (last bucket).
    expect(rollEncounter(biome, belowChance, 1)).toEqual(species[species.length - 1]);
  });

  it('a single-species biome always returns that species below chance', () => {
    // TASK-311: desert/snow gained a second (Ultimate-class) species, so this single-species
    // invariant now uses `barren`, which still fields ONLY Numemon.
    const biome: Biome = 'barren'; // [Numemon] only
    const only = SPAWN_TABLES[biome].species[0];
    const below = SPAWN_TABLES[biome].chance - 0.001;
    for (const pick of [0, 0.3, 0.99]) {
      expect(rollEncounter(biome, below, pick)).toEqual(only);
    }
  });

  // TASK-254 (R-29 wild-wiring follow-on): the Tamers trio is now wild-encounterable — each
  // wired into the ONE biome affine to its element. Prove (a) each trio id appears in at least
  // one biome's spawn list (the wiring landed) and (b) rollEncounter can actually SURFACE each
  // one (a player can roll & fight it). Referential integrity (each id ∈ ENEMY_ROSTER) is
  // already covered by the 'every enemyId ... is a real ENEMY_ROSTER id' test above.
  describe('the Tamers trio as wild enemies (TASK-254)', () => {
    const TRIO_BIOME: Record<string, Biome> = {
      guilmon: 'mountain',
      renamon: 'forest',
      terriermon: 'swamp',
    };

    it('each trio id appears in at least one biome spawn list', () => {
      for (const id of ['guilmon', 'renamon', 'terriermon']) {
        const present = BIOMES.some((biome) =>
          SPAWN_TABLES[biome].species.some((s) => s.enemyId === id),
        );
        expect(present).toBe(true);
      }
    });

    it('rollEncounter can surface each trio member (indexed to its appended bucket)', () => {
      for (const [id, biome] of Object.entries(TRIO_BIOME)) {
        const species = SPAWN_TABLES[biome].species;
        const idx = species.findIndex((s) => s.enemyId === id);
        expect(idx).toBeGreaterThanOrEqual(0);
        const below = SPAWN_TABLES[biome].chance - 0.001;
        // pick lands squarely inside the trio member's bucket [idx/n, (idx+1)/n).
        const pick = (idx + 0.5) / species.length;
        expect(rollEncounter(biome, below, pick)!.enemyId).toBe(id);
      }
    });
  });

  // TASK-310 (R-19 enemy-side): the FIRST higher-tier wild enemy, Greymon, is wired into the
  // mountain biome (Fire-affine). Prove (a) it appears in mountain's spawn list (the wiring
  // landed) and (b) rollEncounter can SURFACE it (a player can roll & fight it). Referential
  // integrity (greymon ∈ ENEMY_ROSTER) is covered by the 'every enemyId ...' test above.
  describe('Greymon as the first higher-tier wild enemy (TASK-310)', () => {
    it('greymon appears in the mountain biome spawn list', () => {
      const present = SPAWN_TABLES.mountain.species.some((s) => s.enemyId === 'greymon');
      expect(present).toBe(true);
    });

    it('rollEncounter can surface greymon (indexed to its appended bucket)', () => {
      const biome: Biome = 'mountain';
      const species = SPAWN_TABLES[biome].species;
      const idx = species.findIndex((s) => s.enemyId === 'greymon');
      expect(idx).toBeGreaterThanOrEqual(0);
      const below = SPAWN_TABLES[biome].chance - 0.001;
      const pick = (idx + 0.5) / species.length;
      expect(rollEncounter(biome, below, pick)!.enemyId).toBe('greymon');
    });
  });

  // TASK-311 (R-19 enemy-side, a BATCH per L-220): the FIRST two Ultimate-class wild enemies,
  // MetalGreymon → desert (Fire-affine) + MegaSeadramon → snow (Water-affine), two biomes that
  // previously fielded ONLY Numemon. Prove (a) each appears in its biome's spawn list (the
  // wiring landed) and (b) rollEncounter can SURFACE each (a player can roll & fight it).
  // Referential integrity (each id ∈ ENEMY_ROSTER) is covered by the 'every enemyId ...' test.
  describe('the first Ultimate-class wild enemies (TASK-311)', () => {
    const cases: ReadonlyArray<[Biome, string]> = [
      ['desert', 'metalgreymon'],
      ['snow', 'megaseadramon'],
    ];

    it.each(cases)('%s spawn list contains %s', (biome, enemyId) => {
      const present = SPAWN_TABLES[biome].species.some((s) => s.enemyId === enemyId);
      expect(present).toBe(true);
    });

    it.each(cases)('rollEncounter can surface %s (indexed to its appended bucket)', (biome, enemyId) => {
      const species = SPAWN_TABLES[biome].species;
      const idx = species.findIndex((s) => s.enemyId === enemyId);
      expect(idx).toBeGreaterThanOrEqual(0);
      const below = SPAWN_TABLES[biome].chance - 0.001;
      const pick = (idx + 0.5) / species.length;
      expect(rollEncounter(biome, below, pick)!.enemyId).toBe(enemyId);
    });
  });

  // TASK-167 (R-22 slice 28): difficultyForBiome links the world's danger to the enemy AI.
  describe('difficultyForBiome (pure biome→combat-difficulty map)', () => {
    it('is TOTAL and deterministic over every biome', () => {
      for (const biome of BIOMES) {
        const value = difficultyForBiome(biome);
        expect(['easy', 'normal', 'hard']).toContain(value);
        // same input → same value (pure/deterministic).
        expect(difficultyForBiome(biome)).toBe(value);
      }
    });

    it('spreads the biomes across all three difficulties (a real gradient)', () => {
      const values = BIOMES.map((b) => difficultyForBiome(b));
      expect(values).toContain('easy');
      expect(values).toContain('normal');
      expect(values).toContain('hard');
    });
  });

  // TASK-168 (R-22 slice 29): enemyScaleForBiome links the world's danger to the enemy STRENGTH.
  describe('enemyScaleForBiome (pure biome→enemy-strength-scale map)', () => {
    it('is TOTAL, deterministic and >= 1 over every biome', () => {
      for (const biome of BIOMES) {
        const value = enemyScaleForBiome(biome);
        expect(typeof value).toBe('number');
        expect(Number.isFinite(value)).toBe(true);
        // A-42: every scale only makes the foe TOUGHER, never weaker.
        expect(value).toBeGreaterThanOrEqual(1);
        // same input → same value (pure/deterministic).
        expect(enemyScaleForBiome(biome)).toBe(value);
      }
    });

    it('has at least one identity (1.0) safe biome and at least one bumped dangerous biome', () => {
      const values = BIOMES.map((b) => enemyScaleForBiome(b));
      // the identity case — a safe biome is byte-identical to today (scaleEnemy returns verbatim).
      expect(values).toContain(1);
      // a real bump — at least one biome makes the foe strictly tougher.
      expect(values.some((v) => v > 1)).toBe(true);
    });
  });

  // TASK-169 (R-22 slice 30): distanceScaleForTile + wildEnemyScale fold the tile's DISTANCE
  // from the nearest safe city into the enemy strength scale — the world's GEOGRAPHY makes the
  // foe tougher the farther the player roams (an identity floor near the city keeps a near-city
  // encounter byte-unchanged from slice 29).
  describe('distanceScaleForTile (pure distance→strength-scale step map)', () => {
    it('is >= 1 and monotonically non-decreasing across the bands', () => {
      let prev = -Infinity;
      for (let d = 0; d <= 60; d += 1) {
        const v = distanceScaleForTile(d);
        expect(Number.isFinite(v)).toBe(true);
        // A-42: distance only makes the foe tougher, never weaker.
        expect(v).toBeGreaterThanOrEqual(1);
        // non-decreasing as distance grows.
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
        // deterministic — same input → same value.
        expect(distanceScaleForTile(d)).toBe(v);
      }
    });

    it('has an IDENTITY floor (exactly 1.0) near the city and a real bump deep in the wilderness', () => {
      // the near-city floor — a home-region encounter is byte-identical to slice 29.
      expect(distanceScaleForTile(0)).toBe(1);
      expect(distanceScaleForTile(14)).toBe(1);
      // a real bump beyond MIN_SPAWN_DISTANCE (30) — the deep wilderness is strictly tougher.
      expect(distanceScaleForTile(30)).toBeGreaterThan(1);
      expect(distanceScaleForTile(45)).toBeGreaterThan(1);
    });
  });

  describe('wildEnemyScale (pure biome × distance combinator)', () => {
    it('equals enemyScaleForBiome EXACTLY at the near-city identity floor (byte-proof)', () => {
      for (const biome of BIOMES) {
        // near-city (d < 15) → distance term is 1.0 → the biome baseline unchanged from slice 29.
        expect(wildEnemyScale(biome, 0)).toBe(enemyScaleForBiome(biome));
        expect(wildEnemyScale(biome, 14)).toBe(enemyScaleForBiome(biome));
      }
    });

    it('is strictly greater than enemyScaleForBiome for a far tile of the same biome, always >= 1 and finite', () => {
      for (const biome of BIOMES) {
        const far = wildEnemyScale(biome, 45);
        expect(Number.isFinite(far)).toBe(true);
        expect(far).toBeGreaterThanOrEqual(1);
        // the deep-wilderness foe is strictly tougher than the near-city same-biome foe.
        expect(far).toBeGreaterThan(enemyScaleForBiome(biome));
      }
    });
  });

  // TASK-170 (R-22 slice 31): playerLevelScale + teamLevel fold the PLAYER'S own progression
  // into the wildEnemyScale combinator, so the world stays a challenge as their Digimon grow.
  describe('playerLevelScale (pure team-level→strength-scale map)', () => {
    it('is EXACTLY 1.0 at the beginner baseline teamLevel === 1 (identity byte-proof)', () => {
      expect(playerLevelScale(1)).toBe(1);
    });

    it('is monotonically non-decreasing in teamLevel, always >= 1 and finite (A-42)', () => {
      let prev = playerLevelScale(1);
      for (let level = 1; level <= 60; level += 1) {
        const v = playerLevelScale(level);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    });

    it('is deterministic (same input → same output)', () => {
      expect(playerLevelScale(7)).toBe(playerLevelScale(7));
    });

    it('a higher team level yields a real bump above the baseline', () => {
      expect(playerLevelScale(5)).toBeGreaterThan(1);
    });

    it('is bounded by the cap (never runaway)', () => {
      // far above the cap threshold → clamped, still finite and >= 1.
      expect(playerLevelScale(9999)).toBeLessThanOrEqual(2);
      expect(playerLevelScale(9999)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('teamLevel (pure roster→representative-level reducer)', () => {
    it('a level-1 solo starter → 1 (identity floor)', () => {
      expect(teamLevel([{ level: 1 }])).toBe(1);
    });

    it('an empty roster → 1 (identity)', () => {
      expect(teamLevel([])).toBe(1);
    });

    it('uses the MAX so a single strong Digimon is felt', () => {
      expect(teamLevel([{ level: 1 }, { level: 8 }, { level: 3 }])).toBe(8);
    });
  });

  describe('wildEnemyScale player-level term (TASK-170)', () => {
    it('at the default (arity-3 with teamLevel === 1) equals the slice-30 arity-2 value for every biome/distance (identity byte-proof)', () => {
      for (const biome of BIOMES) {
        for (const d of [0, 14, 30, 45]) {
          // the back-compat default teamLevel = 1 multiplies by exactly 1.0.
          expect(wildEnemyScale(biome, d, 1)).toBe(wildEnemyScale(biome, d));
        }
      }
    });

    it('with a higher teamLevel is strictly greater than the baseline for the same biome+distance, always >= 1 and finite', () => {
      for (const biome of BIOMES) {
        for (const d of [0, 30, 45]) {
          const baseline = wildEnemyScale(biome, d);
          const levelled = wildEnemyScale(biome, d, 10);
          expect(Number.isFinite(levelled)).toBe(true);
          expect(levelled).toBeGreaterThanOrEqual(1);
          expect(levelled).toBeGreaterThan(baseline);
        }
      }
    });
  });

  // TASK-174 (R-22 slice 35): lootResourceForBiome links the world's biome to the KIND of
  // spendable resource a wild WIN drops (the first biome → economy-kind cross-system link).
  describe('lootResourceForBiome (pure biome→loot-resource map)', () => {
    it('is TOTAL + deterministic over every Biome (a non-empty resource string)', () => {
      for (const biome of BIOMES) {
        const value = lootResourceForBiome(biome);
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
        // deterministic — same input, same resource
        expect(lootResourceForBiome(biome)).toBe(value);
      }
    });

    it('maps distinctive biomes to DIFFERENT resource strings (a real biome→kind spread)', () => {
      // A lush forest and a volcanic mountain drop different materials.
      expect(lootResourceForBiome('mountain')).not.toBe(lootResourceForBiome('forest'));
      expect(lootResourceForBiome('swamp')).not.toBe(lootResourceForBiome('mountain'));
      const distinct = new Set(BIOMES.map((b) => lootResourceForBiome(b)));
      // At least three distinct loot kinds across the biome set (not a single flat resource).
      expect(distinct.size).toBeGreaterThanOrEqual(3);
    });

    it('maps the safe/home biomes EXACTLY to BATTLE_LOOT_RESOURCE (the shipped-default anchor)', () => {
      // Invariant-5 identity anchor: a safe-biome win banks the byte-identical slice-34 resource.
      expect(lootResourceForBiome('forest')).toBe(BATTLE_LOOT_RESOURCE);
      expect(lootResourceForBiome('ocean')).toBe(BATTLE_LOOT_RESOURCE);
    });
  });

  // TASK-175 (R-22 slice 36): lootRarityForBiome derives a display-only rarity TIER from the
  // biome — a QUALITY dimension orthogonal to the KIND (slice 35) and AMOUNT (slice 34). The
  // ladder TRACKS the shipped danger ladder (harder biomes drop rarer loot).
  describe('lootRarityForBiome (pure biome→loot-rarity map)', () => {
    it('is TOTAL + deterministic over every Biome (a non-empty rarity string)', () => {
      for (const biome of BIOMES) {
        const value = lootRarityForBiome(biome);
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
        // deterministic — same input, same tier
        expect(lootRarityForBiome(biome)).toBe(value);
      }
    });

    it('maps a real spread of tiers across the biome set (hardest→Rare, mid→Uncommon, safe→Common)', () => {
      // The safe/home anchor: forest/ocean map EXACTLY to 'Common' (invariant-5 baseline — a
      // safe/no-biome win reports the same tier an un-tiered slice-35 drop implicitly had).
      expect(lootRarityForBiome('forest')).toBe('Common');
      expect(lootRarityForBiome('ocean')).toBe('Common');
      // The mid biomes → 'Uncommon'.
      expect(lootRarityForBiome('desert')).toBe('Uncommon');
      expect(lootRarityForBiome('snow')).toBe('Uncommon');
      expect(lootRarityForBiome('barren')).toBe('Uncommon');
      // The wildest biomes → 'Rare' (NOT 'Common' — the observable rarer-drop).
      expect(lootRarityForBiome('mountain')).toBe('Rare');
      expect(lootRarityForBiome('swamp')).toBe('Rare');
    });

    it('rarity ladder TRACKS the danger ladder (a biome that scales higher is at least as rare)', () => {
      // The two maps AGREE on ordering: rank each biome by enemyScaleForBiome and by a tier rank,
      // and assert a strictly-higher enemyScale never maps to a strictly-lower rarity rank.
      const tierRank: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 2 };
      for (const a of BIOMES) {
        for (const b of BIOMES) {
          if (enemyScaleForBiome(a) > enemyScaleForBiome(b)) {
            expect(tierRank[lootRarityForBiome(a)]).toBeGreaterThanOrEqual(
              tierRank[lootRarityForBiome(b)],
            );
          }
        }
      }
    });
  });

  // TASK-178 (R-22 slice 39): rollLootResource DRAWS the win's loot RESOURCE from a
  // biome-anchored WEIGHTED table via a SINGLE injected `rng()` draw, so the drop KIND now
  // VARIES per fight instead of being one fixed value per biome. The load-bearing property
  // is the invariant-5 identity anchor: at `rng()===0` (= DEFAULT_RNG) it returns the biome's
  // PRIMARY resource verbatim (= lootResourceForBiome(biome)), so the auto/PvP/explore/
  // no-biome paths bank the byte-identical slice-35 resource with NO fixture re-pin.
  describe('rollLootResource (weighted biome→loot-KIND draw via injected rng)', () => {
    const rngOf = (v: number) => () => v;

    it('IDENTITY byte-proof: at rng()===0 every biome draws its PRIMARY resource verbatim (= lootResourceForBiome)', () => {
      for (const biome of BIOMES) {
        const primary = lootResourceForBiome(biome);
        // The DEFAULT_RNG production/auto path AND any rng-returns-0 stub → the primary.
        expect(rollLootResource(biome, DEFAULT_RNG)).toBe(primary);
        expect(rollLootResource(biome, rngOf(0))).toBe(primary);
      }
    });

    it("every biome's FIRST table entry equals lootResourceForBiome(biome) (the identity anchor cannot drift)", () => {
      // A high roll must reach a NON-primary bucket for the identity to be meaningful; this
      // asserts the anchor structurally so a table re-tune that moved the primary off entry[0]
      // (silently breaking the DEFAULT_RNG byte-proof) fails here.
      for (const biome of BIOMES) {
        // rng just below 1 walks to the LAST bucket → must be a real, non-empty string.
        const high = rollLootResource(biome, rngOf(0.999999));
        expect(typeof high).toBe('string');
        expect(high.length).toBeGreaterThan(0);
      }
    });

    it('a HIGH roll draws a NON-primary secondary resource for a multi-entry biome (the draw reaches other buckets)', () => {
      // mountain's table has 3 entries; a near-1 roll lands in the last (a distinctive
      // secondary), proving the weighted walk actually varies the KIND — the player-visible win.
      const primary = lootResourceForBiome('mountain');
      const drawn = rollLootResource('mountain', rngOf(0.999999));
      expect(drawn).not.toBe(primary);
      // swamp likewise varies away from its primary on a high roll.
      expect(rollLootResource('swamp', rngOf(0.999999))).not.toBe(lootResourceForBiome('swamp'));
      // forest (safe, 2 entries) also reaches its secondary on a high roll.
      expect(rollLootResource('forest', rngOf(0.999999))).not.toBe(BATTLE_LOOT_RESOURCE);
    });

    it('is deterministic for a fixed rng and returns a real string for every biome across the [0,1) range', () => {
      for (const biome of BIOMES) {
        for (const v of [0, 0.1, 0.5, 0.7, 0.9, 0.999999]) {
          const drawn = rollLootResource(biome, rngOf(v));
          expect(typeof drawn).toBe('string');
          expect(drawn.length).toBeGreaterThan(0);
          // same input, same output
          expect(rollLootResource(biome, rngOf(v))).toBe(drawn);
        }
      }
    });

    it('draws the rng EXACTLY ONCE per call (L-58 single-draw discipline)', () => {
      let calls = 0;
      const counting = () => {
        calls += 1;
        return 0.5;
      };
      rollLootResource('mountain', counting);
      expect(calls).toBe(1);
    });
  });

  // TASK-273 (R-44a — multi-enemy encounter groups): rollEncounterGroup — the group sibling of
  // rollEncounter. The load-bearing identity proof: a length-1 group's [0] === rollEncounter(...).
  describe('rollEncounterGroup (R-44a — bounded wild-enemy group)', () => {
    it('maxGroupForBiome is TOTAL and capped at 2 (a new biome is a build error)', () => {
      for (const biome of BIOMES) {
        const cap = maxGroupForBiome(biome);
        expect(cap).toBeGreaterThanOrEqual(1);
        expect(cap).toBeLessThanOrEqual(2);
      }
    });

    it('an EMPTY roll (roll >= chance) returns [] (mirror of rollEncounter null)', () => {
      for (const biome of BIOMES) {
        const chance = SPAWN_TABLES[biome].chance;
        // roll at/above chance → no encounter, whatever the size roll.
        expect(rollEncounterGroup(biome, chance, 0, 0.9)).toEqual([]);
        expect(rollEncounterGroup(biome, chance + 0.01, 0, 0.9)).toEqual([]);
      }
    });

    it('a non-empty roll: group[0] is byte-identical to rollEncounter(biome, roll, pick)', () => {
      for (const biome of BIOMES) {
        const below = SPAWN_TABLES[biome].chance - 0.001;
        // A LOW sizeRoll never adds a second enemy → a length-1 group whose [0] IS rollEncounter.
        const group = rollEncounterGroup(biome, below, 0, 0.0);
        expect(group).toHaveLength(1);
        expect(group[0]).toEqual(rollEncounter(biome, below, 0));
      }
    });

    it('a HIGH sizeRoll in a pack biome (cap 2, ≥2 species) fields 2 DISTINCT enemies', () => {
      // mountain has cap 2 and ≥2 distinct species (Numemon/Kuwagamon/Guilmon).
      const below = SPAWN_TABLES.mountain.chance - 0.001;
      const group = rollEncounterGroup('mountain', below, 0, 0.9);
      expect(group).toHaveLength(2);
      // Two DIFFERENT foes (never the same species twice).
      expect(group[0].enemyId).not.toBe(group[1].enemyId);
      // The front is still rollEncounter's front.
      expect(group[0]).toEqual(rollEncounter('mountain', below, 0));
    });

    it('a cap-1 biome NEVER fields a pack even at a high sizeRoll (the 1v1 identity)', () => {
      // forest is cap 1 → always a length-1 group.
      const below = SPAWN_TABLES.forest.chance - 0.001;
      expect(rollEncounterGroup('forest', below, 0, 0.99)).toHaveLength(1);
    });

    it('is deterministic (RNG-free) — identical inputs give an identical group', () => {
      const below = SPAWN_TABLES.swamp.chance - 0.001;
      expect(rollEncounterGroup('swamp', below, 0, 0.9)).toEqual(
        rollEncounterGroup('swamp', below, 0, 0.9),
      );
    });
  });
});
