/**
 * The evolution-chain definition (TASK-17, R-8) — the data foundation the evolve
 * mutation reads.
 *
 * A PURE, side-effect-free data + logic module, mirroring `digimon.seed.ts`'s
 * stance EXACTLY (zero imports beyond the local interfaces declared here, no
 * Prisma, no I/O, `readonly` + `as const` frozen data). That is deliberate:
 *
 *  - TASK-18's `POST /digimon/:id/evolve` consumes `resolveEvolution` to decide
 *    whether an owned Digimon may evolve and, if so, what it becomes — then owns
 *    the SINGLE write path behind `PrismaService` (invariant 1). Keeping this file
 *    side-effect-free means the write path (and the audit/soft-delete disciplines)
 *    live in ONE place (TASK-18), and this stays trivially unit-testable and
 *    reusable (evolution.spec.ts asserts these pure functions with no DB harness).
 *  - The `reason` strings returned by `resolveEvolution` ARE the human-facing block
 *    messages: TASK-18 throws them as the 4xx body and TASK-19 surfaces them in a
 *    `role="alert"`. So they are written to be clear and player-readable, not
 *    developer diagnostics.
 *
 * Scope note (what this file DOES and does NOT decide): it is the pure evolution
 * DATA + eligibility logic — the level/chain gate AND, as of R-8b (TASK-24), the
 * resource `cost` each step charges. It still performs NO I/O: it declares WHAT an
 * evolution requires (a level, and now a `cost { resource, amount }`) and returns
 * that cost to the caller, but it NEVER reads a balance or writes the audit ledger.
 * The balance sufficiency-check + `decrement` + the append-only `AuditLog` row that
 * invariant 3 requires all live in the ONE write path behind `PrismaService`
 * (`DigimonService.evolve`, TASK-24), which folds them into its existing evolve
 * `$transaction`. Keeping this file side-effect-free means the spend (and the audit/
 * soft-delete disciplines) stay in one place and this stays trivially unit-testable
 * (evolution.spec.ts asserts these pure functions with no DB harness). The cost is
 * PURE TS data here — NOT a schema column (invariant 5: no migration for R-8b;
 * `ResourceBalance`/`AuditLog` already exist from R-4b/TASK-21).
 */

import type { Rng } from './rng';

/** The stage vocabulary — the same string union documented on `StarterDigimon`
 * (digimon.seed.ts). SQLite has no enums, so `stage` is a plain `String` column;
 * this union is authoring/documentation safety only, matching the seed's stance. */
export type DigimonStage = 'Fresh' | 'In-Training' | 'Rookie' | 'Champion' | 'Ultimate' | 'Mega';

/**
 * One concrete evolved form — the absolute new stats a Digimon takes on when it
 * advances (TASK-178→TASK-188, R-27). Named (previously an inline object literal on
 * {@link EvolutionStep.into}) so a SET of valid next forms — the digi-api evolution
 * list — can be modelled as `readonly EvolutionInto[]` on {@link EvolutionStep.intoOptions}
 * without duplicating the shape. Byte-identical to the old inline `into` type, so this
 * rename is purely structural (invariant 5).
 */
export interface EvolutionInto {
  name: string;
  stage: DigimonStage;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  /**
   * TASK-213 (R-27a) — PER-TARGET DIVERGENT COST (optional override). When present,
   * evolving into THIS drawn form debits this price instead of the source-step
   * `cost`; a rarer/stronger champion can cost more (or a different resource).
   * ABSENT (the shipped shape for every existing option) means "fall back to the
   * source-step cost", so all seven species/options without an override debit
   * BYTE-IDENTICALLY as before (invariant 5 — the fallback IS the byte-proof).
   * `DigimonService.evolve` reads `into.cost ?? sourceCost` after the random draw.
   */
  cost?: EvolutionCost;
}

/**
 * The resource PRICE of one evolution step (TASK-24, R-8b) — what evolving DEBITS
 * from the player's spendable {@link ResourceBalance}. Its two fields deliberately
 * mirror the balance's own columns so the debit is a direct match:
 *
 *  - `resource`: which resource is spent — one of `"Meat" | "Bits" | "Data"`, the
 *    SAME vocabulary `Building.resource` / `ResourceBalance.resource` use. A plain
 *    `string` (NOT a TS enum), matching the SQLite-no-enums stance those columns
 *    take (L-6 #3); the allowed set is documented, not type-enforced, here.
 *  - `amount`: the whole spendable units the step charges (Int-valued — the house
 *    whole-unit idiom). Deliberately LOW and affordable from a single
 *    `POST /farm/collect` (A-15 — see EVOLUTION_LINES), so a level-1 starter can
 *    demonstrate the SPEND today, exactly as `requiredLevel: 1` keeps the level
 *    gate demonstrable.
 *
 * `DigimonService.evolve` reads this off the resolved step and guards
 * `balance.amount >= cost.amount` before `decrement`-ing the balance and appending
 * the `action:'evolve'` audit row — all inside its evolve `$transaction` (TASK-24).
 */
export interface EvolutionCost {
  resource: string;
  amount: number;
}

/**
 * One evolution step: the requirement to evolve a given Digimon, and the form it
 * becomes.
 *
 * `into` carries ABSOLUTE new stats (not a delta) on purpose — it is the simplest,
 * most testable shape and lets TASK-18 write the resulting attributes directly onto
 * the row without needing to read + add. A stat-DELTA form was considered and
 * rejected here for that reason (build's call, per the task): absolute keeps the
 * outcome self-contained and the unit assertions exact.
 */
/**
 * A SECOND, VARIANT evolution branch off a step (TASK-30, R-16) — the mechanism
 * that lets a Digimon evolve into a DIFFERENT form based on what it has ACCUMULATED,
 * not just its level. Optional on {@link EvolutionStep} so the existing linear
 * lines stay byte-compatible (a step without a `variant` behaves exactly as before).
 *
 *  - `dataType`: which typed Data gate unlocks this branch. Only `'Fire'` exists in
 *    this slice (the `Digimon.dataFire` column); a plain string-literal union, ready
 *    to grow additively to other Data types in later R-16 child slices.
 *  - `requiredData`: the threshold of that typed Data the Digimon must have
 *    accumulated for the branch to be OFFERABLE. Below it, `resolveEvolutionBranch`
 *    blocks with a clear player-facing reason; at/above it the branch unlocks.
 *    Chosen (60) to be reachable in a handful of `train` clicks (each grants
 *    {@link TRAIN_DATA_FIRE_PER_ACTION} = 10 Fire Data) so the SUCCESS path is
 *    demonstrable today (the A-12 "observable-today" principle applied to Data).
 *  - `cost`: the variant's OWN Meat price — a variant is just another priced
 *    `EvolutionStep`, so it DEBITS + writes an `action:'evolve'` audit row exactly
 *    like the linear branch (invariant 3 unchanged). Kept in the same affordable
 *    band (A-15) so one collect covers it.
 *  - `into`: the absolute variant form (e.g. Meramon), same shape as the linear
 *    `into` — the service writes it directly onto the row.
 */
export interface EvolutionVariant {
  dataType: 'Fire';
  requiredData: number;
  cost: EvolutionCost;
  into: EvolutionStep['into'];
  /**
   * TASK-215 (R-27a, A-196) — the variant twin of {@link EvolutionStep.intoOptions}:
   * the SET of valid Champion forms the accumulation-gated VARIANT branch can draw
   * from. OPTIONAL + purely ADDITIVE (invariant 5): a variant WITHOUT `intoOptions`
   * (there are none besides Agumon) keeps its single fixed {@link into} verbatim —
   * `pickEvolutionVariant` falls back to `[into]`. When present, its FIRST entry MUST
   * be byte-identical to {@link into} — the LOAD-BEARING identity anchor: at
   * `rng() === 0` (`DEFAULT_RNG`, the production-default / every no-rng caller and
   * every existing variant fixture) `pickEvolutionVariant` draws index 0 → the primary
   * form (Meramon) verbatim, so every existing variant/adaptive fixture stays green
   * with NO re-pin. Every option is a full stage-valid Champion (A-42 untriggered —
   * stats only advance). ONE variant cost regardless of the drawn form (per-option
   * variant costs stay a carved-off follow-on child). A two-way-door DATA choice.
   */
  intoOptions?: readonly EvolutionInto[];
}

export interface EvolutionStep {
  /**
   * Minimum CURRENT level required to evolve. Deliberately LOW (1) so a freshly
   * seeded level-1 starter already meets it and the SUCCESS path is demonstrable
   * immediately (A-12). As of TASK-29 (R-6) `level` finally MOVES — a discrete
   * `POST /digimon/:id/train` grants XP that levels a Digimon up — so a higher/tiered
   * gate is now MEANINGFUL (a player can train toward it) rather than making nothing
   * ever evolvable. This step keeps the gate at 1 (TASK-29 does not change the gates);
   * tiered `requiredLevel` bumps are a later ADDITIVE slice that READS the level
   * training now advances (orthogonal to this task, R-8b carve-out).
   */
  requiredLevel: number;
  /**
   * The resource PRICE of THIS evolution step (TASK-24, R-8b) — the FIRST economic
   * SPEND. Evolving DEBITS `cost.amount` of `cost.resource` from the player's
   * spendable {@link ResourceBalance} (and is blocked with a clear 422 reason if
   * they cannot afford it). PURE data — the sufficiency-check/decrement/audit-row
   * live in `DigimonService.evolve`'s `$transaction`, not here.
   */
  cost: EvolutionCost;
  /** The form the Digimon becomes — absolute new stats (see interface note). */
  into: EvolutionInto;
  /**
   * TASK-188 (R-27) — the SET of valid next forms this species can digivolve into,
   * seeded as pure TS data from the digi-api evolution list (a keyless DATA SOURCE —
   * NO live network call, so this does NOT park). RANDOM VALID DIGIVOLUTION draws one
   * of these server-side through the injected `rng` seam ({@link pickEvolution}), so
   * re-evolving the same rookie can yield DIFFERENT valid champions instead of one
   * fixed target — the RPG "several legitimate evolutions" backbone.
   *
   * OPTIONAL + purely ADDITIVE (invariant 5): a step WITHOUT `intoOptions` keeps its
   * single fixed {@link into} verbatim (`pickEvolution` falls back to `[into]`). When
   * present, its FIRST entry MUST be byte-identical to {@link into} (the current fixed
   * target) — the LOAD-BEARING identity anchor: at `rng() === 0` (`DEFAULT_RNG`, the
   * production-default / every no-rng caller) `pickEvolution` draws index 0 → the
   * primary form verbatim, so every existing evolve fixture stays green with NO
   * re-pin. Every option is a full `stage`-valid Champion form (same shape as `into`),
   * so evolution still only ADVANCES stats — A-42 (the HP-loop invariant) is untriggered.
   * A two-way-door DATA choice (A-170): re-tuned / extended with zero migration.
   */
  intoOptions?: readonly EvolutionInto[];
  /**
   * An OPTIONAL second, VARIANT branch (TASK-30, R-16) unlocked by accumulating a
   * typed Data stat past a threshold — the "steer WHERE it evolves by what it
   * accumulates" mechanism. Purely ADDITIVE (invariant 5): a step WITHOUT a
   * `variant` (Gabumon/Patamon here) behaves exactly as it did before this task,
   * and the linear branch of a step WITH a variant is unchanged. See
   * {@link EvolutionVariant} and {@link resolveEvolutionBranch}.
   */
  variant?: EvolutionVariant;
}

