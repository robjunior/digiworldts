import { describe, expect, it } from 'vitest';
import {
  EVOLUTION_LINES,
  resolveEvolution,
  pickEvolution,
  pickEvolutionVariant,
  type DigimonStage,
  type EvolutionVariant,
} from './evolution';
import { DEFAULT_RNG, type Rng } from './rng';

/**
 * Evolution-chain contract (TASK-17, R-8). A PURE unit spec — NO Nest, NO DB, NO
 * datastore harness (unlike digimon.seed.spec.ts's persistence e2e): it imports the
 * pure `evolution.ts` module and asserts its data + logic directly. This is the
 * acceptance proof for R-8's data foundation, the hard dependency TASK-18's
 * `POST /digimon/:id/evolve` builds on.
 *
 * It nails down the two things TASK-18 relies on:
 *  - the chain data is WELL-FORMED (positive-int stats, a valid stage, a sane
 *    requiredLevel) so applying `into` to a row can never write garbage; and
 *  - `resolveEvolution` is TOTAL and its discriminant + `reason` strings are exactly
 *    what the mutation branches on and surfaces to the player (a 4xx block reason
 *    that TASK-19 renders in a `role="alert"`).
 */
describe('evolution chain data + resolveEvolution (pure)', () => {
  // The allowed stage vocabulary (mirrors StarterDigimon.stage / DigimonStage).
  // Kept as a runtime array so we can assert `into.stage` is one of them.
  const ALLOWED_STAGES: readonly DigimonStage[] = [
    'Fresh',
    'In-Training',
    'Rookie',
    'Champion',
    'Ultimate',
    'Mega',
  ];

  // The allowed resource vocabulary a `cost.resource` must belong to — the SAME set
  // `Building.resource` / `ResourceBalance.resource` use (SQLite-no-enums, so a
  // plain string; this array is the authoring-time allowed set). Every current line
  // is priced in Meat, but asserting membership (not equality) leaves room for a
  // later line to charge Bits/Data without editing this guard.
  const ALLOWED_RESOURCES: readonly string[] = ['Meat', 'Bits', 'Data'];

  // The Meat Farm's storage cap (farm.seed.ts: rate 60/h, capacity 1440). A cost is
  // "affordable from one collect" iff it is no larger than this — a single
  // `POST /farm/collect` after enough accrual can bank up to the cap. This is the
  // upper bound the affordability assertion enforces (A-15), the economic analogue
  // of A-12's "requiredLevel 1 keeps the success path demonstrable". Kept as a local
  // literal (not imported) so this pure spec keeps zero cross-module import surface,
  // mirroring how ALLOWED_STAGES restates the stage union.
  const MEAT_FARM_CAPACITY = 1440;

  it('exposes well-formed EVOLUTION_LINES entries (valid stage, positive-int stats, sane level, affordable cost)', () => {
    const entries = Object.entries(EVOLUTION_LINES);
    // Guard against an empty map — the slice has no value if nothing can evolve.
    expect(entries.length).toBeGreaterThan(0);

    for (const [fromName, step] of entries) {
      // The key (the CURRENT Digimon name) must be a non-empty string.
      expect(typeof fromName).toBe('string');
      expect(fromName.length).toBeGreaterThan(0);

      // requiredLevel is a positive integer >= 1 (a level-1 starter must be able
      // to meet the lowest gate — A-12).
      expect(Number.isInteger(step.requiredLevel)).toBe(true);
      expect(step.requiredLevel).toBeGreaterThanOrEqual(1);

      // The resulting form: a non-empty name and a stage from the allowed set.
      expect(typeof step.into.name).toBe('string');
      expect(step.into.name.length).toBeGreaterThan(0);
      expect(ALLOWED_STAGES).toContain(step.into.stage);

      // All four combat stats present as positive integers — never garbage a row
      // could be updated to.
      for (const stat of [step.into.hp, step.into.atk, step.into.def, step.into.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }

      // The economic cost (TASK-24, R-8b — the FIRST SPEND): every step charges a
      // `cost { resource, amount }` the evolve `$transaction` debits.
      //  - `resource` is a non-empty string from the known vocabulary (all lines
      //    are priced in Meat for this slice, so a mismatch would misprice the debit
      //    or the display mirror TASK-25 renders — pin it).
      //  - `amount` is a POSITIVE integer that stays AFFORDABLE: it must be
      //    coverable by a single `POST /farm/collect`, i.e. no larger than the Meat
      //    Farm's storage cap (1440). This is the assertion that keeps the SUCCESS
      //    path demonstrable today (A-15) — the exact reason `requiredLevel` stays 1.
      expect(typeof step.cost.resource).toBe('string');
      expect(step.cost.resource.length).toBeGreaterThan(0);
      expect(ALLOWED_RESOURCES).toContain(step.cost.resource);
      expect(Number.isInteger(step.cost.amount)).toBe(true);
      expect(step.cost.amount).toBeGreaterThan(0);
      // Affordable band: at/under the Meat Farm cap so one collect can cover it.
      expect(step.cost.amount).toBeLessThanOrEqual(MEAT_FARM_CAPACITY);
    }
  });

  it('resolves each eligible starter to its Champion form + returns its evolution cost', () => {
    // Agumon → Greymon.
    const agumon = resolveEvolution({ name: 'Agumon', level: 1 });
    expect(agumon.ok).toBe(true);
    if (agumon.ok) {
      expect(agumon.into.name).toBe('Greymon');
      expect(agumon.into.stage).toBe('Champion');
      expect(agumon.into).toEqual({
        name: 'Greymon',
        stage: 'Champion',
        hp: 90,
        atk: 26,
        def: 18,
        spd: 12,
      });
      // The `ok:true` branch now ALSO carries the step's cost (TASK-24) — this is
      // what DigimonService.evolve reads to know the resource + amount to debit, so
      // it must equal the EVOLUTION_LINES literal exactly (a drift here would debit
      // the wrong price). Cross-checked against the source-of-truth map, not a
      // duplicated literal, so the two can never silently diverge.
      expect(agumon.cost).toEqual({ resource: 'Meat', amount: 40 });
      expect(agumon.cost).toEqual(EVOLUTION_LINES.Agumon.cost);
    }

    // Gabumon → Garurumon.
    const gabumon = resolveEvolution({ name: 'Gabumon', level: 1 });
    expect(gabumon.ok).toBe(true);
    if (gabumon.ok) {
      expect(gabumon.into.name).toBe('Garurumon');
      expect(gabumon.into.stage).toBe('Champion');
      expect(gabumon.into).toEqual({
        name: 'Garurumon',
        stage: 'Champion',
        hp: 88,
        atk: 22,
        def: 24,
        spd: 14,
      });
      expect(gabumon.cost).toEqual({ resource: 'Meat', amount: 50 });
      expect(gabumon.cost).toEqual(EVOLUTION_LINES.Gabumon.cost);
    }

    // Patamon → Angemon.
    const patamon = resolveEvolution({ name: 'Patamon', level: 1 });
    expect(patamon.ok).toBe(true);
    if (patamon.ok) {
      expect(patamon.into.name).toBe('Angemon');
      expect(patamon.into.stage).toBe('Champion');
      expect(patamon.into).toEqual({
        name: 'Angemon',
        stage: 'Champion',
        hp: 82,
        atk: 24,
        def: 16,
        spd: 22,
      });
      expect(patamon.cost).toEqual({ resource: 'Meat', amount: 45 });
      expect(patamon.cost).toEqual(EVOLUTION_LINES.Patamon.cost);
    }
  });

  it('blocks a terminal form (no chain entry) with a "no further evolution" reason', () => {
    // Tyrannomon is a resulting Champion form with no entry of its own — a dead end.
    // Even at a high level it cannot evolve further (this is the exact block TASK-18
    // emits when a player clicks Evolve on a terminal Digimon). NOTE: Greymon USED to
    // be the terminal exemplar here, but TASK-285 (R-17c/R-8) gave it the FIRST
    // Champion→Ultimate line, so it is now evolvable — Tyrannomon (an Agumon non-primary
    // option with no line) is the surviving terminal Champion for this assertion.
    const outcome = resolveEvolution({ name: 'Tyrannomon', level: 50 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('no further evolution');
      expect(outcome.reason).toContain('Tyrannomon');
    }
    // Greymon, by contrast, is NOW evolvable (no longer terminal).
    expect(EVOLUTION_LINES.Greymon).toBeDefined();
  });

  it('blocks an under-level Digimon with a "Requires level" reason', () => {
    // Agumon has requiredLevel 1, so level 0 is under the gate. Proves the level
    // check fires and surfaces the requirement (the 4xx reason a player sees when
    // their Digimon is not yet strong enough).
    const outcome = resolveEvolution({ name: 'Agumon', level: 0 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toContain('Requires level');
      expect(outcome.reason).toContain('Agumon');
    }
  });
});

/**
 * TASK-188 (R-27) — RANDOM VALID DIGIVOLUTION contract for `pickEvolution`. A PURE unit
 * spec (no Nest/DB): the injected-RNG draw over a species' seeded `intoOptions`. The
 * three properties the service + invariant 5 rely on:
 *  - the DEFAULT_RNG (`() => 0`) draw returns the PRIMARY form — byte-identical to the
 *    fixed `into` — so every existing no-rng evolve fixture stays green with NO re-pin;
 *  - a stub walking `rng()` across `[0,1)` reaches EACH option and NEVER an off-list form;
 *  - it is a SINGLE `rng()` draw (L-58 multi-draw footgun avoided).
 */
describe('pickEvolution (random valid digivolution, pure injected-RNG)', () => {
  // A species with a seeded multi-branch set (Agumon) and one with only a single `into`
  // (Gabumon) — both must obey the identity anchor at rng()===0.
  const AGUMON = EVOLUTION_LINES.Agumon;
  const GABUMON = EVOLUTION_LINES.Gabumon;
  const PATAMON = EVOLUTION_LINES.Patamon;
  // TASK-208 (R-27a): Biyomon — a previously-terminal starter now given its first
  // random-evolution line (Birdramon anchor + Aquilamon/Kabukimon on higher rolls).
  const BIYOMON = EVOLUTION_LINES.Biyomon;
  // TASK-209 (R-27a): Tentomon — a previously-terminal starter now given its first
  // random-evolution line (Kabuterimon anchor + Aquilamon/Kuwagamon on higher rolls).
  const TENTOMON = EVOLUTION_LINES.Tentomon;
  // TASK-210 (R-27a): Palmon — a previously-terminal starter now given its first
  // random-evolution line (Togemon anchor + Woodmon/Kuwagamon on higher rolls).
  const PALMON = EVOLUTION_LINES.Palmon;
  // TASK-211 (R-27a): Gomamon — a previously-terminal starter now given its first
  // random-evolution line (Ikkakumon anchor + Coelamon/Shellmon on higher rolls).
  const GOMAMON = EVOLUTION_LINES.Gomamon;
  // TASK-212 (R-27a): Veemon — the LAST previously-terminal starter now given its first
  // random-evolution line (ExVeemon anchor + Veedramon/Lynxmon on higher rolls). This
  // closes the whole-roster starter child; no terminal FIRST_SEASON starter remains.
  const VEEMON = EVOLUTION_LINES.Veemon;
  // TASK-251 (R-29): Guilmon — the Tamers/season-3 partner, seeded as a level-1 Rookie
  // starter at TASK-250 but terminal until now; its first random-evolution line (Growlmon
  // anchor + Tyrannomon/Meramon on higher rolls).
  const GUILMON = EVOLUTION_LINES.Guilmon;
  // TASK-252 (R-29): Renamon — the second Tamers/season-3 partner, seeded as a level-1
  // Rookie starter at TASK-250 but terminal until now; its first random-evolution line
  // (Kyubimon anchor + Gatomon/Kabukimon on higher rolls).
  const RENAMON = EVOLUTION_LINES.Renamon;
  // TASK-253 (R-29): Terriermon — the THIRD and LAST Tamers/season-3 partner, seeded as a
  // level-1 Rookie starter at TASK-250 but terminal until now; its first random-evolution line
  // (Gargomon anchor + Woodmon/Leomon on higher rolls), closing the whole Tamers roster.
  const TERRIERMON = EVOLUTION_LINES.Terriermon;
  // TASK-285 (R-17c/R-8): Greymon — the FIRST Champion→Ultimate line (the second evolution
  // tier). Greymon was terminal until now (no EVOLUTION_LINES key); its first random line is
  // the MetalGreymon anchor + SkullGreymon/RizeGreymon Ultimates on higher rolls. Unlike every
  // prior block the target `stage` is 'Ultimate', one tier deeper.
  const GREYMON = EVOLUTION_LINES.Greymon;
  // TASK-286 (R-17c/R-8): Garurumon — the SECOND Champion→Ultimate line, mirroring the
  // Greymon block one tier at a time. Garurumon was terminal until now (no EVOLUTION_LINES
  // key); its first random line is the WereGarurumon anchor + Panjyamon/MegaSeadramon
  // Ultimates on higher rolls. Garurumon is Gabumon's DEFAULT_RNG/index-0 primary.
  const GARURUMON = EVOLUTION_LINES.Garurumon;
  // TASK-287 (R-17c/R-8): Angemon — the THIRD Champion→Ultimate line, mirroring the Greymon +
  // Garurumon blocks one tier at a time. Angemon was terminal until now (no EVOLUTION_LINES key);
  // its first random line is the MagnaAngemon anchor + Angewomon/SkullSatamon Ultimates on higher
  // rolls. Angemon is Patamon's DEFAULT_RNG/index-0 primary.
  const ANGEMON = EVOLUTION_LINES.Angemon;

  it('TASK-287: Angemon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(ANGEMON).toBeDefined();
    expect(ANGEMON.into.name).toBe('MagnaAngemon');
    expect(ANGEMON.into.stage).toBe('Ultimate');
    expect(ANGEMON.intoOptions).toBeDefined();
  });

  it('TASK-287: every Angemon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays MagnaAngemon', () => {
    for (const opt of ANGEMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(ANGEMON, DEFAULT_RNG)).toEqual(ANGEMON.into);
    const opts = ANGEMON.intoOptions!;
    const high = pickEvolution(ANGEMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(ANGEMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['MagnaAngemon', 'Angewomon', 'SkullSatamon']);
  });

  // TASK-288 (R-17c/R-8): Birdramon — the FOURTH Champion→Ultimate line, mirroring the Greymon +
  // Garurumon + Angemon blocks one tier at a time. Birdramon was terminal until now (no
  // EVOLUTION_LINES key); its first random line is the Garudamon anchor + Karatenmon/Crowmon
  // Ultimates on higher rolls. Birdramon is Biyomon's DEFAULT_RNG/index-0 primary.
  const BIRDRAMON = EVOLUTION_LINES.Birdramon;

  it('TASK-288: Birdramon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(BIRDRAMON).toBeDefined();
    expect(BIRDRAMON.into.name).toBe('Garudamon');
    expect(BIRDRAMON.into.stage).toBe('Ultimate');
    expect(BIRDRAMON.intoOptions).toBeDefined();
  });

  it('TASK-288: every Birdramon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays Garudamon', () => {
    for (const opt of BIRDRAMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(BIRDRAMON, DEFAULT_RNG)).toEqual(BIRDRAMON.into);
    const opts = BIRDRAMON.intoOptions!;
    const high = pickEvolution(BIRDRAMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(BIRDRAMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Garudamon', 'Karatenmon', 'Crowmon']);
  });

  // TASK-289 (R-17c/R-8): Kabuterimon — the FIFTH Champion→Ultimate line, mirroring the Greymon +
  // Garurumon + Angemon + Birdramon blocks one tier at a time. Kabuterimon was terminal until now (no
  // EVOLUTION_LINES key); its first random line is the MegaKabuterimon anchor + Okuwamon/Digitamamon
  // Ultimates on higher rolls. Kabuterimon is Tentomon's DEFAULT_RNG/index-0 primary.
  const KABUTERIMON = EVOLUTION_LINES.Kabuterimon;

  it('TASK-289: Kabuterimon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(KABUTERIMON).toBeDefined();
    expect(KABUTERIMON.into.name).toBe('MegaKabuterimon');
    expect(KABUTERIMON.into.stage).toBe('Ultimate');
    expect(KABUTERIMON.intoOptions).toBeDefined();
  });

  it('TASK-289: every Kabuterimon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays MegaKabuterimon', () => {
    for (const opt of KABUTERIMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(KABUTERIMON, DEFAULT_RNG)).toEqual(KABUTERIMON.into);
    const opts = KABUTERIMON.intoOptions!;
    const high = pickEvolution(KABUTERIMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(KABUTERIMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['MegaKabuterimon', 'Okuwamon', 'Digitamamon']);
  });

  // TASK-290 (R-17c/R-8): Togemon — the SIXTH Champion→Ultimate line, mirroring the Greymon +
  // Garurumon + Angemon + Birdramon + Kabuterimon blocks one tier at a time. Togemon was terminal
  // until now (no EVOLUTION_LINES key); its first random line is the Lillymon anchor +
  // Blossomon/Cherrymon Ultimates on higher rolls. Togemon is Palmon's DEFAULT_RNG/index-0 primary.
  const TOGEMON = EVOLUTION_LINES.Togemon;

  it('TASK-290: Togemon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(TOGEMON).toBeDefined();
    expect(TOGEMON.into.name).toBe('Lillymon');
    expect(TOGEMON.into.stage).toBe('Ultimate');
    expect(TOGEMON.intoOptions).toBeDefined();
  });

  it('TASK-290: every Togemon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays Lillymon', () => {
    for (const opt of TOGEMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(TOGEMON, DEFAULT_RNG)).toEqual(TOGEMON.into);
    const opts = TOGEMON.intoOptions!;
    const high = pickEvolution(TOGEMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(TOGEMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Lillymon', 'Blossomon', 'Cherrymon']);
  });

  // TASK-291 (R-17c/R-8): Ikkakumon — the SEVENTH Champion→Ultimate line, mirroring the Greymon +
  // Garurumon + Angemon + Birdramon + Kabuterimon + Togemon blocks one tier at a time. Ikkakumon was
  // terminal until now (no EVOLUTION_LINES key); its first random line is the Zudomon anchor +
  // Whamon/MarineDevimon Ultimates on higher rolls. Ikkakumon is Gomamon's DEFAULT_RNG/index-0 primary.
  const IKKAKUMON = EVOLUTION_LINES.Ikkakumon;

  it('TASK-291: Ikkakumon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(IKKAKUMON).toBeDefined();
    expect(IKKAKUMON.into.name).toBe('Zudomon');
    expect(IKKAKUMON.into.stage).toBe('Ultimate');
    expect(IKKAKUMON.intoOptions).toBeDefined();
  });

  it('TASK-291: every Ikkakumon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays Zudomon', () => {
    for (const opt of IKKAKUMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(IKKAKUMON, DEFAULT_RNG)).toEqual(IKKAKUMON.into);
    const opts = IKKAKUMON.intoOptions!;
    const high = pickEvolution(IKKAKUMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(IKKAKUMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Zudomon', 'Whamon', 'MarineDevimon']);
  });

  // TASK-292 (R-17c/R-8): ExVeemon — the EIGHTH (and FINAL PRIMARY) Champion→Ultimate line, closing the
  // whole-roster primary-Champion Ultimate child; mirrors the Greymon + Garurumon + Angemon + Birdramon +
  // Kabuterimon + Togemon + Ikkakumon blocks one tier at a time. ExVeemon was terminal until now (no
  // EVOLUTION_LINES key); its first random line is the Paildramon anchor + AeroVeedramon/Cyberdramon
  // Ultimates on higher rolls. ExVeemon is Veemon's DEFAULT_RNG/index-0 primary.
  const EXVEEMON = EVOLUTION_LINES.ExVeemon;

  it('TASK-292: ExVeemon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(EXVEEMON).toBeDefined();
    expect(EXVEEMON.into.name).toBe('Paildramon');
    expect(EXVEEMON.into.stage).toBe('Ultimate');
    expect(EXVEEMON.intoOptions).toBeDefined();
  });

  it('TASK-292: every ExVeemon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays Paildramon', () => {
    for (const opt of EXVEEMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(EXVEEMON, DEFAULT_RNG)).toEqual(EXVEEMON.into);
    const opts = EXVEEMON.intoOptions!;
    const high = pickEvolution(EXVEEMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(EXVEEMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Paildramon', 'AeroVeedramon', 'Cyberdramon']);
  });

  // TASK-294 (R-17c/R-8 tier-extension): MetalGreymon — the FIRST Ultimate→Mega line, the THIRD and
  // DEEPEST evolution tier. MetalGreymon was terminal until now (no EVOLUTION_LINES key); its first
  // random line is the WarGreymon anchor + BlackWarGreymon/VictoryGreymon Megas on higher rolls.
  // MetalGreymon is Greymon's DEFAULT_RNG/index-0 primary (Agumon→Greymon→MetalGreymon by default).
  // Unlike every prior block the target `stage` is 'Mega', one tier deeper again.
  const METALGREYMON = EVOLUTION_LINES.MetalGreymon;

  it('TASK-294: MetalGreymon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(METALGREYMON).toBeDefined();
    expect(METALGREYMON.into.name).toBe('WarGreymon');
    expect(METALGREYMON.into.stage).toBe('Mega');
    expect(METALGREYMON.intoOptions).toBeDefined();
  });

  it('TASK-294: every MetalGreymon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays WarGreymon', () => {
    for (const opt of METALGREYMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(METALGREYMON, DEFAULT_RNG)).toEqual(METALGREYMON.into);
    const opts = METALGREYMON.intoOptions!;
    const high = pickEvolution(METALGREYMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(METALGREYMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['WarGreymon', 'BlackWarGreymon', 'VictoryGreymon']);
  });

  // TASK-296 (R-17c/R-8 tier-extension): WereGarurumon — the SECOND Ultimate→Mega line, mirroring the
  // FIRST (MetalGreymon) one tier deeper again. WereGarurumon was terminal until now (no EVOLUTION_LINES
  // key); its first random line is the MetalGarurumon anchor + Boltmon/Cerberumon Megas on higher rolls.
  // WereGarurumon is Garurumon's DEFAULT_RNG/index-0 primary (Gabumon→Garurumon→WereGarurumon by
  // default) — the SECOND-most-reachable Ultimate after MetalGreymon. Target `stage` is 'Mega'.
  const WEREGARURUMON = EVOLUTION_LINES.WereGarurumon;

  it('TASK-296: WereGarurumon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(WEREGARURUMON).toBeDefined();
    expect(WEREGARURUMON.into.name).toBe('MetalGarurumon');
    expect(WEREGARURUMON.into.stage).toBe('Mega');
    expect(WEREGARURUMON.intoOptions).toBeDefined();
  });

  it('TASK-296: every WereGarurumon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays MetalGarurumon', () => {
    for (const opt of WEREGARURUMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(WEREGARURUMON, DEFAULT_RNG)).toEqual(WEREGARURUMON.into);
    const opts = WEREGARURUMON.intoOptions!;
    const high = pickEvolution(WEREGARURUMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(WEREGARURUMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['MetalGarurumon', 'Boltmon', 'Cerberumon']);
  });

  // TASK-298 (R-17c/R-8 tier-extension): MagnaAngemon — the THIRD Ultimate→Mega line, mirroring the
  // FIRST (MetalGreymon) and SECOND (WereGarurumon) verbatim. MagnaAngemon was terminal until now (no
  // EVOLUTION_LINES key); its first random line is the Seraphimon anchor + Dominimon/Goldramon Megas on
  // higher rolls. MagnaAngemon is Angemon's DEFAULT_RNG/index-0 primary (Patamon→Angemon→MagnaAngemon by
  // default) — the THIRD-most-reachable Ultimate after MetalGreymon and WereGarurumon. Target `stage`
  // is 'Mega'; the primary Seraphimon carries the highest spd of the three (speed-tilted angel identity).
  const MAGNAANGEMON = EVOLUTION_LINES.MagnaAngemon;

  it('TASK-298: MagnaAngemon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(MAGNAANGEMON).toBeDefined();
    expect(MAGNAANGEMON.into.name).toBe('Seraphimon');
    expect(MAGNAANGEMON.into.stage).toBe('Mega');
    expect(MAGNAANGEMON.intoOptions).toBeDefined();
  });

  it('TASK-298: every MagnaAngemon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays Seraphimon', () => {
    for (const opt of MAGNAANGEMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(MAGNAANGEMON, DEFAULT_RNG)).toEqual(MAGNAANGEMON.into);
    const opts = MAGNAANGEMON.intoOptions!;
    const high = pickEvolution(MAGNAANGEMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(MAGNAANGEMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Seraphimon', 'Dominimon', 'Goldramon']);
  });

  // TASK-300 (R-17c/R-8 tier-extension): Garudamon — the FOURTH Ultimate→Mega line, mirroring the FIRST
  // (MetalGreymon), SECOND (WereGarurumon) and THIRD (MagnaAngemon) verbatim. Garudamon was terminal until
  // now (no EVOLUTION_LINES key); its first random line is the Hououmon anchor + Valdurmon/Ornismon Megas
  // on higher rolls. Garudamon is Birdramon's DEFAULT_RNG/index-0 primary (Biyomon→Birdramon→Garudamon by
  // default) — the FOURTH-most-reachable Ultimate. Target `stage` is 'Mega'; the primary Hououmon carries
  // the highest spd of the three (speed/attack-tilted bird identity).
  const GARUDAMON = EVOLUTION_LINES.Garudamon;

  it('TASK-300: Garudamon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(GARUDAMON).toBeDefined();
    expect(GARUDAMON.into.name).toBe('Hououmon');
    expect(GARUDAMON.into.stage).toBe('Mega');
    expect(GARUDAMON.intoOptions).toBeDefined();
  });

  it('TASK-300: every Garudamon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays Hououmon', () => {
    for (const opt of GARUDAMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(GARUDAMON, DEFAULT_RNG)).toEqual(GARUDAMON.into);
    const opts = GARUDAMON.intoOptions!;
    const high = pickEvolution(GARUDAMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(GARUDAMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Hououmon', 'Valdurmon', 'Ornismon']);
  });

  // TASK-302 (R-17c/R-8 tier-extension): MegaKabuterimon — the FIFTH Ultimate→Mega line, mirroring the
  // FIRST (MetalGreymon), SECOND (WereGarurumon), THIRD (MagnaAngemon) and FOURTH (Garudamon) verbatim.
  // MegaKabuterimon was terminal until now (no EVOLUTION_LINES key); its first random line is the
  // HerculesKabuterimon anchor + GranKuwagamon/TigerVespamon Megas on higher rolls. MegaKabuterimon is
  // Kabuterimon's DEFAULT_RNG/index-0 primary (Tentomon→Kabuterimon→MegaKabuterimon by default) — the
  // FIFTH-most-reachable Ultimate. Target `stage` is 'Mega'; the primary HerculesKabuterimon carries the
  // highest def of the three (bulky/high-DEF beetle identity).
  const MEGAKABUTERIMON = EVOLUTION_LINES.MegaKabuterimon;

  it('TASK-302: MegaKabuterimon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(MEGAKABUTERIMON).toBeDefined();
    expect(MEGAKABUTERIMON.into.name).toBe('HerculesKabuterimon');
    expect(MEGAKABUTERIMON.into.stage).toBe('Mega');
    expect(MEGAKABUTERIMON.intoOptions).toBeDefined();
  });

  it('TASK-302: every MegaKabuterimon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays HerculesKabuterimon', () => {
    for (const opt of MEGAKABUTERIMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(MEGAKABUTERIMON, DEFAULT_RNG)).toEqual(MEGAKABUTERIMON.into);
    const opts = MEGAKABUTERIMON.intoOptions!;
    const high = pickEvolution(MEGAKABUTERIMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(MEGAKABUTERIMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['HerculesKabuterimon', 'GranKuwagamon', 'TigerVespamon']);
  });

  // TASK-304 (R-17c/R-8 tier-extension): Lillymon — the SIXTH Ultimate→Mega line, mirroring the FIRST
  // (MetalGreymon), SECOND (WereGarurumon), THIRD (MagnaAngemon), FOURTH (Garudamon) and FIFTH
  // (MegaKabuterimon) verbatim. Lillymon was terminal until now (no EVOLUTION_LINES key); its first
  // random line is the Rosemon anchor + Lotosmon/Lilithmon fairy Megas on higher rolls. Lillymon is
  // Togemon's DEFAULT_RNG/index-0 primary (Palmon→Togemon→Lillymon by default) — the SIXTH-most-reachable
  // Ultimate. Target `stage` is 'Mega'; the primary Rosemon carries the highest atk/spd of the three
  // (offense/speed-tilted fairy identity).
  const LILLYMON = EVOLUTION_LINES.Lillymon;

  it('TASK-304: Lillymon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(LILLYMON).toBeDefined();
    expect(LILLYMON.into.name).toBe('Rosemon');
    expect(LILLYMON.into.stage).toBe('Mega');
    expect(LILLYMON.intoOptions).toBeDefined();
  });

  it('TASK-304: every Lillymon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays Rosemon', () => {
    for (const opt of LILLYMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(LILLYMON, DEFAULT_RNG)).toEqual(LILLYMON.into);
    const opts = LILLYMON.intoOptions!;
    const high = pickEvolution(LILLYMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(LILLYMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Rosemon', 'Lotosmon', 'Lilithmon']);
  });

  // TASK-306 (R-17c/R-8 tier-extension): Zudomon — the SEVENTH Ultimate→Mega line, mirroring the FIRST
  // (MetalGreymon), SECOND (WereGarurumon), THIRD (MagnaAngemon), FOURTH (Garudamon), FIFTH
  // (MegaKabuterimon) and SIXTH (Lillymon) verbatim. Zudomon was terminal until now (no EVOLUTION_LINES
  // key); its first random line is the Vikemon anchor + MarineAngemon/Plesiomon aquatic Megas on higher
  // rolls. Zudomon is Ikkakumon's DEFAULT_RNG/index-0 primary (Gomamon→Ikkakumon→Zudomon by default) — the
  // SEVENTH-most-reachable Ultimate. Target `stage` is 'Mega'; the primary Vikemon carries the highest
  // def/hp of the three (tanky bulky-beast identity).
  const ZUDOMON = EVOLUTION_LINES.Zudomon;

  it('TASK-306: Zudomon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(ZUDOMON).toBeDefined();
    expect(ZUDOMON.into.name).toBe('Vikemon');
    expect(ZUDOMON.into.stage).toBe('Mega');
    expect(ZUDOMON.intoOptions).toBeDefined();
  });

  it('TASK-306: every Zudomon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays Vikemon', () => {
    for (const opt of ZUDOMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(ZUDOMON, DEFAULT_RNG)).toEqual(ZUDOMON.into);
    const opts = ZUDOMON.intoOptions!;
    const high = pickEvolution(ZUDOMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(ZUDOMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Vikemon', 'MarineAngemon', 'Plesiomon']);
  });

  // TASK-308 (R-17c/R-8 tier-extension): Paildramon — the EIGHTH — and FINAL PRIMARY — Ultimate→Mega line,
  // CLOSING the primary-Ultimate Mega set (ZERO primary Ultimates remain terminal after this), mirroring
  // the prior seven verbatim. Paildramon was terminal until now (no EVOLUTION_LINES key); its first random
  // line is the Imperialdramon anchor + AlforceVeedramon/UlforceVeedramon dragon Megas on higher rolls.
  // Paildramon is ExVeemon's DEFAULT_RNG/index-0 primary (Veemon→ExVeemon→Paildramon by default) — the
  // EIGHTH-and-LAST-most-reachable Ultimate. Target `stage` is 'Mega'; the primary Imperialdramon carries
  // the highest atk/hp of the three (balanced offense-tilted dragon identity).
  const PAILDRAMON = EVOLUTION_LINES.Paildramon;

  it('TASK-308: Paildramon is present in EVOLUTION_LINES (Ultimate→Mega, previously terminal)', () => {
    expect(PAILDRAMON).toBeDefined();
    expect(PAILDRAMON.into.name).toBe('Imperialdramon');
    expect(PAILDRAMON.into.stage).toBe('Mega');
    expect(PAILDRAMON.intoOptions).toBeDefined();
  });

  it('TASK-308: every Paildramon option is a well-formed positive-int Mega, and a high roll draws a NON-primary while DEFAULT_RNG stays Imperialdramon', () => {
    for (const opt of PAILDRAMON.intoOptions!) {
      expect(opt.stage).toBe('Mega');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Mega verbatim.
    expect(pickEvolution(PAILDRAMON, DEFAULT_RNG)).toEqual(PAILDRAMON.into);
    const opts = PAILDRAMON.intoOptions!;
    const high = pickEvolution(PAILDRAMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(PAILDRAMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Imperialdramon', 'AlforceVeedramon', 'UlforceVeedramon']);
  });

  it('TASK-286: Garurumon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(GARURUMON).toBeDefined();
    expect(GARURUMON.into.name).toBe('WereGarurumon');
    expect(GARURUMON.into.stage).toBe('Ultimate');
    expect(GARURUMON.intoOptions).toBeDefined();
  });

  it('TASK-286: every Garurumon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays WereGarurumon', () => {
    for (const opt of GARURUMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(GARURUMON, DEFAULT_RNG)).toEqual(GARURUMON.into);
    const opts = GARURUMON.intoOptions!;
    const high = pickEvolution(GARURUMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(GARURUMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['WereGarurumon', 'Panjyamon', 'MegaSeadramon']);
  });

  it('TASK-285: Greymon is present in EVOLUTION_LINES (Champion→Ultimate, previously terminal)', () => {
    expect(GREYMON).toBeDefined();
    expect(GREYMON.into.name).toBe('MetalGreymon');
    expect(GREYMON.into.stage).toBe('Ultimate');
    expect(GREYMON.intoOptions).toBeDefined();
  });

  it('TASK-285: every Greymon option is a well-formed positive-int Ultimate, and a high roll draws a NON-primary while DEFAULT_RNG stays MetalGreymon', () => {
    for (const opt of GREYMON.intoOptions!) {
      expect(opt.stage).toBe('Ultimate');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    // Identity anchor: DEFAULT_RNG (index 0) lands the primary Ultimate verbatim.
    expect(pickEvolution(GREYMON, DEFAULT_RNG)).toEqual(GREYMON.into);
    const opts = GREYMON.intoOptions!;
    const high = pickEvolution(GREYMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(GREYMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['MetalGreymon', 'SkullGreymon', 'RizeGreymon']);
  });

  it('TASK-208: Biyomon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(BIYOMON).toBeDefined();
    expect(BIYOMON.into.name).toBe('Birdramon');
    expect(BIYOMON.intoOptions).toBeDefined();
  });

  it('TASK-209: Tentomon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(TENTOMON).toBeDefined();
    expect(TENTOMON.into.name).toBe('Kabuterimon');
    expect(TENTOMON.intoOptions).toBeDefined();
  });

  it('TASK-210: Palmon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(PALMON).toBeDefined();
    expect(PALMON.into.name).toBe('Togemon');
    expect(PALMON.intoOptions).toBeDefined();
  });

  it('TASK-211: Gomamon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(GOMAMON).toBeDefined();
    expect(GOMAMON.into.name).toBe('Ikkakumon');
    expect(GOMAMON.intoOptions).toBeDefined();
  });

  it('TASK-212: Veemon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(VEEMON).toBeDefined();
    expect(VEEMON.into.name).toBe('ExVeemon');
    expect(VEEMON.intoOptions).toBeDefined();
  });

  it('TASK-251: Guilmon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(GUILMON).toBeDefined();
    expect(GUILMON.into.name).toBe('Growlmon');
    expect(GUILMON.intoOptions).toBeDefined();
  });

  it('TASK-252: Renamon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(RENAMON).toBeDefined();
    expect(RENAMON.into.name).toBe('Kyubimon');
    expect(RENAMON.intoOptions).toBeDefined();
  });

  it('TASK-253: Terriermon is present in EVOLUTION_LINES (previously terminal, now evolvable)', () => {
    expect(TERRIERMON).toBeDefined();
    expect(TERRIERMON.into.name).toBe('Gargomon');
    expect(TERRIERMON.intoOptions).toBeDefined();
  });

  it('IDENTITY: at rng()===0 (DEFAULT_RNG) returns the primary form === the fixed into', () => {
    // The invariant-5 byte-proof: DEFAULT_RNG draws index 0, and intoOptions[0] is
    // byte-identical to `into`, so a no-rng caller lands exactly the pre-slice target.
    expect(pickEvolution(AGUMON, DEFAULT_RNG)).toEqual(AGUMON.into);
    expect(pickEvolution(AGUMON, () => 0)).toEqual(AGUMON.into);
    // TASK-207 (R-27a): Gabumon + Patamon now carry a seeded multi-branch set too, and
    // their intoOptions[0] anchors are byte-identical to `into`, so DEFAULT_RNG (index 0)
    // still lands the pre-slice fixed champion (Garurumon / Angemon) verbatim.
    expect(pickEvolution(GABUMON, DEFAULT_RNG)).toEqual(GABUMON.into);
    expect(pickEvolution(PATAMON, DEFAULT_RNG)).toEqual(PATAMON.into);
    // TASK-208 (R-27a): Biyomon's intoOptions[0] (Birdramon) is the same identity anchor,
    // so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(BIYOMON, DEFAULT_RNG)).toEqual(BIYOMON.into);
    // TASK-209 (R-27a): Tentomon's intoOptions[0] (Kabuterimon) is the same identity
    // anchor, so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(TENTOMON, DEFAULT_RNG)).toEqual(TENTOMON.into);
    // TASK-210 (R-27a): Palmon's intoOptions[0] (Togemon) is the same identity
    // anchor, so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(PALMON, DEFAULT_RNG)).toEqual(PALMON.into);
    // TASK-211 (R-27a): Gomamon's intoOptions[0] (Ikkakumon) is the same identity
    // anchor, so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(GOMAMON, DEFAULT_RNG)).toEqual(GOMAMON.into);
    // TASK-212 (R-27a): Veemon's intoOptions[0] (ExVeemon) is the same identity
    // anchor, so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(VEEMON, DEFAULT_RNG)).toEqual(VEEMON.into);
    // TASK-251 (R-29): Guilmon's intoOptions[0] (Growlmon) is the same identity
    // anchor, so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(GUILMON, DEFAULT_RNG)).toEqual(GUILMON.into);
    // TASK-252 (R-29): Renamon's intoOptions[0] (Kyubimon) is the same identity
    // anchor, so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(RENAMON, DEFAULT_RNG)).toEqual(RENAMON.into);
    // TASK-253 (R-29): Terriermon's intoOptions[0] (Gargomon) is the same identity
    // anchor, so DEFAULT_RNG still lands the primary champion verbatim.
    expect(pickEvolution(TERRIERMON, DEFAULT_RNG)).toEqual(TERRIERMON.into);
    // TASK-285 (R-17c/R-8): Greymon's intoOptions[0] (MetalGreymon) is the same identity
    // anchor one tier deeper (Champion→Ultimate), so DEFAULT_RNG lands the primary Ultimate.
    expect(pickEvolution(GREYMON, DEFAULT_RNG)).toEqual(GREYMON.into);
    // TASK-286 (R-17c/R-8): Garurumon's intoOptions[0] (WereGarurumon) is the same identity
    // anchor one tier deeper (Champion→Ultimate), so DEFAULT_RNG lands the primary Ultimate.
    expect(pickEvolution(GARURUMON, DEFAULT_RNG)).toEqual(GARURUMON.into);
  });

  it('TASK-207: Gabumon + Patamon branch to a NON-primary in-set champion on a high roll', () => {
    // A stub near 1 lands the LAST bucket → a distinct, in-set champion (not the anchor),
    // proving the new seams reach their other real digi-api forms under LIVE_RNG.
    for (const step of [GABUMON, PATAMON]) {
      const opts = step.intoOptions!;
      const high = pickEvolution(step, () => 0.999);
      expect(high).toEqual(opts[opts.length - 1]);
      expect(high).not.toEqual(step.into);
      expect(opts).toContainEqual(high);
    }
  });

  it('TASK-207: every Gabumon/Patamon option is a well-formed positive-int Champion', () => {
    for (const step of [GABUMON, PATAMON]) {
      for (const opt of step.intoOptions!) {
        expect(opt.stage).toBe('Champion');
        for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
          expect(Number.isInteger(stat)).toBe(true);
          expect(stat).toBeGreaterThan(0);
        }
      }
    }
  });

  it('TASK-208: every Biyomon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays Birdramon', () => {
    for (const opt of BIYOMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(BIYOMON, DEFAULT_RNG)).toEqual(BIYOMON.into);
    const opts = BIYOMON.intoOptions!;
    const high = pickEvolution(BIYOMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(BIYOMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Birdramon', 'Aquilamon', 'Kabukimon']);
  });

  it('TASK-209: every Tentomon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays Kabuterimon', () => {
    for (const opt of TENTOMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(TENTOMON, DEFAULT_RNG)).toEqual(TENTOMON.into);
    const opts = TENTOMON.intoOptions!;
    const high = pickEvolution(TENTOMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(TENTOMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Kabuterimon', 'Aquilamon', 'Kuwagamon']);
  });

  it('TASK-210: every Palmon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays Togemon', () => {
    for (const opt of PALMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(PALMON, DEFAULT_RNG)).toEqual(PALMON.into);
    const opts = PALMON.intoOptions!;
    const high = pickEvolution(PALMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(PALMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Togemon', 'Woodmon', 'Kuwagamon']);
  });

  it('TASK-211: every Gomamon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays Ikkakumon', () => {
    for (const opt of GOMAMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(GOMAMON, DEFAULT_RNG)).toEqual(GOMAMON.into);
    const opts = GOMAMON.intoOptions!;
    const high = pickEvolution(GOMAMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(GOMAMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Ikkakumon', 'Coelamon', 'Shellmon']);
  });

  it('TASK-212: every Veemon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays ExVeemon', () => {
    for (const opt of VEEMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(VEEMON, DEFAULT_RNG)).toEqual(VEEMON.into);
    const opts = VEEMON.intoOptions!;
    const high = pickEvolution(VEEMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(VEEMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['ExVeemon', 'Veedramon', 'Lynxmon']);
  });

  it('TASK-251: every Guilmon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays Growlmon', () => {
    for (const opt of GUILMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(GUILMON, DEFAULT_RNG)).toEqual(GUILMON.into);
    const opts = GUILMON.intoOptions!;
    const high = pickEvolution(GUILMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(GUILMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Growlmon', 'Tyrannomon', 'Meramon']);
  });

  it('TASK-252: every Renamon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays Kyubimon', () => {
    for (const opt of RENAMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(RENAMON, DEFAULT_RNG)).toEqual(RENAMON.into);
    const opts = RENAMON.intoOptions!;
    const high = pickEvolution(RENAMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(RENAMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Kyubimon', 'Gatomon', 'Kabukimon']);
  });

  it('TASK-253: every Terriermon option is a well-formed positive-int Champion, and a high roll draws a NON-primary while DEFAULT_RNG stays Gargomon', () => {
    for (const opt of TERRIERMON.intoOptions!) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
    expect(pickEvolution(TERRIERMON, DEFAULT_RNG)).toEqual(TERRIERMON.into);
    const opts = TERRIERMON.intoOptions!;
    const high = pickEvolution(TERRIERMON, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(TERRIERMON.into);
    expect(opts).toContainEqual(high);
    expect(opts.map((o) => o.name)).toEqual(['Gargomon', 'Woodmon', 'Leomon']);
  });

  it('TASK-213: Veemon carries a PER-TARGET divergent cost on Veedramon only; the anchor + last option have no override', () => {
    const opts = VEEMON.intoOptions!;
    const [exVeemon, veedramon, lynxmon] = opts;
    // Veedramon — the stronger dragon champion — overrides the source Meat 45 with
    // its own Meat 60 (the divergent-cost slice); a valid EvolutionCost.
    expect(veedramon.name).toBe('Veedramon');
    expect(veedramon.cost).toEqual({ resource: 'Meat', amount: 60 });
    expect(['Meat', 'Bits', 'Data']).toContain(veedramon.cost!.resource);
    expect(Number.isInteger(veedramon.cost!.amount)).toBe(true);
    expect(veedramon.cost!.amount).toBeGreaterThan(0);
    // The anchor (ExVeemon, byte-identical to `into`) and Lynxmon carry NO override,
    // so they fall back to the source-step cost (Meat 45) — the invariant-5 anchor
    // must have no cost or `pickEvolution(VEEMON, DEFAULT_RNG)===into` would drift.
    expect(exVeemon.cost).toBeUndefined();
    expect(lynxmon.cost).toBeUndefined();
    expect(VEEMON.cost).toEqual({ resource: 'Meat', amount: 45 });
    expect(exVeemon).toEqual(VEEMON.into);
  });

  it('TASK-214: Gomamon carries a RESOURCE-VARYING per-target cost on Shellmon only (a DIFFERENT currency); the anchor + Coelamon have no override', () => {
    const opts = GOMAMON.intoOptions!;
    const [ikkakumon, coelamon, shellmon] = opts;
    // Shellmon — the bulky aquatic champion — overrides the source Meat 45 with its OWN
    // Bits 30 (the FIRST resource-varying override, not just amount-varying like TASK-213);
    // a valid EvolutionCost naming a different currency entirely.
    expect(shellmon.name).toBe('Shellmon');
    expect(shellmon.cost).toEqual({ resource: 'Bits', amount: 30 });
    expect(shellmon.cost!.resource).toBe('Bits');
    expect(['Meat', 'Bits', 'Data']).toContain(shellmon.cost!.resource);
    expect(Number.isInteger(shellmon.cost!.amount)).toBe(true);
    expect(shellmon.cost!.amount).toBeGreaterThan(0);
    // The anchor (Ikkakumon, byte-identical to `into`) and Coelamon carry NO override,
    // so they fall back to the source-step cost (Meat 45) — the invariant-5 anchor
    // must have no cost or `pickEvolution(GOMAMON, DEFAULT_RNG)===into` would drift.
    expect(ikkakumon.cost).toBeUndefined();
    expect(coelamon.cost).toBeUndefined();
    expect(GOMAMON.cost).toEqual({ resource: 'Meat', amount: 45 });
    expect(ikkakumon).toEqual(GOMAMON.into);
  });

  it('every intoOptions[0] equals the species existing into (identity anchor cannot drift)', () => {
    for (const step of Object.values(EVOLUTION_LINES)) {
      if (step.intoOptions !== undefined) {
        expect(step.intoOptions[0]).toEqual(step.into);
      }
    }
  });

  it('a high roll returns a NON-primary valid option, never an off-list form', () => {
    // A stub near 1 lands the LAST bucket → a distinct champion, proving the draw
    // actually reaches the other options.
    const opts = AGUMON.intoOptions!;
    const last = pickEvolution(AGUMON, () => 0.999);
    expect(last).toEqual(opts[opts.length - 1]);
    expect(last).not.toEqual(AGUMON.into);
  });

  it('walking rng() across [0,1) draws EACH option and only in-set forms', () => {
    const opts = AGUMON.intoOptions!;
    // One representative roll per bucket: mid-point of each 1/n slice.
    for (let i = 0; i < opts.length; i++) {
      const mid = (i + 0.5) / opts.length;
      const drawn = pickEvolution(AGUMON, () => mid);
      expect(drawn).toEqual(opts[i]);
      // NEVER an off-list form: the drawn form is a member of the seeded set.
      expect(opts).toContainEqual(drawn);
    }
  });

  it('is a SINGLE rng() draw (L-58 multi-draw footgun avoided)', () => {
    let calls = 0;
    const counting: Rng = () => {
      calls += 1;
      return 0;
    };
    pickEvolution(AGUMON, counting);
    expect(calls).toBe(1);
  });
});

/**
 * TASK-215 (R-27a, A-196) — VARIANT-branch random digivolution contract for
 * `pickEvolutionVariant`. The accumulation-gated (Fire-Data) variant branch now draws
 * a random valid Champion, mirroring the linear branch's identity-anchor discipline:
 * `intoOptions[0]` is byte-identical to `variant.into` (Meramon), so `DEFAULT_RNG`
 * (index 0) still lands the pre-slice fixed Meramon verbatim (invariant 5 — every
 * existing variant/adaptive fixture stays green with NO re-pin), while a high roll
 * reaches the other real digi-api Fire/beast forms. A variant WITHOUT `intoOptions`
 * falls back to its single `into` at any rng — the byte-proof for non-randomized
 * variants (of which Agumon's is currently the only variant that exists at all).
 */
describe('pickEvolutionVariant (variant-branch random digivolution)', () => {
  const AGUMON_VARIANT = EVOLUTION_LINES.Agumon.variant!;

  it('IDENTITY: at DEFAULT_RNG draws the primary variant form === variant.into (Meramon anchor)', () => {
    expect(pickEvolutionVariant(AGUMON_VARIANT, DEFAULT_RNG)).toEqual(AGUMON_VARIANT.into);
    expect(pickEvolutionVariant(AGUMON_VARIANT, () => 0)).toEqual(AGUMON_VARIANT.into);
  });

  it('a high roll draws the LAST (non-primary) in-set variant Champion', () => {
    const opts = AGUMON_VARIANT.intoOptions!;
    const high = pickEvolutionVariant(AGUMON_VARIANT, () => 0.999);
    expect(high).toEqual(opts[opts.length - 1]);
    expect(high).not.toEqual(AGUMON_VARIANT.into);
    expect(opts).toContainEqual(high);
  });

  it('every variant option is a well-formed positive-int Champion; order starts with Meramon', () => {
    const opts = AGUMON_VARIANT.intoOptions!;
    expect(opts.map((o) => o.name)[0]).toBe('Meramon');
    // The identity anchor cannot drift: intoOptions[0] is byte-identical to into.
    expect(opts[0]).toEqual(AGUMON_VARIANT.into);
    for (const opt of opts) {
      expect(opt.stage).toBe('Champion');
      for (const stat of [opt.hp, opt.atk, opt.def, opt.spd]) {
        expect(Number.isInteger(stat)).toBe(true);
        expect(stat).toBeGreaterThan(0);
      }
    }
  });

  it('a variant WITHOUT intoOptions draws its single into at ANY rng (fallback byte-proof)', () => {
    // Construct a bare variant with no intoOptions — the fallback path returns `into`
    // for any rng, proving every non-randomized variant is byte-unchanged.
    const bare: EvolutionVariant = {
      dataType: 'Fire',
      requiredData: 60,
      cost: { resource: 'Meat', amount: 45 },
      into: { name: 'Meramon', stage: 'Champion', hp: 84, atk: 30, def: 14, spd: 16 },
    };
    expect(pickEvolutionVariant(bare, DEFAULT_RNG)).toEqual(bare.into);
    expect(pickEvolutionVariant(bare, () => 0.999)).toEqual(bare.into);
  });

  it('is a SINGLE rng() draw (L-58 multi-draw footgun avoided)', () => {
    let calls = 0;
    const counting: Rng = () => {
      calls += 1;
      return 0;
    };
    pickEvolutionVariant(AGUMON_VARIANT, counting);
    expect(calls).toBe(1);
  });
});