/**
 * The evolution chain, keyed by the CURRENT Digimon `name`. A name that is ABSENT
 * from this map has no further evolution (a terminal form) — `resolveEvolution`
 * treats a missing key as "no further evolution", so terminal forms need no entry.
 *
 * Seeds the three starter lines to their canonical Champion forms
 * (Agumon→Greymon, Gabumon→Garurumon, Patamon→Angemon). The `into` stats are a
 * deliberate, clear power bump over the Rookie form (each starter totals 82 across
 * hp/atk/def/spd at Rookie; each Champion totals 146+, and every individual stat
 * rises) — they are a LOW-CONFIDENCE balancing choice (A-12) that a later balance
 * pass can retune; the invariant this file guarantees is only that they are
 * positive integers and a strict upgrade, which evolution.spec.ts asserts.
 *
 * Each step also carries a `cost` (TASK-24, R-8b — the FIRST economic SPEND). All
 * three are priced in `Meat` with a LOW, affordable-from-one-collect `amount`
 * (40/50/45, all far under the Meat Farm's 1440 cap and coverable by a modest
 * `POST /farm/collect` — the Meat Farm banks 60/hr, so under an hour of accrual
 * already covers any of them). Pinning the SAME resource (`Meat`) across all three
 * keeps the slice simple; the per-line amounts vary only to prove the debit uses
 * the step's OWN cost, not a constant. Like the stats, these are a low-confidence
 * balance choice (A-15) a later pass can retune — the guarantee this file makes is
 * only that every step's amount is a positive integer within the affordable band,
 * which evolution.spec.ts asserts. The cost is PURE TS data (invariant 5: no schema
 * column / migration for it; the balance/ledger it debits already exist, TASK-21).
 *
 * `readonly` + `as const`: a fixed definition, never mutated at runtime — frozen at
 * the type level so a consumer cannot accidentally edit the shared map (identical
 * discipline to `STARTER_DIGIMON`). Deeper chains (Champion→Ultimate→Mega),
 * branching targets and de-evolution are later ADDITIVE entries in this same map.
 */
export const EVOLUTION_LINES: Readonly<Record<string, EvolutionStep>> = {
  Agumon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 40 },
    into: { name: 'Greymon', stage: 'Champion', hp: 90, atk: 26, def: 18, spd: 12 },
    // TASK-188 (R-27): Agumon's REAL digi-api evolution SET — several legitimate
    // Champion forms it can digivolve into. `pickEvolution` draws one at random
    // (server-side, through the injected LIVE_RNG seam) so re-evolving an Agumon can
    // land a DIFFERENT valid champion each time, never an off-list form. FIRST entry
    // is Greymon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Greymon verbatim
    // (the invariant-5 identity anchor). Tyrannomon/Centarumon are distinct stat
    // spreads (a low-confidence balance choice, A-170, retunable) drawn only on higher
    // rolls. Each is a full stage-valid Champion (A-42 untriggered — stats only advance).
    intoOptions: [
      { name: 'Greymon', stage: 'Champion', hp: 90, atk: 26, def: 18, spd: 12 },
      { name: 'Tyrannomon', stage: 'Champion', hp: 92, atk: 24, def: 20, spd: 10 },
      { name: 'Centarumon', stage: 'Champion', hp: 86, atk: 22, def: 22, spd: 16 },
    ],
    // TASK-30 (R-16): Agumon's SECOND, VARIANT branch — accumulate 60 Fire Data (a
    // handful of `train` clicks at 10 each) and Agumon can instead evolve into the
    // fiery Meramon. A normal priced step (its own Meat 45 cost, affordable from one
    // collect, mirroring A-15) — it DEBITs + audits exactly like the linear branch.
    // Meramon's stats are a distinct spread from Greymon's (higher atk/spd, lower def)
    // so the two Champion forms feel genuinely different — a low-confidence balance
    // choice (A-12) a later pass can retune.
    variant: {
      dataType: 'Fire',
      requiredData: 60,
      cost: { resource: 'Meat', amount: 45 },
      into: { name: 'Meramon', stage: 'Champion', hp: 84, atk: 30, def: 14, spd: 16 },
      // TASK-215 (R-27a, A-196): the Fire-Data VARIANT branch's REAL digi-api form
      // SET — random Champion draw via `pickEvolutionVariant` through the injected
      // LIVE_RNG seam, mirroring the linear branch (TASK-188) but on the accumulation-
      // gated branch. FIRST entry is Meramon — byte-identical to the fixed `into`
      // above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller + every existing
      // variant/adaptive fixture) the draw returns Meramon verbatim (the invariant-5
      // identity anchor). Flarerizamon/Meteormon are genuine digi-api Fire/beast-affine
      // Champions with distinct stat spreads (a low-confidence balance choice, A-196,
      // retunable) drawn only on higher rolls. Each is a full stage-valid Champion
      // (A-42 untriggered — stats only advance). NO per-option cost — the variant keeps
      // ONE cost (invariant 3), per-option variant costs stay a carved-off child.
      intoOptions: [
        { name: 'Meramon', stage: 'Champion', hp: 84, atk: 30, def: 14, spd: 16 },
        { name: 'Flarerizamon', stage: 'Champion', hp: 88, atk: 32, def: 16, spd: 14 },
        { name: 'Meteormon', stage: 'Champion', hp: 94, atk: 28, def: 24, spd: 10 },
      ],
    },
  },
  Gabumon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 50 },
    into: { name: 'Garurumon', stage: 'Champion', hp: 88, atk: 22, def: 24, spd: 14 },
    // TASK-207 (R-27a, A-184): Gabumon's REAL digi-api evolution SET — random
    // Champion draw via `pickEvolution` through the injected LIVE_RNG seam, exactly
    // as Agumon (TASK-188) branches. FIRST entry is Garurumon — byte-identical to the
    // fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng
    // caller/fixture) the draw returns Garurumon verbatim (the invariant-5 identity
    // anchor; evolution.spec.ts:204 pins intoOptions[0]===into). Fugamon/Gaogamon are
    // distinct Champion stat spreads (a low-confidence balance choice, A-184,
    // retunable) drawn only on higher rolls. Each is a full stage-valid Champion
    // (A-42 untriggered — stats only advance). ONE cost per source species (the
    // shipped shape); per-target divergent costs are a carved-off follow-on child.
    intoOptions: [
      { name: 'Garurumon', stage: 'Champion', hp: 88, atk: 22, def: 24, spd: 14 },
      { name: 'Fugamon', stage: 'Champion', hp: 90, atk: 26, def: 16, spd: 12 },
      { name: 'Gaogamon', stage: 'Champion', hp: 84, atk: 24, def: 18, spd: 20 },
    ],
  },
  Patamon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 },
    into: { name: 'Angemon', stage: 'Champion', hp: 82, atk: 24, def: 16, spd: 22 },
    // TASK-207 (R-27a, A-184): Patamon's REAL digi-api evolution SET — same add-only
    // random-draw seam as Agumon/Gabumon. FIRST entry is Angemon — byte-identical to
    // the fixed `into` above — the invariant-5 identity anchor returned at
    // `rng()===0` (`DEFAULT_RNG`). Unimon/Reppamon are distinct Champion stat spreads
    // (low-confidence balance, A-184, retunable) drawn only on higher rolls; each a
    // full stage-valid Champion (A-42 untriggered). ONE cost per source species.
    intoOptions: [
      { name: 'Angemon', stage: 'Champion', hp: 82, atk: 24, def: 16, spd: 22 },
      { name: 'Unimon', stage: 'Champion', hp: 88, atk: 22, def: 20, spd: 18 },
      { name: 'Reppamon', stage: 'Champion', hp: 80, atk: 26, def: 14, spd: 24 },
    ],
  },
  Biyomon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 },
    into: { name: 'Birdramon', stage: 'Champion', hp: 84, atk: 26, def: 16, spd: 20 },
    // TASK-208 (R-27a, A-189): Biyomon — a previously-TERMINAL FIRST_SEASON starter
    // (Vaccine/Fire, digimon.seed.ts:121-131) with NO EVOLUTION_LINES entry until now,
    // so `resolveEvolution` returned "no further evolution" and the evolve route
    // rejected it. Adding this entry is what makes it evolvable — a pure ADDITIVE DATA
    // change on the SAME add-only seam as Agumon/Gabumon/Patamon (`pickEvolution` is
    // byte-unchanged; it already walks whatever `intoOptions` a step declares). FIRST
    // entry is Birdramon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Birdramon verbatim
    // (the invariant-5 identity anchor). Aquilamon/Kabukimon are its real digi-api
    // non-primary Champion forms, distinct stat spreads (a low-confidence balance
    // choice, A-189, retunable) drawn only on higher LIVE_RNG rolls. Each is a full
    // stage-valid Champion (A-42 untriggered — stats only advance). ONE cost per source
    // species (the shipped shape); per-target divergent costs stay a carved-off child.
    intoOptions: [
      { name: 'Birdramon', stage: 'Champion', hp: 84, atk: 26, def: 16, spd: 20 },
      { name: 'Aquilamon', stage: 'Champion', hp: 88, atk: 24, def: 18, spd: 18 },
      { name: 'Kabukimon', stage: 'Champion', hp: 82, atk: 22, def: 22, spd: 16 },
    ],
  },
  Tentomon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 },
    into: { name: 'Kabuterimon', stage: 'Champion', hp: 90, atk: 24, def: 22, spd: 14 },
    // TASK-209 (R-27a, A-190): Tentomon — a previously-TERMINAL FIRST_SEASON starter
    // (Vaccine/Electric, digimon.seed.ts:132-142) with NO EVOLUTION_LINES entry until
    // now, so `resolveEvolution` returned "no further evolution" and the evolve route
    // rejected it. Adding this entry is what makes it evolvable — a pure ADDITIVE DATA
    // change on the SAME add-only seam as Agumon/Gabumon/Patamon/Biyomon (`pickEvolution`
    // is byte-unchanged; it already walks whatever `intoOptions` a step declares). FIRST
    // entry is Kabuterimon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Kabuterimon verbatim
    // (the invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into).
    // Aquilamon/Kuwagamon are its real digi-api non-primary Champion forms (insect/
    // electric-affinity), distinct stat spreads (a low-confidence balance choice, A-190,
    // retunable) drawn only on higher LIVE_RNG rolls. Each is a full stage-valid Champion
    // (A-42 untriggered — stats only advance). ONE cost per source species (the shipped
    // shape); per-target divergent costs stay a carved-off follow-on child.
    intoOptions: [
      { name: 'Kabuterimon', stage: 'Champion', hp: 90, atk: 24, def: 22, spd: 14 },
      { name: 'Aquilamon', stage: 'Champion', hp: 88, atk: 24, def: 18, spd: 18 },
      { name: 'Kuwagamon', stage: 'Champion', hp: 86, atk: 28, def: 18, spd: 16 },
    ],
  },
  Palmon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 },
    into: { name: 'Togemon', stage: 'Champion', hp: 88, atk: 26, def: 18, spd: 16 },
    // TASK-210 (R-27a, A-191): Palmon — a previously-TERMINAL FIRST_SEASON starter
    // (Data/Nature, digimon.seed.ts:144) with NO EVOLUTION_LINES entry until now, so
    // `resolveEvolution` returned "no further evolution" and the evolve route rejected
    // it. Adding this entry is what makes it evolvable — a pure ADDITIVE DATA change on
    // the SAME add-only seam as Agumon/Gabumon/Patamon/Biyomon/Tentomon (`pickEvolution`
    // is byte-unchanged; it already walks whatever `intoOptions` a step declares). FIRST
    // entry is Togemon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Togemon verbatim
    // (the invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into).
    // Woodmon/Kuwagamon are its real digi-api nature/plant-affine non-primary Champion
    // forms, distinct stat spreads (a low-confidence balance choice, A-191, retunable)
    // drawn only on higher LIVE_RNG rolls. Each is a full stage-valid Champion (A-42
    // untriggered — stats only advance). ONE cost per source species (the shipped
    // shape); per-target divergent costs stay a carved-off follow-on child.
    intoOptions: [
      { name: 'Togemon', stage: 'Champion', hp: 88, atk: 26, def: 18, spd: 16 },
      { name: 'Woodmon', stage: 'Champion', hp: 92, atk: 22, def: 22, spd: 12 },
      { name: 'Kuwagamon', stage: 'Champion', hp: 84, atk: 28, def: 16, spd: 18 },
    ],
  },
  Gomamon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 },
    into: { name: 'Ikkakumon', stage: 'Champion', hp: 94, atk: 24, def: 20, spd: 14 },
    // TASK-211 (R-27a, A-192): Gomamon — a previously-TERMINAL FIRST_SEASON starter
    // (Vaccine/Water, digimon.seed.ts:154-164) with NO EVOLUTION_LINES entry until now,
    // so `resolveEvolution` returned "no further evolution" and the evolve route
    // rejected it. Adding this entry is what makes it evolvable — a pure ADDITIVE DATA
    // change on the SAME add-only seam as Agumon/Gabumon/Patamon/Biyomon/Tentomon/Palmon
    // (`pickEvolution` is byte-unchanged; it already walks whatever `intoOptions` a step
    // declares). FIRST entry is Ikkakumon — byte-identical to the fixed `into` above —
    // so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns
    // Ikkakumon verbatim (the invariant-5 identity anchor; evolution.spec.ts pins
    // intoOptions[0]===into). Coelamon/Shellmon are its real digi-api water/aquatic-affine
    // non-primary Champion forms, distinct stat spreads (a low-confidence balance choice,
    // A-192, retunable) drawn only on higher LIVE_RNG rolls. Each is a full stage-valid
    // Champion (A-42 untriggered — stats only advance).
    // TASK-214 (R-27a, A-195) — RESOURCE-VARYING PER-TARGET COST, the FIRST override
    // that names a DIFFERENT currency (not just a higher amount, as TASK-213's Veedramon
    // did with `Meat 60`). The source/primary price stays `Meat 45` (bound above, paid
    // whenever a form WITHOUT an override lands — Ikkakumon the anchor, Coelamon the
    // fossil form). Shellmon — a bulky aquatic champion — carries its OWN
    // `cost: Bits 30` override, so a player who draws it is debited out of the `Bits`
    // ResourceBalance row (a different currency entirely) and the AuditLog records
    // `resource: 'Bits'`, while every other option/species keeps debiting the source
    // `Meat` cost verbatim (invariant 5 — the `into.cost ?? sourceCost` fallback in
    // DigimonService.evolve is the byte-proof; the evolve $transaction is fully
    // resource-agnostic, reading cost.resource at the balance read/guard/decrement/audit,
    // so a Bits override flows through with ZERO service change). This exhausts the
    // amount-only-vs-resource-varying distinction; more-species divergent costs +
    // variant-branch randomization stay carved-off follow-on children.
    intoOptions: [
      { name: 'Ikkakumon', stage: 'Champion', hp: 94, atk: 24, def: 20, spd: 14 },
      { name: 'Coelamon', stage: 'Champion', hp: 86, atk: 26, def: 18, spd: 18 },
      {
        name: 'Shellmon',
        stage: 'Champion',
        hp: 96,
        atk: 22,
        def: 24,
        spd: 10,
        cost: { resource: 'Bits', amount: 30 },
      },
    ],
  },
  Veemon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 },
    into: { name: 'ExVeemon', stage: 'Champion', hp: 90, atk: 28, def: 18, spd: 16 },
    // TASK-212 (R-27a, A-193): Veemon — the LAST previously-TERMINAL FIRST_SEASON
    // starter (Free/Neutral, digimon.seed.ts:165-175) with NO EVOLUTION_LINES entry
    // until now, so `resolveEvolution` returned "no further evolution" and the evolve
    // route rejected it. Adding this entry is what makes it evolvable — a pure ADDITIVE
    // DATA change on the SAME add-only seam as Agumon/Gabumon/Patamon/Biyomon/Tentomon/
    // Palmon/Gomamon (`pickEvolution` is byte-unchanged; it already walks whatever
    // `intoOptions` a step declares). This slice CLOSES the whole-roster starter child —
    // no terminal FIRST_SEASON starter remains after it. FIRST entry is ExVeemon —
    // byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`, every
    // no-rng caller/fixture) the draw returns ExVeemon verbatim (the invariant-5 identity
    // anchor; evolution.spec.ts pins intoOptions[0]===into). Veedramon/Lynxmon are its
    // real digi-api dragon/beast-affine non-primary Champion forms, distinct stat spreads
    // (a low-confidence balance choice, A-193, retunable) drawn only on higher LIVE_RNG
    // rolls. Each is a full stage-valid Champion (A-42 untriggered — stats only advance).
    // TASK-213 (R-27a, A-194) — PER-TARGET DIVERGENT COST. The source/primary price
    // stays `Meat 45` (bound above, and paid whenever a form WITHOUT an override
    // lands — ExVeemon the anchor, Lynxmon the beast form). Veedramon — the stronger
    // dragon champion — carries its OWN `cost: Meat 60` override, so a player who
    // draws it is debited 60 and the AuditLog records that amount, while every other
    // option/species keeps debiting the source cost verbatim (invariant 5 — the
    // `into.cost ?? sourceCost` fallback in DigimonService.evolve is the byte-proof).
    // Same resource, higher amount (simple affordability reasoning); a resource-varying
    // override is a trivial future add on the same optional `cost?` shape.
    intoOptions: [
      { name: 'ExVeemon', stage: 'Champion', hp: 90, atk: 28, def: 18, spd: 16 },
      {
        name: 'Veedramon',
        stage: 'Champion',
        hp: 86,
        atk: 30,
        def: 16,
        spd: 20,
        cost: { resource: 'Meat', amount: 60 },
      },
      { name: 'Lynxmon', stage: 'Champion', hp: 82, atk: 26, def: 14, spd: 24 },
    ],
  },
  Guilmon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped starter lines
    into: { name: 'Growlmon', stage: 'Champion', hp: 90, atk: 28, def: 18, spd: 14 },
    // TASK-251 (R-29, A-233): Guilmon — the Tamers/season-3 protagonist partner, seeded as a
    // level-1 Rookie starter at TASK-250 (digimon.seed.ts) but TERMINAL until now (no
    // EVOLUTION_LINES key → `resolveEvolution` returned "no further evolution" and the evolve
    // route rejected it). Adding this entry is what makes it evolvable — a pure ADDITIVE DATA
    // change on the SAME byte-unchanged `pickEvolution` seam as Agumon…Veemon. FIRST entry is
    // Growlmon — byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`,
    // every no-rng caller/fixture) the draw returns Growlmon verbatim (the invariant-5 identity
    // anchor; evolution.spec.ts pins intoOptions[0]===into). Tyrannomon/Meramon are real
    // digi-api Champion forms affine to Guilmon's Virus/Fire theme, distinct stat spreads (a
    // low-confidence balance choice, A-233, retunable) drawn only on higher LIVE_RNG rolls.
    // Each is a full stage-valid Champion (A-42 untriggered — stats only advance). ONE cost
    // per source species; per-target divergent costs stay a carved-off follow-on child.
    intoOptions: [
      { name: 'Growlmon', stage: 'Champion', hp: 90, atk: 28, def: 18, spd: 14 }, // === into, BYTE-IDENTICAL
      { name: 'Tyrannomon', stage: 'Champion', hp: 92, atk: 24, def: 20, spd: 10 },
      { name: 'Meramon', stage: 'Champion', hp: 84, atk: 30, def: 14, spd: 16 },
    ],
  },
  Renamon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Guilmon/starter lines
    into: { name: 'Kyubimon', stage: 'Champion', hp: 86, atk: 26, def: 16, spd: 22 },
    // TASK-252 (R-29, A-234): Renamon — the second Tamers/season-3 protagonist partner, seeded as a
    // level-1 Rookie starter at TASK-250 (digimon.seed.ts) but TERMINAL until now (no
    // EVOLUTION_LINES key → `resolveEvolution` returned "no further evolution" and the evolve
    // route rejected it), same as Guilmon before TASK-251. Adding this entry is what makes it
    // evolvable — a pure ADDITIVE DATA change on the SAME byte-unchanged `pickEvolution` seam as
    // Agumon…Veemon/Guilmon. FIRST entry is Kyubimon — byte-identical to the fixed `into` above —
    // so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Kyubimon
    // verbatim (the invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into).
    // Gatomon/Kabukimon are real digi-api Champion forms affine to Renamon's Data theme, distinct
    // stat spreads (a low-confidence balance choice, A-234, retunable) drawn only on higher
    // LIVE_RNG rolls. Each is a full stage-valid Champion (A-42 untriggered — stats only advance).
    // ONE cost per source species; per-target divergent costs stay a carved-off follow-on child.
    intoOptions: [
      { name: 'Kyubimon', stage: 'Champion', hp: 86, atk: 26, def: 16, spd: 22 }, // === into, BYTE-IDENTICAL
      { name: 'Gatomon', stage: 'Champion', hp: 82, atk: 28, def: 14, spd: 24 },
      { name: 'Kabukimon', stage: 'Champion', hp: 90, atk: 24, def: 20, spd: 12 },
    ],
  },
  Terriermon: {
    requiredLevel: 1,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Guilmon/Renamon/starter lines
    into: { name: 'Gargomon', stage: 'Champion', hp: 88, atk: 30, def: 16, spd: 18 },
    // TASK-253 (R-29, A-235): Terriermon — the THIRD and LAST Tamers/season-3 protagonist partner,
    // seeded as a level-1 Rookie starter at TASK-250 (digimon.seed.ts) but TERMINAL until now (no
    // EVOLUTION_LINES key → `resolveEvolution` returned "no further evolution" and the evolve route
    // rejected it), same as Guilmon before TASK-251 and Renamon before TASK-252. Adding this entry is
    // what makes it evolvable — a pure ADDITIVE DATA change on the SAME byte-unchanged `pickEvolution`
    // seam as Agumon…Veemon/Guilmon/Renamon, closing the whole Tamers roster (every seeded season-3
    // starter is now evolvable). FIRST entry is Gargomon — byte-identical to the fixed `into` above —
    // so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Gargomon verbatim
    // (the invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into). Woodmon/Leomon
    // are real digi-api Champion forms affine to Terriermon's Vaccine/Nature theme, distinct stat
    // spreads (a low-confidence balance choice, A-235, retunable) drawn only on higher LIVE_RNG rolls.
    // Each is a full stage-valid Champion (A-42 untriggered — stats only advance). ONE cost per source
    // species; per-target divergent costs stay a carved-off follow-on child.
    intoOptions: [
      { name: 'Gargomon', stage: 'Champion', hp: 88, atk: 30, def: 16, spd: 18 }, // === into, BYTE-IDENTICAL
      { name: 'Woodmon', stage: 'Champion', hp: 92, atk: 24, def: 20, spd: 10 },
      { name: 'Leomon', stage: 'Champion', hp: 90, atk: 32, def: 14, spd: 20 },
    ],
  },
  Greymon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Rookie→Champion lines
    into: { name: 'MetalGreymon', stage: 'Ultimate', hp: 120, atk: 42, def: 30, spd: 20 },
    // TASK-285 (R-17c/R-8, A-267, D-606): the FIRST Champion→Ultimate line — the second
    // evolution tier ships. Greymon was TERMINAL until now (no EVOLUTION_LINES key → it is
    // the SAME dead end every other Champion still hits: `resolveEvolution` returned "no
    // further evolution" and the evolve route rejected it), self-flagged unbuilt above
    // (Champion→Ultimate→Mega). Greymon is chosen because it is Agumon's intoOptions[0]/into
    // — the DEFAULT_RNG (index-0) draw — so it is the single MOST-reachable Champion: a player
    // who evolves an Agumon lands a Greymon by default and can now evolve it a SECOND time.
    // Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it already walks whatever
    // `intoOptions` a step declares, regardless of source/target stage). FIRST entry is
    // MetalGreymon — byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`,
    // every no-rng caller/fixture) the draw returns MetalGreymon verbatim (the invariant-5
    // identity anchor; evolution.spec.ts pins intoOptions[0]===into). SkullGreymon/RizeGreymon
    // are real digi-api Greymon-line Ultimates, distinct stat spreads (a low-confidence balance
    // choice, A-267, retunable) drawn only on higher LIVE_RNG rolls. Each is a full stage-valid
    // Ultimate sitting ABOVE the Champion band (A-42 untriggered — stats only advance). ONE cost
    // per source; per-target divergent Ultimate costs, a variant branch, and the Ultimate→Mega
    // third tier stay carved-off follow-on children.
    intoOptions: [
      { name: 'MetalGreymon', stage: 'Ultimate', hp: 120, atk: 42, def: 30, spd: 20 }, // === into, BYTE-IDENTICAL
      { name: 'SkullGreymon', stage: 'Ultimate', hp: 125, atk: 46, def: 24, spd: 18 },
      { name: 'RizeGreymon', stage: 'Ultimate', hp: 115, atk: 40, def: 28, spd: 26 },
    ],
  },
  Garurumon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Greymon Ultimate line (:540)
    into: { name: 'WereGarurumon', stage: 'Ultimate', hp: 118, atk: 44, def: 26, spd: 24 },
    // TASK-286 (R-17c/R-8, A-268, D-608): the SECOND Champion→Ultimate line — mirrors the shipped
    // Greymon block (:538) one tier at a time. Garurumon was TERMINAL until now (no EVOLUTION_LINES
    // key → the SAME dead end Greymon just escaped: `resolveEvolution` returned "no further
    // evolution" and the evolve route rejected it). Garurumon is chosen because it is Gabumon's
    // into/intoOptions[0] — the DEFAULT_RNG (index-0) draw — so it is the most-reachable Champion
    // after Greymon: a player who evolves a Gabumon lands a Garurumon by default and can now evolve
    // it a SECOND time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it already
    // walks whatever `intoOptions` a step declares, regardless of source/target stage). FIRST entry
    // is WereGarurumon — byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`,
    // every no-rng caller/fixture) the draw returns WereGarurumon verbatim (the invariant-5 identity
    // anchor; evolution.spec.ts pins intoOptions[0]===into). Panjyamon/MegaSeadramon are real
    // digi-api Ultimates, distinct stat spreads (a low-confidence balance choice, A-268, retunable)
    // drawn only on higher LIVE_RNG rolls. Each is a full stage-valid Ultimate sitting ABOVE the
    // Champion band (A-42 untriggered — stats only advance). ONE cost per source; per-target
    // divergent Ultimate costs, a variant branch, and the Ultimate→Mega third tier stay carved-off
    // follow-on children.
    intoOptions: [
      { name: 'WereGarurumon', stage: 'Ultimate', hp: 118, atk: 44, def: 26, spd: 24 }, // === into, BYTE-IDENTICAL
      { name: 'Panjyamon', stage: 'Ultimate', hp: 124, atk: 40, def: 30, spd: 18 },
      { name: 'MegaSeadramon', stage: 'Ultimate', hp: 128, atk: 42, def: 28, spd: 16 },
    ],
  },
  Angemon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Greymon/Garurumon Ultimate lines (:540/:567)
    into: { name: 'MagnaAngemon', stage: 'Ultimate', hp: 112, atk: 40, def: 26, spd: 30 },
    // TASK-287 (R-17c/R-8, A-269, D-610): the THIRD Champion→Ultimate line — mirrors the shipped
    // Greymon (:538) + Garurumon (:565) blocks one tier at a time. Angemon was TERMINAL until now
    // (no EVOLUTION_LINES key → the SAME dead end Greymon and Garurumon just escaped:
    // `resolveEvolution` returned "no further evolution" and the evolve route rejected it). Angemon
    // is chosen because it is Patamon's into/intoOptions[0] — the DEFAULT_RNG (index-0) draw — so it
    // is the most-reachable Champion after Greymon and Garurumon: a player who evolves a Patamon
    // lands an Angemon by default and can now evolve it a SECOND time. Pure ADDITIVE DATA on the
    // byte-unchanged `pickEvolution` seam (it already walks whatever `intoOptions` a step declares,
    // regardless of source/target stage). FIRST entry is MagnaAngemon — byte-identical to the fixed
    // `into` above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns
    // MagnaAngemon verbatim (the invariant-5 identity anchor; evolution.spec.ts pins
    // intoOptions[0]===into). Angewomon/SkullSatamon are real digi-api Angemon-line Ultimates,
    // distinct stat spreads (a low-confidence balance choice, A-269, retunable) drawn only on higher
    // LIVE_RNG rolls. Angemon is a speed-tilted Champion (hp82/atk24/def16/spd22) so the Ultimate
    // spreads keep that identity (highest spd on the primary). Each is a full stage-valid Ultimate
    // sitting ABOVE the Champion band (A-42 untriggered — stats only advance). ONE cost per source;
    // per-target divergent Ultimate costs, a variant branch, and the Ultimate→Mega third tier stay
    // carved-off follow-on children.
    intoOptions: [
      { name: 'MagnaAngemon', stage: 'Ultimate', hp: 112, atk: 40, def: 26, spd: 30 }, // === into, BYTE-IDENTICAL
      { name: 'Angewomon', stage: 'Ultimate', hp: 116, atk: 44, def: 24, spd: 26 },
      { name: 'SkullSatamon', stage: 'Ultimate', hp: 120, atk: 46, def: 22, spd: 20 },
    ],
  },
  Birdramon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Greymon/Garurumon/Angemon Ultimate lines (:540/:567/:593)
    into: { name: 'Garudamon', stage: 'Ultimate', hp: 116, atk: 42, def: 24, spd: 28 },
    // TASK-288 (R-17c/R-8, A-270, D-612): the FOURTH Champion→Ultimate line — mirrors the shipped
    // Greymon (:538) + Garurumon (:565) + Angemon (:591) blocks one tier at a time. Birdramon was
    // TERMINAL until now (no EVOLUTION_LINES key → the SAME dead end Greymon, Garurumon, and Angemon
    // just escaped: `resolveEvolution` returned "no further evolution" and the evolve route rejected
    // it). Birdramon is chosen because it is Biyomon's into/intoOptions[0] — the DEFAULT_RNG (index-0)
    // draw — so it is the most-reachable Champion after Greymon, Garurumon, and Angemon: a player who
    // evolves a Biyomon lands a Birdramon by default and can now evolve it a SECOND time. Pure ADDITIVE
    // DATA on the byte-unchanged `pickEvolution` seam (it already walks whatever `intoOptions` a step
    // declares, regardless of source/target stage). FIRST entry is Garudamon — byte-identical to the
    // fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw
    // returns Garudamon verbatim (the invariant-5 identity anchor; evolution.spec.ts pins
    // intoOptions[0]===into). Karatenmon/Crowmon are real digi-api bird/Birdramon-line Ultimates,
    // distinct stat spreads (a low-confidence balance choice, A-270, retunable) drawn only on higher
    // LIVE_RNG rolls. Birdramon is a fire/flying Champion (hp84/atk26/def16/spd20) so the Ultimate
    // spreads keep that identity (highest spd on the primary). Each is a full stage-valid Ultimate
    // sitting ABOVE the Champion band (A-42 untriggered — stats only advance). ONE cost per source;
    // per-target divergent Ultimate costs, a variant branch, and the Ultimate→Mega third tier stay
    // carved-off follow-on children.
    intoOptions: [
      { name: 'Garudamon', stage: 'Ultimate', hp: 116, atk: 42, def: 24, spd: 28 }, // === into, BYTE-IDENTICAL
      { name: 'Karatenmon', stage: 'Ultimate', hp: 112, atk: 46, def: 22, spd: 30 },
      { name: 'Crowmon', stage: 'Ultimate', hp: 120, atk: 44, def: 26, spd: 24 },
    ],
  },
  Kabuterimon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Greymon/Garurumon/Angemon/Birdramon Ultimate lines (:540/:567/:593/:621)
    into: { name: 'MegaKabuterimon', stage: 'Ultimate', hp: 122, atk: 44, def: 30, spd: 18 },
    // TASK-289 (R-17c/R-8, A-271, D-614): the FIFTH Champion→Ultimate line — mirrors the shipped
    // Greymon (:538) + Garurumon (:565) + Angemon (:591) + Birdramon (:619) blocks one tier at a time.
    // Kabuterimon was TERMINAL until now (no EVOLUTION_LINES key → the SAME dead end Greymon, Garurumon,
    // Angemon, and Birdramon just escaped: `resolveEvolution` returned "no further evolution" and the
    // evolve route rejected it). Kabuterimon is chosen because it is Tentomon's into/intoOptions[0]
    // (:340) — the DEFAULT_RNG (index-0) draw — so it is the most-reachable Champion after Greymon,
    // Garurumon, Angemon, and Birdramon: a player who evolves a Tentomon lands a Kabuterimon by default
    // and can now evolve it a SECOND time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam
    // (it already walks whatever `intoOptions` a step declares, regardless of source/target stage). FIRST
    // entry is MegaKabuterimon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns MegaKabuterimon verbatim (the
    // invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into). Okuwamon/Digitamamon are
    // real digi-api insect/Kabuterimon-line Ultimates, distinct stat spreads (a low-confidence balance
    // choice, A-271, retunable) drawn only on higher LIVE_RNG rolls. Kabuterimon is an insect/electric
    // Champion (hp90/atk24/def22/spd14) so the Ultimate spreads keep that identity (highest def on the
    // primary, its bulky-bug niche). Each is a full stage-valid Ultimate sitting ABOVE the Champion band
    // (A-42 untriggered — stats only advance). ONE cost per source; per-target divergent Ultimate costs,
    // a variant branch, and the Ultimate→Mega third tier stay carved-off follow-on children.
    intoOptions: [
      { name: 'MegaKabuterimon', stage: 'Ultimate', hp: 122, atk: 44, def: 30, spd: 18 }, // === into, BYTE-IDENTICAL
      { name: 'Okuwamon', stage: 'Ultimate', hp: 118, atk: 48, def: 26, spd: 22 },
      { name: 'Digitamamon', stage: 'Ultimate', hp: 126, atk: 42, def: 32, spd: 16 },
    ],
  },
  Togemon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Greymon/Garurumon/Angemon/Birdramon/Kabuterimon Ultimate lines (:540/:567/:593/:621/:649)
    into: { name: 'Lillymon', stage: 'Ultimate', hp: 114, atk: 40, def: 22, spd: 30 },
    // TASK-290 (R-17c/R-8, A-272, D-615): the SIXTH Champion→Ultimate line — mirrors the shipped
    // Greymon (:538) + Garurumon (:565) + Angemon (:591) + Birdramon (:619) + Kabuterimon (:647) blocks
    // one tier at a time. Togemon was TERMINAL until now (no EVOLUTION_LINES key → the SAME dead end the
    // first five primaries just escaped: `resolveEvolution` returned "no further evolution" and the evolve
    // route rejected it). Togemon is chosen because it is Palmon's into/intoOptions[0] (:364) — the
    // DEFAULT_RNG (index-0) draw — so it is the most-reachable Champion after Greymon, Garurumon, Angemon,
    // Birdramon, and Kabuterimon: a player who evolves a Palmon lands a Togemon by default and can now
    // evolve it a SECOND time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it already
    // walks whatever `intoOptions` a step declares, regardless of source/target stage). FIRST entry is
    // Lillymon — byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng
    // caller/fixture) the draw returns Lillymon verbatim (the invariant-5 identity anchor; evolution.spec.ts
    // pins intoOptions[0]===into). Blossomon/Cherrymon are real digi-api nature/plant-line Ultimates,
    // distinct stat spreads (a low-confidence balance choice, A-272, retunable) drawn only on higher
    // LIVE_RNG rolls. Togemon is a nature/plant Champion (hp88/atk26/def18/spd16, :364) so the Ultimate
    // spreads keep that identity while advancing above the Champion band (the agile Lillymon primary leads
    // on spd, its fairy-plant niche). Each is a full stage-valid Ultimate sitting ABOVE the Champion band
    // (A-42 untriggered — stats only advance). ONE cost per source; per-target divergent Ultimate costs,
    // a variant branch, and the Ultimate→Mega third tier stay carved-off follow-on children.
    intoOptions: [
      { name: 'Lillymon', stage: 'Ultimate', hp: 114, atk: 40, def: 22, spd: 30 }, // === into, BYTE-IDENTICAL
      { name: 'Blossomon', stage: 'Ultimate', hp: 122, atk: 44, def: 26, spd: 20 },
      { name: 'Cherrymon', stage: 'Ultimate', hp: 126, atk: 42, def: 30, spd: 16 },
    ],
  },
  Ikkakumon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Greymon/Garurumon/Angemon/Birdramon/Kabuterimon/Togemon Ultimate lines (:540/:567/:593/:621/:649/:677)
    into: { name: 'Zudomon', stage: 'Ultimate', hp: 130, atk: 42, def: 32, spd: 16 },
    // TASK-291 (R-17c/R-8, A-273, D-617): the SEVENTH Champion→Ultimate line — mirrors the shipped
    // Greymon (:538) + Garurumon (:565) + Angemon (:591) + Birdramon (:619) + Kabuterimon (:647) +
    // Togemon (:675) blocks one tier at a time. Ikkakumon was TERMINAL until now (no EVOLUTION_LINES
    // key → the SAME dead end the first six primaries just escaped: `resolveEvolution` returned "no
    // further evolution" and the evolve route rejected it). Ikkakumon is chosen because it is Gomamon's
    // into/intoOptions[0] (:388) — the DEFAULT_RNG (index-0) draw — so it is the most-reachable Champion
    // after Greymon, Garurumon, Angemon, Birdramon, Kabuterimon, and Togemon: a player who evolves a
    // Gomamon lands an Ikkakumon by default and can now evolve it a SECOND time. Pure ADDITIVE DATA on
    // the byte-unchanged `pickEvolution` seam (it already walks whatever `intoOptions` a step declares,
    // regardless of source/target stage). FIRST entry is Zudomon — byte-identical to the fixed `into`
    // above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Zudomon
    // verbatim (the invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into).
    // Whamon/MarineDevimon are real digi-api sea-beast/Ikkakumon-line Ultimates, distinct stat spreads
    // (a low-confidence balance choice, A-273, retunable) drawn only on higher LIVE_RNG rolls. Ikkakumon
    // is a sea-beast/ice Champion (hp92/atk28/def20/spd12, :388) so the Ultimate spreads keep that
    // identity — the bulky Zudomon primary leading on the hp/def niche while advancing above the Champion
    // band. Each is a full stage-valid Ultimate sitting ABOVE the Champion band (A-42 untriggered — stats
    // only advance). ONE cost per source; per-target divergent Ultimate costs, a variant branch, and the
    // Ultimate→Mega third tier stay carved-off follow-on children.
    intoOptions: [
      { name: 'Zudomon', stage: 'Ultimate', hp: 130, atk: 42, def: 32, spd: 16 }, // === into, BYTE-IDENTICAL
      { name: 'Whamon', stage: 'Ultimate', hp: 138, atk: 40, def: 28, spd: 18 },
      { name: 'MarineDevimon', stage: 'Ultimate', hp: 122, atk: 48, def: 24, spd: 22 },
    ],
  },
  ExVeemon: {
    requiredLevel: 5,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Greymon/Garurumon/Angemon/Birdramon/Kabuterimon/Togemon/Ikkakumon Ultimate lines (:540/:567/:593/:621/:649/:677/:705)
    into: { name: 'Paildramon', stage: 'Ultimate', hp: 134, atk: 46, def: 28, spd: 20 },
    // TASK-292 (R-17c/R-8, A-274, D-618): the EIGHTH — and FINAL PRIMARY — Champion→Ultimate line,
    // CLOSING the whole-roster primary-Champion Ultimate child. Mirrors the shipped Greymon (:538) +
    // Garurumon (:565) + Angemon (:591) + Birdramon (:619) + Kabuterimon (:647) + Togemon (:675) +
    // Ikkakumon (:703) blocks one tier at a time. ExVeemon was TERMINAL until now (no EVOLUTION_LINES
    // key → the SAME dead end the first seven primaries just escaped: `resolveEvolution` returned "no
    // further evolution" and the evolve route rejected it). ExVeemon is chosen because it is Veemon's
    // into/intoOptions[0] (:433) — the DEFAULT_RNG (index-0) draw — the last of the eight base-starter
    // primary Champions: a player who evolves a Veemon lands an ExVeemon by default and can now evolve
    // it a SECOND time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it already walks
    // whatever `intoOptions` a step declares, regardless of source/target stage). FIRST entry is
    // Paildramon — byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`, every
    // no-rng caller/fixture) the draw returns Paildramon verbatim (the invariant-5 identity anchor;
    // evolution.spec.ts pins intoOptions[0]===into). AeroVeedramon/Cyberdramon are real digi-api
    // dragon/ExVeemon-line Ultimates, distinct stat spreads (a low-confidence balance choice, A-274,
    // retunable) drawn only on higher LIVE_RNG rolls. ExVeemon is a dragon-man Champion (hp90/atk28/
    // def18/spd16, :433) so the Ultimate spreads keep that identity — the balanced Paildramon primary
    // leading while advancing above the Champion band. Each is a full stage-valid Ultimate sitting
    // ABOVE the Champion band (A-42 untriggered — stats only advance). ONE cost per source; per-target
    // divergent Ultimate costs, a variant branch, and the Ultimate→Mega third tier stay carved-off
    // follow-on children.
    intoOptions: [
      { name: 'Paildramon', stage: 'Ultimate', hp: 134, atk: 46, def: 28, spd: 20 }, // === into, BYTE-IDENTICAL
      { name: 'AeroVeedramon', stage: 'Ultimate', hp: 128, atk: 50, def: 24, spd: 26 },
      { name: 'Cyberdramon', stage: 'Ultimate', hp: 124, atk: 52, def: 26, spd: 24 },
    ],
  },
  MetalGreymon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Champion→Ultimate lines (:540 etc.)
    into: { name: 'WarGreymon', stage: 'Mega', hp: 150, atk: 56, def: 40, spd: 30 },
    // TASK-294 (R-17c/R-8 tier-extension, A-276, D-621): the FIRST Ultimate→Mega line — the THIRD and
    // DEEPEST evolution tier ships. MetalGreymon was TERMINAL until now (no EVOLUTION_LINES key → the
    // SAME dead end every Ultimate still hits: `resolveEvolution` returned "no further evolution" and
    // the evolve route rejected it). MetalGreymon is chosen because it is Greymon's into/intoOptions[0]
    // (:541) — the DEFAULT_RNG (index-0) draw — so it is the single MOST-reachable Ultimate: a player
    // who evolves Agumon→Greymon→MetalGreymon by default can now evolve it a THIRD time. Pure ADDITIVE
    // DATA on the byte-unchanged `pickEvolution` seam (it already walks whatever `intoOptions` a step
    // declares, regardless of source/target stage; `stage:'Mega'` is already a valid DigimonStage union
    // member — NO type change). Escalation pattern Rookie 1 → Champion 5 → Mega 7. FIRST entry is
    // WarGreymon — byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`, every
    // no-rng caller/fixture) the draw returns WarGreymon verbatim (the invariant-5 identity anchor;
    // evolution.spec.ts pins intoOptions[0]===into). BlackWarGreymon/VictoryGreymon are real digi-api
    // MetalGreymon-line/dragon Megas, distinct stat spreads (a low-confidence balance choice, A-276,
    // retunable) drawn only on higher LIVE_RNG rolls. Each is a full stage-valid Mega sitting ABOVE the
    // Ultimate MetalGreymon band (hp120/atk42/def30/spd20, :541 — A-42 untriggered, stats only advance).
    // ONE cost per source; the remaining 7 Ultimate→Mega lines, per-target divergent Mega costs, a
    // variant branch, and the Mega artwork widening stay carved-off follow-on children.
    intoOptions: [
      { name: 'WarGreymon', stage: 'Mega', hp: 150, atk: 56, def: 40, spd: 30 }, // === into, BYTE-IDENTICAL
      { name: 'BlackWarGreymon', stage: 'Mega', hp: 155, atk: 54, def: 44, spd: 26 },
      { name: 'VictoryGreymon', stage: 'Mega', hp: 148, atk: 60, def: 38, spd: 32 },
    ],
  },
  WereGarurumon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped MetalGreymon Mega line (:764)
    into: { name: 'MetalGarurumon', stage: 'Mega', hp: 152, atk: 54, def: 42, spd: 34 },
    // TASK-296 (R-17c/R-8 tier-extension, A-278, D-625): the SECOND Ultimate→Mega line, mirroring the
    // FIRST (MetalGreymon:, :762) verbatim. WereGarurumon was TERMINAL until now (no EVOLUTION_LINES key
    // → the SAME dead end MetalGreymon hit before TASK-294: `resolveEvolution` returned "no further
    // evolution" and the evolve route rejected it). WereGarurumon is chosen because it is Garurumon's
    // into/intoOptions[0] (:568) — the DEFAULT_RNG (index-0) draw — so it is the SECOND-most-reachable
    // Ultimate after MetalGreymon: a player who evolves Gabumon→Garurumon→WereGarurumon by default can
    // now evolve it a THIRD time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it
    // already walks whatever `intoOptions` a step declares, regardless of source/target stage;
    // `stage:'Mega'` is already a valid DigimonStage union member — NO type change). Escalation pattern
    // Rookie 1 → Champion 5 → Mega 7. FIRST entry is MetalGarurumon — byte-identical to the fixed `into`
    // above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns
    // MetalGarurumon verbatim (the invariant-5 identity anchor; evolution.spec.ts pins
    // intoOptions[0]===into). Boltmon/Cerberumon are real digi-api WereGarurumon-line/beast Megas, with
    // distinct stat spreads (a low-confidence balance choice, A-278, retunable) drawn only on higher
    // LIVE_RNG rolls. Each is a full stage-valid Mega sitting ABOVE the Ultimate WereGarurumon band
    // (hp118/atk44/def26/spd24, :568 — A-42 untriggered, stats only advance). ONE cost per source; the
    // remaining Ultimate→Mega lines, per-target divergent Mega costs, a variant branch, and the Mega
    // artwork widening stay carved-off follow-on children.
    intoOptions: [
      { name: 'MetalGarurumon', stage: 'Mega', hp: 152, atk: 54, def: 42, spd: 34 }, // === into, BYTE-IDENTICAL
      { name: 'Boltmon', stage: 'Mega', hp: 158, atk: 58, def: 38, spd: 28 },
      { name: 'Cerberumon', stage: 'Mega', hp: 146, atk: 60, def: 36, spd: 36 },
    ],
  },
  MagnaAngemon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped WereGarurumon Mega line (:791)
    into: { name: 'Seraphimon', stage: 'Mega', hp: 148, atk: 52, def: 40, spd: 38 },
    // TASK-298 (R-17c/R-8 tier-extension, A-280, D-629): the THIRD Ultimate→Mega line, mirroring the
    // FIRST (MetalGreymon:, :762) and SECOND (WereGarurumon:, :789) verbatim. MagnaAngemon was TERMINAL
    // until now (no EVOLUTION_LINES key → the SAME dead end the prior two hit: `resolveEvolution`
    // returned "MagnaAngemon has no further evolution" and the evolve route rejected it). MagnaAngemon is
    // chosen because it is Angemon's into/intoOptions[0] (:594) — the DEFAULT_RNG (index-0) draw — so it
    // is the THIRD-most-reachable Ultimate after MetalGreymon and WereGarurumon: a player who evolves
    // Patamon→Angemon→MagnaAngemon by default can now evolve it a THIRD time. Pure ADDITIVE DATA on the
    // byte-unchanged `pickEvolution` seam (it already walks whatever `intoOptions` a step declares,
    // regardless of source/target stage; `stage:'Mega'` is already a valid DigimonStage union member — NO
    // type change). Escalation pattern Rookie 1 → Champion 5 → Mega 7. FIRST entry is Seraphimon —
    // byte-identical to the fixed `into` above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng
    // caller/fixture) the draw returns Seraphimon verbatim (the invariant-5 identity anchor;
    // evolution.spec.ts pins intoOptions[0]===into). The primary Seraphimon carries the highest spd of
    // the three, keeping MagnaAngemon's speed-tilted angel identity (mirroring how the prior lines kept
    // the dragon/beast identity). Dominimon/Goldramon are real digi-api MagnaAngemon-line/angel/holy
    // Megas, with distinct stat spreads (a low-confidence balance choice, A-280, retunable) drawn only on
    // higher LIVE_RNG rolls. Each is a full stage-valid Mega sitting ABOVE the Ultimate MagnaAngemon band
    // (hp112/atk40/def26/spd30, :594 — A-42 untriggered, stats only advance). ONE cost per source; the
    // remaining Ultimate→Mega lines, per-target divergent Mega costs, a variant branch, and the Mega
    // artwork widening stay carved-off follow-on children.
    intoOptions: [
      { name: 'Seraphimon', stage: 'Mega', hp: 148, atk: 52, def: 40, spd: 38 }, // === into, BYTE-IDENTICAL
      { name: 'Dominimon', stage: 'Mega', hp: 156, atk: 50, def: 46, spd: 30 },
      { name: 'Goldramon', stage: 'Mega', hp: 152, atk: 60, def: 38, spd: 34 },
    ],
  },
  Garudamon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped MagnaAngemon Mega line (:819)
    into: { name: 'Hououmon', stage: 'Mega', hp: 150, atk: 56, def: 38, spd: 42 },
    // TASK-300 (R-17c/R-8 tier-extension, A-282, D-633): the FOURTH Ultimate→Mega line, mirroring the
    // FIRST (MetalGreymon:, :762), SECOND (WereGarurumon:, :789) and THIRD (MagnaAngemon:, :817) verbatim.
    // Garudamon was TERMINAL until now (no EVOLUTION_LINES key → the SAME dead end the prior three hit:
    // `resolveEvolution` returned "Garudamon has no further evolution" and the evolve route rejected it).
    // Garudamon is chosen because it is Birdramon's into/intoOptions[0] (:622) — the DEFAULT_RNG (index-0)
    // draw — so it is the FOURTH-most-reachable Ultimate after MetalGreymon, WereGarurumon and
    // MagnaAngemon: a player who evolves Biyomon→Birdramon→Garudamon by default can now evolve it a THIRD
    // time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it already walks whatever
    // `intoOptions` a step declares, regardless of source/target stage; `stage:'Mega'` is already a valid
    // DigimonStage union member — NO type change). Escalation pattern Rookie 1 → Champion 5 → Mega 7. The
    // primary is Hououmon (the canonical romanization of the Biyomon/Garudamon-line phoenix/bird apex Mega
    // — the digi-api key is `Hououmon`, NOT `Phoenixmon`, which is not a distinct digi-api key; verified
    // D-8 #1). FIRST entry is Hououmon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Hououmon verbatim (the invariant-5
    // identity anchor; evolution.spec.ts pins intoOptions[0]===into). The primary Hououmon carries the
    // highest spd of the three, keeping Garudamon's speed/attack-tilted bird identity (mirroring how the
    // prior lines kept the angel/beast/dragon identity). Valdurmon (Holy Bird) and Ornismon are real
    // digi-api Garudamon-line/bird/holy-beast Megas (both list Garudamon among their prior evolutions),
    // with distinct stat spreads (a low-confidence balance choice, A-282, retunable) drawn only on higher
    // LIVE_RNG rolls. Each is a full stage-valid Mega sitting ABOVE the Ultimate Garudamon band
    // (hp116/atk42/def24/spd28, :622 — A-42 untriggered, stats only advance). ONE cost per source; the
    // remaining Ultimate→Mega lines, per-target divergent Mega costs, a variant branch, and the Mega
    // artwork widening stay carved-off follow-on children.
    intoOptions: [
      { name: 'Hououmon', stage: 'Mega', hp: 150, atk: 56, def: 38, spd: 42 }, // === into, BYTE-IDENTICAL
      { name: 'Valdurmon', stage: 'Mega', hp: 158, atk: 52, def: 44, spd: 36 },
      { name: 'Ornismon', stage: 'Mega', hp: 154, atk: 62, def: 36, spd: 34 },
    ],
  },
  MegaKabuterimon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped Garudamon Mega line (:849)
    into: { name: 'HerculesKabuterimon', stage: 'Mega', hp: 158, atk: 52, def: 48, spd: 22 },
    // TASK-302 (R-17c/R-8 tier-extension, A-284, D-637): the FIFTH Ultimate→Mega line, mirroring the
    // FIRST (MetalGreymon:, :762), SECOND (WereGarurumon:, :789), THIRD (MagnaAngemon:, :817) and FOURTH
    // (Garudamon:, :847) verbatim. MegaKabuterimon was TERMINAL until now (no EVOLUTION_LINES key → the
    // SAME dead end the prior four hit: `resolveEvolution` returned "MegaKabuterimon has no further
    // evolution" and the evolve route rejected it). MegaKabuterimon is chosen because it is Kabuterimon's
    // into/intoOptions[0] (:650/:670) — the DEFAULT_RNG (index-0) draw — so it is the FIFTH-most-reachable
    // Ultimate after MetalGreymon, WereGarurumon, MagnaAngemon and Garudamon: a player who evolves
    // Tentomon→Kabuterimon→MegaKabuterimon by default can now evolve it a THIRD time. Pure ADDITIVE DATA
    // on the byte-unchanged `pickEvolution` seam (it already walks whatever `intoOptions` a step declares,
    // regardless of source/target stage; `stage:'Mega'` is already a valid DigimonStage union member — NO
    // type change). Escalation pattern Rookie 1 → Champion 5 → Mega 7. The primary is HerculesKabuterimon
    // (the canonical Kabuterimon-line beetle apex Mega — a distinct genuine digi-api key; verified D-8 #1).
    // FIRST entry is HerculesKabuterimon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns HerculesKabuterimon verbatim (the
    // invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into). The primary
    // HerculesKabuterimon carries the highest def of the three, keeping MegaKabuterimon's bulky/high-DEF
    // beetle identity (mirroring how the prior lines kept the bird/angel/beast/dragon identity).
    // GranKuwagamon (the Kuwagamon-line insect Mega apex) and TigerVespamon (the wasp/vespa Mega) are real
    // digi-api insect Megas, with distinct stat spreads (a low-confidence balance choice, A-284, retunable)
    // drawn only on higher LIVE_RNG rolls. Each is a full stage-valid Mega sitting ABOVE the Ultimate
    // MegaKabuterimon band (hp122/atk44/def30/spd18, :650 — A-42 untriggered, stats only advance). ONE cost
    // per source; the remaining Ultimate→Mega lines, per-target divergent Mega costs, a variant branch, and
    // the Mega artwork widening stay carved-off follow-on children.
    intoOptions: [
      { name: 'HerculesKabuterimon', stage: 'Mega', hp: 158, atk: 52, def: 48, spd: 22 }, // === into, BYTE-IDENTICAL
      { name: 'GranKuwagamon', stage: 'Mega', hp: 150, atk: 62, def: 40, spd: 30 },
      { name: 'TigerVespamon', stage: 'Mega', hp: 144, atk: 58, def: 38, spd: 36 },
    ],
  },
  Lillymon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped MegaKabuterimon Mega line (:882)
    into: { name: 'Rosemon', stage: 'Mega', hp: 148, atk: 60, def: 34, spd: 46 },
    // TASK-304 (R-17c/R-8 tier-extension, A-286, D-641): the SIXTH Ultimate→Mega line, mirroring the
    // FIRST (MetalGreymon:, :762), SECOND (WereGarurumon:, :789), THIRD (MagnaAngemon:, :817), FOURTH
    // (Garudamon:, :847) and FIFTH (MegaKabuterimon:, :880) verbatim. Lillymon was TERMINAL until now (no
    // EVOLUTION_LINES key → the SAME dead end the prior five hit: `resolveEvolution` returned "Lillymon
    // has no further evolution" and the evolve route rejected it). Lillymon is chosen because it is
    // Togemon's into/intoOptions[0] (:678/:698) — the DEFAULT_RNG (index-0) draw — so it is the
    // SIXTH-most-reachable Ultimate after MetalGreymon, WereGarurumon, MagnaAngemon, Garudamon and
    // MegaKabuterimon: a player who evolves Palmon→Togemon→Lillymon by default can now evolve it a THIRD
    // time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it already walks whatever
    // `intoOptions` a step declares, regardless of source/target stage; `stage:'Mega'` is already a valid
    // DigimonStage union member — NO type change). Escalation pattern Rookie 1 → Champion 5 → Mega 7. The
    // primary is Rosemon (the canonical Palmon/Lillymon-line fairy apex Mega — a distinct genuine digi-api
    // key; verified D-8 #1). FIRST entry is Rosemon — byte-identical to the fixed `into` above — so at
    // `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Rosemon verbatim (the
    // invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into). The primary Rosemon
    // carries the highest atk/spd of the three, keeping Lillymon's offense/speed-tilted fairy identity
    // (mirroring how the Hououmon primary kept the bird speed identity and the HerculesKabuterimon primary
    // kept the beetle def identity). Lotosmon (the canonical fairy/plant Mega) and Lilithmon (the genuine
    // fairy/demon-lord Mega) are real digi-api fairy Megas, with distinct stat spreads (a low-confidence
    // balance choice, A-286, retunable) drawn only on higher LIVE_RNG rolls. Each is a full stage-valid
    // Mega sitting ABOVE the Ultimate Lillymon band (hp114/atk40/def22/spd30, :678/:698 — A-42
    // untriggered, stats only advance). ONE cost per source; the remaining Ultimate→Mega lines, per-target
    // divergent Mega costs, a variant branch, and the Mega artwork widening stay carved-off follow-on
    // children.
    intoOptions: [
      { name: 'Rosemon', stage: 'Mega', hp: 148, atk: 60, def: 34, spd: 46 }, // === into, BYTE-IDENTICAL
      { name: 'Lotosmon', stage: 'Mega', hp: 152, atk: 56, def: 40, spd: 38 },
      { name: 'Lilithmon', stage: 'Mega', hp: 144, atk: 64, def: 32, spd: 40 },
    ],
  },
  Zudomon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped MetalGreymon/WereGarurumon/MagnaAngemon/Garudamon/MegaKabuterimon/Lillymon Mega lines (:764/:791/:819/:849/:882/:915)
    into: { name: 'Vikemon', stage: 'Mega', hp: 168, atk: 54, def: 52, spd: 18 },
    // TASK-306 (R-17c/R-8 tier-extension, A-288, D-645): the SEVENTH Ultimate→Mega line, mirroring the
    // FIRST (MetalGreymon:, :762), SECOND (WereGarurumon:, :789), THIRD (MagnaAngemon:, :817), FOURTH
    // (Garudamon:, :847), FIFTH (MegaKabuterimon:, :880) and SIXTH (Lillymon:, :913) verbatim. Zudomon was
    // TERMINAL until now (no EVOLUTION_LINES key → the SAME dead end the prior six hit: `resolveEvolution`
    // returned "Zudomon has no further evolution" and the evolve route rejected it). Zudomon is chosen
    // because it is Ikkakumon's into/intoOptions[0] (:706/:727) — the DEFAULT_RNG (index-0) draw — so it is
    // the SEVENTH-most-reachable Ultimate after MetalGreymon, WereGarurumon, MagnaAngemon, Garudamon,
    // MegaKabuterimon and Lillymon: a player who evolves Gomamon→Ikkakumon→Zudomon by default can now
    // evolve it a THIRD time. Pure ADDITIVE DATA on the byte-unchanged `pickEvolution` seam (it already
    // walks whatever `intoOptions` a step declares, regardless of source/target stage; `stage:'Mega'` is
    // already a valid DigimonStage union member — NO type change). Escalation pattern Rookie 1 → Champion 5
    // → Mega 7. The primary is Vikemon (the canonical Gomamon/Ikkakumon-line beast/walrus apex Mega — a
    // distinct genuine digi-api key; verified D-8 #1). FIRST entry is Vikemon — byte-identical to the fixed
    // `into` above — so at `rng()===0` (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Vikemon
    // verbatim (the invariant-5 identity anchor; evolution.spec.ts pins intoOptions[0]===into). The primary
    // Vikemon carries the highest def/hp of the three, keeping Zudomon's tanky bulky-beast identity
    // (mirroring how the Hououmon primary kept the bird speed identity and the HerculesKabuterimon primary
    // kept the beetle def identity, but tilted toward def/hp — Zudomon's Ultimate identity is hp/def-led,
    // not the Rosemon fairy's atk/spd tilt). MarineAngemon (the canonical Gomamon-line aquatic angel Mega)
    // and Plesiomon (the genuine Zudomon-line aquatic-beast Mega) are real digi-api aquatic Megas, with
    // distinct stat spreads (a low-confidence balance choice, A-288, retunable) drawn only on higher
    // LIVE_RNG rolls. Each is a full stage-valid Mega sitting ABOVE the Ultimate Zudomon band
    // (hp130/atk42/def32/spd16, :706/:727 — A-42 untriggered, stats only advance). ONE cost per source; the
    // remaining Paildramon→Mega line, per-target divergent Mega costs, a variant branch, and the Mega
    // artwork widening stay carved-off follow-on children.
    intoOptions: [
      { name: 'Vikemon', stage: 'Mega', hp: 168, atk: 54, def: 52, spd: 18 }, // === into, BYTE-IDENTICAL
      { name: 'MarineAngemon', stage: 'Mega', hp: 150, atk: 50, def: 44, spd: 40 },
      { name: 'Plesiomon', stage: 'Mega', hp: 162, atk: 58, def: 46, spd: 24 },
    ],
  },
  Paildramon: {
    requiredLevel: 7,
    cost: { resource: 'Meat', amount: 45 }, // 40–50 band, mirrors the shipped MetalGreymon/WereGarurumon/MagnaAngemon/Garudamon/MegaKabuterimon/Lillymon/Zudomon Mega lines (:764/:791/:819/:849/:882/:915/:949)
    into: { name: 'Imperialdramon', stage: 'Mega', hp: 172, atk: 66, def: 40, spd: 34 },
    // TASK-308 (R-17c/R-8 tier-extension, A-290, D-648): the EIGHTH — and FINAL PRIMARY — Ultimate→Mega
    // line, CLOSING the primary-Ultimate Mega set. Mirrors the FIRST (MetalGreymon:, :762), SECOND
    // (WereGarurumon:, :789), THIRD (MagnaAngemon:, :817), FOURTH (Garudamon:, :847), FIFTH
    // (MegaKabuterimon:, :880), SIXTH (Lillymon:, :913) and SEVENTH (Zudomon:, :947) verbatim. Paildramon
    // was TERMINAL until now (no EVOLUTION_LINES key → the SAME dead end the prior seven hit:
    // `resolveEvolution` returned "Paildramon has no further evolution" and the evolve route rejected it).
    // Paildramon is chosen because it is ExVeemon's into/intoOptions[0] (:735/:757) — the DEFAULT_RNG
    // (index-0) draw — so it is the EIGHTH-and-LAST-most-reachable primary Ultimate (after MetalGreymon,
    // WereGarurumon, MagnaAngemon, Garudamon, MegaKabuterimon, Lillymon and Zudomon): a player who evolves
    // Veemon→ExVeemon→Paildramon by default can now evolve it a THIRD time. With this entry ZERO primary
    // Ultimates remain terminal — the primary-Ultimate Mega set is CLOSED. Pure ADDITIVE DATA on the
    // byte-unchanged `pickEvolution` seam (it already walks whatever `intoOptions` a step declares,
    // regardless of source/target stage; `stage:'Mega'` is already a valid DigimonStage union member — NO
    // type change). Escalation pattern Rookie 1 → Champion 5 → Mega 7. The primary is Imperialdramon (the
    // canonical Veemon/Paildramon-line dragon apex Mega — a distinct genuine digi-api key; verified D-8 #1).
    // FIRST entry is Imperialdramon — byte-identical to the fixed `into` above — so at `rng()===0`
    // (`DEFAULT_RNG`, every no-rng caller/fixture) the draw returns Imperialdramon verbatim (the invariant-5
    // identity anchor; evolution.spec.ts pins intoOptions[0]===into). The primary Imperialdramon carries the
    // highest atk/hp of the three, keeping Paildramon's balanced offense-tilted dragon identity (mirroring
    // how the Vikemon primary kept the def/hp beast identity and the Rosemon primary kept the atk/spd fairy
    // identity, but tilted toward atk/balance — Paildramon's Ultimate identity is a balanced attacker,
    // hp134/atk46/def28/spd20, :735/:757, not the Zudomon beast's def/hp tilt). AlforceVeedramon and
    // UlforceVeedramon (the genuine Veemon/ExVeemon-line "Royal Knight" dragon Megas) are real digi-api
    // dragon Megas, with distinct stat spreads (a low-confidence balance choice, A-290, retunable) drawn
    // only on higher LIVE_RNG rolls. Each is a full stage-valid Mega sitting ABOVE the Ultimate Paildramon
    // band (hp134/atk46/def28/spd20 — A-42 untriggered, stats only advance). ONE cost per source; per-target
    // divergent Mega costs, a variant branch, and the Mega artwork widening stay carved-off follow-on
    // children.
    intoOptions: [
      { name: 'Imperialdramon', stage: 'Mega', hp: 172, atk: 66, def: 40, spd: 34 }, // === into, BYTE-IDENTICAL
      { name: 'AlforceVeedramon', stage: 'Mega', hp: 156, atk: 62, def: 38, spd: 48 },
      { name: 'UlforceVeedramon', stage: 'Mega', hp: 160, atk: 60, def: 36, spd: 52 },
    ],
  },
} as const;

/**
 * The result of asking whether a Digimon may evolve — a discriminated union so the
 * caller (`DigimonService.evolve`) branches exhaustively: on `ok` it applies `into`
 * AND debits `cost` (surfaced here so the service knows the resource + amount to
 * charge WITHOUT re-deriving it); on `!ok` it blocks with `reason` (surfaced
 * verbatim to the player). Both the "no chain" and the "under level" blocks are
 * ordinary, expected outcomes, not errors — hence a total return value rather than
 * a thrown exception here. NOTE: the affordability check is NOT one of these
 * outcomes — this pure function has no balance/user context, so `ok` means "may
 * evolve per the level/chain gate, and here is the price"; the service performs the
 * separate `balance >= cost` guard (a 422 on failure) against the resolved `cost`.
 */
export type EvolutionOutcome =
  | { ok: true; into: EvolutionStep['into']; cost: EvolutionCost }
  | { ok: false; reason: string };

/**
 * Decide whether `digimon` may evolve, and into what — the pure heart of R-8.
 *
 * TOTAL: every input yields a defined `EvolutionOutcome` (never throws, never
 * returns undefined), so the caller can rely on the discriminant alone. Checks run
 * in order of increasing specificity:
 *   1. No chain entry for this name (a terminal form, e.g. Greymon) → blocked with
 *      "has no further evolution".
 *   2. Under the required level → blocked with "Requires level N".
 *   3. Otherwise → `{ ok: true, into, cost }` (the target form AND its price).
 *
 * Only `name` + `level` are inspected here (the level/chain gate, D-43). The `cost`
 * is RETURNED but NOT checked: whether the player can AFFORD it needs a balance +
 * user context this pure function deliberately lacks, so that guard lives in
 * `DigimonService.evolve` (TASK-24, R-8b) which reads this `cost` and debits it.
 */
export function resolveEvolution(digimon: { name: string; level: number }): EvolutionOutcome {
  const step = EVOLUTION_LINES[digimon.name];

  if (step === undefined) {
    return { ok: false, reason: `${digimon.name} has no further evolution.` };
  }

  if (digimon.level < step.requiredLevel) {
    return {
      ok: false,
      reason: `Requires level ${step.requiredLevel} to evolve ${digimon.name}.`,
    };
  }

  return { ok: true, into: step.into, cost: step.cost };
}

/**
 * Which evolution branch a caller is asking for (TASK-30, R-16): the ORIGINAL
 * linear chain, or the accumulation-gated VARIANT branch. The evolve endpoint maps
 * an absent/empty body to `'linear'`, so the existing no-body evolve is unchanged.
 */
export type EvolutionBranch = 'linear' | 'variant';

/**
 * The resolved target when a branch IS evolvable — the form to advance into AND the
 * price to charge, tagged with which branch produced it. `DigimonService.evolve`
 * consumes exactly this: it writes `into` onto the row and DEBITs `cost` (+ audit
 * row) identically for both branches, so a variant is "just another priced step".
 */
export type EvolutionChoice = {
  branch: EvolutionBranch;
  into: EvolutionStep['into'];
  cost: EvolutionCost;
};

/**
 * Resolve a SPECIFIC requested evolution branch for a Digimon (TASK-30, R-16) — the
 * branch-aware heart of adaptive digivolution. TOTAL (never throws): every input
 * yields a defined result, so the caller branches on the discriminant alone.
 *
 * `'linear'` is byte-behaviour-identical to {@link resolveEvolution} (this method
 * delegates to it): unknown name → "no further evolution", under-level → "Requires
 * level N", else `{ branch:'linear', into: step.into, cost: step.cost }`. Keeping
 * the linear path routed through here means the existing evolve is provably unchanged.
 *
 * `'variant'` adds the accumulation gate on top of the SAME chain/level rules:
 *   1. No chain entry → "no further evolution" (same as linear — a terminal form has
 *      neither branch).
 *   2. No `step.variant` → "no variant evolution available" (this line is linear-only,
 *      e.g. Gabumon/Patamon in this slice).
 *   3. Under the required level → the same "Requires level N" block (a variant still
 *      respects the level gate).
 *   4. `dataFire < variant.requiredData` → a clear "Requires N Fire Data …" reason
 *      (the accumulation gate — the NEW mechanism this task adds).
 *   5. Otherwise → `{ branch:'variant', into: variant.into, cost: variant.cost }`.
 *
 * Like `resolveEvolution`, the `cost` is RETURNED but NOT checked for affordability
 * here — this pure function has no balance/user context; the service performs the
 * `balance >= cost` guard against the resolved `cost` (invariant 3), identically for
 * both branches.
 */
export function resolveEvolutionBranch(
  digimon: { name: string; level: number; dataFire: number },
  branch: EvolutionBranch,
): { ok: true; choice: EvolutionChoice } | { ok: false; reason: string } {
  const step = EVOLUTION_LINES[digimon.name];

  if (step === undefined) {
    return { ok: false, reason: `${digimon.name} has no further evolution.` };
  }

  if (branch === 'linear') {
    // Delegate to the existing resolver so the linear path stays byte-identical.
    const outcome = resolveEvolution({ name: digimon.name, level: digimon.level });
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    return { ok: true, choice: { branch: 'linear', into: outcome.into, cost: outcome.cost } };
  }

  // branch === 'variant'
  const variant = step.variant;
  if (variant === undefined) {
    return { ok: false, reason: `${digimon.name} has no variant evolution available.` };
  }

  if (digimon.level < step.requiredLevel) {
    return {
      ok: false,
      reason: `Requires level ${step.requiredLevel} to evolve ${digimon.name}.`,
    };
  }

  if (digimon.dataFire < variant.requiredData) {
    return {
      ok: false,
      reason: `Requires ${variant.requiredData} Fire Data to evolve ${digimon.name} into ${variant.into.name}.`,
    };
  }

  return { ok: true, choice: { branch: 'variant', into: variant.into, cost: variant.cost } };
}

/**
 * TASK-188 (R-27) — RANDOM VALID DIGIVOLUTION: draw ONE of a step's valid next forms
 * through the injected `rng` seam. Reuses the proven injected-RNG recipe
 * (`add-injected-rng-combat-roll`): a PURE function whose ONLY entropy is the injected
 * `rng`, a SINGLE `rng()` draw (L-58 multi-draw footgun avoided), and a threshold
 * direction whose `DEFAULT_RNG` (`() => 0`) default reproduces the PRIOR fixed target.
 *
 * The candidate set is `step.intoOptions ?? [step.into]`, so a species with NO seeded
 * list keeps its single fixed `into` verbatim (purely additive — invariant 5). The
 * draw is `Math.floor(rng() * opts.length)`:
 *  - **LOAD-BEARING identity anchor:** at `rng() === 0` (`DEFAULT_RNG`, every no-rng
 *    caller + every existing evolve fixture) `i === 0` → returns `opts[0]`, which
 *    (asserted in the spec) is byte-identical to the fixed `into` → the prior slice's
 *    outcome is preserved with NO re-pin (the invariant-5 byte-proof).
 *  - a `LIVE_RNG`-fed player draws across `[0,1)`, so `i` walks every option → the
 *    landed champion VARIES fight to fight, and can NEVER be an off-list form (`i` is
 *    always a valid index: `rng() < 1` ⇒ `i < opts.length`).
 *
 * TOTAL + deterministic + RNG-free itself (no `Math.random` here — the entropy is the
 * injected `rng`, fed `LIVE_RNG` only at the HTTP boundary). A-42 untriggered: every
 * option is a valid Champion form; this advances stats, it touches no combat HP loop.
 */
export function pickEvolution(step: EvolutionStep, rng: Rng): EvolutionInto {
  const opts = step.intoOptions ?? [step.into];
  const i = Math.floor(rng() * opts.length);
  return opts[i];
}

/**
 * TASK-215 (R-27a, A-196) — the variant twin of {@link pickEvolution}: draws a random
 * valid Champion for the accumulation-gated VARIANT branch. Same shape and same
 * load-bearing identity anchor:
 *  - a variant WITHOUT `intoOptions` draws its single `into` at ANY rng (fallback to
 *    `[into]`) — the byte-proof that every non-randomized variant is unchanged.
 *  - at `rng() === 0` (`DEFAULT_RNG`, every no-rng caller + every existing variant
 *    fixture) `i === 0` → `opts[0]`, byte-identical to `into` (Meramon) → the prior
 *    fixed variant outcome is preserved with NO re-pin (the invariant-5 byte-proof).
 *  - a `LIVE_RNG`-fed player walks every option → the landed variant Champion VARIES,
 *    never an off-list form (`rng() < 1` ⇒ `i < opts.length`).
 *
 * TOTAL + deterministic + RNG-free itself (the entropy is the injected `rng`, fed
 * `LIVE_RNG` only at the HTTP boundary). A-42 untriggered — every option is a valid
 * Champion form; this advances stats, it touches no combat HP loop.
 */
export function pickEvolutionVariant(variant: EvolutionVariant, rng: Rng): EvolutionInto {
  const opts = variant.intoOptions ?? [variant.into];
  const i = Math.floor(rng() * opts.length);
  return opts[i];
}
