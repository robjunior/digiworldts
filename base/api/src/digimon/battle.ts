/**
 * The PURE turn-based PvE battle rules (TASK-32, R-7) — the deterministic, I/O-free
 * combat core, mirroring the pure {@link resolveEvolution} (evolution.ts) and
 * {@link applyTraining} (training.ts): all the numbers live here so
 * {@link DigimonService.battle} stays a thin transaction wrapper that just resolves
 * ownership, calls {@link simulateBattle}, and persists the WIN reward.
 *
 * WHY a pure module (no Prisma, no I/O, NO RNG): the whole encounter is resolved
 * server-side deterministically from the two combatants' stats, so it is exactly
 * unit-testable in isolation AND the e2e can assert a specific win/loss + turn log
 * without booting anything or seeding randomness. Determinism is the deliberate
 * scope choice (A-21): no interactive per-turn choices, no realtime channel — a
 * single request/response returns the full simulated fight. This combat core is what
 * R-12 ranked PvP and R-9 exploration encounters reuse later.
 *
 * SCOPE (A-21, D-97): ONE player Digimon vs ONE fixed PvE enemy, a single basic
 * attack, a fixed {@link ENEMY_ROSTER} (no movesets, no AI, no party of 3). The WIN
 * reward is a FREE XP grant (invariant 3 untriggered — XP is domain progression, not
 * spendable economic value; L-12 — the ledger is for value-moving mutations). A
 * resource/item DROP reward is economic and is carved to a later R-7 child slice.
 */

// TASK-159 (R-22 slice 20): the crit-roll seam. This is the FIRST import into the
// otherwise self-contained pure engine — and it stays PURE: `rng.ts` is a tiny
// framework-free module (no Nest/IO). The engine's executable `Math.random` count
// STAYS 0 (DEFAULT_RNG is the constant `() => 0`; entropy only ever arrives through
// the injected `rng`, defaulted so the auto path never crits — see resolveDamageStrike).
import { CRIT_MULT, DEFAULT_RNG, critRoll, evadeRoll, statusResists, type Rng } from './rng';

/**
 * The type-triangle multiplier applied to an attacker's damage based on the
 * attribute matchup (the Digimon "rock-paper-scissors"). `Vaccine > Virus`,
 * `Virus > Data`, `Data > Vaccine` (a cycle). Stored as plain `String` in the DB
 * (SQLite has no enums — see schema.prisma / digimon.seed.ts), so this reads plain
 * strings and treats anything off the triangle (`Free`, same attribute, or an
 * unknown value) as neutral ×1.0.
 *
 * WHY a lookup of who-beats-whom rather than a full N×N table: the triangle is a
 * single cycle, so one "beats" map fully determines both directions — an attacker on
 * the winning side of the cycle gets the bonus, the loser gets the penalty, everyone
 * else is neutral. This keeps the rule impossible to mis-transcribe.
 */
const TYPE_BEATS: Readonly<Record<string, string>> = {
  Vaccine: 'Virus',
  Virus: 'Data',
  Data: 'Vaccine',
} as const;

/** Attacker's damage multiplier when it has the type advantage over the defender. */
export const TYPE_ADVANTAGE_MULT = 1.5;
/** Attacker's damage multiplier when the defender has the type advantage (reverse). */
export const TYPE_DISADVANTAGE_MULT = 0.75;

/**
 * The attribute-triangle damage multiplier for `attackerType` striking
 * `defenderType`. PURE, total over any pair of strings:
 *  - attacker beats defender on the triangle → {@link TYPE_ADVANTAGE_MULT} (×1.5)
 *  - defender beats attacker (the reverse)   → {@link TYPE_DISADVANTAGE_MULT} (×0.75)
 *  - `Free` / same / unknown / off-triangle  → ×1.0 (neutral)
 */
export function typeMultiplier(attackerType: string, defenderType: string): number {
  if (TYPE_BEATS[attackerType] === defenderType) return TYPE_ADVANTAGE_MULT;
  if (TYPE_BEATS[defenderType] === attackerType) return TYPE_DISADVANTAGE_MULT;
  return 1.0;
}

/**
 * The element-effectiveness cycle (a smaller, softer echo of the type triangle):
 * `Fire > Nature > Water > Electric > Fire`. `Neutral` and anything off the cycle is
 * always ×1.0. Same "who-beats-whom" encoding as {@link TYPE_BEATS} so both
 * directions derive from one map (no mis-transcription).
 */
const ELEMENT_BEATS: Readonly<Record<string, string>> = {
  Fire: 'Nature',
  Nature: 'Water',
  Water: 'Electric',
  Electric: 'Fire',
} as const;

/** Attacker's damage multiplier when it has the element advantage. */
export const ELEMENT_ADVANTAGE_MULT = 1.25;
/** Attacker's damage multiplier when the defender has the element advantage. */
export const ELEMENT_DISADVANTAGE_MULT = 0.8;

/**
 * The element-effectiveness damage multiplier for `attackerElement` striking
 * `defenderElement`. PURE, total over any pair:
 *  - attacker beats defender on the cycle → {@link ELEMENT_ADVANTAGE_MULT} (×1.25)
 *  - defender beats attacker (reverse)    → {@link ELEMENT_DISADVANTAGE_MULT} (×0.8)
 *  - `Neutral` / same / off-cycle         → ×1.0
 */
export function elementMultiplier(attackerElement: string, defenderElement: string): number {
  if (ELEMENT_BEATS[attackerElement] === defenderElement) {
    return ELEMENT_ADVANTAGE_MULT;
  }
  if (ELEMENT_BEATS[defenderElement] === attackerElement) {
    return ELEMENT_DISADVANTAGE_MULT;
  }
  return 1.0;
}

/**
 * One side of a battle — the minimal combat-relevant projection of a Digimon (or a
 * fixed enemy). Deliberately NOT the persisted `Digimon` row: the simulation only
 * needs these fields, so both a player's owned row and a hand-tuned enemy map onto
 * it uniformly, and the pure module stays free of any datastore type.
 */
export interface Combatant {
  name: string;
  type: string;
  element: string;
  hp: number;
  // TASK-126 (R-17c): the `maxHp` SUBSTRATE — a combatant's FULL/starting HP. Set ONCE at
  // construction (`maxHp = hp`, since the persisted `Digimon.hp` row IS the full HP → NO Prisma
  // migration, NO new column) and NEVER mutated by the round loop (only `hp` mutates as damage
  // lands); it flows unchanged through any fight-local `SideState`. It exists so a mechanic can read
  // a PERCENT OF MAX HP — the FIRST such reader is the `execute` finisher (a low-HP foe, measured
  // against its `maxHp`, takes bonus damage). Add-only: additive, so every existing consumer keeps
  // byte-identical behaviour (invariant 5). This slice adds the substrate the later HP-RAISING
  // (Heal/HoT) family will need, but does NOT open that A-42-gated family (execute only DEALS
  // damage, HP stays monotonically non-increasing).
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
}

/**
 * The damage `attacker` deals to `defender` with a single basic attack. PURE +
 * DETERMINISTIC:
 *
 *   max(1, round(atk × typeMult × elementMult) − floor(effDef / 2))
 *
 * The two matchup multipliers scale the raw attack, then half the defender's
 * EFFECTIVE DEF is subtracted as mitigation (floored, so DEF is integer-predictable).
 * The `max(1, …)` floor guarantees every hit lands for at least 1 — a hit never heals
 * or whiffs to 0, which also guarantees {@link simulateBattle} makes monotonic
 * progress toward a decided outcome (both HP pools strictly shrink on each actor's
 * turn).
 *
 * TASK-54 (R-17c): a WEAKEN status (a persistent stat-modifier, the 3rd ailment kind)
 * on the DEFENDER lowers its effective DEF by `defenderDefReduction` — clamped so the
 * effective DEF never drops below {@link MIN_EFFECTIVE_DEF}, keeping the mitigation
 * math sane (a huge reduction can't invert into a NEGATIVE DEF that would HEAL the
 * hit). This is the observable payoff: a weakened defender takes MORE damage. The
 * parameter is OPTIONAL with a 0 default so every existing caller (and the four
 * external `simulateBattle` consumers) keep the byte-identical no-weaken behaviour
 * (invariant 5 — additive, back-compat by construction).
 *
 * TASK-56 (R-17c): an EMPOWER buff (a persistent POSITIVE stat-modifier, the 5th
 * status kind — the exact MIRROR of Weaken) on the ATTACKER raises its effective ATK
 * by `attackerAtkBonus` in the scaled-damage term, symmetric to `effectiveDef`. This
 * is the observable payoff: an empowered attacker deals MORE damage. A buff can only
 * RAISE the attacker's damage, so HP still stays monotonically non-increasing on the
 * defender (a buff never heals — it only makes hits hurt more). Also OPTIONAL with a 0
 * default so every existing caller keeps byte-identical behaviour (invariant 5).
 */
export function resolveAttack(
  attacker: Combatant,
  defender: Combatant,
  defenderDefReduction = 0,
  attackerAtkBonus = 0,
): number {
  const effectiveDef = Math.max(MIN_EFFECTIVE_DEF, defender.def - defenderDefReduction);
  // TASK-63 (R-17c): the ATK term now takes a NET bonus so a NEGATIVE net
  // (an ENFEEBLE debuff outweighing an Empower buff) is clamped at
  // MIN_EFFECTIVE_ATK. This is the exact MIRROR of the MIN_EFFECTIVE_DEF floor:
  // a large enfeeble reduction can never push effectiveAtk negative, which —
  // before the type/element multipliers — would flip the scaled damage sign and
  // let a hit HEAL. `attackerAtkBonus` is `atkBonus − atkReduction` at the call
  // site; for every existing fight state it is ≥ 0 (no enfeeble present → the
  // clamp is a no-op and the damage is byte-identical to before, invariant 5).
  const effectiveAtk = Math.max(MIN_EFFECTIVE_ATK, attacker.atk + attackerAtkBonus);
  const scaled =
    effectiveAtk *
    typeMultiplier(attacker.type, defender.type) *
    elementMultiplier(attacker.element, defender.element);
  return Math.max(1, Math.round(scaled) - Math.floor(effectiveDef / 2));
}

/**
 * EXECUTE FINISHER (TASK-126) — the FIRST percent-of-MAX-HP read in the engine, as a PURE helper so
 * the genuinely-new `maxHp`-reading shape is unit-testable in isolation (mirroring
 * {@link wakeSleeperOnDamage} / {@link reflectRetaliation}). Given the defender's CURRENT `hp`, its
 * full `maxHp` (the new substrate — set once at construction, never mutated by the round loop),
 * the finisher's `bonusDamage` and its `hpThresholdRatio`, returns the EXTRA HP the execute strike
 * should deal ON TOP of the normal strike:
 *  - `bonusDamage` iff the defender is at/below the threshold (`hp <= floor(maxHp × ratio)` — the
 *    percent-of-MAX read, floored so the threshold is integer-predictable),
 *  - `0` otherwise (above the threshold → just the normal strike).
 *
 * PURE + total. The bonus only ever ADDS damage — the caller subtracts it via the SAME monotone
 * `hp = max(0, hp − X)` write, so HP stays monotonically non-increasing (A-42; execute never heals).
 * The `<=` is inclusive so a foe sitting EXACTLY at `floor(maxHp × ratio)` is executed.
 */
export function executeBonus(
  defenderHp: number,
  defenderMaxHp: number,
  bonusDamage: number,
  hpThresholdRatio: number,
): number {
  const threshold = Math.floor(defenderMaxHp * hpThresholdRatio);
  return defenderHp <= threshold ? bonusDamage : 0;
}

/**
 * Guillotine's bonus damage (TASK-127) — the FIRST max-HP-FRACTION burst. Given the defender's
 * CURRENT `hp`, its (unmutated) `maxHp`, a `bonusRatio` and an `hpThresholdRatio`, returns the extra
 * damage the guillotine finisher deals ON TOP of its normal strike:
 *  - `floor(defenderMaxHp × bonusRatio)` iff the defender is at/below the threshold
 *    (`hp <= floor(maxHp × hpThresholdRatio)` — the same inclusive percent-of-MAX read execute uses),
 *  - `0` otherwise (above the threshold → just the normal strike).
 *
 * This is the FIRST time `maxHp` SIZES a damage number: {@link executeBonus} only READS `maxHp` to
 * GATE a FIXED bonus, whereas here `maxHp` SCALES the bonus magnitude, so two below-threshold
 * defenders with different `maxHp` get proportionally different bonus damage (the distinguishing
 * property vs execute's flat +12).
 *
 * PURE + total. The bonus only ever ADDS damage — the caller subtracts it via the SAME monotone
 * `hp = max(0, hp − X)` write, so HP stays monotonically non-increasing (A-42; guillotine never
 * heals). Both fractions are floored so the threshold AND the bonus are integer-predictable.
 */
export function guillotineBonus(
  defenderHp: number,
  defenderMaxHp: number,
  bonusRatio: number,
  hpThresholdRatio: number,
): number {
  const threshold = Math.floor(defenderMaxHp * hpThresholdRatio);
  return defenderHp <= threshold ? Math.floor(defenderMaxHp * bonusRatio) : 0;
}

/**
 * Rampage's bonus damage (TASK-128) — the FIRST MISSING-HP-FRACTION burst. Given the defender's
 * CURRENT `hp`, its (unmutated) `maxHp` and a `bonusRatio`, returns the extra damage the rampage
 * finisher deals ON TOP of its normal strike: `floor(max(0, maxHp − hp) × bonusRatio)`.
 *
 * This is the FIRST time the engine reads the defender's MISSING HP (`maxHp − hp`, the damage
 * already dealt) to SIZE a number. It is UNCONDITIONAL — there is NO threshold param — because the
 * missing-HP fraction is naturally `0` at full HP (`hp === maxHp` → `maxHp − hp === 0`) and GROWS as
 * the foe is worn down, the classic SMT "rampage/vengeance" idiom that rewards a prolonged fight.
 * This is the distinguishing property vs {@link guillotineBonus}, which sizes off `maxHp` (full HP)
 * behind a low-HP THRESHOLD gate; rampage sizes off `maxHp − hp` (missing HP) with no gate.
 *
 * PURE + total. The bonus only ever ADDS damage — the caller subtracts it via the SAME monotone
 * `hp = max(0, hp − X)` write, so HP stays monotonically non-increasing (A-42; rampage never heals).
 * The `Math.max(0, …)` guards against a caller passing `hp > maxHp` (would otherwise go negative) so
 * the bonus is always `≥ 0`; the fraction is floored so the bonus is integer-predictable.
 */
export function rampageBonus(
  defenderHp: number,
  defenderMaxHp: number,
  bonusRatio: number,
): number {
  return Math.floor(Math.max(0, defenderMaxHp - defenderHp) * bonusRatio);
}

/**
 * Bravado's bonus damage (TASK-129) — the FIRST ATTACKER-OWN-maxHp-FRACTION burst. Given the
 * ATTACKER's (unmutated) `maxHp` and a `bonusRatio`, returns the extra damage the bravado finisher
 * deals ON TOP of its normal strike: `floor(attackerMaxHp × bonusRatio)`.
 *
 * This is the FIRST time the engine sizes a bonus off the CASTER's OWN frame. Every prior maxHp read
 * — {@link executeBonus} (GATE off the defender's hp/maxHp), {@link guillotineBonus} (SIZE off the
 * defender's MAX), {@link rampageBonus} (SIZE off the defender's MISSING) — reads the DEFENDER. Here
 * the magnitude scales off the ATTACKER's own `maxHp`, the classic SMT big-bruiser idiom (a
 * heavyweight hits harder from its own bulk). It is UNCONDITIONAL — there is NO threshold param and
 * NO defender read at all — so two attackers with different `maxHp` versus an IDENTICAL defender deal
 * proportionally different bonus damage (the distinguishing property vs guillotine/rampage, which
 * scale off the DEFENDER's frame).
 *
 * PURE + total. The bonus only ever ADDS damage — the caller subtracts it via the SAME monotone
 * `hp = max(0, hp − X)` write, so HP stays monotonically non-increasing (A-42; bravado never heals —
 * this wave SIZES damage from the ATTACKER's maxHp substrate but does NOT open the A-42-gated
 * HP-raising family). `maxHp` is a non-negative construction constant and `bonusRatio` ≥ 0, so the
 * floored product is always `≥ 0`; the fraction is floored so the bonus is integer-predictable.
 */
export function bravadoBonus(attackerMaxHp: number, bonusRatio: number): number {
  return Math.floor(attackerMaxHp * bonusRatio);
}

/**
 * Last-Stand's bonus damage (TASK-130) — the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst. Given the
 * ATTACKER's CURRENT `hp`, its (unmutated) `maxHp` and a `bonusRatio`, returns the extra damage the
 * last-stand finisher deals ON TOP of its normal strike: `floor(max(0, attackerMaxHp − attackerHp) ×
 * bonusRatio)`.
 *
 * This is the fourth and FINAL cell of the `{MAX-HP | MISSING-HP} × {DEFENDER | ATTACKER-OWN}` frame
 * matrix — the classic SMT "last stand / vengeance-of-the-wounded" idiom: a caster hits HARDER the
 * more worn-down it is. Its distinguishing property:
 *   - {@link bravadoBonus} reads the ATTACKER's MAX (flat in the attacker's current hp),
 *   - {@link rampageBonus} reads the DEFENDER's MISSING (`defMaxHp − defHp`),
 *   - here we read the ATTACKER's OWN MISSING (`atkMaxHp − atkHp`) — the missing-HP sibling of
 *     bravado and the attacker-frame mirror of rampage.
 * It is UNCONDITIONAL — there is NO threshold param — because the attacker's own missing-HP fraction
 * is naturally `0` at full HP (`attackerHp === attackerMaxHp` → `maxHp − hp === 0`) and GROWS as the
 * caster is worn down.
 *
 * PURE + total. The bonus only ever ADDS damage — the caller subtracts it via the SAME monotone
 * `hp = max(0, hp − X)` write, so HP stays monotonically non-increasing (A-42; last-stand never heals
 * — this wave SIZES damage from the ATTACKER's maxHp substrate but does NOT open the A-42-gated
 * HP-raising family). The `Math.max(0, …)` guards against a caller passing `hp > maxHp` (would
 * otherwise go negative) so the bonus is always `≥ 0`; the fraction is floored so the bonus is
 * integer-predictable.
 */
export function lastStandBonus(
  attackerHp: number,
  attackerMaxHp: number,
  bonusRatio: number,
): number {
  return Math.floor(Math.max(0, attackerMaxHp - attackerHp) * bonusRatio);
}

/**
 * Drain a defender's active {@link StatusAilment} `shield` pool against `incoming`
 * damage BEFORE it reaches HP (TASK-55) — the observable payoff of the Guard skill's
 * damage-absorbing buffer. PURE + total; returns:
 *  - `absorbed` — `min(incoming, absorbRemaining)` (0 when the defender is unshielded),
 *  - `overflow` — the damage that survives the shield and DOES reach HP
 *    (`incoming − absorbed`),
 *  - `shieldBroke` — `true` iff a shield was present AND its pool is now exhausted.
 *
 * WHY the floor already lives in {@link resolveAttack}: `incoming` is the ≥1-floored
 * hit, so a fully-absorbed hit yields `overflow === 0` and subtracts NO HP (the floor
 * is NOT re-applied to the overflow — a shield can only REDUCE the HP a hit removes,
 * never raise it). HP therefore stays monotonically non-increasing (a shield is a
 * mitigation, never a heal — A-43), keeping {@link MAX_ROUNDS} termination + the
 * shipped win/loss tuning structurally safe. The CALLER mutates the surviving
 * `absorbRemaining` on the defender's fight-local status (statuses are mutable scratch
 * inside {@link simulateBattle}, like `hp`/`energy`) — this function is a pure calc.
 */
/**
 * WAKE-ON-DAMAGE (TASK-60) — the INTERRUPTIBLE early clear, as a PURE helper so the
 * genuinely-new Sleep shape is unit-testable in isolation (the wake substrate that
 * {@link resolveDamageStrike} calls at the shared HP-write site). Given the defender's
 * current `statuses` and the HP `damageDealt` by an incoming strike, returns:
 *  - `statuses` — the array with the `sleep` arm REMOVED iff a hit landed on a sleeper
 *    (`damageDealt > 0` AND a `sleep` arm was present), else the input array unchanged,
 *  - `woke` — whether a sleeper was jolted awake by this strike.
 *
 * WHY event-driven, not turn-counter: Sleep is the FIRST ailment whose effective
 * duration depends on a COMBAT EVENT (a damage hit), distinct from Stun's fixed-1-turn
 * and Freeze's unconditional full-duration hold. A `damageDealt === 0` strike (a pure
 * control/self skill, or a fully shield-absorbed overflow) does NOT wake it. This only
 * ever REMOVES the ailment — it never adds HP, so HP stays monotonically
 * non-increasing (A-48). PURE: returns a new array, mutates nothing.
 */
export function wakeSleeperOnDamage(
  statuses: readonly StatusAilment[],
  damageDealt: number,
): { statuses: StatusAilment[]; woke: boolean } {
  const woke = damageDealt > 0 && statuses.some((s) => s.kind === 'sleep');
  return {
    statuses: woke ? statuses.filter((s) => s.kind !== 'sleep') : [...statuses],
    woke,
  };
}

/**
 * REFLECT-ON-BEING-HIT (TASK-69) — the reactive Retaliate (Thorns) payoff, as a PURE
 * helper (mirroring {@link wakeSleeperOnDamage}'s shape) so the genuinely-new
 * on-being-struck shape is unit-testable in isolation. {@link resolveDamageStrike}
 * calls it at the ONE shared HP-write site, AFTER `them.hp = max(0, them.hp − overflow)`.
 * Given the DEFENDER's active `statuses` and the HP `overflow` the incoming strike
 * dealt, returns the FIXED `reflect` HP the ATTACKER should take back:
 *  - `reflect` = the active `retaliate` arm's `reflectDamage` iff a damaging strike
 *    landed (`overflow > 0` AND a `retaliate` arm is present),
 *  - `reflect` = `floor(overflow * reflectRatio)` iff instead a `retaliate-percent` arm
 *    is present (TASK-99, the fractional MIRROR — the FIXED arm wins if BOTH present),
 *  - `reflect` = 0 otherwise — in particular a fully-absorbed / non-damaging strike
 *    (`overflow === 0`, e.g. behind a Shield) triggers NO reflect.
 *
 * WHY at the shared site: every damage path (single hit / each multi-hit strike / a
 * composite's damage half) reflects UNIFORMLY. The reflect only ever SUBTRACTS the
 * attacker's HP (never heals), so HP stays monotonically non-increasing (A-42) — the
 * exact reason Retaliate shipped before the HP-raising Heal/Drain family. PURE: reads,
 * mutates nothing (the caller applies the HP write to the attacker).
 */
export function reflectRetaliation(
  defenderStatuses: readonly StatusAilment[],
  overflow: number,
): { reflect: number } {
  if (overflow <= 0) return { reflect: 0 };
  const retaliate = defenderStatuses.find((s) => s.kind === 'retaliate');
  if (retaliate?.kind === 'retaliate') return { reflect: retaliate.reflectDamage };
  // TASK-99 (R-17c 48th wave) — ADDITIVE percent branch (the FIXED branch above stays
  // byte-unchanged). Thorn Mirror's `retaliate-percent` arm reflects a FRACTION
  // (RETALIATE_PERCENT_RATIO, floored) of the actual incoming overflow — the fractional
  // MIRROR of the fixed retaliate (the way sap-percent/leech-percent mirror sap/leech). It
  // still only ever SUBTRACTS the attacker's HP at the SAME resolveDamageStrike seam, so
  // HP stays monotone (A-42). The two never co-occur in-sim under Posture-B; if BOTH were
  // present the FIXED arm is returned FIRST above (a deterministic order — keeps the fixed
  // branch byte-identical).
  const retaliatePercent = defenderStatuses.find((s) => s.kind === 'retaliate-percent');
  if (retaliatePercent?.kind === 'retaliate-percent') {
    return { reflect: Math.floor(overflow * retaliatePercent.reflectRatio) };
  }
  return { reflect: 0 };
}

/**
 * ENERGY DRAIN / Sap (TASK-70) — the FIRST resource-interference payoff, as a PURE
 * exported helper (mirroring {@link reflectRetaliation} / {@link wakeSleeperOnDamage}'s
 * shape) so the genuinely-new "touch the opponent's ENERGY pool" shape is
 * unit-testable in ISOLATION. Given the DEFENDER's `currentEnergy` and the fixed
 * `amount` to sap, returns:
 *  - `newEnergy` = `max(0, currentEnergy − amount)` (the drain floored at 0 — a foe
 *    already at 0 energy cannot go negative),
 *  - `drained` = `min(currentEnergy, amount)` (how much was ACTUALLY removed — 0 when
 *    the foe is already empty, so the log note reflects the true amount, not the const).
 *
 * PURE: reads two numbers, mutates nothing (the caller applies the write to the
 * defender's `energy`). It writes ONLY the non-HP `energy` resource, so HP stays
 * monotonically non-increasing (A-42) — the exact reason this resource-interference
 * mechanic is safe and shipped BEFORE the HP-raising Heal/Drain family.
 */
export function drainEnergy(
  currentEnergy: number,
  amount: number,
): { newEnergy: number; drained: number } {
  const drained = Math.min(currentEnergy, amount);
  return { newEnergy: Math.max(0, currentEnergy - amount), drained };
}

/**
 * TASK-97 (R-17c, 46th combat wave) — Energy Rend's (`sap-percent`) PERCENTAGE energy
 * drain, as a PURE exported helper: the exact FRACTIONAL MIRROR of {@link drainEnergy}
 * (which removes a FIXED amount). This is the FIRST fractional-MAGNITUDE mechanic on the
 * energy-resource substrate — OPENING the percentage/fidelity axis, the way
 * {@link REBOUND_PARTIAL_RATIO} proved DURATION fidelity (fixed → fractional) but on a
 * genuinely-absent MAGNITUDE axis (before this, the only fractional numbers were the
 * `vulnerable` damage-taken amp and the partial-rebound duration ratio; NO fractional
 * resource/damage magnitude existed). Given the DEFENDER's `currentEnergy` and a `ratio`
 * in [0,1], returns:
 *  - `drained` = `Math.floor(currentEnergy * ratio)` — a FRACTION of the CURRENT pool,
 *    floored to an integer (energy is a whole-unit resource). A foe at 0 energy drains
 *    NOTHING (`floor(0 * ratio) = 0`); a foe at 1 energy with ratio 0.5 drains 0
 *    (`floor(0.5) = 0`).
 *  - `newEnergy` = `Math.max(0, currentEnergy - drained)` — the pool after the drain
 *    (the ≥ 0 floor is belt-and-braces: since `drained ≤ currentEnergy` for ratio ≤ 1 it
 *    can never underflow, so `drained + newEnergy === currentEnergy` always holds).
 *
 * PURE: reads two numbers, mutates nothing (the caller applies the write to the DEFENDER's
 * `energy`). It writes ONLY the non-HP `energy` resource, so HP stays monotonically
 * non-increasing (A-42) — exactly like {@link drainEnergy}/{@link leechEnergy}. The
 * fractional-vs-fixed distinction is the whole point: at a HIGH pool a percentage drain
 * removes MORE than a fixed 12 (40 → floor(20) = 20 vs 12), at a LOW pool LESS (10 →
 * floor(5) = 5 vs min(10,12) = 10) — the observable magnitude-fidelity contrast.
 */
export function drainEnergyPercent(
  currentEnergy: number,
  ratio: number,
): { newEnergy: number; drained: number } {
  const drained = Math.floor(currentEnergy * ratio);
  return { newEnergy: Math.max(0, currentEnergy - drained), drained };
}

/**
 * TASK-71 (R-17c) — Energy Leech's (Siphon) energy-CREDIT payoff, as a PURE exported
 * helper so the gain is unit-testable in ISOLATION (the exact MIRROR of {@link drainEnergy},
 * which DEBITS a defender's energy; this CREDITS an ATTACKER's OWN energy). Given the
 * attacker's `currentEnergy` and a fixed `amount`, returns:
 *  - `newEnergy` = `min(MAX_ENERGY, currentEnergy + amount)` — the credit CAPPED at the
 *    per-combatant pool ceiling {@link MAX_ENERGY}, so leech can never overfill the pool.
 *  - `gained` = `min(amount, max(0, MAX_ENERGY − currentEnergy))` (clamped ≥ 0) — how much
 *    was ACTUALLY added (0 when the attacker is already at/above the cap, so the log note
 *    reflects the true amount gained, not the const).
 *
 * PURE: reads two numbers, mutates nothing (the caller applies the write to the
 * ATTACKER's `energy`). It writes ONLY the non-HP `energy` resource, so HP stays
 * monotonically non-increasing (A-42) — this is the genuinely-new SHAPE (the FIRST effect
 * to raise a combatant's OWN energy above the regen path), chosen deliberately over the
 * HP-raising Heal/HoT/Drain/Revive family (A-42-deferred).
 */
export function leechEnergy(
  currentEnergy: number,
  amount: number,
): { newEnergy: number; gained: number } {
  const newEnergy = Math.min(MAX_ENERGY, currentEnergy + amount);
  return { newEnergy, gained: Math.max(0, newEnergy - currentEnergy) };
}

/**
 * TASK-98 (R-17c, 47th combat wave) — Energy Surge's (`leech-percent`) PERCENTAGE energy
 * CREDIT, as a PURE exported helper: the exact FRACTIONAL MIRROR of {@link leechEnergy}
 * (which credits a FIXED amount), and the CREDIT twin of {@link drainEnergyPercent} (the
 * fractional DRAIN). This is the SECOND fractional-MAGNITUDE mechanic on the energy-resource
 * substrate — CONTINUING the percentage/fidelity axis TASK-97's `sap-percent` OPENED, but on
 * the resource-CREDIT side (energy CREDIT existed in exactly ONE form before this — the FIXED
 * {@link leechEnergy}; there was NO fractional/percentage energy gain). Given the ATTACKER's
 * `currentEnergy` and a `ratio` in [0,1], returns:
 *  - `gained` (implicit via `newEnergy − currentEnergy`) — a FRACTION of the caster's OWN
 *    CURRENT pool, `raw = Math.floor(currentEnergy * ratio)` floored to an integer (energy is
 *    a whole-unit resource), then CAPPED so the credit can never overfill the pool. A caster at
 *    0 energy gains NOTHING (`floor(0 * ratio) = 0`); a caster at 1 with ratio 0.5 gains 0
 *    (`floor(0.5) = 0`); a caster already at/near {@link MAX_ENERGY} gains less than the raw
 *    fraction, or nothing.
 *  - `newEnergy` = `Math.min(MAX_ENERGY, currentEnergy + raw)` — the pool after the credit,
 *    {@link MAX_ENERGY}-capped exactly like {@link leechEnergy}.
 *  - `gained` = `Math.max(0, newEnergy − currentEnergy)` — how much was ACTUALLY added (0 when
 *    already at/above the cap, so the log note reflects the true amount, not the raw fraction).
 *
 * PURE: reads two numbers, mutates nothing (the caller applies the write to the ATTACKER's
 * `energy`). It writes ONLY the non-HP `energy` resource, so HP stays monotonically
 * non-increasing (A-42) — exactly like {@link leechEnergy}/{@link drainEnergyPercent}. The
 * fractional-vs-fixed distinction is the whole point: at 20 energy a percentage credit gains
 * `floor(20 * 0.5) = 10` (→ 30) where the fixed-12 Leech gains 12 (→ 32) — the observable
 * magnitude-fidelity contrast. Naming/ratio assumption logged A-85.
 */
export function restoreEnergyPercent(
  currentEnergy: number,
  ratio: number,
): { newEnergy: number; gained: number } {
  const raw = Math.floor(currentEnergy * ratio);
  const newEnergy = Math.min(MAX_ENERGY, currentEnergy + raw);
  return { newEnergy, gained: Math.max(0, newEnergy - currentEnergy) };
}

/**
 * TASK-76 (R-17c, 25th combat wave) — the FIRST status-REMOVAL primitive: the pure
 * helper behind the Purify (`cleanse`) skill. Given a combatant's active `statuses`,
 * returns a NEW array with every HARMFUL arm STRIPPED while the bearer's own SELF-BUFFS
 * are LEFT intact (A-65). PURE + total: reads the input, mutates nothing.
 *
 * WHY a curated allow/deny split rather than "clear everything": a cleanse should relieve
 * what HURTS the bearer, not throw away the bearer's OWN advantages. So it removes:
 *  - the DoTs — `burn`/`poison`/`bleed`/`corrode` — and the deferred `doom` curse;
 *  - the self-suffered stat-DOWNs — `weaken` (DEF-down), `enfeeble` (ATK-down),
 *    `vulnerable` (damage-taken-up);
 *  - the control locks — `stun`/`freeze`/`sleep`;
 * and LEAVES the bearer's self-buffs — `empower` (ATK-up), `shield` (absorb buffer),
 * `retaliate` (Thorns reflect). A dispel-INCLUDING-buffs / cleanse-an-ally variant is a
 * carved later wave; this is the "cleanse-harmful-only" idiom every later status-management
 * mechanic reuses.
 *
 * HP-MONOTONE by construction (A-42): removing a debuff arm writes NO HP — it only trims
 * the status array — so HP stays monotonically non-increasing. `clearDebuffs([])` is a
 * no-op, and applying it twice is IDEMPOTENT (a second pass finds nothing left to strip).
 * Derived from the {@link StatusAilment} union via an explicit HARMFUL set so a future
 * ailment arm is a one-line addition to that set (add-only, invariant 5).
 */
const CLEANSABLE_DEBUFF_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  'burn',
  // Burn-Percent (TASK-120) — the fractional (percent-of-CURRENT-HP) DoT twin of `burn`; harmful to
  // its bearer, so Purify/`cleanse`, Purge/`dispel` and the `reclaim` transfer family all handle it
  // exactly like `burn`. Deliberately NOT added to any REBOUND_* transfer subset this wave (those stay
  // byte-identical; a later wave may include it — mirroring the doom-percent treatment).
  'burn-percent',
  // Wither-Percent (TASK-132) — the maxHp-fraction DoT; harmful to its bearer, so Purify/`cleanse` and
  // the rest of the removal family strip it exactly like the other DoTs.
  'wither-percent',
  'poison',
  // Poison-Percent (TASK-121) — a harmful DoT on its bearer, so Purify/`cleanse`, Purge/`dispel` and
  // the `reclaim` family handle it exactly like `poison`/`burn-percent`. Deliberately NOT added to any
  // REBOUND_* transfer subset this wave (those stay byte-identical — the burn-percent treatment).
  'poison-percent',
  'bleed',
  // Bleed-Percent (TASK-122) — a harmful DoT on its bearer, so Purify/`cleanse`, Purge/`dispel` and
  // the `reclaim` family handle it exactly like `bleed`/`poison-percent`. Deliberately NOT added to any
  // REBOUND_* transfer subset this wave (those stay byte-identical — the burn-percent treatment).
  'bleed-percent',
  'corrode',
  // Corrode-Percent (TASK-123) — a harmful RAMPING fractional DoT on its bearer, so Purify/`cleanse`,
  // Purge/`dispel` and the `reclaim` family handle it exactly like `corrode`/`bleed-percent`. Deliberately
  // NOT added to any REBOUND_* transfer subset this wave (those stay byte-identical — the percent-twin
  // treatment: flat `corrode` IS a REBOUND member but every `-percent` twin is excluded).
  'corrode-percent',
  'doom',
  // Doom-Percent (TASK-119) — the deferred-detonation FRACTIONAL debuff (percent-of-CURRENT-HP twin
  // of `doom`); harmful to its bearer, so Purify/`cleanse`, Purge/`dispel` and the `reclaim`
  // transfer family all handle it exactly like `doom`. Deliberately NOT added to any REBOUND_*
  // transfer subset this wave (those stay byte-identical; a later wave may include it).
  'doom-percent',
  'weaken',
  'weaken-percent',
  'enfeeble',
  'enfeeble-percent',
  'vulnerable',
  'vulnerable-percent',
  // Hobble (TASK-114) — the FLAT SPD-DOWN foe-inflicted DEBUFF; harmful to its bearer (it lowers
  // effective SPD), so Purify/`cleanse` STRIPS it like weaken/enfeeble/vulnerable. It is NOT a self-buff,
  // so it is deliberately EXCLUDED from DISPELLABLE_BUFF_KINDS (the set-membership INVERSION vs the
  // hasten/hasten-percent SPD-UP self-buffs, which went to DISPELLABLE_BUFF_KINDS).
  'hobble',
  // Cripple (TASK-115) — the PERCENTAGE SPD-DOWN foe-inflicted DEBUFF; harmful to its bearer (it
  // lowers effective SPD by floor(spd × ratio)), so Purify/`cleanse` STRIPS it like
  // hobble/weaken-percent/enfeeble-percent. It is NOT a self-buff, so it is deliberately EXCLUDED
  // from DISPELLABLE_BUFF_KINDS (the set-membership INVERSION vs the hasten/hasten-percent SPD-UP
  // self-buffs) — matching the flat `hobble` classification exactly.
  'hobble-percent',
  'stun',
  'freeze',
  'sleep',
]);

/**
 * TASK-83 (R-17c, 32nd combat wave) — the GENERALIZATION of {@link clearDebuffs}: a pure
 * helper that filters OUT every arm whose `kind` is in an arbitrary `kindsSet`, returning a
 * NEW array. `clearDebuffs(statuses)` is now the special case
 * `clearKinds(statuses, CLEANSABLE_DEBUFF_KINDS)` (asserted equivalent in the spec) — this
 * factors "remove this SELECTED set of kinds" out of the fixed cleansable set so a
 * subset-of-kinds transfer (Rebound-Split's {@link REBOUND_SPLIT_KINDS}) reuses the SAME
 * pure trim instead of hand-rolling a broader filter. PURE + total; mutates nothing.
 * HP-monotone by construction (trimming a status array writes NO HP, A-42).
 */
export function clearKinds(
  statuses: readonly StatusAilment[],
  kindsSet: ReadonlySet<StatusAilment['kind']>,
): StatusAilment[] {
  return statuses.filter((s) => !kindsSet.has(s.kind));
}

export function clearDebuffs(statuses: readonly StatusAilment[]): StatusAilment[] {
  return clearKinds(statuses, CLEANSABLE_DEBUFF_KINDS);
}

/**
 * TASK-83 (R-17c, 32nd combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Split (`reclaim-subset`) transfers: the DoT kinds `burn`/`poison`/`bleed`/
 * `corrode`. A STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (every member is cleansable,
 * and it OMITS the stat-mods `weaken`/`enfeeble`/`vulnerable`, the deferred `doom`, and the
 * control locks `stun`/`freeze`/`sleep`). This is the SELECTED set of kinds Rebound-Split
 * moves self→foe — the "widen the SET SELECTIVITY, never the loop" axis (a control-locks-only
 * or stat-mods-only variant is just a different frozen subset reusing {@link clearKinds}).
 */
const REBOUND_SPLIT_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  'burn',
  'poison',
  'bleed',
  'corrode',
]);

/**
 * TASK-84 (R-17c, 33rd combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Snap (`reclaim-stats`) transfers: the STAT-MOD kinds `weaken`/`enfeeble`/
 * `vulnerable`. A STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (every member is
 * cleansable, and it OMITS the DoTs `burn`/`poison`/`bleed`/`corrode`, the deferred `doom`,
 * and the control locks `stun`/`freeze`/`sleep`) and DISJOINT from {@link REBOUND_SPLIT_KINDS}
 * (no kind is in both — Split moves the DoTs, Snap moves the stat-mods). This is the SELECTED
 * set of kinds Rebound-Snap moves self→foe — the "widen the SET SELECTIVITY, never the loop"
 * axis (the SECOND subset variant, proving the TASK-83 {@link clearKinds} generalization pays
 * off: a new frozen subset is now PURE DATA addition — no new helper, no loop change). A
 * control-locks-only variant is just yet another frozen subset reusing {@link clearKinds}.
 */
const REBOUND_SNAP_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  'weaken',
  'weaken-percent',
  'enfeeble',
  'enfeeble-percent',
  'vulnerable',
  'vulnerable-percent',
]);

/**
 * TASK-85 (R-17c, 34th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Lock (`reclaim-locks`) transfers: the CONTROL-LOCK kinds `stun`/`freeze`/`sleep`.
 * A STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (every member is cleansable, and it OMITS
 * the DoTs `burn`/`poison`/`bleed`/`corrode`, the stat-mods `weaken`/`enfeeble`/`vulnerable`,
 * and the deferred `doom`), DISJOINT from BOTH {@link REBOUND_SPLIT_KINDS} (the DoTs) AND
 * {@link REBOUND_SNAP_KINDS} (the stat-mods) — no kind is in more than one. This is the SELECTED
 * set of kinds Rebound-Lock moves self→foe — the "widen the SET SELECTIVITY, never the loop"
 * axis (the THIRD and FINAL natural subset variant). Split moves the DoTs, Snap moves the
 * stat-mods, Lock moves the control-locks: the three subsets are pairwise DISJOINT and together
 * PARTITION the harmful non-`doom` families (DoT ∪ stat-mod ∪ control-lock), CLOSING the
 * subset-of-kinds axis. A third frozen subset dropping in unchanged is the point of the TASK-83
 * {@link clearKinds} generalization — pure DATA addition, no new helper, no loop change.
 */
const REBOUND_LOCK_KINDS: ReadonlySet<StatusAilment['kind']> = new Set(['stun', 'freeze', 'sleep']);

/**
 * TASK-86 (R-17c, 35th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Doom (`reclaim-doom`) transfers: the SINGLE deferred-detonation `doom` kind.
 * A STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (its one member is cleansable, and it
 * OMITS the DoTs `burn`/`poison`/`bleed`/`corrode`, the stat-mods `weaken`/`enfeeble`/
 * `vulnerable`, and the control locks `stun`/`freeze`/`sleep`), DISJOINT from ALL THREE
 * existing subsets — {@link REBOUND_SPLIT_KINDS} (the DoTs), {@link REBOUND_SNAP_KINDS}
 * (the stat-mods) AND {@link REBOUND_LOCK_KINDS} (the control-locks) — no kind is in more
 * than one. This is the SELECTED set of kinds Rebound-Doom moves self→foe — the FOURTH (and
 * final) subset variant. Split moves the DoTs, Snap the stat-mods, Lock the control-locks,
 * Doom the `doom` kind: the four subsets are pairwise DISJOINT and together PARTITION the
 * FULL cleansable set (DoT ∪ stat-mod ∪ control-lock ∪ doom = CLEANSABLE_DEBUFF_KINDS),
 * CLOSING the subset-of-kinds axis over every cleansable kind. A fourth frozen subset
 * dropping in unchanged is the point of the TASK-83 {@link clearKinds} generalization —
 * pure DATA addition, no new helper, no loop change.
 */
const REBOUND_DOOM_KINDS: ReadonlySet<StatusAilment['kind']> = new Set(['doom']);

/**
 * TASK-87 (R-17c, 36th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Blight (`reclaim-blight`) transfers: the UNION of the DoT kinds AND the
 * CONTROL-LOCK kinds `{burn,poison,bleed,corrode}` ∪ `{stun,freeze,sleep}` (7 kinds).
 * It is DERIVED from the two existing frozen sets (rather than hand-listing the 7 kinds)
 * so it stays in LOCK-STEP with {@link REBOUND_SPLIT_KINDS} and {@link REBOUND_LOCK_KINDS}
 * — that derivation IS the reuse point.
 *
 * This is the FIRST MULTI-FAMILY (non-singleton, union-of-two-disjoint-families) kind-set
 * — the NEW selectivity axis. Where Split moves the DoTs, Snap the stat-mods, Lock the
 * control-locks and Doom the `doom` kind (each ONE disjoint family, together PARTITIONING
 * {@link CLEANSABLE_DEBUFF_KINDS}), and Rebound (`reclaim-deep`) moves the WHOLE set,
 * Rebound-Blight moves the union of TWO families — the DoTs AND the control-locks together
 * — and LEAVES the stat-mods (`weaken`/`enfeeble`/`vulnerable`) and `doom` behind. It is a
 * STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (7 < 11), EQUAL to
 * `REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS`, and DISJOINT from BOTH
 * {@link REBOUND_SNAP_KINDS} (the stat-mods) AND {@link REBOUND_DOOM_KINDS} (`doom`).
 * Feeding this NON-singleton multi-family set to {@link clearKinds} PROVES the TASK-83
 * generalization handles arbitrary kind-sets — a fifth frozen set is pure DATA addition
 * (a new const + one apply branch), NO new helper.
 */
const REBOUND_BLIGHT_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SPLIT_KINDS,
  ...REBOUND_LOCK_KINDS,
]);

/**
 * TASK-88 (R-17c, 37th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Cripple (`reclaim-cripple`) transfers: the UNION of the STAT-MOD kinds AND the
 * CONTROL-LOCK kinds `{weaken,enfeeble,vulnerable}` ∪ `{stun,freeze,sleep}` (6 kinds).
 * It is DERIVED from the two existing frozen sets (rather than hand-listing the 6 kinds)
 * so it stays in LOCK-STEP with {@link REBOUND_SNAP_KINDS} and {@link REBOUND_LOCK_KINDS}
 * — that derivation IS the reuse point (exactly how {@link REBOUND_BLIGHT_KINDS} derives
 * from SPLIT ∪ LOCK).
 *
 * This is the SECOND MULTI-FAMILY (non-singleton, union-of-two-disjoint-families) kind-set
 * on the union-selectivity axis Rebound-Blight opened. Where Blight moves the {DoT ∪
 * control-lock} pair, Cripple moves the {stat-mod ∪ control-lock} pair — the COMPLEMENTARY
 * 2-of-4 union (they overlap ONLY on the control-locks) — and LEAVES the DoTs
 * (`burn`/`poison`/`bleed`/`corrode`) and `doom` behind. It is a STRICT SUBSET of
 * {@link CLEANSABLE_DEBUFF_KINDS} (6 < 11), EQUAL to `REBOUND_SNAP_KINDS ∪
 * REBOUND_LOCK_KINDS`, DISJOINT from BOTH {@link REBOUND_SPLIT_KINDS} (the DoTs) AND
 * {@link REBOUND_DOOM_KINDS} (`doom`), and DISTINCT from {@link REBOUND_BLIGHT_KINDS}
 * (Cripple has the stat-mods where Blight has the DoTs). Feeding this SECOND non-singleton
 * multi-family set to {@link clearKinds} PROVES the TASK-83 generalization handles ARBITRARY
 * multi-family kind-sets (not just the one Blight union) — a sixth frozen set is pure DATA
 * addition (a new const + one apply branch), NO new helper.
 */
const REBOUND_CRIPPLE_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SNAP_KINDS,
  ...REBOUND_LOCK_KINDS,
]);

/**
 * TASK-89 (R-17c, 38th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Sear (`reclaim-sear`) transfers: the UNION of the DoT kinds AND the STAT-MOD
 * kinds `{burn,poison,bleed,corrode}` ∪ `{weaken,enfeeble,vulnerable}` (7 kinds — the
 * "affliction" pairing). It is DERIVED from the two existing frozen sets (rather than
 * hand-listing the 7 kinds) so it stays in LOCK-STEP with {@link REBOUND_SPLIT_KINDS} and
 * {@link REBOUND_SNAP_KINDS} — that derivation IS the reuse point (exactly how
 * {@link REBOUND_BLIGHT_KINDS} derives from SPLIT ∪ LOCK and {@link REBOUND_CRIPPLE_KINDS}
 * from SNAP ∪ LOCK).
 *
 * This is the THIRD MULTI-FAMILY (non-singleton, union-of-two-disjoint-families) kind-set
 * on the union-selectivity axis Rebound-Blight opened, and the FIRST that does NOT contain
 * the control-locks. Where Blight moves {DoT ∪ control-lock} and Cripple moves {stat-mod ∪
 * control-lock} (both share the locks), Sear moves the {DoT ∪ stat-mod} pair — a DIFFERENT
 * 2-of-4 union — and LEAVES the control-locks (`stun`/`freeze`/`sleep`) and `doom` behind.
 * It is a STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (7 < 11), EQUAL to
 * `REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS`, DISJOINT from BOTH {@link REBOUND_LOCK_KINDS}
 * (the control-locks) AND {@link REBOUND_DOOM_KINDS} (`doom`), and DISTINCT from BOTH
 * {@link REBOUND_BLIGHT_KINDS} (Sear has the stat-mods where Blight has the control-locks)
 * AND {@link REBOUND_CRIPPLE_KINDS} (Sear has the DoTs where Cripple has the control-locks).
 * Feeding this THIRD non-singleton multi-family set to {@link clearKinds} PROVES the TASK-83
 * generalization handles ARBITRARY multi-family kind-sets — a seventh frozen set is pure
 * DATA addition (a new const + one apply branch), NO new helper.
 */
const REBOUND_SEAR_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SPLIT_KINDS,
  ...REBOUND_SNAP_KINDS,
]);

/**
 * TASK-90 (R-17c, 39th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Doomburn (`reclaim-doomburn`) transfers: the UNION of the DoT kinds AND the
 * `doom` kind `{burn,poison,bleed,corrode}` ∪ `{doom}` (5 kinds — the "affliction"
 * pairing of the damage-over-time arms with the delayed-kill curse). It is DERIVED from
 * the two existing frozen sets (rather than hand-listing the 5 kinds) so it stays in
 * LOCK-STEP with {@link REBOUND_SPLIT_KINDS} and {@link REBOUND_DOOM_KINDS} — that
 * derivation IS the reuse point (exactly how {@link REBOUND_BLIGHT_KINDS} derives from
 * SPLIT ∪ LOCK, {@link REBOUND_CRIPPLE_KINDS} from SNAP ∪ LOCK, and
 * {@link REBOUND_SEAR_KINDS} from SPLIT ∪ SNAP).
 *
 * This is the FOURTH MULTI-FAMILY (non-singleton, union-of-two-disjoint-families)
 * kind-set on the union-selectivity axis Rebound-Blight opened, and the FIRST that
 * CONTAINS `doom` (Blight = DoT ∪ lock, Cripple = stat-mod ∪ lock, Sear = DoT ∪ stat-mod
 * all EXCLUDE `doom`). Where those three move their pairs, Doomburn moves the {DoT ∪
 * `doom`} pair — a DIFFERENT 2-of-4 union — and LEAVES the stat-mods (`weaken`/`enfeeble`/
 * `vulnerable`) and the control-locks (`stun`/`freeze`/`sleep`) behind. It is a STRICT
 * SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (5 < 11), EQUAL to `REBOUND_SPLIT_KINDS ∪
 * REBOUND_DOOM_KINDS`, DISJOINT from BOTH {@link REBOUND_SNAP_KINDS} (the stat-mods) AND
 * {@link REBOUND_LOCK_KINDS} (the control-locks), and DISTINCT from {@link REBOUND_BLIGHT_KINDS}
 * (share only the DoTs — Doomburn has `doom` where Blight has the locks), from
 * {@link REBOUND_CRIPPLE_KINDS} (share NOTHING) AND from {@link REBOUND_SEAR_KINDS} (share
 * only the DoTs — Doomburn has `doom` where Sear has the stat-mods). Feeding this FOURTH
 * non-singleton multi-family set (the FIRST containing `doom`) to {@link clearKinds} PROVES
 * the TASK-83 generalization handles ARBITRARY multi-family kind-sets INCLUDING the `doom`
 * family — an eighth frozen set is pure DATA addition (a new const + one apply branch), NO
 * new helper.
 */
const REBOUND_DOOMBURN_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SPLIT_KINDS,
  ...REBOUND_DOOM_KINDS,
]);

/**
 * TASK-91 (R-17c, 40th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Snapdoom (`reclaim-snapdoom`) transfers: the UNION of the STAT-MOD kinds AND the
 * `doom` kind `{weaken,enfeeble,vulnerable}` ∪ `{doom}` (4 kinds — the "affliction"
 * pairing of the stat-DOWN arms with the delayed-kill curse). It is DERIVED from the two
 * existing frozen sets (rather than hand-listing the 4 kinds) so it stays in LOCK-STEP with
 * {@link REBOUND_SNAP_KINDS} and {@link REBOUND_DOOM_KINDS} — that derivation IS the reuse
 * point (exactly how {@link REBOUND_BLIGHT_KINDS} derives from SPLIT ∪ LOCK,
 * {@link REBOUND_CRIPPLE_KINDS} from SNAP ∪ LOCK, {@link REBOUND_SEAR_KINDS} from SPLIT ∪
 * SNAP, and {@link REBOUND_DOOMBURN_KINDS} from SPLIT ∪ DOOM).
 *
 * This is the FIFTH MULTI-FAMILY (non-singleton, union-of-two-disjoint-families) kind-set on
 * the union-selectivity axis Rebound-Blight opened, and the SECOND that CONTAINS `doom`
 * (Doomburn = DoT ∪ doom was the first; Blight = DoT ∪ lock, Cripple = stat-mod ∪ lock,
 * Sear = DoT ∪ stat-mod all EXCLUDE `doom`). Where those four move their pairs, Snapdoom
 * moves the {stat-mod ∪ `doom`} pair — a DIFFERENT 2-of-4 union — and LEAVES the DoTs
 * (`burn`/`poison`/`bleed`/`corrode`) and the control-locks (`stun`/`freeze`/`sleep`)
 * behind. It is a STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (4 < 11), EQUAL to
 * `REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS`, DISJOINT from BOTH {@link REBOUND_SPLIT_KINDS}
 * (the DoTs) AND {@link REBOUND_LOCK_KINDS} (the control-locks), and DISTINCT from
 * {@link REBOUND_BLIGHT_KINDS} (share NOTHING), from {@link REBOUND_CRIPPLE_KINDS} (share
 * only the stat-mods — Snapdoom has `doom` where Cripple has the locks), from
 * {@link REBOUND_SEAR_KINDS} (share only the stat-mods — Snapdoom has `doom` where Sear has
 * the DoTs) AND from {@link REBOUND_DOOMBURN_KINDS} (share only `doom` — Snapdoom has the
 * stat-mods where Doomburn has the DoTs). Feeding this FIFTH non-singleton multi-family set
 * (the SECOND containing `doom`) to {@link clearKinds} PROVES the TASK-83 generalization
 * handles ARBITRARY multi-family kind-sets INCLUDING the `doom` family — a ninth frozen set
 * is pure DATA addition (a new const + one apply branch), NO new helper.
 */
const REBOUND_SNAPDOOM_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SNAP_KINDS,
  ...REBOUND_DOOM_KINDS,
]);

/**
 * TASK-92 (R-17c, 41st combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Doomlock (`reclaim-doomlock`) transfers: the UNION of the CONTROL-LOCK kinds AND the
 * `doom` kind `{stun,freeze,sleep}` ∪ `{doom}` (4 kinds — the "hold-then-detonate" pairing of
 * the skip/timing locks with the delayed-kill curse). It is DERIVED from the two existing frozen
 * sets (rather than hand-listing the 4 kinds) so it stays in LOCK-STEP with
 * {@link REBOUND_LOCK_KINDS} and {@link REBOUND_DOOM_KINDS} — that derivation IS the reuse point
 * (exactly how {@link REBOUND_BLIGHT_KINDS} derives from SPLIT ∪ LOCK,
 * {@link REBOUND_CRIPPLE_KINDS} from SNAP ∪ LOCK, {@link REBOUND_SEAR_KINDS} from SPLIT ∪ SNAP,
 * {@link REBOUND_DOOMBURN_KINDS} from SPLIT ∪ DOOM, and {@link REBOUND_SNAPDOOM_KINDS} from
 * SNAP ∪ DOOM).
 *
 * This is the SIXTH (and FINAL) MULTI-FAMILY (non-singleton, union-of-two-disjoint-families)
 * kind-set on the union-selectivity axis Rebound-Blight opened, and the THIRD (and last) that
 * CONTAINS `doom` (Doomburn = DoT ∪ doom was first, Snapdoom = stat-mod ∪ doom second; Blight =
 * DoT ∪ lock, Cripple = stat-mod ∪ lock, Sear = DoT ∪ stat-mod all EXCLUDE `doom`). Where those
 * five move their pairs, Doomlock moves the {control-lock ∪ `doom`} pair — the SIXTH and LAST
 * 2-of-4 union — and LEAVES the DoTs (`burn`/`poison`/`bleed`/`corrode`) and the stat-mods
 * (`weaken`/`enfeeble`/`vulnerable`) behind. It is a STRICT SUBSET of
 * {@link CLEANSABLE_DEBUFF_KINDS} (4 < 11), EQUAL to `REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS`,
 * DISJOINT from BOTH {@link REBOUND_SPLIT_KINDS} (the DoTs) AND {@link REBOUND_SNAP_KINDS} (the
 * stat-mods), and DISTINCT from {@link REBOUND_BLIGHT_KINDS} (share only the locks — Doomlock has
 * `doom` where Blight has the DoTs), from {@link REBOUND_CRIPPLE_KINDS} (share only the locks —
 * Doomlock has `doom` where Cripple has the stat-mods), from {@link REBOUND_DOOMBURN_KINDS} (share
 * only `doom` — Doomlock has the locks where Doomburn has the DoTs) AND from
 * {@link REBOUND_SNAPDOOM_KINDS} (share only `doom` — Doomlock has the locks where Snapdoom has the
 * stat-mods). Feeding this SIXTH non-singleton multi-family set (the THIRD containing `doom`) to
 * {@link clearKinds} CLOSES all six 2-of-4 unions and PROVES the TASK-83 generalization handles
 * ARBITRARY multi-family kind-sets INCLUDING every `doom`-union — a tenth frozen set is pure DATA
 * addition (a new const + one apply branch), NO new helper.
 */
const REBOUND_DOOMLOCK_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_LOCK_KINDS,
  ...REBOUND_DOOM_KINDS,
]);

/**
 * TASK-93 (R-17c, 42nd combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Purge (`reclaim-purge`) transfers: the UNION of the DoT kinds, the STAT-MOD kinds AND
 * the CONTROL-LOCK kinds `{burn,poison,bleed,corrode}` ∪ `{weaken,enfeeble,vulnerable}` ∪
 * `{stun,freeze,sleep}` (10 kinds = "everything but `doom`" — CLEANSABLE minus `doom`). It is
 * DERIVED from the three existing frozen sets (rather than hand-listing the 10 kinds) so it stays
 * in LOCK-STEP with
 * {@link REBOUND_SPLIT_KINDS}, {@link REBOUND_SNAP_KINDS} and {@link REBOUND_LOCK_KINDS} — that
 * derivation IS the reuse point (exactly how the six 2-of-4 unions derive from their two source
 * sets).
 *
 * This is the FIRST 3-of-4 MULTI-FAMILY (union-of-three-disjoint-families) kind-set — OPENING the
 * 3-of-4 selectivity DEPTH, a NEW rung on the selectivity axis (singleton → 2-of-4 pair → 3-of-4
 * triple → whole-set) exactly as {@link REBOUND_BLIGHT_KINDS} opened the 2-of-4 pair axis after
 * the singleton partition closed. Where the singletons move ONE family and the six 2-of-4 unions
 * move a PAIR, Rebound-Purge moves the union of THREE families and LEAVES ONLY the caster's `doom`
 * arm (and its self-buffs) behind. It is a STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS}
 * (10 < 11), EQUAL to `REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS`, DISJOINT
 * from {@link REBOUND_DOOM_KINDS} (it LEAVES `doom` behind), and a STRICT SUPERSET of each of
 * {@link REBOUND_SPLIT_KINDS}, {@link REBOUND_SNAP_KINDS}, {@link REBOUND_LOCK_KINDS},
 * {@link REBOUND_BLIGHT_KINDS} (SPLIT∪LOCK), {@link REBOUND_CRIPPLE_KINDS} (SNAP∪LOCK) AND
 * {@link REBOUND_SEAR_KINDS} (SPLIT∪SNAP). It is DISTINCT from (strictly LARGER than)
 * {@link REBOUND_SEAR_KINDS} — Sear (size 7) EXCLUDES the control-locks, so Purge has `stun` where
 * Sear does not — and from every 2-of-4 union (strictly larger — 10 kinds spanning all three
 * non-doom families). Feeding
 * this FIRST 3-family set to {@link clearKinds} PROVES the TASK-83 generalization handles an
 * arbitrary 3-of-4 kind-set — an eleventh frozen set is pure DATA addition (a new const + one
 * apply branch), NO new helper.
 */
const REBOUND_PURGE_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SPLIT_KINDS,
  ...REBOUND_SNAP_KINDS,
  ...REBOUND_LOCK_KINDS,
]);

/**
 * TASK-94 (R-17c, 43rd combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Seardoom (`reclaim-seardoom`) transfers: the UNION of the DoT kinds, the STAT-MOD kinds
 * AND the `doom` kind `{burn,poison,bleed,corrode}` ∪ `{weaken,enfeeble,vulnerable}` ∪ `{doom}`
 * (8 kinds = "everything but the CONTROL-LOCKS" — CLEANSABLE minus `stun`/`freeze`/`sleep`). It is
 * DERIVED from the three existing frozen sets (rather than hand-listing the 8 kinds) so it stays in
 * LOCK-STEP with {@link REBOUND_SPLIT_KINDS}, {@link REBOUND_SNAP_KINDS} and
 * {@link REBOUND_DOOM_KINDS} — that derivation IS the reuse point (exactly how the six 2-of-4
 * unions and {@link REBOUND_PURGE_KINDS} derive from their source sets).
 *
 * This is the SECOND 3-of-4 MULTI-FAMILY (union-of-three-disjoint-families) kind-set — ADVANCING
 * the 3-of-4 selectivity DEPTH that {@link REBOUND_PURGE_KINDS} opened, and the FIRST 3-of-4 union
 * that INCLUDES `doom`. Where Purge moves DoT ∪ stat-mod ∪ control-lock (LEAVING `doom`),
 * Rebound-Seardoom moves DoT ∪ stat-mod ∪ `doom` — the MIRROR image across the doom/control-lock
 * swap — and LEAVES ONLY the caster's CONTROL-LOCK arms (`stun`/`freeze`/`sleep`) (and its
 * self-buffs) behind. It is a STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (8 < 11), EQUAL to
 * `REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS`, DISJOINT from
 * {@link REBOUND_LOCK_KINDS} (the control-locks it LEAVES behind), a STRICT SUPERSET of
 * {@link REBOUND_SEAR_KINDS} (= SPLIT ∪ SNAP, size 7 — Seardoom = Sear ∪ `{doom}`) and of the
 * doom-including 2-of-4 unions {@link REBOUND_DOOMBURN_KINDS} (SPLIT ∪ DOOM) and
 * {@link REBOUND_SNAPDOOM_KINDS} (SNAP ∪ DOOM), and DISTINCT from {@link REBOUND_PURGE_KINDS} (both
 * are 3-of-4 unions but Seardoom INCLUDES `doom` and EXCLUDES the control-locks whereas Purge is
 * the inverse; sizes 8 ≠ 10). Feeding this SECOND 3-family set (the FIRST containing `doom`) to
 * {@link clearKinds} PROVES the TASK-83 generalization handles an arbitrary doom-including 3-of-4
 * kind-set — a twelfth frozen set is pure DATA addition (a new const + one apply branch), NO new
 * helper.
 */
const REBOUND_SEARDOOM_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SPLIT_KINDS,
  ...REBOUND_SNAP_KINDS,
  ...REBOUND_DOOM_KINDS,
]);

/**
 * TASK-95 (R-17c, 44th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Blightdoom (`reclaim-blightdoom`) transfers: the UNION of the DoT kinds, the
 * CONTROL-LOCK kinds AND the `doom` kind `{burn,poison,bleed,corrode}` ∪ `{stun,freeze,sleep}` ∪
 * `{doom}` (8 kinds = "everything but the STAT-MODS" — CLEANSABLE minus `weaken`/`enfeeble`/
 * `vulnerable`). It is DERIVED from the three existing frozen sets (rather than hand-listing the 8
 * kinds) so it stays in LOCK-STEP with {@link REBOUND_SPLIT_KINDS}, {@link REBOUND_LOCK_KINDS} and
 * {@link REBOUND_DOOM_KINDS} — that derivation IS the reuse point (exactly how the six 2-of-4
 * unions, {@link REBOUND_PURGE_KINDS} and {@link REBOUND_SEARDOOM_KINDS} derive from their source
 * sets).
 *
 * This is the THIRD 3-of-4 MULTI-FAMILY (union-of-three-disjoint-families) kind-set — ADVANCING
 * the 3-of-4 selectivity DEPTH that {@link REBOUND_PURGE_KINDS} opened, and the SECOND 3-of-4 union
 * that INCLUDES `doom` (Seardoom was the first). Where Purge moves DoT ∪ stat-mod ∪ control-lock
 * (LEAVING `doom`) and Seardoom moves DoT ∪ stat-mod ∪ `doom` (LEAVING the control-locks),
 * Rebound-Blightdoom moves DoT ∪ control-lock ∪ `doom` — the MIRROR image of Seardoom across the
 * stat-mod/control-lock swap — and LEAVES ONLY the caster's STAT-MOD arms
 * (`weaken`/`enfeeble`/`vulnerable`) (and its self-buffs) behind. It is a STRICT SUBSET of
 * {@link CLEANSABLE_DEBUFF_KINDS} (8 < 11), EQUAL to `REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS ∪
 * REBOUND_DOOM_KINDS`, DISJOINT from {@link REBOUND_SNAP_KINDS} (the stat-mods it LEAVES behind), a
 * STRICT SUPERSET of {@link REBOUND_BLIGHT_KINDS} (= SPLIT ∪ LOCK, size 7 — Blightdoom = Blight ∪
 * `{doom}`) and of the doom-including 2-of-4 unions {@link REBOUND_DOOMBURN_KINDS} (SPLIT ∪ DOOM)
 * and {@link REBOUND_DOOMLOCK_KINDS} (LOCK ∪ DOOM), and DISTINCT from BOTH prior 3-of-4 unions:
 * from {@link REBOUND_PURGE_KINDS} (Blightdoom INCLUDES `doom` and EXCLUDES the stat-mods whereas
 * Purge is the inverse; sizes 8 ≠ 10) AND from {@link REBOUND_SEARDOOM_KINDS} (both are 8-kind
 * doom-including 3-of-4 unions but Blightdoom INCLUDES the control-locks and EXCLUDES the stat-mods
 * whereas Seardoom is the inverse; equal size 8, different membership). Feeding this THIRD 3-family
 * set (the SECOND containing `doom`) to {@link clearKinds} PROVES the TASK-83 generalization handles
 * a doom-including 3-of-4 kind-set — a thirteenth frozen set is pure DATA addition (a new const +
 * one apply branch), NO new helper.
 */
const REBOUND_BLIGHTDOOM_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SPLIT_KINDS,
  ...REBOUND_LOCK_KINDS,
  ...REBOUND_DOOM_KINDS,
]);

/**
 * TASK-96 (R-17c, 45th combat wave) — the FROZEN subset of debuff kinds that
 * Rebound-Snaplockdoom (`reclaim-snaplockdoom`) transfers: the UNION of the STAT-MOD kinds, the
 * CONTROL-LOCK kinds AND the `doom` kind `{weaken,enfeeble,vulnerable}` ∪ `{stun,freeze,sleep}` ∪
 * `{doom}` (7 kinds = "everything but the DoTs" — CLEANSABLE minus `burn`/`poison`/`bleed`/
 * `corrode`). It is DERIVED from the three existing frozen sets (rather than hand-listing the 7
 * kinds) so it stays in LOCK-STEP with {@link REBOUND_SNAP_KINDS}, {@link REBOUND_LOCK_KINDS} and
 * {@link REBOUND_DOOM_KINDS} — that derivation IS the reuse point (exactly how the six 2-of-4
 * unions, {@link REBOUND_PURGE_KINDS}, {@link REBOUND_SEARDOOM_KINDS} and
 * {@link REBOUND_BLIGHTDOOM_KINDS} derive from their source sets).
 *
 * This is the FOURTH and LAST 3-of-4 MULTI-FAMILY (union-of-three-disjoint-families) kind-set — and
 * the THIRD 3-of-4 union that INCLUDES `doom` — CLOSING the 3-of-4 selectivity axis. Where Purge
 * moves DoT ∪ stat-mod ∪ control-lock (LEAVING `doom`), Seardoom moves DoT ∪ stat-mod ∪ `doom`
 * (LEAVING the control-locks) and Blightdoom moves DoT ∪ control-lock ∪ `doom` (LEAVING the
 * stat-mods), Rebound-Snaplockdoom moves stat-mod ∪ control-lock ∪ `doom` — the ONLY 3-of-4 triple
 * that EXCLUDES the DoTs — and LEAVES ONLY the caster's DoT arms (`burn`/`poison`/`bleed`/`corrode`)
 * (and its self-buffs) behind. It is a STRICT SUBSET of {@link CLEANSABLE_DEBUFF_KINDS} (7 < 11),
 * EQUAL to `REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS`, DISJOINT from
 * {@link REBOUND_SPLIT_KINDS} (the DoTs it LEAVES behind), a STRICT SUPERSET of
 * {@link REBOUND_CRIPPLE_KINDS} (= SNAP ∪ LOCK, size 6 — Snaplockdoom = Cripple ∪ `{doom}`) and of
 * the doom-including 2-of-4 unions {@link REBOUND_SNAPDOOM_KINDS} (SNAP ∪ DOOM) and
 * {@link REBOUND_DOOMLOCK_KINDS} (LOCK ∪ DOOM), and DISTINCT from ALL THREE prior 3-of-4 unions:
 * from {@link REBOUND_PURGE_KINDS} (Snaplockdoom INCLUDES `doom` and EXCLUDES the DoTs whereas Purge
 * is the inverse; sizes 7 ≠ 10), from {@link REBOUND_SEARDOOM_KINDS} (both doom-including but
 * Snaplockdoom INCLUDES the control-locks + EXCLUDES the DoTs while Seardoom is the inverse; sizes
 * 7 ≠ 8) AND from {@link REBOUND_BLIGHTDOOM_KINDS} (both doom-including but Snaplockdoom INCLUDES
 * the stat-mods + EXCLUDES the DoTs while Blightdoom is the inverse; sizes 7 ≠ 8). Feeding this
 * FOURTH and LAST 3-family set (the THIRD containing `doom`) to {@link clearKinds} CLOSES the 3-of-4
 * selectivity axis and PROVES the TASK-83 generalization handles every 3-of-4 kind-set — a
 * fourteenth frozen set is pure DATA addition (a new const + one apply branch), NO new helper.
 */
const REBOUND_SNAPLOCKDOOM_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  ...REBOUND_SNAP_KINDS,
  ...REBOUND_LOCK_KINDS,
  ...REBOUND_DOOM_KINDS,
]);

/**
 * TASK-77 (R-17c, 26th combat wave) — the SECOND status-REMOVAL primitive: the pure helper
 * behind the Purge (`dispel`) skill, the HOSTILE inverse of {@link clearDebuffs}. Given a
 * FOE's active `statuses`, returns a NEW array with the foe's SELF-BUFFS STRIPPED while its
 * HARMFUL arms (DoTs / stat-downs / control locks) are LEFT intact (A-66). PURE + total:
 * reads the input, mutates nothing.
 *
 * WHY strip ONLY the self-buffs (and NOT the foe's DoTs/debuffs): dispel is cast AGAINST the
 * opponent, so it should remove what HELPS the foe — its `empower` (ATK-up), `shield` (absorb
 * buffer), and `retaliate` (Thorns reflect). Stripping the foe's OWN harmful arms (a burn it
 * carries, a weaken on it) would HELP the foe, the opposite of a hostile skill — the natural
 * counter-reading (A-66).
 *
 * NOTE the clean complementarity: {@link DISPELLABLE_BUFF_KINDS} is EXACTLY the three
 * self-buff kinds `clearDebuffs`'s {@link CLEANSABLE_DEBUFF_KINDS} deliberately EXCLUDES —
 * the two allow-sets PARTITION the ailment kinds by who benefits (A-66). This establishes the
 * "widen the SET or the target, never the loop" idiom every later status-management mechanic
 * (dispel-ALL, party cleanse in teams, cleanse-on-swap) reuses.
 *
 * HP-MONOTONE by construction (A-42): removing a buff arm writes NO HP — it only trims the
 * status array — so HP stays monotonically non-increasing. `stripBuffs([])` is a no-op, and
 * applying it twice is IDEMPOTENT (a second pass finds no self-buff left to strip). Derived
 * from the {@link StatusAilment} union via an explicit BUFF set so a future buff arm is a
 * one-line addition to that set (add-only, invariant 5).
 */
const DISPELLABLE_BUFF_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  'empower',
  'shield',
  'retaliate',
  // Thorn Mirror (TASK-99) is a SELF-buff (the fractional MIRROR of retaliate), so it is
  // classified as a strippable/dispellable buff exactly like retaliate — a hostile Purge
  // removes it too. Excluded from CLEANSABLE_DEBUFF_KINDS (it is not harmful to its owner).
  'retaliate-percent',
  // Reinforce (TASK-102) is a SELF-buff (the fractional MIRROR of empower, the ATK-BONUS twin of
  // Sunder's ATK-reduction) — classified as a strippable/dispellable buff exactly like empower: a
  // hostile Purge removes it too. Excluded from CLEANSABLE_DEBUFF_KINDS (it is not harmful to its owner).
  'empower-percent',
  // Fortify (TASK-108) is a SELF-buff (the DEF-up self-buff, the exact SELF-BUFF MIRROR of the
  // `weaken` DEF-DOWN debuff and the DEF-axis twin of `empower`) — classified as a strippable/
  // dispellable buff exactly like empower/shield/retaliate: a hostile Purge/dispel/purloin removes
  // it too. Excluded from CLEANSABLE_DEBUFF_KINDS (a self-buff is NOT harmful to its owner — that
  // set removes the bearer's own DEBUFFS). Posture-B: never fires in the shipped fights, so this
  // membership perturbs no shipped-fight assert.
  'fortify',
  // Brace (TASK-109) is a SELF-buff (the damage-taken-DOWN self-buff, the exact POSITIVE MIRROR of
  // the `vulnerable` damage-taken-UP debuff at the damage-application seam) — classified as a
  // strippable/dispellable buff exactly like empower/shield/retaliate/fortify: a hostile
  // Purge/dispel/purloin removes it too. Excluded from CLEANSABLE_DEBUFF_KINDS (a self-buff is NOT
  // harmful to its owner). Posture-B: never fires in the shipped fights, so this membership perturbs
  // no shipped-fight assert.
  'brace',
  // Bulwark (TASK-110) is a SELF-buff (the PERCENTAGE damage-taken-DOWN self-buff, the fractional
  // MIRROR of `brace` and the DOWN-side percent twin of `vulnerable-percent` at the damage-application
  // seam) — classified as a strippable/dispellable buff exactly like empower/shield/retaliate/fortify/
  // brace: a hostile Purge/dispel/purloin removes it too. Excluded from CLEANSABLE_DEBUFF_KINDS (a
  // self-buff is NOT harmful to its owner). Posture-B: never fires in the shipped fights, so this
  // membership perturbs no shipped-fight assert.
  'brace-percent',
  // Aegis (TASK-111) is a SELF-buff (the PERCENTAGE DEF-UP self-buff, the fractional MIRROR of
  // `fortify` and the DEF-UP percent twin of the DEBUFF `weaken-percent` at the DEF-mitigation seam) —
  // classified as a strippable/dispellable buff exactly like empower/shield/retaliate/fortify/brace/
  // brace-percent: a hostile Purge/dispel/purloin removes it too. Excluded from CLEANSABLE_DEBUFF_KINDS
  // (a self-buff is NOT harmful to its owner). Posture-B: never fires in the shipped fights, so this
  // membership perturbs no shipped-fight assert.
  'fortify-percent',
  // Hasten (TASK-112) is a SELF-buff (the FLAT SPD-UP self-buff, the SPD-axis twin of the DEF-up
  // `fortify` / ATK-up `empower`) — classified as a strippable/dispellable buff exactly like
  // empower/shield/retaliate/fortify/brace/brace-percent/fortify-percent: a hostile Purge/dispel/purloin
  // removes it too. Excluded from CLEANSABLE_DEBUFF_KINDS (a self-buff is NOT harmful to its owner).
  // Posture-B: never fires in the shipped fights, so this membership perturbs no shipped-fight assert.
  'hasten',
  // Rush (TASK-113) is a SELF-buff (the PERCENTAGE SPD-UP self-buff, the fractional MIRROR of the flat
  // `hasten` and the SPD-axis percent twin of the DEF-up `fortify-percent` / ATK-up `empower-percent`) —
  // classified as a strippable/dispellable buff exactly like empower/shield/retaliate/fortify/brace/
  // brace-percent/fortify-percent/hasten: a hostile Purge/dispel/purloin removes it too. Excluded from
  // CLEANSABLE_DEBUFF_KINDS (a self-buff is NOT harmful to its owner). Posture-B: never fires in the
  // shipped fights, so this membership perturbs no shipped-fight assert.
  'hasten-percent',
]);

export function stripBuffs(statuses: readonly StatusAilment[]): StatusAilment[] {
  return statuses.filter((s) => !DISPELLABLE_BUFF_KINDS.has(s.kind));
}

/**
 * TASK-78 (R-17c, 27th combat wave) — the THIRD status-REMOVAL family member and the
 * FIRST strip-and-TRANSFER: the pure helper behind the Purloin (`purloin`, "Spellthief")
 * skill. It REUSES {@link stripBuffs}/{@link DISPELLABLE_BUFF_KINDS} verbatim (NO new
 * allow-set, NO new StatusAilment arm, NO new tick slot) — it merely COMPOSES the existing
 * hostile strip with the existing self-buff grant. Given the CASTER's and the FOE's active
 * `statuses`, returns a NEW pair of arrays plus whether a steal actually occurred:
 *  - `foe` — the foe's statuses with its SELF-BUFFS stripped (via {@link stripBuffs}); its
 *    harmful arms are LEFT intact (A-66 — stripping the foe's own DoT would HELP it),
 *  - `caster` — the caster's statuses, UNCHANGED when the foe had NO self-buff to steal, or
 *    with a FIXED `empower` (ATK-up) self-buff GRANTED (via the EXISTING {@link applyAilment}
 *    `'empower'` builder, exactly as the `empower`/Focus effect does) when a strip DID occur,
 *  - `stole` — `true` iff the foe HAD at least one self-buff (i.e. `stripBuffs` returned a
 *    SHORTER array). This is what makes it a GENUINE steal, not an unconditional self-buff:
 *    against a foe with no self-buff the strip is a no-op AND the caster gets NO free buff.
 *
 * WHY the grant is a FIXED `empower` (not the exact buff(s) cloned verbatim): a
 * payload-preserving "steal the exact buff" refinement is a carved follow-up (A-67);
 * keeping the grant a single fixed `empower` keeps this slice single-responsibility. The
 * grant reuses the existing `empower` arm/tick (untouched) — Purloin ITSELF is INSTANTANEOUS,
 * it resolves on cast (like `sap`/`leech`/`cleanse`/`dispel`) and is NOT a lingering ailment.
 *
 * HP-MONOTONE by construction (A-42): a strip trims the foe's array and a grant appends the
 * caster's — NEITHER writes any HP — so HP stays monotonically non-increasing. PURE + total:
 * reads the two inputs, mutates nothing (returns fresh arrays). Because it reuses the two
 * proven primitives, its own regression surface is the CONDITIONAL transfer alone.
 */
export function stealBuffs(
  casterStatuses: readonly StatusAilment[],
  foeStatuses: readonly StatusAilment[],
): { caster: StatusAilment[]; foe: StatusAilment[]; stole: boolean } {
  const foe = stripBuffs(foeStatuses);
  const stole = foe.length < foeStatuses.length;
  const caster = stole ? applyAilment(casterStatuses, 'empower') : [...casterStatuses];
  return { caster, foe, stole };
}

/**
 * TASK-104 (R-17c) — the pure helper behind Chaos Shift (`swap-atk`), the FIRST stat-VALUE
 * SWAP, extracted so the raw-`atk` EXCHANGE is unit-testable in ISOLATION (the same posture
 * as {@link stealBuffs}/{@link clearDebuffs} — a Posture-B on-cast effect proven directly,
 * never in the shipped fight). Given two combatants, returns their `atk` values EXCHANGED:
 * `{ casterAtk: them.atk, foeAtk: me.atk }` — the caller writes them back in place. This
 * opens a genuinely-NEW *shape* axis: the transfer of raw STAT VALUES, distinct from the
 * transfer of status ARRAYS by the cleanse/dispel/purloin/displace/reclaim family. It is a
 * pure exchange — NO current-stat FLOOR / lookup is needed (unlike the weaken/enfeeble
 * REDUCTIONS which floor at MIN_EFFECTIVE_*). It writes NO HP — only the two `atk` scalars
 * change — so HP stays monotonically non-increasing (A-42). PURE: reads two numbers, mutates
 * nothing. `swapDef`/`swapSpd`/full-swap are trivial later twins of this SAME shape.
 */
export function swapAtk(
  me: Pick<Combatant, 'atk'>,
  them: Pick<Combatant, 'atk'>,
): { casterAtk: number; foeAtk: number } {
  return { casterAtk: them.atk, foeAtk: me.atk };
}

/**
 * TASK-105 (R-17c) — the pure helper behind Chaos Warp (`swap-def`), the SECOND stat-VALUE
 * SWAP and the defensive twin of {@link swapAtk}. Structurally IDENTICAL to {@link swapAtk}
 * on the existing raw `def` scalar (no new substrate — `Combatant` has fields
 * `name/type/element/hp/atk/def/spd`, NO `maxHp`), extracted so the raw-`def` EXCHANGE is
 * unit-testable in ISOLATION (the same Posture-B posture as its atk twin — proven directly,
 * never in the shipped fight). Given two combatants, returns their `def` values EXCHANGED:
 * `{ casterDef: them.def, foeDef: me.def }` — the caller writes them back in place. This is
 * the SECOND variant of the stat-VALUE-transfer *shape* axis TASK-104 opened, distinct from
 * the transfer of status ARRAYS by the cleanse/dispel/purloin/displace/reclaim family. It is
 * a pure exchange — NO current-stat FLOOR / lookup is needed (unlike the weaken/enfeeble
 * REDUCTIONS which floor at MIN_EFFECTIVE_*). It writes NO HP — only the two `def` scalars
 * change — so HP stays monotonically non-increasing (A-42). PURE: reads two numbers, mutates
 * nothing. `swapSpd`/full three-stat swap are the trivial remaining twins of this SAME shape.
 */
export function swapDef(
  me: Pick<Combatant, 'def'>,
  them: Pick<Combatant, 'def'>,
): { casterDef: number; foeDef: number } {
  return { casterDef: them.def, foeDef: me.def };
}

/**
 * TASK-106 (R-17c) — the pure helper behind Chaos Cyclone (`swap-spd`), the THIRD stat-VALUE
 * SWAP and the speed twin of {@link swapAtk}/{@link swapDef}, COMPLETING the per-scalar
 * atk→def→spd swap trio. Structurally IDENTICAL to {@link swapDef} on the existing raw `spd`
 * scalar (no new substrate — `Combatant` has fields `name/type/element/hp/atk/def/spd`, `spd`
 * already present, NO `maxHp`), extracted so the raw-`spd` EXCHANGE is unit-testable in
 * ISOLATION (the same Posture-B posture as its atk/def twins — proven directly, never in the
 * shipped fight). Given two combatants, returns their `spd` values EXCHANGED:
 * `{ casterSpd: them.spd, foeSpd: me.spd }` — the caller writes them back in place. This is
 * the THIRD variant of the stat-VALUE-transfer *shape* axis TASK-104 opened, distinct from the
 * transfer of status ARRAYS by the cleanse/dispel/purloin/displace/reclaim family. It is a
 * pure exchange — NO current-stat FLOOR / lookup is needed (unlike the weaken/enfeeble
 * REDUCTIONS which floor at MIN_EFFECTIVE_*). It writes NO HP — only the two `spd` scalars
 * change — so HP stays monotonically non-increasing (A-42). PURE: reads two numbers, mutates
 * nothing. This completes the stat-value-swap per-scalar sweep of the three combat stats.
 */
export function swapSpd(
  me: Pick<Combatant, 'spd'>,
  them: Pick<Combatant, 'spd'>,
): { casterSpd: number; foeSpd: number } {
  return { casterSpd: them.spd, foeSpd: me.spd };
}

/**
 * TASK-107 (R-17c) — the pure helper behind Chaos Nexus (`swap-all`), the FULL three-stat SWAP
 * that EXCHANGES `atk` + `def` + `spd` TOGETHER in a single cast, EXHAUSTING the stat-value-swap
 * shape family the per-scalar {@link swapAtk}/{@link swapDef}/{@link swapSpd} trio opened. It
 * re-derives NO exchange math: it COMPOSES the three shipped per-scalar helpers, reading each
 * combatant's ORIGINAL scalar and returning all six EXCHANGED values so the caller writes them
 * back in place. Extracted so the FULL exchange is unit-testable in ISOLATION (the same Posture-B
 * posture as its per-scalar parents — proven directly, never in the shipped fight). Needs NO new
 * substrate — all three raw scalars already exist on `Combatant` (NO `maxHp`). It writes NO HP —
 * only the three scalar pairs change — so HP stays monotonically non-increasing (A-42). PURE:
 * reads three numbers per side, mutates nothing.
 */
export function swapAllStats(
  me: Pick<Combatant, 'atk' | 'def' | 'spd'>,
  them: Pick<Combatant, 'atk' | 'def' | 'spd'>,
): {
  casterAtk: number;
  foeAtk: number;
  casterDef: number;
  foeDef: number;
  casterSpd: number;
  foeSpd: number;
} {
  const a = swapAtk(me, them);
  const d = swapDef(me, them);
  const s = swapSpd(me, them);
  return {
    casterAtk: a.casterAtk,
    foeAtk: a.foeAtk,
    casterDef: d.casterDef,
    foeDef: d.foeDef,
    casterSpd: s.casterSpd,
    foeSpd: s.foeSpd,
  };
}

/**
 * TASK-65 (R-17c) — the VULNERABLE damage-AMPLIFICATION read, as a PURE exported helper
 * so the +25%-damage-taken payoff is unit-testable in ISOLATION (the mirror of how the
 * Weaken DEF-cut is proven directly on the exported {@link resolveAttack}). Given a
 * ≥1-floored `base` strike and the DEFENDER's active `statuses`, returns:
 *  - `base` UNCHANGED when the defender carries NO `vulnerable` arm (the identity — every
 *    existing fight state, so `resolveDamageStrike` stays byte-identical, invariant 5),
 *  - `max(1, round(base * (1 + damageTakenBonus)))` (+25%) when it does — the AMP layered
 *    AFTER the type/element/DEF math and BEFORE the shield-absorb.
 *
 * A damage-AMP only ever RAISES a strike (never heals), so HP stays monotonically
 * non-increasing (A-54 / GUARDRAIL 2). The `max(1, …)` floor is re-asserted so an
 * already-1 hit against a vulnerable defender still lands ≥ 1. PURE: reads, mutates
 * nothing (the exact inverse posture of the DEF-reduction {@link resolveAttack} read).
 */
export function amplifyForVulnerable(
  base: number,
  defenderStatuses: readonly StatusAilment[],
): number {
  const vulnerable = defenderStatuses.find((s) => s.kind === 'vulnerable');
  const bonus = vulnerable?.kind === 'vulnerable' ? vulnerable.damageTakenBonus : 0;
  // Rupture / vulnerable-percent (TASK-103) — the fractional MIRROR of the FIXED `vulnerable` read
  // above (which stays BYTE-UNCHANGED). If the defender carries a `vulnerable-percent` arm, ADD its
  // `damageTakenBonusRatio` (a FRACTION of the base strike) into the SAME `bonus` scalar BEFORE the
  // `base * (1 + bonus)` amplify (the fixed and percent bonuses SUM if both present — they never
  // co-occur in-sim). Target-INDEPENDENT (no floor / stat lookup — the vulnerable bonus is already a
  // multiplier). When no vulnerable-percent is present (every existing fight state) the added term is
  // 0 → byte-identical (invariant 5). A damage-AMP only ever RAISES a strike, so HP stays monotone (A-42).
  const vulnerablePercent = defenderStatuses.find((s) => s.kind === 'vulnerable-percent');
  // Brace (TASK-109) — the damage-taken-DOWN self-buff, the exact POSITIVE MIRROR of `vulnerable`.
  // A damage-taken-DOWN buff on the DEFENDER is a NEGATIVE bonus: find a `brace` in the SAME statuses
  // array and SUBTRACT its `damageTakenReduction` from `totalBonus`, at the SAME seam where
  // `vulnerable`'s `damageTakenBonus` folds in (do NOT add a second amplify pass — only fold the term).
  // When no `brace` is present (every existing fight state) the term is 0 → the damage is byte-identical
  // (invariant 5). The Math.max(1, …) floor keeps damage ≥1 even when totalBonus goes negative, so HP
  // stays monotone (A-42). `brace` and `vulnerable` are exact opposites at this seam.
  const brace = defenderStatuses.find((s) => s.kind === 'brace');
  const braceReduction = brace?.kind === 'brace' ? brace.damageTakenReduction : 0;
  // Bulwark (TASK-110) — the PERCENTAGE damage-taken-DOWN self-buff, the fractional MIRROR of `brace`
  // and the DOWN-side percent twin of `vulnerable-percent`. A percent damage-taken-DOWN buff on the
  // DEFENDER is a NEGATIVE ratio bonus: find a `brace-percent` in the SAME statuses array and SUBTRACT
  // its `damageTakenReductionRatio` from `totalBonus`, at the SAME seam where `vulnerable-percent`'s
  // `damageTakenBonusRatio` folds in (do NOT add a second amplify pass — only fold the term). When no
  // `brace-percent` is present (every existing fight state) the term is 0 → the damage is byte-identical
  // (invariant 5). The Math.max(1, …) floor keeps damage ≥1 even when totalBonus goes negative, so HP
  // stays monotone (A-42). `brace-percent` and `vulnerable-percent` are exact opposites at this seam.
  const bracePercent = defenderStatuses.find((s) => s.kind === 'brace-percent');
  const bracePercentReduction =
    bracePercent?.kind === 'brace-percent' ? bracePercent.damageTakenReductionRatio : 0;
  const totalBonus =
    bonus +
    (vulnerablePercent?.kind === 'vulnerable-percent'
      ? vulnerablePercent.damageTakenBonusRatio
      : 0) -
    braceReduction -
    bracePercentReduction;
  return totalBonus !== 0 ? Math.max(1, Math.round(base * (1 + totalBonus))) : base;
}

export function absorbWithShield(
  incoming: number,
  // TASK-131 — GENERALIZED to EITHER shield-family arm (`shield` flat pool OR `shield-percent`
  // maxHp-fraction pool) the FIRST time a second instance of the family arrived: the drain math reads
  // only `absorbRemaining`, which BOTH arms carry identically, so widening the param type is pure
  // addition — the existing flat-`shield` behaviour is byte-unchanged. This is the "generalize a lone
  // special-cased field into a keyed collection the first time a second instance arrives" move (L-16 #7).
  shield: Extract<StatusAilment, { kind: 'shield' | 'shield-percent' }> | undefined,
): { absorbed: number; overflow: number; shieldBroke: boolean } {
  if (shield === undefined || shield.absorbRemaining <= 0) {
    return { absorbed: 0, overflow: incoming, shieldBroke: false };
  }
  const absorbed = Math.min(incoming, shield.absorbRemaining);
  const overflow = incoming - absorbed;
  const shieldBroke = shield.absorbRemaining - absorbed <= 0;
  return { absorbed, overflow, shieldBroke };
}

/**
 * The floor a WEAKEN debuff can reduce a defender's effective DEF to (TASK-54).
 * `max(MIN_EFFECTIVE_DEF, def − defReduction)` keeps the mitigation term
 * non-negative so a large `defReduction` can never invert `floor(def/2)` into a
 * negative number that would ADD to (i.e. heal) the hit — the damage math stays
 * monotonic and the ≥1-per-hit progress guarantee is preserved.
 */
export const MIN_EFFECTIVE_DEF = 0;

/**
 * The floor an ENFEEBLE debuff (TASK-63) can reduce an attacker's effective ATK to.
 * `max(MIN_EFFECTIVE_ATK, atk + attackerAtkBonus)` — where `attackerAtkBonus` is the
 * NET `empower.atkBonus − enfeeble.atkReduction` — keeps the ATK term non-negative so
 * a large `atkReduction` can never invert `effectiveAtk` into a negative number that
 * (multiplied by the ×0.75/×0.8 disadvantage multipliers) would flip the scaled
 * damage sign and HEAL the defender. The exact MIRROR of {@link MIN_EFFECTIVE_DEF} on
 * the DEF term; the final `max(1, …)` ≥1-per-hit floor is unchanged, so an
 * over-enfeebled attacker still lands the minimum 1 damage (HP stays monotone).
 */
export const MIN_EFFECTIVE_ATK = 0;

/**
 * The floor the SPD stat-mod axis (TASK-112) can reduce a combatant's effective SPD to, read by
 * {@link effectiveSpd}. `max(MIN_EFFECTIVE_SPD, spd + Σ spdBonus)` — the exact MIRROR of
 * {@link MIN_EFFECTIVE_DEF} / {@link MIN_EFFECTIVE_ATK} on the SPD term. A flat `hasten` SPD-UP only
 * RAISES effective SPD (the clamp is a no-op today), but the floor is kept symmetric with the other two
 * effective-stat helpers so the eventual SPD-DOWN `hobble` debuff twin can never invert effective SPD
 * negative.
 */
export const MIN_EFFECTIVE_SPD = 0;

/**
 * A combatant's effective SPD under the SPD stat-mod axis (TASK-112/TASK-113) — its raw {@link Combatant.spd}
 * RAISED by the sum of every active `hasten` self-buff's flat `spdBonus` PLUS every active `hasten-percent`
 * self-buff's `Math.floor(spd × spdBonusRatio)` (TASK-113 — the SAME floor(stat × ratio) read-seam idiom
 * `netDefReduction` uses for `fortify-percent`), clamped ≥ {@link MIN_EFFECTIVE_SPD}.
 * The SPD-axis MIRROR of {@link resolveAttack}'s inline `effectiveDef`/`effectiveAtk` reads. A pure,
 * RNG-free, HP-neutral read helper.
 *
 * SCOPE (A-99 now CONSUMED, TASK-116): this helper OPENED the SPD stat-mod axis the way `fortify` opened
 * DEF-up and `empower` opened ATK-up — a lingering stat-mod read through a dedicated effective-stat helper.
 * As of TASK-116 (R-17c wave 65) it is WIRED into the turn-order read: {@link simulateBattle} recomputes the
 * round's action order at the TOP of each round from `effectiveSpd(player, …)` vs `effectiveSpd(enemy, …)`
 * via {@link resolveTurnOrder} (player-first on ties). Because every SPD skill is above-pool (Posture-B,
 * never cast in-sim), the shipped fights carry no SPD statuses and this per-round order equals the old raw-spd
 * order EXACTLY (byte-identical fights). The recompute is at ROUND TOP ONLY — a per-action / mid-round re-sort
 * (the TASK-60/L-22 hazard) remains a deliberately-deferred separate wave.
 */
export function effectiveSpd(combatant: Combatant, statuses: readonly StatusAilment[]): number {
  const spdBonus = statuses.reduce((sum, s) => {
    // Flat `hasten` (Quicken, TASK-112) contributes its raw `spdBonus`; percentage `hasten-percent`
    // (Rush, TASK-113) contributes floor(spd × spdBonusRatio) — the SAME floor(stat × ratio) read-seam
    // idiom `netDefReduction` uses for `fortify-percent` and the ATK seam uses for `empower-percent`.
    // The two fold ADDITIVELY (a combatant carrying both gets spd + spdBonus + floor(spd × ratio)).
    if (s.kind === 'hasten') return sum + s.spdBonus;
    if (s.kind === 'hasten-percent') return sum + Math.floor(combatant.spd * s.spdBonusRatio);
    // Flat `hobble` (Hobble, TASK-114) — the FIRST *subtractive* branch and the FIRST SPD-DOWN member:
    // it SUBTRACTS its raw `spdReduction`, the exact SPD-axis mirror of how `effectiveDef` subtracts
    // weaken's `defReduction` and `effectiveAtk` subtracts enfeeble's `atkReduction`. It folds into the
    // SAME sum ADDITIVELY alongside the SPD-UP arms (a combatant carrying both `hasten` and `hobble`
    // nets spd + spdBonus - spdReduction), and the Math.max clamp below floors the result at
    // MIN_EFFECTIVE_SPD (pre-built TASK-112 for exactly this DOWN branch) so a large `hobble` can never
    // drive effectiveSpd negative.
    if (s.kind === 'hobble') return sum - s.spdReduction;
    // Percentage `hobble-percent` (Cripple, TASK-115) — the SECOND *subtractive* branch and the
    // PERCENTAGE SPD-DOWN member completing the SPD-axis DOWN percent square: it SUBTRACTS
    // floor(spd × spdReductionRatio) — the SAME floor(stat × ratio) read-seam idiom `hasten-percent`
    // uses (+floor(spd × spdBonusRatio)) and `netDefReduction` uses for `fortify-percent`, with the
    // opposite sign to the SPD-UP percent arm. It is the percentage twin of the flat `hobble` exactly
    // as `weaken-percent`/`enfeeble-percent` are the percentage twins of the flat `weaken`/`enfeeble`.
    // It folds ADDITIVELY into the SAME sum (a combatant carrying both `hobble` flat and
    // `hobble-percent` nets spd - spdReduction - floor(spd × ratio)), and the Math.max clamp below
    // floors the result at MIN_EFFECTIVE_SPD (pre-built TASK-112) so a large percent can never drive
    // effectiveSpd negative. Unlike the flat `hobble` (constant delta), this scales with the bearer's
    // OWN raw spd.
    if (s.kind === 'hobble-percent') return sum - Math.floor(combatant.spd * s.spdReductionRatio);
    return sum;
  }, 0);
  return Math.max(MIN_EFFECTIVE_SPD, combatant.spd + spdBonus);
}

/**
 * The pure per-round turn-order rule (TASK-116, R-17c wave 65) — the FIRST true turn-order-re-ordering
 * consumption of the SPD stat-mod axis. Given the two sides' EFFECTIVE SPD for a round (each computed via
 * {@link effectiveSpd}, i.e. raw spd folded with any active `hasten`/`hasten-percent`/`hobble`/`hobble-percent`),
 * returns the round's action order. The player wins ties (`>=`), preserving BYTE-FOR-BYTE the shipped
 * once-before-loop polarity (`player.spd >= enemy.spd`) — so a fight carrying NO SPD statuses (every shipped
 * numemon-WIN / kuwagamon-LOSS fight, since ALL SPD skills are above-pool Posture-B and never cast in-sim)
 * orders by raw spd EXACTLY as before, keeping those fights + their logs byte-identical.
 *
 * This helper is what makes the four shipped SPD stat-mod arms OBSERVABLE at runtime for the first time
 * (A-99 is now CONSUMED, not merely opened): a combatant carrying `hobble`/`hobble-percent` can LOSE the
 * initiative it held by raw spd, and `hasten`/`hasten-percent` can GAIN it. Kept as a small pure fn so the
 * tie/polarity RULE is unit-provable in plain Vitest in ISOLATION (A-36 #3 / L-16), independent of the
 * full fight. It is RNG-free and HP-neutral (a pure read of two numbers).
 *
 * SCOPE (TASK-116): the recompute happens ONLY at the TOP of each round (see {@link simulateBattle}) — NOT
 * per-action, NOT mid-round. A mid-round / per-action re-sort is the A-99/TASK-60/L-22 hazard and a
 * genuinely different, deliberately-deferred wave (a per-action initiative BAR); this slice does not do it.
 */
export function resolveTurnOrder(
  playerEffSpd: number,
  enemyEffSpd: number,
): ('player' | 'enemy')[] {
  return playerEffSpd >= enemyEffSpd ? ['player', 'enemy'] : ['enemy', 'player'];
}

/**
 * The SPD ratio at (or above) which the faster side earns a SECOND action in the round.
 * `effectiveSpd(fast) >= DOUBLE_TURN_SPD_RATIO * effectiveSpd(slow)` ⇒ double-turn.
 */
export const DOUBLE_TURN_SPD_RATIO = 2;

/**
 * TASK-148 (R-22 slice 9): the DISPLAY/accumulation-tuning denominator for the carried
 * ATB gauge (see {@link SideState.atb}). The web `/battle` HUD renders each side's fill as
 * `min(100%, atb ÷ ATB_THRESHOLD)`. Read by NO turn-order rule in this slice —
 * `resolveTurnOrder`/`effectiveSpd` stay byte-unchanged; turn-order authority (crossing a
 * threshold to earn an action) is a deliberately-deferred later wave. Value `100`.
 */
export const ATB_THRESHOLD = 100;

/**
 * TASK-150 (R-22 slice 11): the HARD CAP on how many extra (bonus) actions ONE side may take
 * in a single interactive turn from a banked ATB bar. The interactive seam (`digimon.service.ts`
 * `battleTurn`) drains one {@link ATB_THRESHOLD} per bonus action in a loop, but stops at this
 * many regardless of how much `atb` is banked — a termination-safety bound (A-133): a side that
 * stacked ten turns' worth of ATB cannot take ten actions in one turn. Bonus actions remain
 * WITHIN the round (no new round → `round <= MAX_ROUNDS` unaffected, A-42). Read by NO pure
 * whole-fight rule — the drain-loop lives at the interactive seam ONLY (invariant 5). Value `3`.
 */
export const MAX_ATB_BONUS_ACTIONS = 3;

/**
 * TASK-151 (R-22 slice 12): telegraph-side mirror of the drain-loop bound — projects the enemy's
 * incoming bonus-action count for next turn; display-only, read by no rule.
 *
 * A PURE, RNG-free projection of HOW MANY actions a side will take next turn from its carried
 * post-drain residual `atb` PLUS its next effective SPD (which re-accrues onto the residual at the
 * start of next turn), using the SAME `min(cap, floor(...))` bound the interactive drain-loop
 * itself applies — so the telegraphed intent and the eventual resolution can never drift. It is a
 * best-effort FORECAST, not a contract (A-134): if the enemy is KO'd, its SPD changes, or the
 * fight ends first, next turn may differ — exactly like the single-skill `nextEnemy` telegraph.
 * Read by NO turn-order/damage rule (invariant 5) — a display-only counterpart to the drain-loop.
 */
export function projectedBonusActions(residualAtb: number, effSpdNext: number): number {
  return Math.min(
    MAX_ATB_BONUS_ACTIONS,
    Math.max(0, Math.floor((residualAtb + effSpdNext) / ATB_THRESHOLD)),
  );
}

/**
 * TASK-117 (R-17c wave 66) — the pure per-action initiative RULE: a SPD-gated DOUBLE-TURN.
 *
 * Given the two sides' `effectiveSpd`, returns the N-element ACTION SEQUENCE for a round.
 * It extends {@link resolveTurnOrder} from a 2-element WHO-acts-first order to a 2- or
 * 3-element action sequence: the faster side earns an EXTRA action when its `effectiveSpd`
 * is at least `DOUBLE_TURN_SPD_RATIO ×` the slower side's — the sequence becomes
 * `[fast, slow, fast]` (fast acts, slow acts, then fast acts AGAIN). Below the ratio the
 * sequence is the plain `[fast, slow]`, byte-identical to `resolveTurnOrder`.
 *
 * The base pair is single-sourced through `resolveTurnOrder` (do NOT duplicate the
 * `>=`/player-first-on-ties polarity — A-36 #3 / L-16), then the extra faster-side action
 * is conditionally appended. On an exact tie (ratio 1) there is NO double-turn, player
 * first is preserved. When the slower side's `effectiveSpd` is 0 the ratio is unbounded, so
 * the faster side double-turns iff its own `effectiveSpd > 0`; if BOTH are 0 there is no
 * double-turn (plain order by the `>=` tie rule). RNG-free and HP-neutral (a pure read of
 * two numbers — it returns an actor SEQUENCE, it resolves no damage).
 *
 * SCOPE (TASK-117): this helper is PURE and INTENTIONALLY UNWIRED this wave — the shipped
 * `simulateBattle` round loop does NOT call it and stays BYTE-UNCHANGED, so the shipped
 * numemon-WIN / kuwagamon-LOSS fights + logs + HP-monotonicity + determinism are
 * byte-identical BY CONSTRUCTION (a naive raw-spd trigger WOULD fire in the kuwagamon-20-vs
 * -agumon-8 LOSS fight and perturb the log — hence unwired here). The RULE is proven in
 * ISOLATION (this is the exact TASK-116 pattern); a LATER Posture-B-safe wave wires it into
 * the round loop behind an SPD-STATUS-gated trigger (shipped fights carry no SPD statuses),
 * consuming the N-element sequence instead of the 2-element order.
 */
export function resolveActionSequence(
  playerEffSpd: number,
  enemyEffSpd: number,
): ('player' | 'enemy')[] {
  const order = resolveTurnOrder(playerEffSpd, enemyEffSpd);
  const fast = order[0];
  const slow = order[1];
  const fastEff = fast === 'player' ? playerEffSpd : enemyEffSpd;
  const slowEff = slow === 'player' ? playerEffSpd : enemyEffSpd;
  // Faster side double-turns when it is at least DOUBLE_TURN_SPD_RATIO× the slower side.
  // The `fastEff > 0` guard makes slowEff===0 an unbounded ratio (fast double-turns) while
  // BOTH-zero yields the plain order (fastEff*ratio is never >= 0 unless fastEff > 0).
  if (fastEff > 0 && fastEff >= DOUBLE_TURN_SPD_RATIO * slowEff) {
    return [fast, slow, fast];
  }
  return order;
}

/**
 * The four SPD-modifying status kinds — the SPD-UP self-buffs (`hasten`/`hasten-percent`) and the
 * SPD-DOWN foe-inflicted debuffs (`hobble`/`hobble-percent`). These are the ONLY statuses that can
 * perturb a side's `effectiveSpd` away from its raw `spd`, so their PRESENCE is exactly the gate for
 * whether the per-action DOUBLE-TURN path ({@link resolveActionSequence}) can matter this round.
 * Reuses the in-file membership-set idiom ({@link CLEANSABLE_DEBUFF_KINDS} / DISPELLABLE_BUFF_KINDS).
 */
const SPD_STATUS_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  'hasten',
  'hasten-percent',
  'hobble',
  'hobble-percent',
]);

/**
 * TASK-118 (R-17c wave 67) — the Posture-B-safe GATE for wiring {@link resolveActionSequence} into
 * the live `simulateBattle` round loop. Returns true iff the side currently carries any SPD status
 * (`hasten`/`hasten-percent`/`hobble`/`hobble-percent`). PURE + total; reads no HP, mutates nothing.
 *
 * WHY a status-PRESENCE gate and not a raw-spd gate: all four SPD skills are priced strictly above
 * `MAX_ENERGY`, so `chooseSkill` can NEVER afford them in-sim → the shipped agumon-vs-numemon (WIN)
 * and agumon-vs-kuwagamon (LOSS) fights accumulate ZERO SPD statuses every round. Keying the
 * double-turn path on SPD-status presence makes the gate STRUCTURALLY false in those fights (not a
 * stat coincidence), so the round order falls back to the plain 2-element `resolveTurnOrder` result
 * and the shipped WIN/LOSS fights + logs + HP-monotonicity + determinism stay byte-identical. A
 * raw-spd trigger, by contrast, WOULD fire in the kuwagamon(20)-vs-agumon(8) LOSS fight (20 ≥ 2×8)
 * and perturb the log — the exact reason TASK-117 shipped the rule UNWIRED.
 */
export function hasSpdStatus(statuses: readonly StatusAilment[]): boolean {
  return statuses.some((s) => SPD_STATUS_KINDS.has(s.kind));
}

/**
 * One recorded action in the turn-by-turn battle log (TASK-33 renders this).
 *
 * TASK-51 (R-17c) GREW this ADDITIVELY (invariant 5) with two OPTIONAL fields —
 * `skill` and `statusEvents` — so the first combat-engine slice (energy-gated
 * composite skills + the Burn status) is OBSERVABLE in the shipped log WITHOUT
 * breaking any existing consumer (they ignore the new keys). The four original
 * fields are byte-unchanged.
 */
export interface TurnLogEntry {
  /** 1-based round number; both combatants may act within the same round. */
  round: number;
  /** Which side struck this entry. */
  actor: 'player' | 'enemy';
  /** Damage dealt to the OTHER side on this action (always ≥ 1). */
  damage: number;
  /** The struck side's running HP AFTER this hit (clamped ≥ 0). */
  defenderHpAfter: number;
  /**
   * The NAME of the skill used on this action (TASK-51, R-17c) — e.g. `"Attack"`
   * or `"Fire Breath"`. OPTIONAL/additive: absent on a pure Burn-tick entry (which
   * is not a skill use) and on any older consumer's synthesised entry.
   */
  skill?: string;
  /**
   * Human-readable status notes attached to this turn (TASK-51, R-17c) — e.g.
   * `"Numemon is Burned"` when a skill applies Burn, or `"Burn deals 4 to Numemon"`
   * for a per-turn DoT tick. OPTIONAL/additive; absent when nothing statusful
   * happened. Deterministic + covered so the shipped log can RENDER the Burn
   * appearing and ticking over successive turns.
   */
  statusEvents?: string[];
  /**
   * Whether THIS strike landed a CRITICAL hit (TASK-159, R-22 slice 20). OPTIONAL/
   * additive: absent on a non-crit strike, on a status/tick entry, and on any older
   * consumer's synthesised entry. Set `true` only when the crit multiplier was applied
   * to the strike's damage. Existing consumers ignore the new key (back-compat by
   * construction). The rule stays SERVER-side (A-36 #3 / L-16); the client only READS
   * the flag to render a "Critical hit!" cue.
   */
  crit?: boolean;
  /**
   * Whether THIS strike was EVADED / MISSED (TASK-160, R-22 slice 21) — crit's
   * mirror-image. OPTIONAL/additive: absent on a strike that landed, on a status/tick
   * entry, and on any older consumer's synthesised entry. Set `true` only when the
   * evade roll forced the strike's damage to 0 (defender HP untouched). Existing
   * consumers ignore the new key (back-compat by construction). The rule stays
   * SERVER-side (A-36 #3 / L-16); the client only READS the flag to render a "Missed!"
   * cue.
   */
  evaded?: boolean;
  /**
   * Whether an OFFENSIVE status this turn was RESISTED by the defender (failed to
   * land) (TASK-161, R-22 slice 22). OPTIONAL/additive: absent when the status
   * landed, on a non-status entry, and on any older consumer's synthesised entry.
   * Set `true` only when the resist roll skipped `applyAilment` (the defender's
   * statuses are UNCHANGED). Existing consumers ignore the new key (back-compat by
   * construction). The rule stays SERVER-side (A-36 #3 / L-16); the client only
   * READS the flag to render a "Resisted!" cue.
   */
  resisted?: boolean;
}

/** The full result of a resolved battle, from the PLAYER's perspective. */
export interface BattleResult {
  outcome: 'win' | 'loss';
  turns: TurnLogEntry[];
  /** The player's running HP when the fight ended (clamped ≥ 0). */
  playerHpRemaining: number;
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * TASK-51 (R-17c) — the FIRST decoupled combat-engine slice: an in-combat energy
 * pool, an energy-gated composite skill (Fire Breath), the first status ailment
 * (Burn, a DoT), and a deterministic energy-gated skill-selection "AI".
 *
 * ALL of this is PURE + RNG-free + FIGHT-LOCAL (A-36 / L-15): nothing here is a
 * persisted `Digimon` column (NO migration) — energy is engine-internal state
 * seeded per fight from {@link MAX_ENERGY}, and the Burn status lives only inside
 * one {@link simulateBattle} call. The {@link Combatant} interface stays
 * byte-unchanged; the three call sites (`DigimonService.battle`,
 * `ExploreService.exploreTile`, the `WorldService` handoff) keep compiling because
 * `simulateBattle(Combatant, Enemy) → BattleResult` is signature-unchanged.
 *
 * WHY model skills as data (`{id,name,energyCost,effects}`) with an ORDERED list of
 * composite {@link SkillEffect}s: it makes the engine extensible by later R-17c
 * waves (more skills, more effect kinds, more ailments) purely additively — a new
 * skill is a new catalog row, a new effect kind is a new switch arm — without
 * touching the turn loop. This slice ships exactly TWO effect kinds (Damage, Burn)
 * and TWO skills (attack, fire-breath).
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The max in-combat energy/MP a combatant holds. Each side STARTS a fight at this
 * value (a fight-local number, NOT a persisted stat — NO migration). TASK-58 retuned
 * MAX_ENERGY 23→43 (ENERGY_REGEN_PER_TURN kept at 4; every EXISTING skill cost is
 * byte-unchanged) so the opening drain-and-climb cascade from a full pool now walks
 * through a value for EACH of the SEVEN costed skills — Double Strike (24), Guard (14),
 * Shock Strike (9), Focus (7), Armor Break (5), Poison Sting (2), then Fire Breath (6)
 * on the climb — making all SEVEN costed skills (and the multi-hit + all six statuses)
 * OBSERVABLE in a single resolved fight. Double Strike (cost 24 ≤ 43) is affordable on
 * turn 1.
 */
export const MAX_ENERGY = 41;

/* TASK-57: the SIXTH costed skill (Shock Strike, cost 9) joined the ladder. Guard was
 * raised 9→14 and MAX_ENERGY 13→23 (ENERGY_REGEN_PER_TURN kept at 4) so the greedy
 * selectSkill sawtooth steps through ALL SIX costed skills — Guard (14) → Shock Strike
 * (9) → Focus (7) → Fire Breath (6) → Armor Break (5) → Poison Sting (2) → the free
 * Attack — in one deterministic fight (present ≠ observable, L-16). Widening the pool
 * to 23 is what lets the extra sixth tier land; the damage-relevant costs are
 * byte-unchanged, so only the energy GATING moved — the shipped win-vs-numemon /
 * loss-vs-kuwagamon outcomes hold. */

/* TASK-56: the FIFTH costed skill (Focus, cost 7) joined the ladder. The energy
 * economy was re-tuned so the greedy selectSkill cascade steps through ALL FIVE
 * costed skills — Guard (9) → Focus (7) → Fire Breath (6) → Armor Break (5) →
 * Poison Sting (2) → the free Attack — over one deterministic fight. With
 * ENERGY_REGEN_PER_TURN 4 the drain-and-climb sawtooth visits each cost tier as the
 * top affordable pick (9,7,5,2,6,2,6,… descending from a full pool), making every
 * skill and hence every status OBSERVABLE in a single resolved fight (present ≠
 * observable, L-16). The gap-of-1 tiers (9→7→6→5) required a wider regen than the
 * prior 2 to actually land on the intermediate tiers. */

/**
 * Energy recovered at the START of a combatant's own turn (clamped to
 * {@link MAX_ENERGY}). Set BELOW every costed skill so energy net-drains while
 * spamming — the fighter falls back through the cheaper costed skills to the free
 * Attack, then regen climbs it back up to afford the pricier skills again, so the
 * drain-and-climb cycle visits each cost tier. TASK-55 retuned it 4→2 (with
 * MAX_ENERGY 13 and Guard 8) so the greedy {@link selectSkill} cascade steps through
 * ALL FOUR costed skills over one fight rather than settling on a single tier.
 */
export const ENERGY_REGEN_PER_TURN = 4;

/**
 * Fire Breath's energy cost. `≤ MAX_ENERGY` and affordable at fight start (invariant
 * of the slice). Above the per-turn regen so it can't be cast indefinitely.
 */
export const FIRE_BREATH_ENERGY_COST = 6;

/**
 * Poison Sting's energy cost (TASK-53). DISTINCT from Fire Breath (4 vs 6) so the
 * energy economy still gates meaningfully — cheaper, so once energy net-drains below
 * Fire Breath's 6 the fighter can still afford Poison Sting (and only falls back to
 * the free Attack when below 4). Selection priority (see {@link COMBATANT_SKILLS})
 * is Fire Breath → Poison Sting → Attack, so BOTH costed skills are observably cast
 * as energy ebbs, and BOTH ailments appear in the log.
 */
export const POISON_STING_ENERGY_COST = 2;

/** How many of the afflicted combatant's OWN turns a Burn lasts before expiring. */
export const BURN_DURATION = 3;

/** The fixed HP a Burn removes at the start of each afflicted turn (floored at 0). */
export const BURN_DAMAGE_PER_TURN = 4;

/**
 * The FRACTIONAL per-turn DoT magnitude for `burn-percent` (TASK-120) — the percent-of-CURRENT-HP
 * twin of the flat {@link BURN_DAMAGE_PER_TURN}. Each afflicted turn the bearer loses
 * `floor(hp × BURN_PERCENT_DAMAGE_RATIO)` of its CURRENT HP (NOT max HP — no `maxHp` field is read),
 * routed through the SAME monotone `Math.max(0, hp − tick)` DoT seam Burn/Poison/Bleed/Corrode use.
 * It is the FIRST fractional-magnitude DoT: the DoT family was the ONE magnitude-carrying family with
 * no `-percent` fidelity twin (the stat-mod grid, vulnerable/brace, retaliate and `doom` all gained
 * theirs). A ratio in (0,1); modest so the recurring tick is meaningful yet non-lethal-to-verdict —
 * the shipped win-vs-numemon / loss-vs-kuwagamon regression outcomes hold (this skill is Posture-B-
 * priced above the pool, so the shipped fights never cast it and stay byte-identical anyway). A tick
 * only ever SUBTRACTS HP (floored at 0), so HP stays monotonically non-increasing (A-42).
 */
export const BURN_PERCENT_DAMAGE_RATIO = 0.2;

/**
 * The FRACTIONAL-of-MAXHP per-turn DoT magnitude for `wither-percent` (TASK-132) — the FIRST DoT
 * sized off the bearer's OWN `maxHp` rather than its CURRENT `hp`. Every existing percent DoT
 * (`burn-percent`/Smolder 0.20, `poison-percent`/Toxin 0.12, `bleed-percent`/Hemorrhage 0.15,
 * `corrode-percent`/Necrosis) ticks `floor(hp × ratio)` of CURRENT HP, so it DIMINISHES as HP falls
 * (an asymptotic, self-slowing burn). Wither instead ticks a CONSTANT `floor(maxHp × ratio)` every
 * turn — a relentless, non-slowing attrition (the classic SMT "wither/decay" feel). The amount is
 * MATERIALIZED ONCE at apply time (`applyAilment` bakes `floor(bearerMaxHp × ratio)` into the arm's
 * `damagePerTurn`) — this is safe because `maxHp` is immutable during a fight, so materialize-at-apply
 * and recompute-each-tick are provably identical; the materialized form keeps the tick a byte-simple
 * subtract that mirrors the flat `burn` tick. A modest ratio (A-116) so the recurring tick is
 * meaningful yet the regression-tuned win/loss outcomes + MAX_ROUNDS(50) termination hold — and the
 * skill is Posture-B-priced above the pool anyway, so the shipped fights never cast it and stay
 * byte-identical. A tick only ever SUBTRACTS HP (floored at 0), so HP stays monotone (A-42).
 */
export const WITHER_PERCENT_DAMAGE_RATIO = 0.08;

/**
 * Wither's duration in turns (TASK-132) — kept SMALL (a DoT LENGTHENS the fight: it adds per-turn
 * damage across several rounds, the deterministic analogue of the A-42 termination hazard), so the
 * mechanic reads distinct in the log without threatening MAX_ROUNDS(50) clearance. Above-pool
 * (Posture-B), so no shipped fight actually ticks it — but the bound is chosen conservatively anyway.
 */
export const WITHER_DURATION = 3;

/**
 * Smolder Strike's energy cost (TASK-120) — the FRACTIONAL twin of Fire Breath (which inflicts the
 * flat `burn`). Priced 83 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED (L-16 #7 / L-17):
 * `selectSkill`/`chooseSkill` NEVER afford it inside `simulateBattle`, so the shipped agumon fights
 * stay BYTE-IDENTICAL (assert (d)) — zero ladder re-tune, the safest regression posture. A castable
 * DoT-only inflictor carries NO `damage` arm (so `skillDealsDamage` is false), which means
 * `chooseSkill` rule-1 would rotate it onto the foe as a DoT tactical and PERTURB the shipped fight
 * (exactly the Posture-B fallback the task prescribes for a below-pool inflictor that cannot preserve
 * byte-identity); we prove the fractional tick via the DIRECT-SEAM unit (assert (b)) instead of a
 * live-fight cast. DISTINCT from every other above-pool cost (doom-percent@82 is the prior ladder TOP).
 */
export const SMOLDER_STRIKE_ENERGY_COST = 83;

/**
 * The FRACTIONAL per-turn DoT magnitude for `poison-percent` (TASK-121) — the percent-of-CURRENT-HP
 * twin of the flat {@link POISON_DAMAGE_PER_TURN}, the DoT family's SECOND `-percent` fidelity twin
 * (after `burn-percent`). Each afflicted turn the bearer loses `floor(hp × POISON_PERCENT_DAMAGE_RATIO)`
 * of its CURRENT HP (NOT max HP — no `maxHp` field is read), routed through the SAME monotone
 * `Math.max(0, hp − tick)` DoT seam Burn/Poison/Bleed/Corrode/Burn-Percent use. DISTINCT from
 * {@link BURN_PERCENT_DAMAGE_RATIO} (0.2) — a LOWER 0.12 so the two percent DoTs are distinguishable
 * (poison the weaker/slower fractional bite, mirroring the flat poison-under-burn tuning; A-106, a
 * two-way-door data choice). A tick only ever SUBTRACTS HP (floored at 0), so HP stays monotonically
 * non-increasing (A-42). The skill is Posture-B-priced above the pool, so the shipped fights never
 * cast it and stay byte-identical anyway.
 */
export const POISON_PERCENT_DAMAGE_RATIO = 0.12;

/**
 * Toxin Sting's energy cost (TASK-121) — the FRACTIONAL twin of Poison Sting (which inflicts the flat
 * `poison`). Priced 84 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED (L-16 #7 / L-17), mirroring
 * `smolder-strike`@83 exactly: a DoT-only inflictor carries NO `damage` arm (`skillDealsDamage` false),
 * so a below-pool price would let `chooseSkill` rule-1 rotate it onto the foe as a DoT tactical and
 * PERTURB the byte-identical shipped agumon fights (assert (d)). Above the pool, `selectSkill`/
 * `chooseSkill` NEVER afford it in-sim, so the shipped fights stay BYTE-IDENTICAL — zero ladder re-tune.
 * We prove the fractional tick via the DIRECT-SEAM unit (assert (b)) instead of a live cast. DISTINCT
 * from every other above-pool cost — the NEW ladder TOP, immediately above `smolder-strike`@83.
 */
export const TOXIN_STING_ENERGY_COST = 84;

/**
 * TASK-53 (R-17c, next combat wave) — the SECOND status ailment: Poison, a
 * damage-over-time echoing Burn. Deliberately a LONGER but WEAKER tick than Burn
 * (5 turns × 3/turn = 15 total vs Burn's 3 × 4 = 12) so the two ailments feel
 * distinct in the log AND so — chosen with care — the shipped win-vs-numemon /
 * loss-vs-kuwagamon outcomes still hold (a slightly-lower per-turn tick than Burn,
 * per the task, keeps the winnable fight winnable and the losing one losing).
 */
export const POISON_DURATION = 5;

/** The fixed HP a Poison removes at the start of each afflicted turn (floored at 0). */
export const POISON_DAMAGE_PER_TURN = 3;

/**
 * TASK-62 (R-17c, 11th combat wave) — the THIRD DoT ailment: Bleed, a
 * damage-over-time on the proven Burn/Poison substrate. Deliberately the LONGEST but
 * WEAKEST tick of the three (4 turns × 2/turn = 8 total, vs Burn's 3 × 4 = 12 and
 * Poison's 5 × 3 = 15) so it reads as a slow, low-tick bleed VISIBLY distinct from the
 * other two DoTs in the log. Its per-turn tick, applied identically to Burn/Poison,
 * only ever SUBTRACTS HP (HP stays monotonically non-increasing — Rule 2), so a DoT
 * that ADDS damage only SHORTENS the fight; it cannot flip the MAX_ROUNDS termination
 * the way a heal would. Tuned (low 2/turn) so the shipped win-vs-numemon /
 * loss-vs-kuwagamon outcomes STILL hold with `bleed-strike` firing mid-fight.
 */
export const BLEED_DURATION = 4;

/** The fixed HP a Bleed removes at the start of each afflicted turn (floored at 0). */
export const BLEED_DAMAGE_PER_TURN = 2;

/**
 * The FRACTIONAL per-turn DoT magnitude for `bleed-percent` (TASK-122) — the percent-of-CURRENT-HP
 * twin of the flat {@link BLEED_DAMAGE_PER_TURN}, the DoT family's THIRD `-percent` fidelity twin
 * (after `burn-percent`/`poison-percent`). Each afflicted turn the bearer loses
 * `floor(hp × BLEED_PERCENT_DAMAGE_RATIO)` of its CURRENT HP (NOT max HP — no `maxHp` field is read),
 * routed through the SAME monotone `Math.max(0, hp − tick)` DoT seam Burn/Poison/Bleed/Corrode/
 * Burn-Percent/Poison-Percent use. DISTINCT from {@link BURN_PERCENT_DAMAGE_RATIO} (0.2) and
 * {@link POISON_PERCENT_DAMAGE_RATIO} (0.12) — an intermediate 0.15 so the three percent DoTs are
 * distinguishable (A-107, a two-way-door data choice; `bleed` sits between burn's heavier and
 * poison's lighter fractional bite). A tick only ever SUBTRACTS HP (floored at 0), so HP stays
 * monotonically non-increasing (A-42). The skill is Posture-B-priced above the pool, so the shipped
 * fights never cast it and stay byte-identical anyway.
 */
export const BLEED_PERCENT_DAMAGE_RATIO = 0.15;

/**
 * The INITIAL fractional per-turn DoT ratio for `corrode-percent` (TASK-123) — the percent-of-CURRENT-HP
 * twin of the flat RAMPING {@link CORRODE_INITIAL_DAMAGE}, the DoT family's FOURTH & FINAL `-percent`
 * fidelity twin (after `burn-percent`/`poison-percent`/`bleed-percent`). Unlike the three FIXED-ratio
 * percent DoTs, `corrode-percent`'s ratio ITSELF GROWS by {@link CORRODE_PERCENT_RAMP_RATIO} each tick —
 * the genuinely-new fractional-RAMP COMBINATION (percent-of-current like `bleed-percent`, ramping like
 * `corrode`). Each afflicted turn the bearer loses `floor(hp × damagePerTurnRatio)` of its CURRENT HP
 * (NOT max HP — no `maxHp` field is read), THEN the ratio advances for the next tick, routed through the
 * SAME monotone `Math.max(0, hp − tick)` DoT seam every DoT uses. Deliberately LOW initial ratio (0.05,
 * DISTINCT from burn 0.2 / poison 0.12 / bleed 0.15) so the "starts weak, grows scary" ramp signature
 * mirrors `corrode`'s flat 2→4→6→8 growth (A-108, a two-way-door data choice). A tick only ever SUBTRACTS
 * HP (floored at 0), so HP stays monotonically non-increasing (A-42). The skill is Posture-B-priced above
 * the pool, so the shipped fights never cast it and stay byte-identical anyway.
 */
export const CORRODE_PERCENT_INITIAL_RATIO = 0.05;

/**
 * How much a `corrode-percent`'s per-turn RATIO GROWS at each successive tick (TASK-123) — the ratio-growth
 * mirror of the flat {@link CORRODE_RAMP} (which grows `corrode`'s flat `damagePerTurn`). The ratio climbs
 * `CORRODE_PERCENT_INITIAL_RATIO`, `+ CORRODE_PERCENT_RAMP_RATIO`, `+ 2·…`, … over its {@link CORRODE_DURATION}
 * ticks (0.05 → 0.10 → 0.15 → 0.20). Kept modest (0.05) so the growing fractional bite is VISIBLE tick-over-tick
 * while the shipped outcomes hold (the skill is Posture-B-priced above the pool, so the shipped fights are
 * byte-identical regardless).
 */
export const CORRODE_PERCENT_RAMP_RATIO = 0.05;

/**
 * Hemorrhage's energy cost (TASK-122) — the FRACTIONAL twin of Bleed Strike (which inflicts the flat
 * `bleed`). Priced 85 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED (L-16 #7 / L-17), mirroring
 * `toxin-sting`@84 exactly: a DoT-only inflictor carries NO `damage` arm (`skillDealsDamage` false),
 * so a below-pool price would let `chooseSkill` rule-1 rotate it onto the foe as a DoT tactical and
 * PERTURB the byte-identical shipped agumon fights (assert (d)). Above the pool, `selectSkill`/
 * `chooseSkill` NEVER afford it in-sim, so the shipped fights stay BYTE-IDENTICAL — zero ladder re-tune.
 * We prove the fractional tick via the DIRECT-SEAM unit (assert (b)) instead of a live cast. DISTINCT
 * from every other above-pool cost — the NEW ladder TOP, immediately above `toxin-sting`@84.
 */
export const HEMORRHAGE_ENERGY_COST = 85;

/**
 * Necrosis's energy cost (TASK-123) — the FRACTIONAL-RAMP twin of Corrode Strike (which inflicts the flat
 * ramping `corrode`). Priced 86 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED (L-16 #7 / L-17), the NEW
 * ladder TOP immediately above `hemorrhage`@85: a DoT-only inflictor carries NO `damage` arm
 * (`skillDealsDamage` false), so a below-pool price would let `chooseSkill` rule-1 rotate it onto the foe as
 * a DoT tactical and PERTURB the byte-identical shipped agumon fights (assert (d)). Above the pool,
 * `selectSkill`/`chooseSkill` NEVER afford it in-sim, so the shipped fights stay BYTE-IDENTICAL — zero ladder
 * re-tune. We prove the fractional RAMPING tick via the DIRECT-SEAM unit (assert (b)) instead of a live cast.
 * DISTINCT from every other above-pool cost.
 */
export const NECROSIS_ENERGY_COST = 86;

/**
 * Execute Strike's energy cost (TASK-126) — the FIRST mechanic the new `maxHp` substrate unlocks
 * (a percent-of-MAX-HP finisher). Priced 87 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED
 * (L-16 #7 / Rule 5): `execute-strike` is a DAMAGING composite (`[damage, execute]`), so a
 * below-pool price would let `chooseSkill` rule-1 rotate it onto the foe as a damage tactical and
 * PERTURB the byte-identical shipped agumon fights (assert (d)) — forcing a full ladder + win/loss
 * re-tune. Above the pool, `selectSkill`/`chooseSkill` NEVER afford it in-sim, so the two reference
 * fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL — zero ladder re-tune, the safest
 * regression posture. We prove the finisher WIRED (present ≠ observable) via a direct-seam apply
 * unit at BOTH sides of the threshold (assert (b)) + a `selectSkill(87)` boundary unit (assert (c)),
 * NOT a live cast. The NEW ladder TOP, immediately above `necrosis`@86; DISTINCT from every other
 * above-pool cost so the ladder stays strictly cost-descending.
 */
export const EXECUTE_ENERGY_COST = 87;

/**
 * Execute Strike's bonus damage (TASK-126) — the FLAT extra HP the finisher deals ON TOP of its
 * normal strike WHEN the defender is already at/below the execute threshold (a low-HP foe is
 * "executed" for extra). Added via the SAME monotone `hp = max(0, hp − X)` write path, so HP stays
 * monotonically non-increasing (A-42; execute only ever DEALS more damage, never heals).
 */
export const EXECUTE_BONUS_DAMAGE = 12;

/**
 * Execute Strike's HP threshold RATIO (TASK-126) — the finisher's bonus lands only when the
 * defender's CURRENT `hp <= floor(maxHp × EXECUTE_HP_THRESHOLD_RATIO)`. This is the FIRST
 * percent-of-MAX-HP read in the engine — a pure read of the new fight-local `maxHp` substrate
 * (never mutated by the round loop). 0.25 → a foe below a quarter of its full HP is finished off.
 */
export const EXECUTE_HP_THRESHOLD_RATIO = 0.25;

/**
 * Guillotine's energy cost (TASK-127) — the FIRST max-HP-FRACTION burst: a finisher that SIZES its
 * bonus damage as a FRACTION of the defender's `maxHp` (execute only READS `maxHp` for a fixed-bonus
 * gate; guillotine uses it to SCALE the hit). Priced 88 > {@link MAX_ENERGY} (41) — Posture-B
 * DECOUPLED (L-16 #7 / Rule 5), the NEW ladder TOP immediately above `execute-strike`@87. Like
 * execute, `guillotine-strike` is a DAMAGING composite (`[damage, guillotine]`), so a below-pool
 * price would let `chooseSkill` rule-1 rotate it onto the foe as a damage tactical and PERTURB the
 * byte-identical shipped agumon fights (assert (d)) — forcing a full ladder + win/loss re-tune.
 * Above the pool, `selectSkill`/`chooseSkill` NEVER afford it in-sim, so the two reference fights
 * (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL — zero ladder re-tune, the safest
 * regression posture. We prove the finisher WIRED (present ≠ observable) via direct-seam apply units
 * at BOTH sides of the threshold + a `maxHp`-SCALING contrast unit + a `selectSkill(88)` boundary
 * unit, NOT a live cast. DISTINCT from every other above-pool cost so the ladder stays strictly
 * cost-descending.
 */
export const GUILLOTINE_ENERGY_COST = 88;

/**
 * Guillotine's bonus RATIO (TASK-127) — the finisher's bonus damage is sized as
 * `floor(defenderMaxHp × GUILLOTINE_BONUS_RATIO)`, the FIRST time `maxHp` SIZES a damage NUMBER (vs
 * execute's FIXED +12, which only READS `maxHp` for a gate). 0.20 → 20% of the defender's full HP is
 * added as bonus damage when the foe is at/below the guillotine threshold. Added via the SAME
 * monotone `hp = max(0, hp − X)` write path, so HP stays monotonically non-increasing (A-42;
 * guillotine only ever DEALS more damage, never heals — this wave SIZES damage from the `maxHp`
 * substrate but does NOT open the A-42-gated HP-raising family).
 */
export const GUILLOTINE_BONUS_RATIO = 0.2;

/**
 * Guillotine's HP threshold RATIO (TASK-127) — the finisher's max-HP-scaled bonus lands only when
 * the defender's CURRENT `hp <= floor(maxHp × GUILLOTINE_HP_THRESHOLD_RATIO)` (the same inclusive
 * percent-of-MAX read execute uses). 0.30 → a WIDER kill window than execute's 0.25, so the two
 * finishers read as DISTINCT (guillotine triggers earlier AND, being maxHp-scaled, hits harder on a
 * high-maxHp foe). A pure read of the fight-local `maxHp` substrate; never mutated by the round loop.
 */
export const GUILLOTINE_HP_THRESHOLD_RATIO = 0.3;

/**
 * Rampage's energy cost (TASK-128) — the FIRST MISSING-HP-FRACTION burst: a finisher that SIZES its
 * bonus damage as a FRACTION of the defender's MISSING HP (`maxHp − hp`, the damage already dealt),
 * the FIRST time the engine reads missing HP (execute/guillotine both read the defender's CURRENT hp
 * against a fraction of MAX). Priced 89 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED (L-16 #7 /
 * Rule 5), the NEW ladder TOP immediately above `guillotine-strike`@88. Like guillotine,
 * `rampage-strike` is a DAMAGING composite (`[damage, rampage]`), so a below-pool price would let
 * `chooseSkill` rule-1 rotate it onto the foe as a damage tactical and PERTURB the byte-identical
 * shipped agumon fights (assert (d)) — forcing a full ladder + win/loss re-tune (the TASK-60
 * staller). Above the pool, `selectSkill`/`chooseSkill` NEVER afford it in-sim, so the two reference
 * fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL — zero ladder re-tune, the safest
 * regression posture. We prove the finisher WIRED (present ≠ observable) via direct-seam
 * {@link rampageBonus} apply units (a missing-HP-SCALING contrast + the full-HP → 0 case + the floor
 * truncation) + a `selectSkill(89)` boundary unit, NOT a live cast. DISTINCT from every other
 * above-pool cost so the ladder stays strictly cost-descending.
 */
export const RAMPAGE_ENERGY_COST = 89;

/**
 * Rampage's bonus RATIO (TASK-128) — the finisher's bonus damage is sized as
 * `floor(max(0, defenderMaxHp − defenderHp) × RAMPAGE_BONUS_RATIO)`, the FIRST time MISSING HP
 * (`maxHp − hp`) SIZES a damage number. 0.25 → 25% of the damage already dealt to the foe is added as
 * bonus damage on the strike; it is naturally 0 at full HP and grows as the foe is worn down (an
 * UNCONDITIONAL burst, NO threshold gate — distinct in feel from guillotine's threshold-gated
 * 0.20-of-MAX). Added via the SAME monotone `hp = max(0, hp − X)` write path, so HP stays
 * monotonically non-increasing (A-42; rampage only ever DEALS more damage, never heals — this wave
 * SIZES damage from the `maxHp` substrate but does NOT open the A-42-gated HP-raising family).
 */
export const RAMPAGE_BONUS_RATIO = 0.25;

/**
 * Bravado's energy cost (TASK-129) — the FIRST ATTACKER-OWN-maxHp-FRACTION burst: a finisher that
 * SIZES its bonus damage as a FRACTION of the ATTACKER's OWN `maxHp` (the classic SMT big-bruiser
 * idiom), the FIRST time the engine sizes a bonus off the CASTER's frame (execute/guillotine/rampage
 * all read the DEFENDER). Priced 90 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED (L-16 #7 /
 * Rule 5), the NEW ladder TOP immediately above `rampage-strike`@89. Like guillotine/rampage,
 * `bravado-strike` is a DAMAGING composite (`[damage, bravado]`), so a below-pool price would let
 * `chooseSkill` rule-1 rotate it onto the foe as a damage tactical and PERTURB the byte-identical
 * shipped agumon fights (assert (d)) — forcing a full ladder + win/loss re-tune (the TASK-60
 * staller). Above the pool, `selectSkill`/`chooseSkill` NEVER afford it in-sim, so the two reference
 * fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL — zero ladder re-tune, the safest
 * regression posture. We prove the finisher WIRED (present ≠ observable) via direct-seam
 * {@link bravadoBonus} apply units (an ATTACKER-maxHp-SCALING contrast + a floor-truncation case) +
 * a `selectSkill(90)` boundary unit, NOT a live cast. DISTINCT from every other above-pool cost so
 * the ladder stays strictly cost-descending.
 */
export const BRAVADO_ENERGY_COST = 90;

/**
 * Bravado's bonus RATIO (TASK-129) — the finisher's bonus damage is sized as
 * `floor(attackerMaxHp × BRAVADO_BONUS_RATIO)`, the FIRST time the ATTACKER's OWN `maxHp` SIZES a
 * damage number. 0.15 → 15% of the caster's own max HP is added as bonus damage on the strike;
 * DELIBERATELY below guillotine's 0.20-of-DEFENDER-MAX (A-113) so the caster's-own-bulk feel is a
 * modest self-scaled add, not a one-shot. Added via the SAME monotone `hp = max(0, hp − X)` write
 * path, so HP stays monotonically non-increasing (A-42; bravado only ever DEALS more damage, never
 * heals — this wave SIZES damage from the ATTACKER's `maxHp` substrate but does NOT open the
 * A-42-gated HP-raising family).
 */
export const BRAVADO_BONUS_RATIO = 0.15;

/**
 * Last-Stand's energy cost (TASK-130) — the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst: a finisher
 * that SIZES its bonus damage as a FRACTION of the ATTACKER's OWN missing HP (`attackerMaxHp −
 * attackerHp`, the classic SMT "vengeance-of-the-wounded" idiom — a caster hits harder the more
 * worn-down it is), completing the 2×2 maxHp-frame matrix (the missing-HP sibling of `bravado`; the
 * attacker-frame mirror of `rampage`). Priced 91 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED
 * (L-16 #7 / Rule 5), the NEW ladder TOP immediately above `bravado-strike`@90. Like
 * guillotine/rampage/bravado, `last-stand-strike` is a DAMAGING composite (`[damage, last-stand]`),
 * so a below-pool price would let `chooseSkill` rule-1 rotate it onto the foe as a damage tactical and
 * PERTURB the byte-identical shipped agumon fights (assert (d)) — forcing a full ladder + win/loss
 * re-tune (the TASK-60 staller). Above the pool, `selectSkill`/`chooseSkill` NEVER afford it in-sim,
 * so the two reference fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL — zero ladder
 * re-tune, the safest regression posture. We prove the finisher WIRED (present ≠ observable) via
 * direct-seam {@link lastStandBonus} apply units (an attacker-OWN-missing-HP-SCALING contrast + the
 * full-HP → 0 case + a floor-truncation case) + a `selectSkill(91)` boundary unit, NOT a live cast.
 * DISTINCT from every other above-pool cost so the ladder stays strictly cost-descending.
 */
export const LAST_STAND_ENERGY_COST = 91;

/**
 * TASK-131 (R-17c) — `barrier`/"Barrier"'s energy cost: 92 > {@link MAX_ENERGY} (41) — Posture-B
 * DECOUPLED (L-16 #7 / Rule 5), the NEW ladder TOP immediately above `last-stand-strike`@91. Barrier
 * is a SELF-targeting `shield-percent` BUFF (like guard/Shield) — it would NOT be `chooseSkill`
 * rule-1 rotated (self-buffs route through rule 2), but pricing it ABOVE the pool keeps it out of
 * `selectSkill` entirely, so the two reference fights (WIN vs numemon / LOSS vs kuwagamon) stay
 * BYTE-IDENTICAL — the safest posture, and the same one every recent wave uses. Crucially, a
 * mitigation buff can only LENGTHEN a fight (like a DoT in reverse), so keeping it out of the sim also
 * protects MAX_ROUNDS termination. We prove it WIRED (present ≠ observable) via direct
 * apply/{@link absorbWithShield}-drain units + a `selectSkill(92)` boundary unit, NOT a live cast.
 * DISTINCT from every other above-pool cost so the ladder stays strictly cost-descending (92 > 91).
 */
export const SHIELD_PERCENT_ENERGY_COST = 92;

/**
 * Wither Curse's energy cost (TASK-132) — the `wither-percent` maxHp-fraction DoT inflictor. Priced
 * 93 > {@link MAX_ENERGY} (41) and above the prior ladder TOP `barrier`@92 — the NEW ladder TOP,
 * Posture-B DECOUPLED (L-16 #7 / L-17). A castable DoT-only inflictor carries NO `damage` arm, so
 * `chooseSkill` rule-1 would rotate it onto the foe as a DoT tactical and PERTURB the shipped fights;
 * pricing it above the pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside
 * `simulateBattle`, so the two reference fights (WIN vs numemon / LOSS vs kuwagamon) stay
 * BYTE-IDENTICAL and MAX_ROUNDS termination is protected (a DoT only lengthens the fight). We prove
 * it WIRED (present ≠ observable) via the direct apply/tick units + a `selectSkill(93)` boundary unit,
 * NOT a live cast. DISTINCT from every other above-pool cost so the ladder stays strictly
 * cost-descending (93 > 92 > 91).
 */
export const WITHER_PERCENT_ENERGY_COST = 93;

/**
 * `rot-when-weak`'s DEFENDER-HP GATE ratio (TASK-133) — the FIRST THRESHOLD-GATED status/DoT
 * inflictor. The curse applies its `wither-percent` DoT to the foe ONLY when the foe is already
 * wounded: `foe.hp <= floor(foe.maxHp × ROT_WHEN_WEAK_HP_THRESHOLD_RATIO)` (the SAME percent-of-MAX
 * read `execute`@0.25 / `guillotine`@0.30 use to gate a BURST — reused here to gate an INFLICTOR, the
 * genuinely-new mechanic: a CONDITIONAL APPLICATION predicate, not a scaled `dealt`). Set 0.35 — a
 * MODEST "prey on the wounded" gate DISTINCT from execute (0.25) and guillotine (0.30): a bleeding
 * foe (below 35% HP) rots, a healthier one resists (the log notes it "too healthy to rot"). Above
 * the gate the skill is a pure no-op status attempt — it writes NO HP either way (the applied DoT's
 * subtractive tick is the only HP write, floored at 0), so HP stays monotone (A-42; this GATES when a
 * subtractive DoT applies, it does NOT open the HP-raising family). The applied DoT payload REUSES
 * {@link WITHER_PERCENT_DAMAGE_RATIO}/{@link WITHER_DURATION} (TASK-132) unchanged — the NEW knob is
 * only this apply-gate. Two-way door (A-117).
 */
export const ROT_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35;

/**
 * `rot-when-weak-curse`'s energy cost (TASK-133) — priced 94 > {@link MAX_ENERGY} (41) and above the
 * prior ladder TOP `wither-curse`@93 — the NEW ladder TOP, Posture-B DECOUPLED (L-16 #7 / L-17). A
 * castable DoT-inflictor (even a GATED one) carries NO `damage` arm, so a below-pool price would let
 * `chooseSkill` rule-1 rotate it onto the foe as a DoT tactical and PERTURB the shipped fights;
 * pricing it above the pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside
 * `simulateBattle`, so the two reference fights (WIN vs numemon / LOSS vs kuwagamon) stay
 * BYTE-IDENTICAL and MAX_ROUNDS termination is protected (a DoT only lengthens the fight). We prove
 * it WIRED (present ≠ observable) via direct gate-true / gate-false / boundary apply units + a
 * `selectSkill(94)` boundary unit, NOT a live cast. DISTINCT from every other above-pool cost so the
 * ladder stays strictly cost-descending (94 > 93 > 92).
 */
export const ROT_WHEN_WEAK_ENERGY_COST = 94;

/**
 * `wither-when-weak-hex`'s DEFENDER-HP GATE ratio (TASK-134) — the FIRST THRESHOLD-GATED STAT-MOD
 * inflictor. Where `rot-when-weak` (TASK-133) gated a subtractive DoT (`wither-percent`), this gates
 * a lingering STAT-MODIFIER (`weaken`, a DEF reduction) on the SAME conditional-application axis but a
 * DIFFERENT apply-family: the hex applies the existing `weaken` DEF-down to the foe ONLY when the foe
 * is already wounded (`foe.hp <= floor(foe.maxHp × WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO)`) — the SMT
 * "cripple the wounded" idiom; a healthy foe resists (a "too healthy to weaken" note). Set 0.35 to
 * MATCH `rot-when-weak`'s "prey on the wounded" band (below 35% HP) — the SAME percent-of-MAX read
 * `execute`@0.25 / `guillotine`@0.30 / `rot-when-weak`@0.35 use, reused here to gate a STAT-MOD
 * inflictor rather than a DoT or a burst (the genuinely-new mechanic: a CONDITIONAL APPLICATION
 * predicate on the stat-mod family). The applied stat-mod payload REUSES {@link WEAKEN_DURATION} /
 * {@link WEAKEN_DEF_REDUCTION} unchanged (via the existing `weaken` applyAilment branch) — the NEW
 * knob is only this apply-gate. SAFER than TASK-133's gated DoT: a DEF debuff writes NO HP and can only
 * make the fight FASTER, so HP stays monotone (A-42) with ZERO MAX_ROUNDS hazard. Two-way door (A-118).
 */
export const WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35;

/**
 * `wither-when-weak-hex`'s energy cost (TASK-134) — priced 95 > {@link MAX_ENERGY} (41) and above the
 * prior ladder TOP `rot-when-weak-curse`@94 — the NEW ladder TOP, Posture-B DECOUPLED (L-16 #7 / L-17).
 * A castable stat-mod inflictor carries NO `damage` arm, so a below-pool price would let `chooseSkill`
 * rule-1 rotate it onto the foe as a debuff tactical and PERTURB the shipped fights; pricing it above
 * the pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside `simulateBattle`, so the two
 * reference fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL. (A DEF debuff cannot
 * lengthen the fight, so MAX_ROUNDS is protected trivially either way.) We prove it WIRED (present ≠
 * observable) via direct gate-true / gate-false / boundary apply units + a `selectSkill(95)` boundary
 * unit, NOT a live cast. DISTINCT from every other above-pool cost so the ladder stays strictly
 * cost-descending (95 > 94 > 93).
 */
export const WEAKEN_WHEN_WEAK_ENERGY_COST = 95;

/**
 * `wither-when-strong-hex`'s DEFENDER-HP GATE ratio (TASK-135) — the FIRST `>=` HIGH-hp ("prey on the
 * healthy") gate in the engine. Where every existing threshold gate — `execute`@0.25 / `guillotine`@0.30
 * / `rot-when-weak`@0.35 / `weaken-when-weak`@0.35 — uses the inclusive `<=` LOW-hp ("prey on the
 * wounded") comparison, this FLIPS the operator to `>=`: the hex applies the existing `weaken` DEF-down
 * to the foe ONLY when the foe is still fresh (`foe.hp >= floor(foe.maxHp × WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO)`)
 * — the SMT/Pokémon "soften the full-strength enemy" idiom; a badly-wounded foe is spared (a "too weak to
 * bother weakening" note). The genuinely-NEW variable is the predicate DIRECTION itself, isolated onto a
 * strictly-safe payload (a DEF debuff — TASK-134's `weaken`, REUSED byte-for-byte). Set 0.60 — an
 * "above-half / still-fresh" band DELIBERATELY DISTINCT from the LOW-hp band (0.25/0.30/0.35) so the `>=`
 * direction is UNAMBIGUOUS in tests: a full-HP foe is squarely gate-TRUE, a badly-wounded foe (e.g. 1 HP)
 * squarely gate-FALSE — the mirror image of `weaken-when-weak`'s `<=` boundary. The applied stat-mod
 * payload REUSES {@link WEAKEN_DURATION} / {@link WEAKEN_DEF_REDUCTION} unchanged (via the existing
 * `weaken` applyAilment branch) — the NEW knob is only this flipped apply-gate. SAFE as TASK-134: a DEF
 * debuff writes NO HP and can only make the fight FASTER, so HP stays monotone (A-42) with ZERO
 * MAX_ROUNDS hazard. Two-way door (A-119).
 */
export const WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO = 0.6;

/**
 * `wither-when-strong-hex`'s energy cost (TASK-135) — priced 96 > {@link MAX_ENERGY} (41) and above the
 * prior ladder TOP `wither-when-weak-hex`@95 — the NEW ladder TOP, Posture-B DECOUPLED (L-16 #7 / L-17).
 * A castable stat-mod inflictor carries NO `damage` arm, so a below-pool price would let `chooseSkill`
 * rule-1 rotate it onto the foe as a debuff tactical and PERTURB the shipped fights; pricing it above the
 * pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside `simulateBattle`, so the two
 * reference fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL. (A DEF debuff cannot
 * lengthen the fight, so MAX_ROUNDS is protected trivially either way.) We prove it WIRED (present ≠
 * observable) via direct gate-true / gate-false / boundary apply units + a `selectSkill(96)` boundary
 * unit, NOT a live cast. DISTINCT from every other above-pool cost so the ladder stays strictly
 * cost-descending (96 > 95 > 94 > 93).
 */
export const WEAKEN_WHEN_STRONG_ENERGY_COST = 96;

/**
 * `enfeeble-when-weak-hex`'s DEFENDER-HP GATE ratio (TASK-136) — the SECOND stat-mod FAMILY's FIRST
 * threshold-gated inflictor. Where TASK-134/135 varied the predicate DIRECTION (`<=`/`>=`) under a FIXED
 * apply-family (`weaken`, DEF-down), this wave varies the APPLY-FAMILY itself: it applies the existing
 * `enfeeble` (ATK-down) status to the foe ONLY when the foe is already wounded (`foe.hp <= floor(foe.maxHp
 * × ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO)`) — the SMT "kick the ATK out of an already-wounded foe" idiom;
 * a healthy foe resists (a "too healthy to enfeeble" note). Set 0.35 to MATCH the established `<=` LOW-hp
 * band `rot-when-weak`@0.35 / `weaken-when-weak`@0.35 use, so the `<=` direction is the consistent one and
 * the ONLY genuinely-new variable is the apply-family (`enfeeble`, an ATK reduction, REUSED byte-for-byte
 * via its {@link ENFEEBLE_DURATION} / {@link ENFEEBLE_ATK_REDUCTION} spec + the existing `enfeeble`
 * applyAilment branch). SAFER than a gated DoT (per L-35): an ATK-down debuff writes NO HP and means the
 * foe hits WEAKER, which can only make the fight FASTER or unchanged, never LONGER — HP stays monotone
 * (A-42) with ZERO MAX_ROUNDS hazard. Two-way door (A-118).
 */
export const ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35;

/**
 * `enfeeble-when-weak-hex`'s energy cost (TASK-136) — priced 97 > {@link MAX_ENERGY} (41) and above the
 * prior ladder TOP `wither-when-strong-hex`@96 — the NEW ladder TOP, Posture-B DECOUPLED (L-16 #7 / L-17).
 * A castable stat-mod inflictor carries NO `damage` arm, so a below-pool price would let `chooseSkill`
 * rule-1 rotate it onto the foe as a debuff tactical and PERTURB the shipped fights; pricing it above the
 * pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside `simulateBattle`, so the two
 * reference fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL. (An ATK debuff cannot lengthen
 * the fight, so MAX_ROUNDS is protected trivially either way.) We prove it WIRED (present ≠ observable) via
 * direct gate-true / gate-false / boundary apply units + a `selectSkill(97)` boundary unit, NOT a live
 * cast. DISTINCT from every other above-pool cost so the ladder stays strictly cost-descending
 * (97 > 96 > 95 > 94 > 93).
 */
export const ENFEEBLE_WHEN_WEAK_ENERGY_COST = 97;

/**
 * `enfeeble-when-strong-hex`'s DEFENDER-HP GATE ratio (TASK-137) — CLOSES the `enfeeble` (ATK-down)
 * family's SECOND predicate DIRECTION. Where TASK-136's `enfeeble-when-weak` gates the SAME `enfeeble`
 * ATK-down on a `<=` LOW-hp foe, this FLIPS the operator to `>=`: the hex applies the existing `enfeeble`
 * ATK-reduction to the foe ONLY when the foe is still fresh (`foe.hp >= floor(foe.maxHp ×
 * ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO)`) — the SMT "kick the ATK out of a still-fresh, dangerous foe
 * before it winds up" idiom; a badly-wounded foe is spared (a "too wounded to bother enfeebling" note).
 * The genuinely-NEW variable is the predicate DIRECTION on the `enfeeble` family (mirroring TASK-135's
 * `>=` gate on `weaken`), isolated onto a strictly-safe payload (the ATK debuff `enfeeble`, REUSED
 * byte-for-byte). Set 0.60 to MATCH `weaken-when-strong`@0.60 so the `>=` HIGH-hp band is the consistent
 * one and DELIBERATELY DISTINCT from the `<=` LOW-hp band (0.25/0.30/0.35): a full-HP foe is squarely
 * gate-TRUE, a badly-wounded foe (e.g. 1 HP) squarely gate-FALSE — the mirror image of
 * `enfeeble-when-weak`'s `<=` boundary. The applied stat-mod payload REUSES {@link ENFEEBLE_DURATION} /
 * {@link ENFEEBLE_ATK_REDUCTION} unchanged (via the existing `enfeeble` applyAilment branch) — the NEW
 * knob is only this flipped apply-gate. SAFE as TASK-136: an ATK debuff writes NO HP and can only make the
 * fight FASTER, so HP stays monotone (A-42) with ZERO MAX_ROUNDS hazard. Two-way door (A-120).
 */
export const ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO = 0.6;

/**
 * `enfeeble-when-strong-hex`'s energy cost (TASK-137) — priced 98 > {@link MAX_ENERGY} (41) and above the
 * prior ladder TOP `enfeeble-when-weak-hex`@97 — the NEW ladder TOP, Posture-B DECOUPLED (L-16 #7 / L-17).
 * A castable stat-mod inflictor carries NO `damage` arm, so a below-pool price would let `chooseSkill`
 * rule-1 rotate it onto the foe as a debuff tactical and PERTURB the shipped fights; pricing it above the
 * pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside `simulateBattle`, so the two
 * reference fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL. (An ATK debuff cannot lengthen
 * the fight, so MAX_ROUNDS is protected trivially either way.) We prove it WIRED (present ≠ observable) via
 * direct gate-true / gate-false / boundary apply units + a `selectSkill(98)` boundary unit, NOT a live
 * cast. DISTINCT from every other above-pool cost so the ladder stays strictly cost-descending
 * (98 > 97 > 96 > 95 > 94 > 93).
 */
export const ENFEEBLE_WHEN_STRONG_ENERGY_COST = 98;

/**
 * `vulnerable-when-weak-hex`'s DEFENDER-HP GATE ratio (TASK-138) — the THIRD stat-mod FAMILY's FIRST
 * threshold-gated inflictor. Where TASK-134/135 closed the `weaken` (DEF-down) family and TASK-136/137
 * closed the `enfeeble` (ATK-down) family across BOTH predicate directions, L-37 forbids a third gated
 * variant of either (a duplicate SHAPE) — so this wave CROSSES to the THIRD stat-mod apply-family,
 * `vulnerable` (damage-taken-UP), opening its FIRST cell in the established `<=` LOW-hp direction (mirroring
 * how `weaken`/`enfeeble` each opened with their `<=` gate first). It applies the existing `vulnerable`
 * damage-taken-up status to the foe ONLY when the foe is already wounded (`foe.hp <= floor(foe.maxHp ×
 * VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO)`) — the SMT "expose an already-wounded foe to bigger hits" idiom;
 * a healthy foe resists (a "too healthy to expose" note). Set 0.35 to MATCH the established `<=` LOW-hp band
 * `weaken-when-weak`@0.35 / `enfeeble-when-weak`@0.35 / `rot-when-weak`@0.35 use, so the `<=` direction is
 * the consistent one and the ONLY genuinely-new variable is the apply-family (`vulnerable`, a
 * damage-taken-UP debuff that SCALES incoming damage — a fundamentally different effect KIND than a DEF-down
 * or ATK-down flat-stat reduction — REUSED byte-for-byte via its {@link VULNERABLE_DURATION} /
 * {@link VULNERABLE_DAMAGE_TAKEN_BONUS} spec + the existing `vulnerable` applyAilment branch). SAFER than a
 * gated DoT (per L-35) and even than a gated ATK/DEF debuff: a damage-taken-UP debuff on the FOE means the
 * foe takes MORE per hit, which can only make the fight FASTER or unchanged, never LONGER — HP stays
 * monotone (A-42) with ZERO MAX_ROUNDS hazard. Two-way door (A-121).
 */
export const VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO = 0.35;

/**
 * `vulnerable-when-weak-hex`'s energy cost (TASK-138) — priced 99 > {@link MAX_ENERGY} (41) and above the
 * prior ladder TOP `enfeeble-when-strong-hex`@98 — the NEW ladder TOP, Posture-B DECOUPLED (L-16 #7 / L-17).
 * A castable stat-mod inflictor carries NO `damage` arm, so a below-pool price would let `chooseSkill`
 * rule-1 rotate it onto the foe as a debuff tactical and PERTURB the shipped fights; pricing it above the
 * pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside `simulateBattle`, so the two
 * reference fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL. (A damage-taken-UP debuff
 * cannot lengthen the fight, so MAX_ROUNDS is protected trivially either way.) We prove it WIRED (present ≠
 * observable) via direct gate-true / gate-false / boundary apply units + a `selectSkill(99)` boundary unit,
 * NOT a live cast. DISTINCT from every other above-pool cost so the ladder stays strictly cost-descending
 * (99 > 98 > 97 > 96 > 95 > 94 > 93).
 */
export const VULNERABLE_WHEN_WEAK_ENERGY_COST = 99;

/**
 * `vulnerable-when-strong-hex`'s DEFENDER-HP GATE ratio (TASK-139) — CLOSES the THIRD stat-mod family
 * (`vulnerable`, damage-taken-UP) across BOTH predicate directions. TASK-138 opened the family at its
 * `<=` LOW-hp cell ({@link VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO}=0.35); its `>=` HIGH-hp cell was the
 * one genuine gap left (L-36 — a byte-for-byte OPERATOR FLIP on a family whose other cell is filled,
 * exactly as TASK-135 flipped TASK-134's `<=` to close `weaken` and TASK-137 flipped TASK-136's to close
 * `enfeeble`). It applies the existing `vulnerable` damage-taken-up status to the foe ONLY when the foe is
 * still HEALTHY (`foe.hp >= floor(foe.maxHp × VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO)`) — the SMT "hit a
 * still-fresh foe with a damage-taken-UP hex so the big early hits land harder" idiom, the exact tactical
 * mirror of the `<=` "expose an already-wounded foe" idiom; a wounded foe resists (a "too wounded to bother
 * exposing" note). Set 0.6 to MATCH the established `>=` HIGH-hp band `weaken-when-strong`@0.6 /
 * `enfeeble-when-strong`@0.6 use — a DISTINCT band from the `<=` 0.35 LOW-hp band so the flipped direction
 * is provably a mirror, not a re-skin (A-122). The apply-family (`vulnerable`) + its payload
 * ({@link VULNERABLE_DURATION} / {@link VULNERABLE_DAMAGE_TAKEN_BONUS} + the existing `vulnerable`
 * applyAilment branch) are REUSED byte-for-byte; the ONLY new variable is the predicate DIRECTION. SAFER
 * than a gated DoT (L-35): a damage-taken-UP debuff writes NO HP and can only make the fight FASTER or
 * unchanged, never LONGER — HP stays monotone (A-42) with ZERO MAX_ROUNDS hazard. Two-way door (A-122).
 */
export const VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO = 0.6;

/**
 * `vulnerable-when-strong-hex`'s energy cost (TASK-139) — priced 100 > {@link MAX_ENERGY} (41) and above the
 * prior ladder TOP `vulnerable-when-weak-hex`@99 — the NEW ladder TOP, Posture-B DECOUPLED (L-16 #7 / L-17).
 * A castable stat-mod inflictor carries NO `damage` arm, so a below-pool price would let `chooseSkill`
 * rule-1 rotate it onto the foe as a debuff tactical and PERTURB the shipped fights; pricing it above the
 * pool keeps `selectSkill`/`chooseSkill` from EVER affording it inside `simulateBattle`, so the two
 * reference fights (WIN vs numemon / LOSS vs kuwagamon) stay BYTE-IDENTICAL. (A damage-taken-UP debuff
 * cannot lengthen the fight, so MAX_ROUNDS is protected trivially either way.) We prove it WIRED (present ≠
 * observable) via direct gate-true / gate-false / boundary apply units + a `selectSkill(100)` boundary unit,
 * NOT a live cast. DISTINCT from every other above-pool cost so the ladder stays strictly cost-descending
 * (100 > 99 > 98 > 97 > 96 > 95 > 94 > 93).
 */
export const VULNERABLE_WHEN_STRONG_ENERGY_COST = 100;

/**
 * Last-Stand's bonus RATIO (TASK-130) — the finisher's bonus damage is sized as
 * `floor(max(0, attackerMaxHp − attackerHp) × LAST_STAND_BONUS_RATIO)`, the FIRST time the ATTACKER's
 * OWN MISSING HP SIZES a damage number. 0.30 → 30% of the caster's own missing HP is added as bonus
 * damage on the strike; DELIBERATELY the LARGEST of the four maxHp-frame ratios (guillotine 0.20 /
 * rampage 0.25 / bravado 0.15) — a wounded-caster payoff, distinct from bravado's steady
 * 0.15-of-own-MAX; still bounded because at low attacker HP the caster is close to losing anyway (the
 * bonus is 0 at full HP and only grows as the caster nears death). Added via the SAME monotone
 * `hp = max(0, hp − X)` write path, so HP stays monotonically non-increasing (A-42; last-stand only
 * ever DEALS more damage, never heals — this wave SIZES damage from the ATTACKER's `maxHp` substrate
 * but does NOT open the A-42-gated HP-raising family).
 */
export const LAST_STAND_BONUS_RATIO = 0.3;

/**
 * Bleed Strike's energy cost (TASK-62). DISTINCT from every other costed skill —
 * Double Strike (24) / Lullaby Hex (21) / Guard (14) / Frost Bite (11) / Shock Strike
 * (9) / Focus (7) / Fire Breath (6) / Armor Break (5) / Poison Sting (2) — set at 3,
 * slotting between Armor Break (5) and Poison Sting (2), so the affordability ladder
 * stays strictly cost-descending and ALL nine existing skill costs stay BYTE-UNCHANGED
 * (no MAX_ENERGY / regen re-tune). Because `bleed-strike` is a DAMAGING composite
 * (`[damage, bleed]`, the fire-breath/poison-sting family) it is SAFE mid-ladder — it
 * still deals its damage half on the turn it fires, so it does NOT starve the winnable
 * fight the way a pure-control skill would (the TASK-60/61 hazard). At cost 3 it is
 * readily affordable once energy climbs, so Bleed actually SURFACES in a shipped fight.
 *
 * WHY 3, not the A-51 target of 4 (GUARDRAIL-2 — a one-const nudge): cost 4 collides
 * EXACTLY with {@link ENERGY_REGEN_PER_TURN} (4). Once the sawtooth drains to 4 it
 * would then regen +4 → cast Bleed Strike (−4) → 0 → regen +4 → … a FIXED POINT that
 * locks selection on Bleed Strike forever and STARVES every other low-tier skill
 * (Fire Breath / Poison Sting / Armor Break never resurface). Cost 3 breaks that
 * degenerate equality (drain to 3 → regen to 5+ climbs past it), so the greedy
 * drain-and-climb cascade keeps visiting the other tiers — the nine costs stay
 * byte-unchanged and both shipped outcomes hold. L-16 #6: this trace is re-derived
 * from the FINAL constant (regen 4, cost 3).
 */
export const BLEED_STRIKE_ENERGY_COST = 3;

/**
 * Armor Break's energy cost (TASK-54). DISTINCT from Fire Breath (6) / Poison Sting
 * (4) — set at 5 so the energy economy still gates meaningfully and the three costed
 * skills cascade cleanly by cost as energy ebbs (Fire Breath 6 → Armor Break 5 →
 * Poison Sting 4 → the free Attack). Above the per-turn regen (3) so it can't be cast
 * indefinitely, like the others.
 */
export const ARMOR_BREAK_ENERGY_COST = 5;

/**
 * TASK-54 (R-17c, next combat wave) — the THIRD status kind: Weaken, a persistent
 * STAT-MODIFIER debuff (NOT a DoT). Unlike Burn/Poison it removes NO HP on its tick;
 * instead, while active it LOWERS the afflicted defender's effective DEF by
 * {@link WEAKEN_DEF_REDUCTION} (see {@link resolveAttack}), so a weakened target
 * visibly takes harder hits. Lasts this many of the afflicted side's OWN turns.
 *
 * Tuned (duration 3 × a modest −6 DEF) so the shipped win-vs-numemon /
 * loss-vs-kuwagamon outcomes STILL hold: it only sharpens damage against a defender
 * that carries it, and since Weaken removes no HP directly it cannot flip a fight's
 * termination the way a heal would (A-42 — Weaken over Heal keeps HP monotonically
 * non-increasing).
 */
export const WEAKEN_DURATION = 3;

/**
 * How much a Weaken debuff lowers the afflicted defender's effective DEF (TASK-54),
 * clamped at {@link MIN_EFFECTIVE_DEF} inside {@link resolveAttack}. Modest so the
 * regression-tuned win/loss outcomes hold — a weakened defender takes a few more
 * damage per hit, not an outright one-shot.
 */
export const WEAKEN_DEF_REDUCTION = 6;

/**
 * Guard's energy cost (TASK-55). DISTINCT from Fire Breath (6) / Armor Break (5) /
 * Poison Sting (4) — set at 7 (the most expensive skill, fitting a strong defensive
 * buff) so the energy economy still gates meaningfully and the FOUR costed skills
 * cascade cleanly by cost as energy ebbs (Guard 7 → Fire Breath 6 → Armor Break 5 →
 * Poison Sting 4 → the free Attack). Above the per-turn regen (3) so it can't be cast
 * indefinitely, like the others. Affordable at fight start ({@link MAX_ENERGY} 10 ≥ 7).
 */
export const GUARD_ENERGY_COST = 14;

/**
 * TASK-55 (R-17c, next combat wave) — the FOURTH status kind: Shield, a persistent
 * DAMAGE-ABSORBING BUFFER (a NEW category — not a DoT like Burn/Poison, not a
 * stat-modifier like Weaken). Applied by the DEFENSIVE, SELF-targeting Guard skill to
 * the CASTER's OWN statuses. While active it holds an absorption pool
 * ({@link SHIELD_ABSORB_AMOUNT}) that soaks incoming damage BEFORE HP: each hit drains
 * `min(incoming, absorbRemaining)`, only the overflow reaches HP (see
 * {@link absorbWithShield}). Lasts this many of the shielded side's OWN turns; its
 * tick removes NO HP (it only counts down + logs), so HP stays monotonically
 * non-increasing (A-43 — Shield over Heal keeps termination + the win/loss tuning
 * structurally safe).
 */
export const SHIELD_DURATION = 3;

/**
 * The total HP-worth of damage a fresh Shield absorbs before it breaks (TASK-55).
 * Modest so the regression-tuned win/loss outcomes hold — a shielded defender takes a
 * few fully/partially absorbed hits, not invulnerability. The pool is a re-cast
 * REFRESH (never a stack), matching every other ailment's semantics.
 */
export const SHIELD_ABSORB_AMOUNT = 12;

/**
 * TASK-131 (R-17c) — the FRACTIONAL twin of {@link SHIELD_ABSORB_AMOUNT}: the
 * absorb POOL of a `shield-percent` buff (label "Barrier") is SIZED as a bounded
 * fraction of the BEARER's OWN maxHp — `floor(bearer.maxHp × SHIELD_PERCENT_ABSORB_RATIO)`
 * — instead of the flat 12. This is the FIRST time `maxHp` sizes a MITIGATION pool
 * (the completed maxHp DAMAGE-frame matrix — guillotine/rampage/bravado/last-stand —
 * sized DAMAGE; this sizes what DAMAGE is soaked), and closes the last buff/status
 * family without a `-percent` mirror (`shield` was the only one). MODEST (0.20 — A-115)
 * so the distinguishing property (a bulkier bearer gets a strictly larger pool) is
 * visible in unit tests while the regression-tuned win/loss outcomes hold. It is the
 * only property that differs from the flat `shield` at APPLICATION time — the drain
 * seam ({@link absorbWithShield}) and the tick are byte-identical to `shield`.
 */
export const SHIELD_PERCENT_ABSORB_RATIO = 0.2;

/**
 * How many of the bearer's OWN turns a `shield-percent` (Barrier) buff lasts (TASK-131).
 * Reuses {@link SHIELD_DURATION} — only the SIZING (a maxHp fraction) distinguishes the
 * percent twin from the flat `shield`; its tick (count down, drop-on-expiry, NO HP change)
 * is identical.
 */
export const SHIELD_PERCENT_DURATION = SHIELD_DURATION;

/**
 * Focus's energy cost (TASK-56). DISTINCT from Guard (8) / Fire Breath (6) / Armor
 * Break (5) / Poison Sting (4) — set at 7, slotting between Guard and Fire Breath, so
 * the energy economy still gates meaningfully and the FIVE costed skills cascade
 * cleanly by cost as energy ebbs (Guard 8 → Focus 7 → Fire Breath 6 → Armor Break 5 →
 * Poison Sting 4 → the free Attack). Above the per-turn regen (2) so it can't be cast
 * indefinitely, like the others.
 */
export const FOCUS_ENERGY_COST = 7;

/**
 * TASK-56 (R-17c, next combat wave) — the FIFTH status kind: Empower, a persistent
 * POSITIVE STAT-MODIFIER (an offensive self-BUFF — the exact MIRROR of the Weaken
 * debuff, the natural next member of the Tarukaja/rage family). Applied by the
 * offensive, SELF-targeting Focus skill to the CASTER's OWN statuses (the second
 * self-targeting effect, after Shield — proving that machinery generalizes). Unlike
 * Burn/Poison it removes NO HP on its tick; instead, while active it RAISES the
 * afflicted attacker's effective ATK by {@link EMPOWER_ATK_BONUS} (see
 * {@link resolveAttack}), so an empowered attacker visibly hits harder. Lasts this
 * many of the empowered side's OWN turns.
 *
 * Tuned (duration 3 × a modest +6 ATK) so the shipped win-vs-numemon /
 * loss-vs-kuwagamon outcomes STILL hold: a buff can only RAISE the attacker's damage,
 * and since Empower removes no HP directly (it never heals) it CANNOT flip a fight's
 * MAX_ROUNDS termination the way a heal would (A-44 — Empower over Heal keeps HP
 * monotonically non-increasing). It only sharpens the empowered side's hits.
 */
export const EMPOWER_DURATION = 3;

/**
 * How much an Empower buff raises the empowered attacker's effective ATK (TASK-56),
 * fed into {@link resolveAttack}'s `effectiveAtk = attacker.atk + attackerAtkBonus`.
 * Modest (+6, mirroring Weaken's −6 DEF) so the regression-tuned win/loss outcomes
 * hold — an empowered attacker deals a few more damage per hit, not an outright
 * one-shot.
 */
export const EMPOWER_ATK_BONUS = 6;

/**
 * TASK-69 (R-17c) — the FIRST REACTIVE / ON-BEING-HIT status kind: Retaliate (Thorns),
 * a SELF-buff that, while active, REFLECTS a FIXED amount of HP damage back at whoever
 * deals HP damage to the buffed combatant. It is a genuinely NEW *shape*: every prior
 * effect is either a per-turn TICK (burn/poison/…/doom-detonate) or resolves ON CAST —
 * nothing before it reacted to being STRUCK. Applied by the self-targeting Counter
 * Stance skill to the CASTER's OWN statuses (the THIRD self-buff after Shield/Empower,
 * proving the self-target machinery generalizes). Its own tick removes NO HP (it only
 * counts down + logs — the "a stat-modifier's tick and its PAYOFF live in two different
 * places" rule); the reflect payoff lives at the ONE shared resolveDamageStrike HP-write
 * site (alongside the Sleep wake hook), so EVERY damage path (single / each multi-hit /
 * a composite's damage half) reflects uniformly.
 *
 * HP-MONOTONE by construction (A-42): Retaliate only ever SUBTRACTS the attacker's HP —
 * it never heals. That is exactly why it was chosen over the HP-raising Heal/HoT/Drain
 * family (which threatens MAX_ROUNDS termination + the win/loss regression tuning). Lasts
 * this many of the retaliating side's OWN turns.
 */
export const RETALIATE_DURATION = 3;

/**
 * The FIXED HP the reflect deals back to an attacker who lands a damaging strike on a
 * Retaliating defender (TASK-69). Modest so a shipped fight stays regression-safe (the
 * skill is now priced IN-pool (TASK-75, cost 30 ≤ MAX_ENERGY) and FIRES in the shipped
 * numemon WIN — see {@link COUNTER_STANCE_ENERGY_COST} — so this value NOW touches the
 * shipped log: the reflect deals RETALIATE_REFLECT_DAMAGE back to the enemy on its
 * overflow hit, VISIBLE as a "…retaliates for N" statusEvent).
 */
export const RETALIATE_REFLECT_DAMAGE = 5;

/**
 * Thorn Mirror's (`reflect-percent`) reflect RATIO (TASK-99, R-17c 48th wave) — the FRACTION
 * of the incoming OVERFLOW damage the percentage-reflect deals back at the attacker (floored to
 * an integer). This is the fractional MIRROR of the FIXED {@link RETALIATE_REFLECT_DAMAGE} = 5,
 * exactly as {@link SAP_PERCENT_RATIO}/{@link LEECH_PERCENT_RATIO} mirror the fixed sap/leech —
 * the THIRD fractional-MAGNITUDE constant, EXTENDING the percentage/fidelity axis to the reactive
 * REFLECT mechanic. 0.5 = "reflect HALF the incoming overflow": a genuine magnitude-fidelity
 * contrast with the fixed Retaliate — for an overflow of 20 percent reflects floor(10) = 10 vs
 * the fixed 5. It only ever SUBTRACTS the attacker's HP at the SAME shared monotone
 * resolveDamageStrike reflect seam (exactly like the fixed retaliate), so HP-monotone (A-42) holds.
 * The duration re-uses {@link RETALIATE_DURATION} (a duration re-tune is NOT part of this wave).
 * Naming/ratio assumption logged A-86.
 */
export const RETALIATE_PERCENT_RATIO = 0.5;

/**
 * Thorn Mirror's energy cost (TASK-99) — priced 66, DELIBERATELY ABOVE {@link MAX_ENERGY} (41)
 * and DISTINCT from {@link LEECH_PERCENT_ENERGY_COST} (65) / {@link SAP_PERCENT_ENERGY_COST} (64)
 * and every other above-pool cost, so it slots at the new strictly-cost-descending ladder TOP
 * (above `leech-percent`@65). Posture-B DECOUPLED (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy` and every fight-local
 * pool is capped at MAX_ENERGY, `reflect-percent` is NEVER the pick inside {@link simulateBattle} —
 * so the shipped win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder
 * re-tune, no top-of-ladder staller risk, TASK-60/L-22). The mechanic is proven wired in ISOLATION
 * by a {@link selectSkill}(66) boundary unit + a direct {@link reflectRetaliation} fixed-vs-percent
 * CONTRAST unit + a self-buff grant unit. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL
 * other skill costs stay BYTE-UNCHANGED.
 */
export const RETALIATE_PERCENT_ENERGY_COST = 66;

/**
 * Crumble's (`weaken-percent`) DEF-reduction RATIO (TASK-100, R-17c 49th wave) — the FRACTION
 * of the target's CURRENT def the percentage-Weaken removes as effective-DEF reduction (floored
 * to an integer, added into the existing `defReduction` local at the {@link resolveDamageStrike}
 * weaken-read seam). This is the fractional MIRROR of the FIXED {@link WEAKEN_DEF_REDUCTION} = 6,
 * exactly as {@link RETALIATE_PERCENT_RATIO}/{@link SAP_PERCENT_RATIO}/{@link LEECH_PERCENT_RATIO}
 * mirror the fixed retaliate/sap/leech — the FOURTH fractional-MAGNITUDE constant, EXTENDING the
 * percentage/fidelity axis onto the STAT-MODIFIER family. 0.5 = "cut HALF the target's CURRENT
 * def": a genuine magnitude-fidelity contrast with the fixed −6 — for a def-30 target Crumble
 * removes floor(15) = 15 (MORE than 6), for a def-8 target floor(4) = 4 (LESS than 6). It removes
 * NO HP (a DEF debuff read at the mitigation seam), floored at {@link MIN_EFFECTIVE_DEF} inside
 * {@link resolveAttack} so even a huge reduction can never invert floor(def/2) — HP-monotone
 * (A-42) holds. The duration re-uses {@link WEAKEN_DURATION} (a duration re-tune is NOT part of
 * this wave). Naming/ratio assumption logged A-87.
 */
export const WEAKEN_PERCENT_RATIO = 0.5;

/**
 * Crumble's energy cost (TASK-100) — priced 67, DELIBERATELY ABOVE {@link MAX_ENERGY} (41) and
 * DISTINCT from {@link RETALIATE_PERCENT_ENERGY_COST} (66) / {@link LEECH_PERCENT_ENERGY_COST}
 * (65) / {@link SAP_PERCENT_ENERGY_COST} (64) and every other above-pool cost, so it slots at the
 * new strictly-cost-descending ladder TOP (above `reflect-percent`@66). Posture-B DECOUPLED
 * (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose
 * `energyCost ≤ energy` and every fight-local pool is capped at MAX_ENERGY, `weaken-percent` is
 * NEVER the pick inside {@link simulateBattle} — so the shipped win-vs-numemon / loss-vs-kuwagamon
 * fights stay BYTE-IDENTICAL (ZERO ladder re-tune, no top-of-ladder staller risk, TASK-60/L-22).
 * The mechanic is proven wired in ISOLATION by a {@link selectSkill}(67) boundary unit + a direct
 * fixed-vs-percent DEF-mitigation CONTRAST unit + a debuff-grant unit. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const WEAKEN_PERCENT_ENERGY_COST = 67;

/**
 * Counter Stance's energy cost (TASK-69, PROMOTED IN-POOL by TASK-75). This is the 4th
 * and FINAL OBSERVABLE-PROMOTION wave (R-17c), CLOSING the arc TASK-72 (Sap) / TASK-73
 * (Leech) / TASK-74 (Focus/Empower) opened: Retaliate — the reactive Thorns SELF-buff —
 * shipped Posture-B (priced above the pool, present-but-invisible) across TASK-69.
 * TASK-75 RE-PRICES it IN-pool (was 45 > MAX_ENERGY 41) so a real `/battle` player finally
 * SEES a counter/reflect in the shipped numemon WIN. After this wave ZERO skills remain
 * above-pool.
 *
 * The selector inclusion is AUTOMATIC: `skillAilment` already classifies `retaliate` as
 * `target: 'self'`, so the TASK-74 Rule-1b self-buff opener is GENERIC over it — the
 * moment `counter-stance` becomes affordable it is auto-included with NO selector-code
 * change (the third self-buff after Focus/Guard). So the ONLY change is this re-price.
 *
 * Cost tuned to 30 — an in-pool value (≤ MAX_ENERGY 41) in the mid-to-upper band (A-64:
 * 26–34) that stays ABOVE Double Strike's 24, so `counter-stance` keeps the ladder's TOP
 * slot 1 and NO other ladder entry re-orders (minimal ladder-unit churn). It is affordable
 * from a full pool on the opening turns, so once the Rule-1 fresh-ailment arsenal is spent
 * the Rule-1b opener casts it (cost-descending among the three self-buffs: counter-stance@30
 * → guard@14 → focus@7), it is SEEN with a "…is Retaliating" note, and — because the enemy
 * then lands an overflow HP hit on the retaliating player — the reflect actually TRIGGERS
 * ("…retaliates for N"). HP stays MONOTONICALLY NON-INCREASING (A-42): Retaliate's ONLY
 * payoff is REFLECT damage TO the enemy on overflow, never HP-up — categorically NOT the
 * A-42-deferred Heal/HoT family. Kept DISTINCT (30) so the COMBATANT_SKILLS ladder stays
 * strictly cost-descending; MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other
 * skill costs stay BYTE-UNCHANGED.
 */
export const COUNTER_STANCE_ENERGY_COST = 30;

/**
 * Energy Drain's (Sap) fixed drain amount (TASK-70) — the FIXED, DETERMINISTIC energy
 * the `sap` effect removes from the DEFENDER's in-combat pool (floored at 0). This is
 * the FIRST mechanic that interferes with the opponent's ENERGY economy (the resource
 * that gates their next-turn skill selection) rather than their HP / a stat / a control
 * lock / a shield. 12 is DISTINCT and tunable: large enough (3× the 4/turn regen) to
 * meaningfully set back a foe's skill choice, but bounded so it can never underflow
 * (the ≥ 0 floor holds) and never touches HP (A-42 held — `sap` writes ONLY the non-HP
 * `energy` resource; the composite's damage half is the sole HP write, through the
 * shared monotone {@link resolveDamageStrike}).
 */
export const SAP_ENERGY_AMOUNT = 12;

/**
 * Energy Rend's (`sap-percent`) drain RATIO (TASK-97, R-17c 46th wave) — the FRACTION of
 * the DEFENDER's CURRENT energy the percentage-drain removes (floored to an integer). This
 * is the FIRST fractional-MAGNITUDE constant on the resource axis (the fractional MIRROR of
 * the FIXED {@link SAP_ENERGY_AMOUNT} = 12). 0.5 = "drain HALF the foe's current energy":
 * a genuine magnitude-fidelity contrast with the fixed Sap — MORE at a high pool (40 →
 * floor(20) = 20 > 12), LESS at a low pool (10 → floor(5) = 5 < min(10,12) = 10). It
 * writes ONLY the non-HP `energy` resource, so HP-monotone (A-42) holds. Naming/ratio
 * assumption logged A-84.
 */
export const SAP_PERCENT_RATIO = 0.5;

/**
 * Energy Rend's energy cost (TASK-97) — priced 64, DELIBERATELY ABOVE {@link MAX_ENERGY}
 * (41) and DISTINCT from {@link REBOUND_SNAPLOCKDOOM_ENERGY_COST} (63) and every other
 * above-pool cost, so it slots at the new strictly-cost-descending ladder TOP (above
 * `reclaim-snaplockdoom`@63). Posture-B DECOUPLED (L-16 #7): because
 * {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`
 * and every fight-local pool is capped at MAX_ENERGY, `sap-percent` is NEVER the pick
 * inside {@link simulateBattle} — so the shipped win-vs-numemon / loss-vs-kuwagamon fights
 * stay BYTE-IDENTICAL (ZERO ladder re-tune, no top-of-ladder staller risk, TASK-60/L-22).
 * The mechanic is proven wired in ISOLATION by a {@link selectSkill}(64) boundary unit + a
 * direct {@link drainEnergyPercent} apply unit + a Sap-vs-Sap-percent magnitude contrast.
 * MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay
 * BYTE-UNCHANGED.
 */
export const SAP_PERCENT_ENERGY_COST = 64;

/**
 * Energy Surge's (`leech-percent`) credit RATIO (TASK-98, R-17c 47th wave) — the FRACTION of
 * the ATTACKER's OWN CURRENT energy the percentage-credit regains (floored to an integer,
 * pre-cap). This is the CREDIT twin of {@link SAP_PERCENT_RATIO} (the fractional DRAIN) and the
 * fractional MIRROR of the FIXED {@link LEECH_ENERGY_AMOUNT} = 12 — the SECOND fractional-MAGNITUDE
 * constant on the resource axis, CONTINUING the percentage/fidelity axis on the resource-CREDIT
 * side. 0.5 = "regain HALF the caster's current energy": a genuine magnitude-fidelity contrast
 * with the fixed Leech — at 20 energy percent gains floor(10) = 10 (→ 30) vs fixed 12 (→ 32). It
 * writes ONLY the non-HP `energy` resource, so HP-monotone (A-42) holds. Naming/ratio assumption
 * logged A-85.
 */
export const LEECH_PERCENT_RATIO = 0.5;

/**
 * Energy Surge's energy cost (TASK-98) — priced 65, DELIBERATELY ABOVE {@link MAX_ENERGY}
 * (41) and DISTINCT from {@link SAP_PERCENT_ENERGY_COST} (64) and every other above-pool cost,
 * so it slots at the new strictly-cost-descending ladder TOP (above `sap-percent`@64).
 * Posture-B DECOUPLED (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick
 * a skill whose `energyCost ≤ energy` and every fight-local pool is capped at MAX_ENERGY,
 * `leech-percent` is NEVER the pick inside {@link simulateBattle} — so the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune, no
 * top-of-ladder staller risk, TASK-60/L-22). The mechanic is proven wired in ISOLATION by a
 * {@link selectSkill}(65) boundary unit + a direct {@link restoreEnergyPercent} apply unit + a
 * Leech-vs-Leech-percent magnitude contrast. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and
 * ALL other skill costs stay BYTE-UNCHANGED.
 */
export const LEECH_PERCENT_ENERGY_COST = 65;

/**
 * Energy Drain's energy cost (TASK-70, PROMOTED IN-POOL by TASK-72). This is the
 * OBSERVABLE-PROMOTION wave (R-17c 20th): Sap — the elder resource-interference
 * sibling — was shipped Posture-B (priced above the pool, present-but-invisible)
 * across TASK-70. TASK-72 DEMOTES it into the fight pool so a real `/battle` player
 * finally SEES it. `energy-drain` is a DAMAGING composite (`[damage, sap]`) with NO
 * ailment arm, so `chooseSkill` Rule 1 (the fresh-ailment tactical rotation) never
 * picks it; only Rule 2 (`strongestDamage`) does — reached in the numemon fight's LATE
 * hammer phase once the whole tactical arsenal is spent. IMPORTANT (the tuning story):
 * the ~25 first guessed does NOT fire — the Rule-1 arsenal drains the pool hard and
 * energy only regens 4/turn, so by the hammer the pool hovers ~4–10 and never climbs
 * back to 25 (raising MAX_ENERGY/regen to force it is the TASK-60 Posture-A staller,
 * avoided). Cost is therefore tuned to 1 — a low in-pool cost inside the fixture's
 * hammer-phase energy band — so Sap is CAST at round 13 while numemon STILL WINS.
 * Cost 1 is DELIBERATELY < the 4/turn regen (NOT == it): a cost==regen pick forms a
 * drain→regen→recast FIXED POINT that starves Double Strike out of a LONG fight (the
 * {@link ENFEEBLE_STRIKE_ENERGY_COST} cost-4 degeneracy — which, proven under this
 * wave, bites the Rule-2 hammer too). At cost 1 the pool net-CLIMBS +3/turn between
 * casts, so a long fight still recovers energy to afford Double Strike. Kept DISTINCT (1,
 * between poison-sting's 2 and the free attack's 0) so the COMBATANT_SKILLS ladder stays
 * strictly cost-descending. (TASK-75 UPDATE: `counter-stance` was itself promoted IN-pool
 * to cost 30 — the ladder's TOP slot — closing the observable-promotion arc; ZERO skills
 * remain above-pool.) TASK-73 UPDATE: `energy-siphon` (Leech) was itself promoted
 * IN-POOL to cost 4 — ABOVE Sap@1 — and, because Rule 2 prefers the highest-cost affordable
 * pure-damage skill, Leech now WINS the numemon fight's single hammer slot that TASK-72 gave
 * to Sap. Sap stays fully wired + unit-proven directly; it simply no longer casts in THIS
 * fixture (it would still win whenever energy sits in [1,3], below Leech@4).
 */
export const ENERGY_DRAIN_ENERGY_COST = 1;

/**
 * Energy Leech's (Siphon) fixed leech amount (TASK-71) — the FIXED, DETERMINISTIC energy
 * the `leech` effect CREDITS the ATTACKER's OWN in-combat pool (capped at
 * {@link MAX_ENERGY}). This is the exact MIRROR of {@link SAP_ENERGY_AMOUNT}: sap REMOVES
 * energy from the DEFENDER, leech GRANTS energy to the ATTACKER — genuinely the FIRST
 * effect to raise a combatant's OWN energy above the regen path, so a genuinely new SHAPE
 * (add-only, HP-monotone, RNG-free). 12 is DISTINCT and tunable: large enough (3× the
 * 4/turn regen) to meaningfully accelerate the attacker's next skill choice, but bounded
 * and capped so it can never overfill the pool (the {@link MAX_ENERGY} ceiling holds) and
 * never touches HP (A-42 held — `leech` writes ONLY the non-HP `energy` resource; the
 * composite's damage half is the sole HP write, through the shared monotone
 * {@link resolveDamageStrike}).
 */
export const LEECH_ENERGY_AMOUNT = 12;

/**
 * Energy Siphon's energy cost (TASK-71, PROMOTED IN-POOL by TASK-73). This is the 2nd
 * OBSERVABLE-PROMOTION wave (R-17c): Leech — the resource-interference sibling that
 * MIRRORS Sap (attacker energy GAIN vs Sap's defender DRAIN) — shipped Posture-B
 * (priced above the pool, present-but-invisible) across TASK-71. TASK-73 DEMOTES it into
 * the fight pool so a real `/battle` player finally SEES it. `energy-siphon` is a DAMAGING
 * composite (`[damage, leech]`) with NO ailment arm — structurally IDENTICAL to Sap — so
 * `chooseSkill` Rule 1 (the fresh-ailment tactical rotation) never picks it; only Rule 2
 * (`strongestDamage`) does, reached in the numemon fight's single late hammer turn (round
 * 13) once the whole tactical arsenal is spent and energy has settled to ~10.
 *
 * Cost is tuned to 4 — the LONE free in-pool integer that actually FIRES: every other low
 * slot is taken (armor-break@5, bleed-strike@3, poison-sting@2, energy-drain@1, attack@0),
 * and a higher cost (e.g. 13) never re-climbs in the low hammer band so it would never
 * surface. It slots between armor-break@5 and bleed-strike@3 so the COMBATANT_SKILLS ladder
 * stays strictly cost-descending. Because energy-siphon@4 sits ABOVE energy-drain@1 and
 * Rule 2 prefers the HIGHEST-cost affordable pure-damage skill, Leech WINS the single
 * hammer slot that TASK-72 gave to Sap — a deliberate, bounded perturbation of the numemon
 * WIN log (still a clean WIN, Leech now VISIBLE), NOT a byte-identical add. Sap stays fully
 * wired + unit-proven directly.
 *
 * NOTE cost 4 == {@link ENERGY_REGEN_PER_TURN}, which is a FIXED-POINT trap ONLY for a
 * skill that does NOT restore energy (the cost-4 {@link ENFEEBLE_STRIKE_ENERGY_COST}
 * degeneracy). energy-siphon LEECHES +12 (a NET energy GAIN of +8 after regen and −4 cost
 * per cast), so it can never pin the pool — it always climbs after a cast. The trap does
 * not apply.
 */
export const ENERGY_SIPHON_ENERGY_COST = 4;

/**
 * TASK-76 (R-17c, 25th combat wave) — Purify's energy cost, and the FIRST NEW mechanic
 * after the observable-promotion arc (TASK-72→75) CLOSED: the FIRST status-REMOVAL
 * family. Priced at 43 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41) — the Posture-B
 * DECOUPLED posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever
 * pick a skill whose `energyCost ≤ energy`, and every fight-local pool is capped at
 * MAX_ENERGY, `cleanse` is NEVER the pick inside {@link simulateBattle}. So the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune —
 * the safest regression posture), and the skill is proven wired in ISOLATION (present ≠
 * observable) by a {@link selectSkill}(43) boundary unit + a direct {@link clearDebuffs}
 * apply unit, NOT by a shipped-fight cast.
 *
 * WHY Posture-B (not a demotion / in-pool surface): Purify is a NON-damaging UTILITY
 * skill — casting it FIRST at full energy would spend a zero-damage turn removing the
 * caster's OWN (usually absent) debuffs, starving the marginally-winnable numemon fight
 * exactly like the pure-control Lullaby Hex hazard (TASK-60). And its behaviour is fully
 * verifiable in isolation, so it does not need to co-star in the shipped fight. Kept
 * DISTINCT (43, above `counter-stance`@30) so the {@link COMBATANT_SKILLS} ladder stays
 * strictly cost-descending for the selectSkill boundary unit. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const CLEANSE_ENERGY_COST = 43;

/**
 * TASK-104 (R-17c, 53rd combat wave) — Chaos Shift's energy cost, opening the FIRST
 * stat-VALUE SWAP mechanic (the transfer of raw STAT VALUES, distinct from the transfer of
 * status ARRAYS by the cleanse/dispel/purloin/displace/reclaim family). Priced at 42 —
 * DELIBERATELY ABOVE {@link MAX_ENERGY} (41), the LAST free integer between MAX_ENERGY (41)
 * and the contiguous 43→70 above-pool band, and DISTINCT from every other above-pool cost
 * (`cleanse`@43 … `vulnerable-percent`@70) and from `counter-stance`@30 so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY, `swap-atk`
 * is NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon /
 * loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression
 * posture), and the skill is proven wired in ISOLATION (present ≠ observable) by a
 * {@link selectSkill}(42) boundary unit + a direct swap unit (two combatants' `atk` EXCHANGED,
 * HP-neutral), NOT by a shipped-fight cast.
 *
 * WHY the stat-VALUE swap is the lowest-risk genuinely-absent next mechanic (gap analysis vs
 * LIVE `battle.ts`, cycle-255): of the four remaining absent families — HP-raising
 * (heal/HoT/drain/revive), percent-of-max-HP damage, execute/threshold, and stat-VALUE swap —
 * only the stat-value swap needs NO new substrate (`Combatant` has NO `maxHp` field, so
 * percent-of-max-HP / execute each require ADDING it — a wire/substrate change, higher-risk,
 * DEFERRED) AND stays HP-monotone (the HP-raising family RAISES HP, breaking A-42, DEFERRED).
 * A stat-value swap is RNG-free and writes NO HP. MAX_ENERGY / ENERGY_REGEN_PER_TURN /
 * MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const SWAP_ATK_ENERGY_COST = 42;

/**
 * TASK-105 (R-17c, 54th combat wave) — Chaos Warp's energy cost, adding the SECOND
 * stat-VALUE SWAP mechanic (`swap-def`, the defensive twin of `swap-atk`/{@link SWAP_ATK_ENERGY_COST}).
 * Priced at 71 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), the FIRST free integer at the TOP
 * of the now-contiguous 42→70 above-pool band (`swap-atk`@42 its floor … `vulnerable-percent`@70
 * its previous top), and DISTINCT from every other above-pool cost so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY, `swap-def`
 * is NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon /
 * loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression
 * posture), and the skill is proven wired in ISOLATION (present ≠ observable) by a
 * {@link selectSkill}(71) boundary unit + a direct swap unit (two combatants' `def` EXCHANGED,
 * HP-neutral), NOT by a shipped-fight cast.
 *
 * WHY `swap-def` is the lowest-risk genuinely-absent next mechanic (gap analysis vs LIVE
 * `battle.ts`, cycle-257): of the genuinely-absent families, only the stat-value-swap variants
 * (`swap-def`/`swap-spd`/full three-stat swap) need NO new substrate — `Combatant` has NO
 * `maxHp` field, so `swap-def` mirrors the shipped `swap-atk` STRUCTURALLY IDENTICALLY on the
 * existing raw `def` scalar. The substrate-gated families (percent-of-max-HP damage +
 * execute/threshold each need a NEW `maxHp` field; the HP-RAISING heal/HoT/drain/revive family
 * breaks HP-monotonicity A-42; the RNG-seam control ailments need an A-53 RNG substrate) are all
 * strictly higher-risk and DEFERRED. A stat-value swap is RNG-free and writes NO HP. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const SWAP_DEF_ENERGY_COST = 71;

/**
 * TASK-106 (R-17c, 55th combat wave) — Chaos Cyclone's energy cost, adding the THIRD
 * stat-VALUE SWAP mechanic (`swap-spd`, the speed twin of `swap-atk`/{@link SWAP_ATK_ENERGY_COST}
 * and `swap-def`/{@link SWAP_DEF_ENERGY_COST}), COMPLETING the per-scalar atk→def→spd swap trio.
 * Priced at 72 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), the FIRST free integer at the TOP
 * of the now-contiguous 42→71 above-pool band (`swap-atk`@42 its floor … `swap-def`@71 its
 * previous top), and DISTINCT from every other above-pool cost so the {@link COMBATANT_SKILLS}
 * ladder stays strictly cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because
 * {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`,
 * and every fight-local pool is capped at MAX_ENERGY, `swap-spd` is NEVER the pick inside
 * {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression posture), and the skill is proven
 * wired in ISOLATION (present ≠ observable) by a {@link selectSkill}(72) boundary unit + a direct
 * swap unit (two combatants' `spd` EXCHANGED, HP-neutral), NOT by a shipped-fight cast.
 *
 * WHY `swap-spd` is the lowest-risk genuinely-absent next mechanic (gap analysis vs LIVE
 * `battle.ts`, cycle-259): of the genuinely-absent families, only the stat-value-swap variants
 * (`swap-spd`/full three-stat swap) need NO new substrate — `Combatant` already carries `spd`
 * (NO `maxHp` field), so `swap-spd` mirrors the shipped `swap-def` STRUCTURALLY IDENTICALLY on
 * the existing raw `spd` scalar. The substrate-gated families (percent-of-max-HP damage +
 * execute/threshold each need a NEW `maxHp` field; the HP-RAISING heal/HoT/drain/revive family
 * breaks HP-monotonicity A-42; the RNG-seam control ailments need an A-53 RNG substrate) are all
 * strictly higher-risk and DEFERRED. A stat-value swap is RNG-free and writes NO HP. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const SWAP_SPD_ENERGY_COST = 72;

/**
 * TASK-107 (R-17c, 56th combat wave) — Chaos Nexus's energy cost, adding the FULL three-stat
 * SWAP mechanic (`swap-all` — the FULL-bundle variant that EXCHANGES `atk` + `def` + `spd`
 * TOGETHER in a single cast, EXHAUSTING the stat-value-swap shape family that `swap-atk`/
 * {@link SWAP_ATK_ENERGY_COST} opened and `swap-def`/{@link SWAP_DEF_ENERGY_COST} +
 * `swap-spd`/{@link SWAP_SPD_ENERGY_COST} completed per-scalar). Priced at 73 — DELIBERATELY
 * ABOVE {@link MAX_ENERGY} (41), the FIRST free integer at the TOP of the now-contiguous 42→72
 * above-pool band (`swap-atk`@42 its floor … `swap-spd`@72 its previous top), and DISTINCT from
 * every other above-pool cost so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`, and every fight-local
 * pool is capped at MAX_ENERGY, `swap-all` is NEVER the pick inside {@link simulateBattle}. So
 * the shipped win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune
 * — the safest regression posture), and the skill is proven wired in ISOLATION (present ≠
 * observable) by a {@link selectSkill}(73) boundary unit + a direct full-swap unit (two
 * combatants' `atk`/`def`/`spd` ALL exchanged, HP-neutral), NOT by a shipped-fight cast.
 *
 * WHY `swap-all` is the lowest-risk genuinely-absent next mechanic (gap analysis vs LIVE
 * `battle.ts`, cycle-261): it is the ONLY genuinely-absent variant of the swap shape that needs
 * NO new substrate — all three raw scalars `atk`/`def`/`spd` already exist on `Combatant` (fields
 * exactly `name/type/element/hp/atk/def/spd`, NO `maxHp`) and each already has its own shipped
 * pure swap helper ({@link swapAtk}/{@link swapDef}/{@link swapSpd}), so `swap-all` is a
 * byte-for-byte COMPOSITION of the three shipped per-scalar swaps applied in ONE on-cast branch —
 * it re-derives NO exchange math. The substrate-gated families (percent-of-max-HP damage +
 * execute/threshold each need a NEW `maxHp` field; the HP-RAISING heal/HoT/drain/revive family
 * breaks HP-monotonicity A-42; the RNG-seam control ailments need an A-53 RNG substrate) are all
 * strictly higher-risk and DEFERRED. A stat-value swap is RNG-free and writes NO HP. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const SWAP_ALL_ENERGY_COST = 73;

/**
 * TASK-108 (R-17c, 57th combat wave) — Fortify's energy cost, and the missing DEFENSIVE
 * member of the SELF-BUFF family: the DEF-up self-buff, the exact SELF-BUFF MIRROR of the
 * `weaken` (DEF-DOWN) debuff and the DEF-axis TWIN of the shipped `empower` (ATK-up) self-buff.
 * Priced at 74 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41 = above-pool, Posture-B DECOUPLED),
 * the next FREE above-pool integer at the ladder TOP, one above `swap-all`@73; DISTINCT from
 * every above-pool cost 42…73 and from `counter-stance`@30 — documented distinct exactly as
 * {@link SWAP_ALL_ENERGY_COST} = 73 is. Because {@link selectSkill}/{@link chooseSkill} pick the
 * FIRST {@link COMBATANT_SKILLS} entry with `energyCost ≤ energy` and every fight-local pool is
 * capped at MAX_ENERGY, `fortify` is NEVER the pick inside {@link simulateBattle} — so the shipped
 * numemon-WIN / kuwagamon-LOSS fights stay BYTE-IDENTICAL. It is proven wired NOT via a shipped
 * fight but with a direct {@link selectSkill}(74) boundary unit + a direct mitigation-seam unit.
 */
export const FORTIFY_ENERGY_COST = 74;

/**
 * How many of the fortified side's OWN turns a Fortify buff lasts (TASK-108). Mirrors
 * {@link EMPOWER_DURATION} = 3 (the ATK-up self-buff twin). A DEF-up buff tick removes NO HP — it
 * only LOWERS incoming damage — so HP stays monotonically non-increasing (A-42).
 */
export const FORTIFY_DURATION = 3;

/**
 * How much a Fortify buff RAISES the fortified DEFENDER's effective DEF at the mitigation seam
 * (TASK-108) — the self-buff MIRROR of the DEF-reduction {@link WEAKEN_DEF_REDUCTION} = 6 (and the
 * DEF-axis twin of the ATK-bonus {@link EMPOWER_ATK_BONUS} = 6). A fortified defender takes a few
 * LESS damage per incoming hit; folded in at the `netDefReduction` seam as a NEGATIVE reduction,
 * clamped at MIN_EFFECTIVE_DEF in {@link resolveAttack} — a def-BONUS only RAISES effectiveDef and
 * can never invert the mitigation term, so damage stays ≥1-floored and HP stays monotone (A-42).
 */
export const FORTIFY_DEF_BONUS = 6;

/**
 * TASK-109 (R-17c, 58th combat wave) — Brace's energy cost, and the missing damage-application-seam
 * BUFF: the damage-taken-DOWN SELF-BUFF, the exact POSITIVE MIRROR of the `vulnerable` (damage-taken-UP)
 * debuff — distinct from `fortify`@74 which lives at the OTHER (DEF-mitigation / netDefReduction) seam.
 * Priced at 75 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41 = above-pool, Posture-B DECOUPLED), the next
 * FREE above-pool integer at the ladder TOP, one above `fortify`@74; DISTINCT from every above-pool cost
 * 42…74 and from `counter-stance`@30 — documented distinct exactly as {@link FORTIFY_ENERGY_COST} = 74
 * is. Because {@link selectSkill}/{@link chooseSkill} pick the FIRST {@link COMBATANT_SKILLS} entry with
 * `energyCost ≤ energy` and every fight-local pool is capped at MAX_ENERGY, `brace` is NEVER the pick
 * inside {@link simulateBattle} — so the shipped numemon-WIN / kuwagamon-LOSS fights stay BYTE-IDENTICAL.
 * It is proven wired NOT via a shipped fight but with a direct {@link selectSkill}(75) boundary unit + a
 * direct {@link amplifyForVulnerable} damage-application-seam unit (a braced defender takes STRICTLY LESS).
 */
export const BRACE_ENERGY_COST = 75;

/**
 * How many of the braced side's OWN turns a Brace buff lasts (TASK-109). Mirrors
 * {@link FORTIFY_DURATION} / {@link VULNERABLE_DURATION} = 3. A damage-taken-DOWN buff tick removes NO
 * HP — it only LOWERS incoming damage — so HP stays monotonically non-increasing (A-42).
 */
export const BRACE_DURATION = 3;

/**
 * The fractional damage-taken REDUCTION a Brace defender enjoys on EVERY incoming strike (TASK-109) —
 * the POSITIVE-MIRROR magnitude of the damage-taken-UP {@link VULNERABLE_DAMAGE_TAKEN_BONUS} = 0.25
 * (+25%). A braced defender takes ×(1 − 0.25) damage per incoming hit; folded in at the SAME
 * {@link amplifyForVulnerable} damage-application seam as a NEGATIVE bonus (SUBTRACTED from totalBonus),
 * and the existing Math.max(1, …) floor keeps damage ≥1 even when totalBonus goes negative — so damage
 * stays ≥1-floored and HP stays monotone (A-42).
 */
export const BRACE_DAMAGE_TAKEN_REDUCTION = 0.25;

/**
 * Bulwark's (`brace-percent`) energy cost (TASK-110) — 76, DELIBERATELY ABOVE {@link MAX_ENERGY}
 * (41 = above-pool, Posture-B DECOUPLED), the next FREE above-pool integer at the ladder TOP, one
 * above `brace`@75; DISTINCT from every above-pool cost 42…75 and from `counter-stance`@30 —
 * documented distinct exactly as {@link BRACE_ENERGY_COST} = 75 / {@link VULNERABLE_PERCENT_ENERGY_COST}
 * = 70 are. Because {@link selectSkill}/{@link chooseSkill} pick the FIRST {@link COMBATANT_SKILLS}
 * entry with `energyCost ≤ energy` and every fight-local pool is capped at MAX_ENERGY, `brace-percent`
 * is NEVER the pick inside {@link simulateBattle} — so the shipped numemon-WIN / kuwagamon-LOSS fights
 * stay BYTE-IDENTICAL. Proven wired NOT via a shipped fight but with a direct {@link selectSkill}(76)
 * boundary unit + a direct {@link amplifyForVulnerable} damage-application-seam unit (a bulwarked
 * defender takes STRICTLY LESS).
 */
export const BRACE_PERCENT_ENERGY_COST = 76;

/**
 * How many of the bulwarked side's OWN turns a Bulwark buff lasts (TASK-110). Mirrors
 * {@link BRACE_DURATION} / {@link VULNERABLE_DURATION} = 3. A damage-taken-DOWN buff tick removes NO
 * HP — it only LOWERS incoming damage — so HP stays monotonically non-increasing (A-42).
 */
export const BRACE_PERCENT_DURATION = 3;

/**
 * The FRACTIONAL damage-taken REDUCTION a Bulwark defender enjoys on EVERY incoming strike (TASK-110)
 * — the damage-taken-DOWN fractional MIRROR of the damage-taken-UP {@link VULNERABLE_PERCENT_RATIO} =
 * 0.5 (+50%), and a LARGER cut than the FLAT {@link BRACE_DAMAGE_TAKEN_REDUCTION} = 0.25. A bulwarked
 * defender takes ×(1 − 0.5) damage per incoming hit; folded in at the SAME {@link amplifyForVulnerable}
 * damage-application seam as a NEGATIVE bonus (SUBTRACTED from totalBonus), and the existing
 * Math.max(1, …) floor keeps damage ≥1 even when totalBonus goes negative — so damage stays ≥1-floored
 * and HP stays monotone (A-42).
 */
export const BRACE_PERCENT_RATIO = 0.5;

/**
 * Aegis's (`fortify-percent`) energy cost (TASK-111) — 77, DELIBERATELY ABOVE {@link MAX_ENERGY}
 * (41 = above-pool, Posture-B DECOUPLED), the next FREE above-pool integer at the ladder TOP, one
 * above `brace-percent`@76; DISTINCT from every above-pool cost 42…76 and from `counter-stance`@30 —
 * documented distinct exactly as {@link BRACE_PERCENT_ENERGY_COST} = 76 / {@link FORTIFY_ENERGY_COST}
 * = 74 are. Because {@link selectSkill}/{@link chooseSkill} pick the FIRST {@link COMBATANT_SKILLS}
 * entry with `energyCost ≤ energy` and every fight-local pool is capped at MAX_ENERGY, `fortify-percent`
 * is NEVER the pick inside {@link simulateBattle} — so the shipped numemon-WIN / kuwagamon-LOSS fights
 * stay BYTE-IDENTICAL. Proven wired NOT via a shipped fight but with a direct {@link selectSkill}(77)
 * boundary unit + a direct mitigation-seam unit (an aegis'd defender takes STRICTLY LESS — and less
 * than the FLAT `fortify` at a def where floor(def × 0.5) > FORTIFY_DEF_BONUS).
 */
export const FORTIFY_PERCENT_ENERGY_COST = 77;

/**
 * How many of the aegis'd side's OWN turns an Aegis buff lasts (TASK-111). Mirrors
 * {@link FORTIFY_DURATION} / {@link BRACE_PERCENT_DURATION} = 3. A DEF-up buff tick removes NO HP — it
 * only LOWERS incoming damage — so HP stays monotonically non-increasing (A-42).
 */
export const FORTIFY_PERCENT_DURATION = 3;

/**
 * The FRACTIONAL DEF BONUS an Aegis defender enjoys on EVERY incoming strike (TASK-111) — the DEF-UP
 * fractional MIRROR of the DEF-DOWN {@link WEAKEN_PERCENT_RATIO} = 0.5, and a LARGER effect than the
 * FLAT {@link FORTIFY_DEF_BONUS} = 6 (at a def ≥ 14, floor(def × 0.5) > 6). While a combatant carries
 * `fortify-percent`, its effective DEF at the `netDefReduction` seam is RAISED by floor(def ×
 * defBonusRatio) — folded in as a NEGATIVE reduction (SUBTRACTED from netDefReduction) EXACTLY like
 * `weaken-percent`'s `defReductionRatio` folds `+ floor(def × ratio)` but with opposite sign; the
 * existing MIN_EFFECTIVE_DEF clamp in {@link resolveAttack} keeps damage ≥1-floored even when the
 * reduction term goes negative — so damage stays ≥1-floored and HP stays monotone (A-42).
 */
export const FORTIFY_PERCENT_RATIO = 0.5;

/**
 * Quicken's (`hasten`) energy cost (TASK-112) — 78, DELIBERATELY ABOVE {@link MAX_ENERGY} (41 =
 * above-pool, Posture-B DECOUPLED), the next FREE above-pool integer at the ladder TOP, one above
 * `fortify-percent`@77; DISTINCT from every above-pool cost 42…77 and from `counter-stance`@30 —
 * documented distinct exactly as {@link FORTIFY_PERCENT_ENERGY_COST} = 77 / {@link FORTIFY_ENERGY_COST}
 * = 74 are. Because {@link selectSkill}/{@link chooseSkill} pick the FIRST {@link COMBATANT_SKILLS}
 * entry with `energyCost ≤ energy` and every fight-local pool is capped at MAX_ENERGY, `hasten` is
 * NEVER the pick inside {@link simulateBattle} — so the shipped numemon-WIN / kuwagamon-LOSS fights stay
 * BYTE-IDENTICAL. Proven wired NOT via a shipped fight but with a direct {@link selectSkill}(78) boundary
 * unit + a direct {@link effectiveSpd} read unit (a hasten'd combatant's effectiveSpd is STRICTLY GREATER
 * than its raw spd).
 */
export const HASTEN_ENERGY_COST = 78;

/**
 * How many of the hastened side's OWN turns a Quicken buff lasts (TASK-112). Mirrors
 * {@link FORTIFY_DURATION} / {@link EMPOWER_DURATION} = 3. A SPD-up buff tick removes NO HP — it only
 * RAISES effective SPD — so HP stays monotonically non-increasing (A-42).
 */
export const HASTEN_DURATION = 3;

/**
 * How much a Quicken buff RAISES the hastened combatant's effective SPD, read by {@link effectiveSpd}
 * (TASK-112) — the FLAT SPD-axis SELF-BUFF scalar, sized like the flat {@link FORTIFY_DEF_BONUS} = 6 /
 * `empower`'s `atkBonus`. Modest so the eventual SPD-axis debuff twin can mirror it. A flat SPD-UP only
 * RAISES effectiveSpd (clamped ≥ {@link MIN_EFFECTIVE_SPD}), never inverting it, and writes NO HP (A-42).
 */
export const HASTEN_SPD_BONUS = 4;

/**
 * Rush's (`hasten-percent`) energy cost (TASK-113) — 79, DELIBERATELY ABOVE {@link MAX_ENERGY} (41 =
 * above-pool, Posture-B DECOUPLED), the next FREE above-pool integer at the ladder TOP, one above
 * `hasten`@78; DISTINCT from every above-pool cost 42…78 and from `counter-stance`@30 — documented
 * distinct exactly as {@link HASTEN_ENERGY_COST} = 78 / {@link FORTIFY_PERCENT_ENERGY_COST} = 77 are.
 * Because {@link selectSkill}/{@link chooseSkill} pick the FIRST {@link COMBATANT_SKILLS} entry with
 * `energyCost ≤ energy` and every fight-local pool is capped at MAX_ENERGY, `hasten-percent` is NEVER
 * the pick inside {@link simulateBattle} — so the shipped numemon-WIN / kuwagamon-LOSS fights stay
 * BYTE-IDENTICAL. Proven wired NOT via a shipped fight but with a direct {@link selectSkill}(79) boundary
 * unit + a direct {@link effectiveSpd} read unit (a rushed combatant's effectiveSpd is STRICTLY GREATER
 * than its raw spd, RAISED by floor(spd × ratio)).
 */
export const HASTEN_PERCENT_ENERGY_COST = 79;

/**
 * How many of the rushed side's OWN turns a Rush buff lasts (TASK-113). Mirrors {@link HASTEN_DURATION} /
 * {@link FORTIFY_PERCENT_DURATION} = 3. A SPD-up buff tick removes NO HP — it only RAISES effective SPD —
 * so HP stays monotonically non-increasing (A-42).
 */
export const HASTEN_PERCENT_DURATION = 3;

/**
 * The fractional SPD-up ratio a Rush buff grants (TASK-113) — the PERCENTAGE twin of the flat
 * {@link HASTEN_SPD_BONUS} = 4, read by {@link effectiveSpd} via floor(spd × ratio) (the SAME
 * floor(stat × ratio) seam {@link FORTIFY_PERCENT_RATIO} = 0.5 uses for DEF and `empower-percent` for
 * ATK). Sized like {@link FORTIFY_PERCENT_RATIO} = 0.5. A percentage SPD-UP only RAISES effectiveSpd
 * (clamped ≥ {@link MIN_EFFECTIVE_SPD}), never inverting it, and writes NO HP (A-42).
 */
export const HASTEN_PERCENT_RATIO = 0.5;

/**
 * Hobble's (`hobble`) energy cost (TASK-114) — 80, DELIBERATELY ABOVE {@link MAX_ENERGY} (41 =
 * above-pool, Posture-B DECOUPLED), the next FREE above-pool integer at the ladder TOP, one above
 * `hasten-percent`@79; DISTINCT from every above-pool cost 42…79 and from `counter-stance`@30 —
 * documented distinct exactly as {@link HASTEN_ENERGY_COST} = 78 / {@link HASTEN_PERCENT_ENERGY_COST}
 * = 79 are. `hobble` OPENS the SPD-axis DOWN half: the FLAT SPD-DOWN DEBUFF cast on the FOE, the SPD
 * mirror of the shipped flat ATK-down `weaken` ({...; defReduction}) and DEF-down `enfeeble`
 * ({...; atkReduction}). Because {@link selectSkill}/{@link chooseSkill} pick the FIRST
 * {@link COMBATANT_SKILLS} entry with `energyCost ≤ energy` and every fight-local pool is capped at
 * MAX_ENERGY, `hobble` is NEVER the pick inside {@link simulateBattle} — so the shipped numemon-WIN /
 * kuwagamon-LOSS fights stay BYTE-IDENTICAL. Proven wired NOT via a shipped fight but with a direct
 * {@link selectSkill}(80) boundary unit + a direct {@link effectiveSpd} read unit (a hobbled
 * combatant's effectiveSpd is STRICTLY LESS than its raw spd, LOWERED by `spdReduction`, floored at
 * {@link MIN_EFFECTIVE_SPD}).
 */
export const HOBBLE_ENERGY_COST = 80;

/**
 * How many of the hobbled side's OWN turns a Hobble debuff lasts (TASK-114). Mirrors
 * {@link WEAKEN_DURATION} / {@link ENFEEBLE_DURATION} = 3. A SPD-down debuff tick removes NO HP — it
 * only LOWERS effective SPD — so HP stays monotonically non-increasing (A-42).
 */
export const HOBBLE_DURATION = 3;

/**
 * The flat SPD-down magnitude a Hobble debuff inflicts on the FOE (TASK-114) — the SPD-axis mirror of
 * the flat {@link WEAKEN_DEF_REDUCTION} = 6 (DEF-down) and {@link ENFEEBLE_ATK_REDUCTION} = 6 (ATK-down),
 * sized identically. Read by {@link effectiveSpd} via `spd - spdReduction`, the SAME subtract-then-clamp
 * read-seam idiom `effectiveDef` uses for weaken's `defReduction` and `effectiveAtk` for enfeeble's
 * `atkReduction`. The result is floored at {@link MIN_EFFECTIVE_SPD} (pre-built in TASK-112 for exactly
 * this DOWN branch), so a large `hobble` never drives effectiveSpd below 0. Writes NO HP (A-42).
 */
export const HOBBLE_SPD_REDUCTION = 6;

/**
 * Cripple's (`hobble-percent`) energy cost (TASK-115) — 81, DELIBERATELY ABOVE {@link MAX_ENERGY} (41 =
 * above-pool, Posture-B), the next FREE above-pool integer at the NEW ladder TOP, one above `hobble`@80;
 * DISTINCT from every above-pool cost 42…80 and from `counter-stance`@30 — documented distinct exactly
 * as {@link HOBBLE_ENERGY_COST} = 80 / {@link HASTEN_PERCENT_ENERGY_COST} = 79 are. `hobble-percent`
 * COMPLETES the SPD-axis DOWN percent square: the PERCENTAGE SPD-DOWN DEBUFF cast on the FOE, the
 * percentage twin of the flat `hobble` (SPD mirror of the percentage `weaken-percent`/`enfeeble-percent`
 * DEF/ATK debuffs). Because {@link selectSkill}/{@link chooseSkill} pick the FIRST
 * {@link COMBATANT_SKILLS} entry with `energyCost ≤ energy` and every fight-local pool is capped at
 * MAX_ENERGY, `hobble-percent` is NEVER the pick inside {@link simulateBattle} — so the shipped
 * numemon-WIN / kuwagamon-LOSS fights stay BYTE-IDENTICAL (zero ladder re-tune). Proven via a
 * {@link selectSkill}(81) boundary unit + a direct {@link effectiveSpd} read unit (a crippled
 * combatant's effectiveSpd is STRICTLY LESS than its raw spd, LOWERED by floor(spd × spdReductionRatio),
 * floored at {@link MIN_EFFECTIVE_SPD}).
 */
export const HOBBLE_PERCENT_ENERGY_COST = 81;

/**
 * How many of the crippled side's OWN turns a Cripple debuff lasts (TASK-115). Mirrors
 * {@link HOBBLE_DURATION} / {@link HASTEN_PERCENT_DURATION} / {@link WEAKEN_DURATION} = 3. A SPD-down
 * debuff tick removes NO HP — it only LOWERS effective SPD — so HP stays monotone (A-42).
 */
export const HOBBLE_PERCENT_DURATION = 3;

/**
 * The SPD-down FRACTION a Cripple debuff inflicts on the FOE (TASK-115) — the percentage twin of the
 * flat {@link HOBBLE_SPD_REDUCTION} and the SPD-axis mirror of {@link WEAKEN_PERCENT_RATIO} = 0.5
 * (DEF-down) / {@link ENFEEBLE_PERCENT_RATIO} = 0.5 (ATK-down) / {@link HASTEN_PERCENT_RATIO} = 0.5
 * (SPD-up), sized identically. Read by {@link effectiveSpd} via `spd - floor(spd × spdReductionRatio)`,
 * the SAME floor(stat × ratio) subtract-then-clamp read-seam idiom `hasten-percent` uses (with opposite
 * sign). Floored at {@link MIN_EFFECTIVE_SPD} (pre-built TASK-112), so a large percent never drives
 * effectiveSpd below 0. Unlike the flat `hobble` (constant delta), it scales with the bearer's OWN raw
 * spd. Writes NO HP (A-42).
 */
export const HOBBLE_PERCENT_RATIO = 0.5;

/**
 * TASK-77 (R-17c, 26th combat wave) — Purge's energy cost, and the SECOND status-REMOVAL
 * family member: the HOSTILE inverse of Purify. Priced at 44 — DELIBERATELY ABOVE
 * {@link MAX_ENERGY} (41), and DISTINCT from {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY, `dispel`
 * is NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon /
 * loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression
 * posture), and the skill is proven wired in ISOLATION (present ≠ observable) by a
 * {@link selectSkill}(44) boundary unit + a direct {@link stripBuffs} apply unit, NOT by a
 * shipped-fight cast.
 *
 * WHY Posture-B (not an in-pool surface): like Purify, Purge is a NON-damaging UTILITY skill
 * whose payoff (stripping the FOE's self-buffs) only matters when the foe actually carries
 * buffs; casting it greedily at full energy would spend a zero-damage turn and starve the
 * marginally-winnable numemon fight exactly like the pure-control Lullaby Hex hazard
 * (TASK-60). Its behaviour is fully verifiable in isolation, so it need not co-star in the
 * shipped fight. Placed at the new ladder TOP (above `cleanse`@43); it never fires in-sim.
 * MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay
 * BYTE-UNCHANGED.
 */
export const DISPEL_ENERGY_COST = 44;

/**
 * TASK-78 (R-17c, 27th combat wave) — Purloin's ("Spellthief") energy cost, and the THIRD
 * status-REMOVAL family member: the FIRST strip-and-TRANSFER (strip the FOE's self-buffs AND
 * grant the CASTER a self-buff). Priced at 45 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41),
 * and DISTINCT from both {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43)
 * so the {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B
 * DECOUPLED posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick
 * a skill whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY,
 * `purloin` is NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon /
 * loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression
 * posture), and the skill is proven wired in ISOLATION (present ≠ observable) by a
 * {@link selectSkill}(45) boundary unit + a direct {@link stealBuffs} apply unit, NOT by a
 * shipped-fight cast.
 *
 * WHY Posture-B (not an in-pool surface): like Purify/Purge, Purloin is a NON-damaging UTILITY
 * skill whose payoff (stealing the FOE's self-buffs) only matters when the foe actually carries
 * buffs; casting it greedily at full energy would spend a zero-damage turn and starve the
 * marginally-winnable numemon fight exactly like the pure-control Lullaby Hex hazard (TASK-60).
 * Its behaviour is fully verifiable in isolation, so it need not co-star in the shipped fight.
 * Placed at the new ladder TOP (above `dispel`@44); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const PURLOIN_ENERGY_COST = 45;

/**
 * TASK-79 (R-17c, 28th combat wave) — Displace's ("Scapegoat") energy cost, and the FOURTH
 * status-REMOVAL family member: the FIRST self→foe DEBUFF TRANSFER (the MIRROR of Purloin —
 * clear the CASTER's OWN harmful debuffs AND inflict a fixed `weaken` on the FOE). Priced at
 * 46 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from {@link PURLOIN_ENERGY_COST}
 * (45), {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY, `displace`
 * is NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon /
 * loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression
 * posture), and the skill is proven wired in ISOLATION (present ≠ observable) by a
 * {@link selectSkill}(46) boundary unit + a direct clear-and-transfer apply unit, NOT by a
 * shipped-fight cast.
 *
 * WHY Posture-B (not an in-pool surface): like Purify/Purge/Purloin, Displace is a NON-damaging
 * UTILITY skill whose payoff (clearing the caster's OWN debuffs + weakening the foe) only matters
 * when the caster actually carries a harmful debuff; casting it greedily at full energy would
 * spend a zero-damage turn and starve the marginally-winnable numemon fight exactly like the
 * pure-control Lullaby Hex hazard (TASK-60). Its behaviour is fully verifiable in isolation, so
 * it need not co-star in the shipped fight. Placed at the new ladder TOP (above `purloin`@45); it
 * never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs
 * stay BYTE-UNCHANGED.
 */
export const DISPLACE_ENERGY_COST = 46;

/**
 * TASK-80 (R-17c, 29th combat wave) — Reclaim's ("Backfire") energy cost, and the FIFTH
 * status-REMOVAL family member: the FIRST PAYLOAD-PRESERVING self→foe DEBUFF TRANSFER (the
 * A-68 refinement of Displace — clear the CASTER's OWN harmful debuffs AND inflict the SAME
 * debuff KINDS it just cleared onto the FOE, a genuine "give it back" clone, instead of
 * Displace's one-size fixed `weaken`). Priced at 47 — DELIBERATELY ABOVE {@link MAX_ENERGY}
 * (41), and DISTINCT from {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST} (45),
 * {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY, `reclaim`
 * is NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon /
 * loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression
 * posture), and the skill is proven wired in ISOLATION (present ≠ observable) by a
 * {@link selectSkill}(47) boundary unit + a direct clear-and-clone apply unit, NOT by a
 * shipped-fight cast.
 *
 * WHY Posture-B (not an in-pool surface): like Purify/Purge/Purloin/Displace, Reclaim is a
 * NON-damaging UTILITY skill whose payoff (clearing the caster's OWN debuffs + backfiring the
 * SAME kinds onto the foe) only matters when the caster actually carries a harmful debuff;
 * casting it greedily at full energy would spend a zero-damage turn and starve the
 * marginally-winnable numemon fight exactly like the pure-control Lullaby Hex hazard (TASK-60).
 * Its behaviour is fully verifiable in isolation, so it need not co-star in the shipped fight.
 * Placed at the new ladder TOP (above `displace`@46); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const RECLAIM_ENERGY_COST = 47;

/**
 * TASK-81 (R-17c, 30th combat wave) — the SIXTH status-REMOVAL/transfer carrier and the
 * FIRST RAW ARM-BY-ARM DEEP-COPY self→foe DEBUFF TRANSFER: Reclaim-Deep / "Rebound" (the
 * A-69 refinement of Backfire). Where Backfire (`reclaim`@47) re-BREWS each cleared KIND
 * fresh via {@link applyAilment} — a half-burned `burn` re-applies at FULL canonical
 * duration; a ramped `corrode` resets to `CORRODE_INITIAL_DAMAGE` — Rebound MOVES the
 * caster's ACTUAL harmful debuff ARMS onto the foe, each with its EXACT remaining
 * `turnsRemaining`/`damagePerTurn`/`ramp`, via a per-arm `{ ...arm }` deep-copy. It REUSES
 * {@link CLEANSABLE_DEBUFF_KINDS} verbatim to identify the harmful arms and
 * {@link clearDebuffs} verbatim to strip them off the caster; the only NEW logic is the pure
 * structural deep-copy of the captured arms appended to the foe (de-duped by kind,
 * refresh-not-stack) — NO new allow-set, NO new StatusAilment arm, NO AILMENT_SPEC/tick slot.
 *
 * Priced at 48 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46),
 * {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`, and every
 * fight-local pool is capped at MAX_ENERGY, `reclaim-deep` is NEVER the pick inside
 * {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune — the safest regression posture), and the skill is
 * proven wired in ISOLATION (present ≠ observable) by a {@link selectSkill}(48) boundary unit
 * + a direct clear-and-deep-copy apply unit, NOT by a shipped-fight cast. It writes NO HP
 * (trims the caster's array + appends deep-copied arms to the foe's, both HP-neutral at cast;
 * the moved DoTs/stat-mods tick via the EXISTING per-turn seam), so HP stays monotonically
 * non-increasing (A-42). Placed at the new ladder TOP (above `reclaim`@47); it never fires
 * in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay
 * BYTE-UNCHANGED.
 */
export const REBOUND_ENERGY_COST = 48;

/**
 * TASK-82 (R-17c, 31st combat wave) — the SEVENTH status-REMOVAL/transfer carrier and the
 * FIRST PERCENTAGE/PARTIAL-DURATION self→foe DEBUFF TRANSFER: Reclaim-Partial / "Rebound-Lite"
 * (the A-70 refinement of Rebound). Where Rebound (`reclaim-deep`@48) MOVES each captured arm
 * at its FULL current `turnsRemaining` (a `burn`@turnsRemaining:4 arrives on the foe at 4),
 * Rebound-Lite moves each captured arm at a HALVED remaining duration
 * (`turnsRemaining → max(1, ceil(turnsRemaining * REBOUND_PARTIAL_RATIO))`, so `burn`@4 → foe
 * `burn`@2; a `burn`@1 stays 1 by the floor) while PRESERVING each arm's
 * `damagePerTurn`/`ramp`. It REUSES {@link CLEANSABLE_DEBUFF_KINDS} verbatim to identify the
 * harmful arms and {@link clearDebuffs} verbatim to strip them off the caster; the only NEW
 * logic is the per-arm `{ ...arm, turnsRemaining: partialTurns }` duration-halving deep-copy
 * appended to the foe (de-duped by kind, refresh-not-stack) — NO new allow-set, NO new
 * StatusAilment arm, NO AILMENT_SPEC/tick slot. It generalizes the family from "transfer the
 * ARMS verbatim" (Rebound) to "transfer the ARMS at a FRACTION of their duration" — the "widen
 * the FIDELITY of the payload, never the loop" idiom, the substrate a future percentage-drain/
 * steal or subset-of-kinds variant reuses.
 *
 * Priced at 49 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47),
 * {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST} (45),
 * {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY,
 * `reclaim-partial` is NEVER the pick inside {@link simulateBattle}. So the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune — the
 * safest regression posture), and the skill is proven wired in ISOLATION (present ≠ observable)
 * by a {@link selectSkill}(49) boundary unit + a direct clear-and-partial-copy apply unit, NOT
 * by a shipped-fight cast. It writes NO HP (trims the caster's array + appends duration-halved
 * deep-copied arms to the foe's, both HP-neutral at cast; the moved DoTs/stat-mods tick via the
 * EXISTING per-turn seam, and HALVING a foe DoT only ever SHORTENS the fight — no
 * MAX_ROUNDS-lengthening hazard), so HP stays monotonically non-increasing (A-42). Placed at
 * the new ladder TOP (above `reclaim-deep`@48); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_LITE_ENERGY_COST = 49;

/**
 * The FIXED, DETERMINISTIC fraction of a transferred debuff arm's remaining duration that
 * Rebound-Lite (`reclaim-partial`) moves onto the foe (TASK-82). `0.5` — each captured arm's
 * `turnsRemaining` is halved via `max(1, ceil(turnsRemaining * REBOUND_PARTIAL_RATIO))` (a
 * floor-at-1 so a 1-turn debuff still transfers as 1, never 0). RNG-free (a fixed fraction),
 * so the transfer stays fully deterministic and unit-testable. This is the ONE knob a future
 * percentage-transfer variant re-tunes.
 */
export const REBOUND_PARTIAL_RATIO = 0.5;

/**
 * TASK-83 (R-17c, 32nd combat wave) — Rebound-Split's (`reclaim-subset`) energy cost, the
 * EIGHTH status-REMOVAL/transfer carrier and the FIRST SUBSET-OF-KINDS self→foe DEBUFF
 * TRANSFER. Where Rebound (`reclaim-deep`@48) moves the caster's WHOLE cleansable set,
 * Rebound-Split moves ONLY the arms whose kind is in {@link REBOUND_SPLIT_KINDS} (the DoT
 * subset) at FULL duration and LEAVES the caster's other debuffs behind — the "widen the SET
 * SELECTIVITY, never the loop" axis.
 *
 * Priced at 50 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_LITE_ENERGY_COST} (49), {@link REBOUND_ENERGY_COST} (48),
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46),
 * {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`, and every
 * fight-local pool is capped at MAX_ENERGY, `reclaim-subset` is NEVER the pick inside
 * {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(50) boundary unit + a direct subset clear-and-transfer apply unit. It
 * writes NO HP (trims the caster's subset arms + appends full-duration deep-copied arms to
 * the foe, both HP-neutral at cast; the moved DoTs tick via the EXISTING per-turn seam, and
 * transferring FEWER/EQUAL DoTs never LENGTHENS the fight — no MAX_ROUNDS hazard), so HP
 * stays monotonically non-increasing (A-42). Placed at the new ladder TOP (above
 * `reclaim-partial`@49); it never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN /
 * MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_SPLIT_ENERGY_COST = 50;

/**
 * TASK-84 (R-17c, 33rd combat wave) — Rebound-Snap's (`reclaim-stats`) energy cost, the
 * NINTH status-REMOVAL/transfer carrier and the SECOND SUBSET-OF-KINDS self→foe DEBUFF
 * TRANSFER. Where Rebound-Split (`reclaim-subset`@50) moves the caster's DoT subset
 * ({@link REBOUND_SPLIT_KINDS}), Rebound-Snap moves ONLY the arms whose kind is in
 * {@link REBOUND_SNAP_KINDS} (the STAT-MOD subset `weaken`/`enfeeble`/`vulnerable` — DISJOINT
 * from the DoT subset) at FULL duration and LEAVES the caster's DoTs/control-locks/self-buffs
 * behind — the "widen the SET SELECTIVITY, never the loop" axis along a DISJOINT axis.
 *
 * Priced at 51 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_SPLIT_ENERGY_COST} (50), {@link REBOUND_LITE_ENERGY_COST} (49),
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47),
 * {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST} (45),
 * {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY,
 * `reclaim-stats` is NEVER the pick inside {@link simulateBattle}. So the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune), and
 * the skill is proven wired in ISOLATION by a {@link selectSkill}(51) boundary unit + a direct
 * subset clear-and-transfer apply unit. It writes NO HP (trims the caster's stat-mod arms +
 * appends full-duration deep-copied arms to the foe, both HP-neutral at cast; the moved arms
 * are STAT-MODS — pure modifiers that never tick HP — so there is ZERO MAX_ROUNDS hazard even
 * in principle), so HP stays monotonically non-increasing (A-42). Placed at the new ladder TOP
 * (above `reclaim-subset`@50); it never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN /
 * MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_SNAP_ENERGY_COST = 51;

/**
 * TASK-85 (R-17c, 34th combat wave) — Rebound-Lock's (`reclaim-locks`) energy cost, the
 * TENTH status-REMOVAL/transfer carrier and the THIRD (and final natural) SUBSET-OF-KINDS
 * self→foe DEBUFF TRANSFER. Where Rebound-Split (`reclaim-subset`@50) moves the caster's DoT
 * subset ({@link REBOUND_SPLIT_KINDS}) and Rebound-Snap (`reclaim-stats`@51) moves the STAT-MOD
 * subset ({@link REBOUND_SNAP_KINDS}), Rebound-Lock moves ONLY the arms whose kind is in
 * {@link REBOUND_LOCK_KINDS} (the CONTROL-LOCK subset `stun`/`freeze`/`sleep` — DISJOINT from
 * BOTH the DoT and stat-mod subsets) at FULL duration and LEAVES the caster's DoTs/stat-mods/
 * self-buffs behind. The three subsets are pairwise DISJOINT and PARTITION the harmful
 * non-`doom` families — CLOSING the subset-of-kinds axis.
 *
 * Priced at 52 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_SNAP_ENERGY_COST} (51), {@link REBOUND_SPLIT_ENERGY_COST} (50),
 * {@link REBOUND_LITE_ENERGY_COST} (49), {@link REBOUND_ENERGY_COST} (48),
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46),
 * {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because
 * {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`,
 * and every fight-local pool is capped at MAX_ENERGY, `reclaim-locks` is NEVER the pick inside
 * {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(52) boundary unit + a direct subset clear-and-transfer apply unit. It
 * writes NO HP (trims the caster's control-lock arms + appends full-duration deep-copied arms
 * to the foe, both HP-neutral at cast; the moved arms are CONTROL-LOCKS — turn-skip modifiers
 * that never tick HP — so there is ZERO MAX_ROUNDS hazard even in principle), so HP stays
 * monotonically non-increasing (A-42). Placed at the new ladder TOP (above `reclaim-stats`@51);
 * it never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill
 * costs stay BYTE-UNCHANGED.
 */
export const REBOUND_LOCK_ENERGY_COST = 52;

/**
 * TASK-86 (R-17c, 35th combat wave) — Rebound-Doom's (`reclaim-doom`) energy cost, the
 * ELEVENTH status-REMOVAL/transfer carrier and the FOURTH (and final) SUBSET-OF-KINDS
 * self→foe DEBUFF TRANSFER. Where Rebound-Split (`reclaim-subset`@50) moves the caster's DoT
 * subset, Rebound-Snap (`reclaim-stats`@51) the STAT-MOD subset and Rebound-Lock
 * (`reclaim-locks`@52) the CONTROL-LOCK subset, Rebound-Doom moves ONLY the arm whose kind is
 * in {@link REBOUND_DOOM_KINDS} (the single deferred-detonation `doom` kind — a strict subset
 * of {@link CLEANSABLE_DEBUFF_KINDS}, DISJOINT from all three other subsets) at FULL duration
 * (preserving `turnsRemaining` + `detonationDamage`) and LEAVES the caster's DoTs/stat-mods/
 * control-locks and self-buffs behind. This CLOSES the subset-of-kinds axis: the four subsets
 * are pairwise DISJOINT and together PARTITION the full cleansable set.
 *
 * Priced at 53 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_LOCK_ENERGY_COST} (52), {@link REBOUND_SNAP_ENERGY_COST} (51),
 * {@link REBOUND_SPLIT_ENERGY_COST} (50), {@link REBOUND_LITE_ENERGY_COST} (49),
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47),
 * {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST} (45),
 * {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY,
 * `reclaim-doom` is NEVER the pick inside {@link simulateBattle}. So the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune), and the
 * skill is proven wired in ISOLATION by a {@link selectSkill}(53) boundary unit + a direct
 * subset clear-and-transfer apply unit. It writes NO HP at cast (trims the caster's `doom` arm
 * + appends a full-duration deep-copied `doom` arm to the foe, both HP-neutral at cast; the
 * moved `doom` detonates LATER via the EXISTING monotone `Math.max(0, hp - burst)` seam, and
 * in Posture-B it never fires in-sim), so HP stays monotonically non-increasing (A-42). Placed
 * at the new ladder TOP (above `reclaim-locks`@52); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_DOOM_ENERGY_COST = 53;

/**
 * TASK-87 (R-17c, 36th combat wave) — Rebound-Blight's (`reclaim-blight`) energy cost, the
 * TWELFTH status-REMOVAL/transfer carrier and the FIRST MULTI-FAMILY (PAIR/UNION)
 * SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. Where Rebound-Split (`reclaim-subset`@50) moves
 * the DoT subset, Rebound-Snap (`reclaim-stats`@51) the STAT-MOD subset, Rebound-Lock
 * (`reclaim-locks`@52) the CONTROL-LOCK subset and Rebound-Doom (`reclaim-doom`@53) the
 * `doom` subset (each ONE disjoint family), Rebound-Blight moves the UNION of TWO families —
 * the arms whose kind is in {@link REBOUND_BLIGHT_KINDS} (the DoTs AND the control-locks,
 * = `REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS`) at FULL duration — and LEAVES the caster's
 * stat-mods and `doom` behind. It OPENS the MULTI-FAMILY (union) selectivity axis: the FIRST
 * non-singleton kind-set fed to {@link clearKinds}.
 *
 * Priced at 54 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_DOOM_ENERGY_COST} (53), {@link REBOUND_LOCK_ENERGY_COST} (52),
 * {@link REBOUND_SNAP_ENERGY_COST} (51), {@link REBOUND_SPLIT_ENERGY_COST} (50),
 * {@link REBOUND_LITE_ENERGY_COST} (49), {@link REBOUND_ENERGY_COST} (48),
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46),
 * {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because
 * {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`,
 * and every fight-local pool is capped at MAX_ENERGY, `reclaim-blight` is NEVER the pick
 * inside {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(54) boundary unit + a direct subset clear-and-transfer apply unit. It
 * writes NO HP at cast (trims the caster's DoT+lock arms + appends full-duration deep-copied
 * arms to the foe, both HP-neutral at cast; the moved DoTs tick LATER via the EXISTING
 * monotone `Math.max(0, hp - damagePerTurn)` seam, the moved locks write no HP, and in
 * Posture-B it never fires in-sim), so HP stays monotonically non-increasing (A-42). Placed
 * at the new ladder TOP (above `reclaim-doom`@53); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_BLIGHT_ENERGY_COST = 54;

/**
 * TASK-88 (R-17c, 37th combat wave) — Rebound-Cripple's (`reclaim-cripple`) energy cost, the
 * THIRTEENTH status-REMOVAL/transfer carrier and the SECOND MULTI-FAMILY (PAIR/UNION)
 * SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. Where Rebound-Blight (`reclaim-blight`@54) moves
 * the {DoT ∪ control-lock} union, Rebound-Cripple moves the COMPLEMENTARY {stat-mod ∪
 * control-lock} union — the arms whose kind is in {@link REBOUND_CRIPPLE_KINDS}
 * (= `REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS`) at FULL duration — and LEAVES the caster's
 * DoTs and `doom` behind. It CONTINUES the MULTI-FAMILY (union) selectivity axis: the SECOND
 * non-singleton kind-set fed to {@link clearKinds}, proving the helper handles ARBITRARY
 * multi-family sets.
 *
 * Priced at 55 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_BLIGHT_ENERGY_COST} (54), {@link REBOUND_DOOM_ENERGY_COST} (53),
 * {@link REBOUND_LOCK_ENERGY_COST} (52), {@link REBOUND_SNAP_ENERGY_COST} (51),
 * {@link REBOUND_SPLIT_ENERGY_COST} (50), {@link REBOUND_LITE_ENERGY_COST} (49),
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47),
 * {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST} (45),
 * {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY,
 * `reclaim-cripple` is NEVER the pick inside {@link simulateBattle}. So the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune), and
 * the skill is proven wired in ISOLATION by a {@link selectSkill}(55) boundary unit + a direct
 * subset clear-and-transfer apply unit. It writes NO HP at cast (trims the caster's stat-mod +
 * lock arms + appends full-duration deep-copied arms to the foe, both HP-neutral at cast;
 * NEITHER moved family ticks HP — stat-mods only scale damage, control-locks only skip turns —
 * so unlike Blight there is not even a deferred DoT, and in Posture-B it never fires in-sim),
 * so HP stays monotonically non-increasing (A-42). Placed at the new ladder TOP (above
 * `reclaim-blight`@54); it never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN /
 * MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_CRIPPLE_ENERGY_COST = 55;

/**
 * TASK-89 (R-17c, 38th combat wave) — Rebound-Sear's (`reclaim-sear`) energy cost, the
 * FOURTEENTH status-REMOVAL/transfer carrier and the THIRD MULTI-FAMILY (PAIR/UNION)
 * SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. Where Rebound-Blight (`reclaim-blight`@54) moves
 * the {DoT ∪ control-lock} union and Rebound-Cripple (`reclaim-cripple`@55) moves the
 * {stat-mod ∪ control-lock} union (both share the locks), Rebound-Sear moves the {DoT ∪
 * stat-mod} union — the arms whose kind is in {@link REBOUND_SEAR_KINDS} (= `REBOUND_SPLIT_KINDS
 * ∪ REBOUND_SNAP_KINDS`) at FULL duration — the FIRST union NOT containing the control-locks,
 * and LEAVES the caster's control-locks (`stun`/`freeze`/`sleep`) and `doom` behind. It
 * CONTINUES the MULTI-FAMILY (union) selectivity axis: the THIRD non-singleton kind-set fed
 * to {@link clearKinds}, proving the helper handles ARBITRARY multi-family sets.
 *
 * Priced at 56 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_CRIPPLE_ENERGY_COST} (55), {@link REBOUND_BLIGHT_ENERGY_COST} (54),
 * {@link REBOUND_DOOM_ENERGY_COST} (53), {@link REBOUND_LOCK_ENERGY_COST} (52),
 * {@link REBOUND_SNAP_ENERGY_COST} (51), {@link REBOUND_SPLIT_ENERGY_COST} (50),
 * {@link REBOUND_LITE_ENERGY_COST} (49), {@link REBOUND_ENERGY_COST} (48),
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46),
 * {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because
 * {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`,
 * and every fight-local pool is capped at MAX_ENERGY, `reclaim-sear` is NEVER the pick inside
 * {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(56) boundary unit + a direct subset clear-and-transfer apply unit. It
 * writes NO HP at cast (trims the caster's DoT + stat-mod arms + appends full-duration
 * deep-copied arms to the foe, both HP-neutral at cast; the moved DoTs would tick foe HP only
 * via the existing DoT seams IF cast — deferred foe HP loss, still monotonically
 * non-increasing, exactly as Blight; in Posture-B it never fires in-sim), so HP stays
 * monotonically non-increasing (A-42). Placed at the new ladder TOP (above `reclaim-cripple`@55);
 * it never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill
 * costs stay BYTE-UNCHANGED.
 */
export const REBOUND_SEAR_ENERGY_COST = 56;

/**
 * TASK-90 (R-17c, 39th combat wave) — Rebound-Doomburn's (`reclaim-doomburn`) energy cost,
 * the FIFTEENTH status-REMOVAL/transfer carrier and the FOURTH MULTI-FAMILY (PAIR/UNION)
 * SUBSET-OF-KINDS self→foe DEBUFF TRANSFER — the FIRST union CONTAINING `doom`. Where
 * Rebound-Blight (`reclaim-blight`@54) moves {DoT ∪ control-lock}, Rebound-Cripple
 * (`reclaim-cripple`@55) moves {stat-mod ∪ control-lock} and Rebound-Sear (`reclaim-sear`@56)
 * moves {DoT ∪ stat-mod} — all EXCLUDING `doom` — Rebound-Doomburn moves the {DoT ∪ `doom`}
 * union — the arms whose kind is in {@link REBOUND_DOOMBURN_KINDS} (= `REBOUND_SPLIT_KINDS ∪
 * REBOUND_DOOM_KINDS`) at FULL duration — and LEAVES the caster's stat-mods
 * (`weaken`/`enfeeble`/`vulnerable`) and control-locks (`stun`/`freeze`/`sleep`) behind. It
 * CONTINUES the MULTI-FAMILY (union) selectivity axis: the FOURTH non-singleton kind-set fed
 * to {@link clearKinds}, and the FIRST including `doom`, proving the helper handles ARBITRARY
 * multi-family sets.
 *
 * Priced at 57 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_SEAR_ENERGY_COST} (56), {@link REBOUND_CRIPPLE_ENERGY_COST} (55),
 * {@link REBOUND_BLIGHT_ENERGY_COST} (54), {@link REBOUND_DOOM_ENERGY_COST} (53),
 * {@link REBOUND_LOCK_ENERGY_COST} (52), {@link REBOUND_SNAP_ENERGY_COST} (51),
 * {@link REBOUND_SPLIT_ENERGY_COST} (50), {@link REBOUND_LITE_ENERGY_COST} (49),
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47),
 * {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST} (45),
 * {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED
 * posture (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill
 * whose `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY,
 * `reclaim-doomburn` is NEVER the pick inside {@link simulateBattle}. So the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune), and the
 * skill is proven wired in ISOLATION by a {@link selectSkill}(57) boundary unit + a direct
 * subset clear-and-transfer apply unit. It writes NO HP at cast (trims the caster's DoT +
 * `doom` arms + appends full-duration deep-copied arms to the foe, both HP-neutral at cast; the
 * moved DoTs would tick foe HP + `doom` would fire only via the existing seams IF cast —
 * deferred foe HP loss, still monotonically non-increasing, exactly as Blight; in Posture-B it
 * never fires in-sim), so HP stays monotonically non-increasing (A-42). Placed at the new
 * ladder TOP (above `reclaim-sear`@56); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_DOOMBURN_ENERGY_COST = 57;

/**
 * TASK-91 (R-17c, 40th combat wave) — Rebound-Snapdoom's (`reclaim-snapdoom`) energy cost,
 * the SIXTEENTH status-REMOVAL/transfer carrier and the FIFTH MULTI-FAMILY (PAIR/UNION)
 * SUBSET-OF-KINDS self→foe DEBUFF TRANSFER — the SECOND union CONTAINING `doom`. Where
 * Rebound-Blight (`reclaim-blight`@54) moves {DoT ∪ control-lock}, Rebound-Cripple
 * (`reclaim-cripple`@55) moves {stat-mod ∪ control-lock}, Rebound-Sear (`reclaim-sear`@56)
 * moves {DoT ∪ stat-mod} — all EXCLUDING `doom` — and Rebound-Doomburn (`reclaim-doomburn`@57)
 * moves {DoT ∪ `doom`}, Rebound-Snapdoom moves the {stat-mod ∪ `doom`} union — the arms whose
 * kind is in {@link REBOUND_SNAPDOOM_KINDS} (= `REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS`) at
 * FULL duration — and LEAVES the caster's DoTs (`burn`/`poison`/`bleed`/`corrode`) and
 * control-locks (`stun`/`freeze`/`sleep`) behind. It CONTINUES the MULTI-FAMILY (union)
 * selectivity axis: the FIFTH non-singleton kind-set fed to {@link clearKinds}, and the SECOND
 * including `doom`, proving the helper handles ARBITRARY multi-family sets.
 *
 * Priced at 58 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_DOOMBURN_ENERGY_COST} (57), {@link REBOUND_SEAR_ENERGY_COST} (56),
 * {@link REBOUND_CRIPPLE_ENERGY_COST} (55), {@link REBOUND_BLIGHT_ENERGY_COST} (54),
 * {@link REBOUND_DOOM_ENERGY_COST} (53), {@link REBOUND_LOCK_ENERGY_COST} (52),
 * {@link REBOUND_SNAP_ENERGY_COST} (51), {@link REBOUND_SPLIT_ENERGY_COST} (50),
 * {@link REBOUND_LITE_ENERGY_COST} (49), {@link REBOUND_ENERGY_COST} (48),
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46),
 * {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`, and every
 * fight-local pool is capped at MAX_ENERGY, `reclaim-snapdoom` is NEVER the pick inside
 * {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(58) boundary unit + a direct subset clear-and-transfer apply unit. It
 * writes NO HP at cast (trims the caster's stat-mod + `doom` arms + appends full-duration
 * deep-copied arms to the foe, both HP-neutral at cast; the moved `doom` would fire only via
 * the existing seam IF cast — deferred foe HP loss, still monotonically non-increasing,
 * exactly as Doomburn; in Posture-B it never fires in-sim), so HP stays monotonically
 * non-increasing (A-42). Placed at the new ladder TOP (above `reclaim-doomburn`@57); it never
 * fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay
 * BYTE-UNCHANGED.
 */
export const REBOUND_SNAPDOOM_ENERGY_COST = 58;

/**
 * TASK-92 (R-17c, 41st combat wave) — Rebound-Doomlock's (`reclaim-doomlock`) energy cost,
 * the SEVENTEENTH status-REMOVAL/transfer carrier and the SIXTH (and FINAL) MULTI-FAMILY
 * (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER — the THIRD (and last) union CONTAINING
 * `doom`. Where Rebound-Blight (`reclaim-blight`@54) moves {DoT ∪ control-lock}, Rebound-Cripple
 * (`reclaim-cripple`@55) moves {stat-mod ∪ control-lock}, Rebound-Sear (`reclaim-sear`@56) moves
 * {DoT ∪ stat-mod}, Rebound-Doomburn (`reclaim-doomburn`@57) moves {DoT ∪ `doom`} and
 * Rebound-Snapdoom (`reclaim-snapdoom`@58) moves {stat-mod ∪ `doom`}, Rebound-Doomlock moves the
 * {control-lock ∪ `doom`} union — the arms whose kind is in {@link REBOUND_DOOMLOCK_KINDS} (=
 * `REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS`) at FULL duration — and LEAVES the caster's DoTs
 * (`burn`/`poison`/`bleed`/`corrode`) and stat-mods (`weaken`/`enfeeble`/`vulnerable`) behind. It
 * CLOSES the MULTI-FAMILY (union) selectivity axis: the SIXTH (and last) non-singleton kind-set
 * fed to {@link clearKinds}, and the THIRD including `doom`, proving the helper handles ARBITRARY
 * multi-family sets INCLUDING every `doom`-union.
 *
 * Priced at 59 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_SNAPDOOM_ENERGY_COST} (58), {@link REBOUND_DOOMBURN_ENERGY_COST} (57),
 * {@link REBOUND_SEAR_ENERGY_COST} (56), {@link REBOUND_CRIPPLE_ENERGY_COST} (55),
 * {@link REBOUND_BLIGHT_ENERGY_COST} (54), {@link REBOUND_DOOM_ENERGY_COST} (53),
 * {@link REBOUND_LOCK_ENERGY_COST} (52), {@link REBOUND_SNAP_ENERGY_COST} (51),
 * {@link REBOUND_SPLIT_ENERGY_COST} (50), {@link REBOUND_LITE_ENERGY_COST} (49),
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47),
 * {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST} (45),
 * {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED posture
 * (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose
 * `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY, `reclaim-doomlock` is
 * NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon
 * fights stay BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(59) boundary unit + a direct subset clear-and-transfer apply unit. It writes
 * NO HP at cast (trims the caster's control-lock + `doom` arms + appends full-duration deep-copied
 * arms to the foe, both HP-neutral at cast; the moved `doom` would fire only via the existing seam
 * IF cast — deferred foe HP loss, still monotonically non-increasing, exactly as Doomburn/Snapdoom;
 * in Posture-B it never fires in-sim), so HP stays monotonically non-increasing (A-42). Placed at
 * the new ladder TOP (above `reclaim-snapdoom`@58); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_DOOMLOCK_ENERGY_COST = 59;

/**
 * TASK-93 (R-17c, 42nd combat wave) — Rebound-Purge's (`reclaim-purge`) energy cost, the
 * EIGHTEENTH status-REMOVAL/transfer carrier and the FIRST 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS
 * self→foe DEBUFF TRANSFER — OPENING the 3-of-4 selectivity DEPTH. Where the singletons move ONE
 * family and the six 2-of-4 unions (Blight@54…Doomlock@59) each move a PAIR, Rebound-Purge moves
 * the union of THREE families — the arms whose kind is in {@link REBOUND_PURGE_KINDS} (=
 * `REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS` = "everything but `doom`") at
 * FULL duration — and LEAVES ONLY the caster's `doom` arm (and its self-buffs) behind. It is the
 * SEVENTH non-singleton kind-set fed to {@link clearKinds} and the FIRST 3-family set, proving the
 * TASK-83 generalization handles an arbitrary 3-of-4 kind-set.
 *
 * Priced at 60 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_DOOMLOCK_ENERGY_COST} (59), {@link REBOUND_SNAPDOOM_ENERGY_COST} (58),
 * {@link REBOUND_DOOMBURN_ENERGY_COST} (57), {@link REBOUND_SEAR_ENERGY_COST} (56),
 * {@link REBOUND_CRIPPLE_ENERGY_COST} (55), {@link REBOUND_BLIGHT_ENERGY_COST} (54),
 * {@link REBOUND_DOOM_ENERGY_COST} (53), {@link REBOUND_LOCK_ENERGY_COST} (52),
 * {@link REBOUND_SNAP_ENERGY_COST} (51), {@link REBOUND_SPLIT_ENERGY_COST} (50),
 * {@link REBOUND_LITE_ENERGY_COST} (49), {@link REBOUND_ENERGY_COST} (48),
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46),
 * {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`, and every fight-local
 * pool is capped at MAX_ENERGY, `reclaim-purge` is NEVER the pick inside {@link simulateBattle}. So
 * the shipped win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder re-tune),
 * and the skill is proven wired in ISOLATION by a {@link selectSkill}(60) boundary unit + a direct
 * subset clear-and-transfer apply unit. It writes NO HP at cast (trims the caster's DoT + stat-mod
 * + control-lock arms + appends full-duration deep-copied arms to the foe, both HP-neutral at cast;
 * the moved DoTs would tick via the existing `Math.max(0, hp − X)` seam on the FOE only IF cast —
 * deferred foe HP loss, still monotonically non-increasing; in Posture-B it never fires in-sim), so
 * HP stays monotonically non-increasing (A-42). Placed at the new ladder TOP (above
 * `reclaim-doomlock`@59); it never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS
 * and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_PURGE_ENERGY_COST = 60;

/**
 * TASK-94 (R-17c, 43rd combat wave) — Rebound-Seardoom's (`reclaim-seardoom`) energy cost, the
 * NINETEENTH status-REMOVAL/transfer carrier and the SECOND 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS
 * self→foe DEBUFF TRANSFER (and the FIRST 3-of-4 union that INCLUDES `doom`) — ADVANCING the 3-of-4
 * selectivity DEPTH that Rebound-Purge@60 opened. Where the singletons move ONE family, the six
 * 2-of-4 unions (Blight@54…Doomlock@59) each move a PAIR, and Rebound-Purge@60 moves the
 * "everything-but-doom" triple, Rebound-Seardoom moves the DIFFERENT triple — the arms whose kind
 * is in {@link REBOUND_SEARDOOM_KINDS} (= `REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪
 * REBOUND_DOOM_KINDS` = "everything but the CONTROL-LOCKS") at FULL duration — and LEAVES ONLY the
 * caster's control-lock arms (and its self-buffs) behind. It is the EIGHTH non-singleton kind-set
 * fed to {@link clearKinds} and the SECOND 3-family set, proving the TASK-83 generalization handles
 * a doom-including 3-of-4 kind-set.
 *
 * Priced at 61 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_PURGE_ENERGY_COST} (60), {@link REBOUND_DOOMLOCK_ENERGY_COST} (59),
 * {@link REBOUND_SNAPDOOM_ENERGY_COST} (58), {@link REBOUND_DOOMBURN_ENERGY_COST} (57),
 * {@link REBOUND_SEAR_ENERGY_COST} (56), {@link REBOUND_CRIPPLE_ENERGY_COST} (55),
 * {@link REBOUND_BLIGHT_ENERGY_COST} (54), {@link REBOUND_DOOM_ENERGY_COST} (53),
 * {@link REBOUND_LOCK_ENERGY_COST} (52), {@link REBOUND_SNAP_ENERGY_COST} (51),
 * {@link REBOUND_SPLIT_ENERGY_COST} (50), {@link REBOUND_LITE_ENERGY_COST} (49),
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST}
 * (46), {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`, and every fight-local
 * pool is capped at MAX_ENERGY, `reclaim-seardoom` is NEVER the pick inside {@link simulateBattle}.
 * So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder
 * re-tune), and the skill is proven wired in ISOLATION by a {@link selectSkill}(61) boundary unit +
 * a direct subset clear-and-transfer apply unit. It writes NO HP at cast (trims the caster's DoT +
 * stat-mod + `doom` arms + appends full-duration deep-copied arms to the foe, both HP-neutral at
 * cast; the moved DoTs would tick + the moved `doom` detonate via the existing seams on the FOE
 * only IF cast — deferred foe HP loss, still monotonically non-increasing; in Posture-B it never
 * fires in-sim), so HP stays monotonically non-increasing (A-42). Placed at the new ladder TOP
 * (above `reclaim-purge`@60); it never fires in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS
 * and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_SEARDOOM_ENERGY_COST = 61;

/**
 * TASK-95 (R-17c, 44th combat wave) — Rebound-Blightdoom's (`reclaim-blightdoom`) energy cost, the
 * TWENTIETH status-REMOVAL/transfer carrier and the THIRD 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS
 * self→foe DEBUFF TRANSFER (and the SECOND 3-of-4 union that INCLUDES `doom`) — ADVANCING the 3-of-4
 * selectivity DEPTH that Rebound-Purge@60 opened and Rebound-Seardoom@61 advanced. Where the
 * singletons move ONE family, the six 2-of-4 unions (Blight@54…Doomlock@59) each move a PAIR,
 * Rebound-Purge@60 moves the "everything-but-doom" triple and Rebound-Seardoom@61 the
 * "everything-but-control-locks" triple, Rebound-Blightdoom moves the DIFFERENT triple — the arms
 * whose kind is in {@link REBOUND_BLIGHTDOOM_KINDS} (= `REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS ∪
 * REBOUND_DOOM_KINDS` = "everything but the STAT-MODS") at FULL duration — and LEAVES ONLY the
 * caster's stat-mod arms (and its self-buffs) behind. It is the NINTH non-singleton kind-set fed to
 * {@link clearKinds} and the THIRD 3-family set, proving the TASK-83 generalization handles a
 * doom-including 3-of-4 kind-set — the MIRROR of Seardoom across the stat-mod/control-lock swap.
 *
 * Priced at 62 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_SEARDOOM_ENERGY_COST} (61), {@link REBOUND_PURGE_ENERGY_COST} (60),
 * {@link REBOUND_DOOMLOCK_ENERGY_COST} (59), {@link REBOUND_SNAPDOOM_ENERGY_COST} (58),
 * {@link REBOUND_DOOMBURN_ENERGY_COST} (57), {@link REBOUND_SEAR_ENERGY_COST} (56),
 * {@link REBOUND_CRIPPLE_ENERGY_COST} (55), {@link REBOUND_BLIGHT_ENERGY_COST} (54),
 * {@link REBOUND_DOOM_ENERGY_COST} (53), {@link REBOUND_LOCK_ENERGY_COST} (52),
 * {@link REBOUND_SNAP_ENERGY_COST} (51), {@link REBOUND_SPLIT_ENERGY_COST} (50),
 * {@link REBOUND_LITE_ENERGY_COST} (49), {@link REBOUND_ENERGY_COST} (48),
 * {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST} (46), {@link PURLOIN_ENERGY_COST}
 * (45), {@link DISPEL_ENERGY_COST} (44) and {@link CLEANSE_ENERGY_COST} (43) so the
 * {@link COMBATANT_SKILLS} ladder stays strictly cost-descending — the Posture-B DECOUPLED posture
 * (L-16 #7): because {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose
 * `energyCost ≤ energy`, and every fight-local pool is capped at MAX_ENERGY, `reclaim-blightdoom`
 * is NEVER the pick inside {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon
 * fights stay BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(62) boundary unit + a direct subset clear-and-transfer apply unit. It writes
 * NO HP at cast (trims the caster's DoT + control-lock + `doom` arms + appends full-duration
 * deep-copied arms to the foe, both HP-neutral at cast; the moved DoTs would tick + the moved `doom`
 * detonate via the existing seams on the FOE only IF cast — deferred foe HP loss, still
 * monotonically non-increasing; in Posture-B it never fires in-sim), so HP stays monotonically
 * non-increasing (A-42). Placed at the new ladder TOP (above `reclaim-seardoom`@61); it never fires
 * in-sim. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay
 * BYTE-UNCHANGED.
 */
export const REBOUND_BLIGHTDOOM_ENERGY_COST = 62;

/**
 * TASK-96 (R-17c, 45th combat wave) — Rebound-Snaplockdoom's (`reclaim-snaplockdoom`) energy cost,
 * the TWENTY-FIRST status-REMOVAL/transfer carrier and the FOURTH and LAST 3-of-4 MULTI-FAMILY
 * SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (and the THIRD 3-of-4 union that INCLUDES `doom`) —
 * CLOSING the 3-of-4 selectivity axis that Rebound-Purge@60 opened. Where the singletons move ONE
 * family, the six 2-of-4 unions (Blight@54…Doomlock@59) each move a PAIR, Rebound-Purge@60 moves the
 * "everything-but-doom" triple, Rebound-Seardoom@61 the "everything-but-control-locks" triple and
 * Rebound-Blightdoom@62 the "everything-but-stat-mods" triple, Rebound-Snaplockdoom moves the FINAL
 * triple — the arms whose kind is in {@link REBOUND_SNAPLOCKDOOM_KINDS} (= `REBOUND_SNAP_KINDS ∪
 * REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS` = "everything but the DoTs") at FULL duration — and
 * LEAVES ONLY the caster's DoT arms (and its self-buffs) behind. It is the TENTH non-singleton
 * kind-set fed to {@link clearKinds} and the FOURTH 3-family set, proving the TASK-83 generalization
 * handles every 3-of-4 kind-set — the ONLY 3-of-4 triple that EXCLUDES the DoTs.
 *
 * Priced at 63 — DELIBERATELY ABOVE {@link MAX_ENERGY} (41), and DISTINCT from
 * {@link REBOUND_BLIGHTDOOM_ENERGY_COST} (62), {@link REBOUND_SEARDOOM_ENERGY_COST} (61),
 * {@link REBOUND_PURGE_ENERGY_COST} (60), {@link REBOUND_DOOMLOCK_ENERGY_COST} (59),
 * {@link REBOUND_SNAPDOOM_ENERGY_COST} (58), {@link REBOUND_DOOMBURN_ENERGY_COST} (57),
 * {@link REBOUND_SEAR_ENERGY_COST} (56), {@link REBOUND_CRIPPLE_ENERGY_COST} (55),
 * {@link REBOUND_BLIGHT_ENERGY_COST} (54), {@link REBOUND_DOOM_ENERGY_COST} (53),
 * {@link REBOUND_LOCK_ENERGY_COST} (52), {@link REBOUND_SNAP_ENERGY_COST} (51),
 * {@link REBOUND_SPLIT_ENERGY_COST} (50), {@link REBOUND_LITE_ENERGY_COST} (49),
 * {@link REBOUND_ENERGY_COST} (48), {@link RECLAIM_ENERGY_COST} (47), {@link DISPLACE_ENERGY_COST}
 * (46), {@link PURLOIN_ENERGY_COST} (45), {@link DISPEL_ENERGY_COST} (44) and
 * {@link CLEANSE_ENERGY_COST} (43) so the {@link COMBATANT_SKILLS} ladder stays strictly
 * cost-descending — the Posture-B DECOUPLED posture (L-16 #7): because
 * {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy`, and
 * every fight-local pool is capped at MAX_ENERGY, `reclaim-snaplockdoom` is NEVER the pick inside
 * {@link simulateBattle}. So the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (ZERO ladder re-tune), and the skill is proven wired in ISOLATION by a
 * {@link selectSkill}(63) boundary unit + a direct subset clear-and-transfer apply unit. It writes
 * NO HP at cast (trims the caster's stat-mod + control-lock + `doom` arms + appends full-duration
 * deep-copied arms to the foe, both HP-neutral at cast; the moved `doom` detonates via the existing
 * seam on the FOE only IF cast — deferred foe HP loss, still monotonically non-increasing; in
 * Posture-B it never fires in-sim), so HP stays monotonically non-increasing (A-42). Placed at the
 * new ladder TOP (above `reclaim-blightdoom`@62); it never fires in-sim. MAX_ENERGY /
 * ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs stay BYTE-UNCHANGED.
 */
export const REBOUND_SNAPLOCKDOOM_ENERGY_COST = 63;

/**
 * TASK-63 (R-17c, 12th combat wave) — the FOURTH stat-modifier ailment (and the exact
 * OFFENSIVE-ATK MIRROR of Weaken's DEF-debuff / Empower's self-ATK-buff): Enfeeble, a
 * persistent NEGATIVE stat-modifier that LOWERS the afflicted attacker's effective ATK
 * by {@link ENFEEBLE_ATK_REDUCTION} while active (read off `me.statuses` at the damage
 * seam in {@link resolveDamageStrike}). Unlike Burn/Poison/Bleed it removes NO HP on
 * its tick; its damage-side payoff is that an ENFEEBLED foe's SUBSEQUENT attacks land
 * for visibly LESS. It is DEFENDER-targeted (applied to the OPPONENT), like Weaken:
 * the debuff is cast onto `them`, and when that enfeebled opponent takes its OWN turn
 * and attacks, its cut ATK is read off ITS statuses. Lasts this many of the afflicted
 * side's OWN turns.
 *
 * Tuned (duration 3 × a modest −6 ATK, mirroring Weaken's −6 DEF / Empower's +6 ATK)
 * so the shipped win-vs-numemon / loss-vs-kuwagamon outcomes STILL hold. NOTE the
 * directional hazard (GUARDRAIL 1): Enfeeble reduces the FOE's outgoing damage, which
 * HELPS the player — it could flip the loss-vs-kuwagamon fight or lengthen a fight
 * toward MAX_ROUNDS. Since Enfeeble removes no HP directly it cannot flip termination
 * the way a heal would (A-52 — Enfeeble over Heal keeps HP monotonically
 * non-increasing); the regression pair below is asserted to catch any drift.
 */
export const ENFEEBLE_DURATION = 3;

/**
 * How much an Enfeeble debuff lowers the afflicted attacker's effective ATK (TASK-63),
 * clamped at {@link MIN_EFFECTIVE_ATK} inside {@link resolveAttack}. Modest (−6,
 * mirroring Weaken's −6 DEF and Empower's +6 ATK) so the regression-tuned win/loss
 * outcomes hold — an enfeebled attacker deals a few LESS damage per hit, not zeroed.
 */
export const ENFEEBLE_ATK_REDUCTION = 6;

/**
 * Enfeeble Strike's energy cost (TASK-63). DISTINCT from every other costed skill —
 * Double Strike (24) / Lullaby Hex (21) / Guard (14) / Frost Bite (11) / Shock Strike
 * (9) / Focus (7) / Fire Breath (6) / Armor Break (5) / Bleed Strike (3) / Poison
 * Sting (2) — set at 8, slotting between Shock Strike (9) and Focus (7), so the
 * affordability ladder stays strictly cost-descending and ALL eleven existing skill
 * costs stay BYTE-UNCHANGED (no MAX_ENERGY / regen re-tune) — the safest regression
 * posture: the shipped win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL.
 *
 * WHY 8 and NOT a shipped-fight-surfacing slot (the honest reality, L-16 #6 — trace
 * re-derived from the FINAL constants): the greedy selectSkill sawtooth in a real fight
 * opens Double Strike (24) → Lullaby Hex (21) — draining the pool 41→0 — then settles
 * PERMANENTLY into the low {Armor Break (5) ↔ Bleed Strike (3)} band (regen 4), whose
 * decision energies are only {4, 5}. The steady-state pool NEVER climbs back to 8, so
 * cost 8 is a NON-surfacing in-pool tier — exactly like Shock Strike (9) / Focus (7) /
 * Fire Breath (6) / Frost Bite (11), which for the same reason are NOT asserted as
 * shipped-fight casts but proven via the {@link selectSkill} boundary + direct
 * applyAilment/resolveAttack unit tests. A brute-force stat scan confirmed NO combatant
 * matchup surfaces an 8-cost pick (Double Strike dominates any high pool; the low band
 * skips 8), so the observable Enfeeble PAYOFF is proven by driving `simulateBattle` past
 * an INJECTED enfeeble status + the pure resolveDamageStrike/resolveAttack cut, not by a
 * greedy shipped-fight cast. Cost 4 (== ENERGY_REGEN_PER_TURN) WAS rejected: it forms a
 * drain→regen→cast FIXED POINT that locks selection on Enfeeble Strike forever and
 * STARVES Bleed Strike / Armor Break out of the shipped fight (the documented
 * BLEED_STRIKE_ENERGY_COST degeneracy). Because `enfeeble-strike` is a DAMAGING
 * composite (`[damage, enfeeble]`, the armor-break/bleed-strike family) it deals its
 * damage half on cast, so it is SAFE mid-ladder without the pure-control starvation
 * hazard should a future re-tune ever surface it.
 */
export const ENFEEBLE_STRIKE_ENERGY_COST = 8;

/**
 * Sunder's (`enfeeble-percent`) ATK-reduction RATIO (TASK-101, R-17c 50th wave) — the FRACTION
 * of the target's CURRENT atk the percentage-Enfeeble removes as effective-ATK reduction (floored
 * to an integer, ADDED into the existing `atkReduction` local at the {@link resolveDamageStrike}
 * enfeeble-read seam). This is the fractional MIRROR of the FIXED {@link ENFEEBLE_ATK_REDUCTION} = 6
 * — the exact ATK-side twin of {@link WEAKEN_PERCENT_RATIO}'s DEF-side Crumble, EXTENDING the
 * percentage/fidelity axis onto the ATK-side of the STAT-MODIFIER family. 0.5 = "cut HALF the
 * target's CURRENT atk": a genuine magnitude-fidelity contrast with the fixed −6 — for an atk-30
 * attacker Sunder removes floor(15) = 15 (MORE than 6), for an atk-8 attacker floor(4) = 4 (LESS
 * than 6). It removes NO HP (an ATK debuff read at the attack seam), and {@link resolveAttack}
 * clamps effectiveAtk at {@link MIN_EFFECTIVE_ATK} + floors damage at ≥1, so even a huge reduction
 * can never invert the ATK term — HP-monotone (A-42) holds. The duration re-uses
 * {@link ENFEEBLE_DURATION} (a duration re-tune is NOT part of this wave). Naming/ratio A-88.
 */
export const ENFEEBLE_PERCENT_RATIO = 0.5;

/**
 * Sunder's energy cost (TASK-101) — priced 68, DELIBERATELY ABOVE {@link MAX_ENERGY} (41) and
 * DISTINCT from {@link WEAKEN_PERCENT_ENERGY_COST} (67) / {@link RETALIATE_PERCENT_ENERGY_COST}
 * (66) / {@link LEECH_PERCENT_ENERGY_COST} (65) / {@link SAP_PERCENT_ENERGY_COST} (64) and every
 * other above-pool cost, so it slots at the new strictly-cost-descending ladder TOP (above
 * `weaken-percent`@67). Posture-B DECOUPLED (L-16 #7): because {@link selectSkill}/
 * {@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy` and every fight-local
 * pool is capped at MAX_ENERGY, `enfeeble-percent` is NEVER the pick inside {@link simulateBattle}
 * — so the shipped win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL (ZERO ladder
 * re-tune, no top-of-ladder staller risk, TASK-60/L-22). The mechanic is proven wired in ISOLATION
 * by a {@link selectSkill}(68) boundary unit + a direct fixed-vs-percent ATK-cut CONTRAST unit + a
 * debuff-grant unit. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill costs
 * stay BYTE-UNCHANGED.
 */
export const ENFEEBLE_PERCENT_ENERGY_COST = 68;

/**
 * Reinforce's (`empower-percent`) ATK-BONUS RATIO (TASK-102, R-17c wave 51) — the FRACTION of the
 * caster's CURRENT atk the percentage-Empower ADDS to the caster's outgoing effective-ATK bonus
 * (floored to an integer, ADDED into the existing `atkBonus` local at the {@link resolveDamageStrike}
 * empower-read seam). This is the fractional MIRROR of the FIXED {@link EMPOWER_ATK_BONUS} = 6 — the
 * exact ATK-BONUS (SELF-BUFF) twin of the ATK-REDUCTION Sunder ({@link ENFEEBLE_PERCENT_RATIO}) and the
 * DEF-side Crumble ({@link WEAKEN_PERCENT_RATIO}), EXTENDING the percentage/fidelity axis onto the
 * ATK-BONUS side of the STAT-MODIFIER family. 0.5 = "gain HALF my CURRENT atk as ATK bonus": a genuine
 * magnitude-fidelity contrast with the fixed +6 — for an atk-30 caster Reinforce grants floor(15) = 15
 * (MORE than 6), for an atk-8 caster floor(4) = 4 (LESS than 6). It removes NO HP (an ATK-bonus self-buff
 * read at the attack seam only SHARPENS the caster's hits; A-42), and {@link resolveAttack} floors damage
 * at ≥1, so the larger bonus can never produce invalid damage. The duration re-uses {@link EMPOWER_DURATION}
 * (a duration re-tune is NOT part of this wave), exactly as `enfeeble-percent` re-uses ENFEEBLE_DURATION.
 * Naming/ratio A-89.
 */
export const EMPOWER_PERCENT_RATIO = 0.5;

/**
 * Reinforce's energy cost (TASK-102) — priced 69, DELIBERATELY ABOVE {@link MAX_ENERGY} (41) and
 * DISTINCT from {@link ENFEEBLE_PERCENT_ENERGY_COST} (68) / {@link WEAKEN_PERCENT_ENERGY_COST} (67) /
 * {@link RETALIATE_PERCENT_ENERGY_COST} (66) / {@link LEECH_PERCENT_ENERGY_COST} (65) /
 * {@link SAP_PERCENT_ENERGY_COST} (64) and every other above-pool cost, so it slots at the new
 * strictly-cost-descending ladder TOP (above `enfeeble-percent`@68). Posture-B DECOUPLED (L-16 #7):
 * because {@link selectSkill}/{@link chooseSkill} only ever pick a skill whose `energyCost ≤ energy` and
 * every fight-local pool is capped at MAX_ENERGY, `empower-percent` is NEVER the pick inside
 * {@link simulateBattle} — so the shipped win-vs-numemon / loss-vs-kuwagamon fights stay BYTE-IDENTICAL
 * (ZERO ladder re-tune, no top-of-ladder staller risk, TASK-60/L-22). The mechanic is proven wired in
 * ISOLATION by a {@link selectSkill}(69) boundary unit + a direct fixed-vs-percent ATK-bonus CONTRAST
 * unit + a self-buff-grant unit. MAX_ENERGY / ENERGY_REGEN_PER_TURN / MAX_ROUNDS and ALL other skill
 * costs stay BYTE-UNCHANGED.
 */
export const EMPOWER_PERCENT_ENERGY_COST = 69;

/**
 * TASK-65 (R-17c, 14th combat wave) — the FIFTH stat-modifier ailment: Vulnerable, a
 * persistent DEFENDER debuff that AMPLIFIES incoming damage (the clean INVERSE of the
 * DEF-reduction {@link WEAKEN_DEF_REDUCTION} / the ATK-reduction {@link ENFEEBLE_ATK_REDUCTION}
 * mitigation debuffs). While a combatant carries `vulnerable`, every strike that lands
 * on it is scaled UP by `1 + {@link VULNERABLE_DAMAGE_TAKEN_BONUS}` (read off the
 * DEFENDER's statuses at the damage seam in {@link resolveDamageStrike}, AFTER the
 * type/element/DEF math, keeping the `>= 1` floor).
 *
 * Unlike Burn/Poison/Bleed it removes NO HP on its tick — like Weaken/Enfeeble it is a
 * pure stat-modifier: its tick only counts down + logs (HP stays MONOTONICALLY
 * non-increasing, A-54). It is NOT a control lock, so it can never stall a fight toward
 * MAX_ROUNDS (it always increases outgoing damage → the fight only SHORTENS), sidestepping
 * the TASK-60/61 Sleep/Freeze starvation hazard. Lasts this many of the afflicted side's
 * OWN turns.
 *
 * Tuned (duration 3 × a modest +25%) so the shipped win-vs-numemon / loss-vs-kuwagamon
 * outcomes STILL hold. NOTE the directional hazard (GUARDRAIL 1): the tactical AI casts
 * `vulnerable-strike` onto the FOE, so it AMPLIFIES the player's damage against numemon
 * (helps the win) — but the enemy also casts it onto the player, and against kuwagamon a
 * marked player takes harder hits (could deepen the loss but never flip it TO a win — a
 * damage-AMP never heals). The regression pair below is asserted to catch any drift.
 */
export const VULNERABLE_DURATION = 3;

/**
 * The fractional bonus a Vulnerable defender takes on EVERY incoming strike (TASK-65) —
 * a +25% damage-taken multiplier applied as `round(raw * (1 + 0.25))` in
 * {@link resolveDamageStrike}, AFTER the existing type/element/DEF math and BEFORE the
 * shield-absorb, keeping the `>= 1` floor. Modest (+25%) so the regression-tuned
 * win/loss outcomes hold — a vulnerable defender takes noticeably harder hits, not an
 * outright one-shot. A damage-AMP only ever RAISES a strike's damage, so HP stays
 * monotonically non-increasing (a damage-AMP never heals).
 */
export const VULNERABLE_DAMAGE_TAKEN_BONUS = 0.25;

/**
 * Vulnerable Strike's energy cost (TASK-65). DISTINCT from every other costed skill —
 * Double Strike (24) / Lullaby Hex (21) / Guard (14) / Frost Bite (11) / Shock Strike
 * (9) / Enfeeble Strike (8) / Focus (7) / Fire Breath (6) / Armor Break (5) / Bleed
 * Strike (3) / Poison Sting (2) — set at 10, slotting between Shock Strike (9) and Frost
 * Bite (11), so the affordability ladder stays strictly cost-descending and ALL twelve
 * existing skill costs stay BYTE-UNCHANGED (no MAX_ENERGY / regen re-tune) — the safest
 * regression posture.
 *
 * OBSERVABLE-BY-DEFAULT (TASK-64): because `vulnerable-strike` is a DAMAGING composite
 * (`[damage, vulnerable]`, the armor-break/enfeeble-strike family) applying a FRESH
 * defender ailment, the deterministic tactical {@link chooseSkill} rule 1 ROTATES it
 * onto the foe in the shipped `simulateBattle(agumon, numemon)` fight regardless of the
 * greedy-sawtooth energy band (chooseSkill filters `affordable` and picks the highest
 * TACTICAL PRIORITY fresh-unseen ailment — cost 10 ≤ MAX_ENERGY 41 is affordable on the
 * opening turn), so a /battle player SEES the foe marked Vulnerable and take harder hits.
 * Cost 10 is DISTINCT (keeps the ladder strictly cost-descending) so the `selectSkill`
 * boundary stays clean too.
 */
export const VULNERABLE_STRIKE_ENERGY_COST = 10;

/**
 * Rupture's (`vulnerable-percent`) damage-taken RATIO (TASK-103, R-17c wave 52) — the FRACTIONAL
 * MIRROR of the FIXED {@link VULNERABLE_DAMAGE_TAKEN_BONUS} (0.25 = +25%), the way `enfeeble-percent`
 * mirrors the fixed `enfeeble`, `weaken-percent` mirrors `weaken`, and `empower-percent` mirrors
 * `empower`. While a target carries `vulnerable-percent`, EVERY incoming strike is scaled UP by
 * `1 + VULNERABLE_PERCENT_RATIO` (= +50%, a LARGER bump than the fixed +25%), read at the SAME
 * {@link amplifyForVulnerable} seam that SUMS the fixed and percent bonuses.
 *
 * STRUCTURALLY SIMPLER than the enfeeble/empower/weaken percent twins: the vulnerable bonus is
 * ALREADY a fraction applied as a MULTIPLIER at the strike (NOT a floored amount subtracted from a
 * live combatant stat), so this ratio is target-INDEPENDENT by construction — NO `Math.floor`, NO
 * current-stat lookup. A damage-AMP only ever RAISES a strike (never heals), so HP stays
 * monotonically non-increasing (A-42). The observable contrast at base 40: fixed → round(40·1.25)=50,
 * percent → round(40·1.5)=60 (STRICTLY greater). REUSES {@link VULNERABLE_DURATION} (no duration
 * re-tune this wave), exactly as `enfeeble-percent` re-uses ENFEEBLE_DURATION.
 */
export const VULNERABLE_PERCENT_RATIO = 0.5;

/**
 * Rupture's (`vulnerable-percent`) energy cost (TASK-103) — 70, the new strictly-cost-descending
 * ladder TOP (above `empower-percent`@69 / `enfeeble-percent`@68 / `weaken-percent`@67 / … /
 * `cleanse`@43). Posture-B DECOUPLED (L-16 #7): because 70 > {@link MAX_ENERGY} (41) and every
 * fight-local pool is capped at MAX_ENERGY, `vulnerable-percent` is NEVER the pick inside
 * {@link simulateBattle}, so the shipped win-vs-numemon / loss-vs-kuwagamon fights stay
 * BYTE-IDENTICAL (zero ladder re-tune — the safest regression posture). Its wiring is proven in
 * ISOLATION via a `selectSkill(70)` boundary unit + a direct {@link amplifyForVulnerable} contrast,
 * NOT via a shipped fight. DISTINCT from every other above-pool cost (68→43 taken; 69 = empower-percent).
 */
export const VULNERABLE_PERCENT_ENERGY_COST = 70;

/**
 * TASK-66 (R-17c, 15th combat wave) — the SIXTH lingering-ailment family member and a
 * genuinely NEW mechanical SHAPE the engine did not have before: DEFERRED / SCHEDULED
 * damage. Doom is a delayed-detonation CURSE. Unlike a DoT (Burn/Poison/Bleed) it does
 * NOTHING on its per-turn tick except COUNT DOWN {@link DOOM_DURATION}; when its counter
 * reaches 0 it DETONATES a single FIXED {@link DOOM_DETONATION_DAMAGE} burst on the
 * afflicted combatant (routed through the SAME `hp = max(0, hp − X)` write path the DoTs
 * use, respecting the ≥ 0 floor) and then EXPIRES — the classic SMT "doom/countdown".
 *
 * It NEVER heals (HP stays MONOTONICALLY NON-INCREASING, GUARDRAIL 2 — the A-42-gated
 * Heal/HoT family stays deferred). Because it only ever ADDS a delayed damage burst it
 * can only SHORTEN a fight (like Vulnerable), never STALL it — so it sidesteps the
 * TASK-60/61 Sleep/Freeze `MAX_ROUNDS` starvation hazard that afflicts a pure-control
 * lock. Fixed short fuse (3 turns — deterministic, tunable to hold the regression).
 */
export const DOOM_DURATION = 3;

/**
 * The FIXED HP burst a Doom detonates on the afflicted combatant when its fuse expires
 * (TASK-66) — dealt ONCE, at expiry, NOT per turn. Modest so the regression-tuned
 * win-vs-numemon / loss-vs-kuwagamon outcomes hold: a doomed target takes a single
 * meaningful burst a few turns after being cursed, not an outright one-shot. A burst
 * only ever SUBTRACTS HP (floored at 0), so HP stays monotonically non-increasing.
 */
export const DOOM_DETONATION_DAMAGE = 12;

/**
 * Doom Curse's energy cost (TASK-66). DISTINCT from every other costed skill — Double
 * Strike (24) / Lullaby Hex (21) / Guard (14) / Frost Bite (11) / Vulnerable Strike
 * (10) / Shock Strike (9) / Enfeeble Strike (8) / Focus (7) / Fire Breath (6) / Armor
 * Break (5) / Bleed Strike (3) / Poison Sting (2) — set at 12, slotting between Frost
 * Bite (11) and … actually ABOVE Frost Bite (see the ladder), so the affordability
 * ladder stays strictly cost-descending and ALL thirteen existing skill costs stay
 * BYTE-UNCHANGED (no MAX_ENERGY / regen re-tune) — the safest regression posture.
 *
 * OBSERVABLE-BY-DEFAULT (the TASK-64/D-154 posture): because `doom-curse` applies a
 * FRESH defender ailment that WILL deal damage (a DEFERRED strike, not a zero-sum
 * control lock), the deterministic tactical {@link chooseSkill} rule 1 ROTATES it onto
 * the foe in the shipped `simulateBattle(agumon, numemon)` fight (cost 12 ≤ MAX_ENERGY
 * 41 → affordable), so a /battle player SEES the foe marked Doomed and, a few turns
 * later, Doom DETONATE for a burst — the whole point of the wave (present ≠ observable).
 * It is treated as a "deals damage (deferred)" tactical for selection so it never
 * spends a truly wasted turn (GUARDRAIL 3) the way the pure-control Lullaby Hex would.
 */
export const DOOM_CURSE_ENERGY_COST = 12;

/**
 * The FRACTIONAL detonation magnitude for `doom-percent` (TASK-119) — the percent-of-CURRENT-HP
 * twin of `doom`'s FIXED {@link DOOM_DETONATION_DAMAGE}. On fuse-end the bearer loses
 * `floor(hp × DOOM_PERCENT_DETONATION_RATIO)` of its CURRENT HP (NOT max HP — no `maxHp` field is
 * read), routed through the SAME monotone `Math.max(0, hp − burst)` seam `doom` uses. A ratio in
 * (0,1); modest so the deferred burst is meaningful yet never one-shots — the shipped
 * win-vs-numemon / loss-vs-kuwagamon regression outcomes hold (this skill is Posture-B-priced
 * above the pool, so the shipped fights never cast it and stay byte-identical anyway). A burst only
 * ever SUBTRACTS HP (floored at 0), so HP stays monotonically non-increasing (A-42).
 */
export const DOOM_PERCENT_DETONATION_RATIO = 0.25;

/**
 * Doom-Percent Curse's energy cost (TASK-119) — the FRACTIONAL twin of Doom Curse
 * ({@link DOOM_CURSE_ENERGY_COST} = 12). Priced 82 > {@link MAX_ENERGY} (41) — Posture-B DECOUPLED
 * (L-16 #7): `selectSkill`/`chooseSkill` NEVER afford it inside `simulateBattle`, so the shipped
 * agumon fights stay BYTE-IDENTICAL (assert (d)) — zero ladder re-tune, the safest regression
 * posture. Unlike the castable flat `doom-curse@12`, a castable `doom-percent-curse` WOULD be
 * selected as a "deals damage (deferred)" tactical and rotate onto the foe, PERTURBING the shipped
 * fight; the guardrail (assert (f)) forbids that, so we take the Posture-B fallback the task
 * prescribes and prove the fractional detonation via the DIRECT-SEAM unit (assert (b)) instead of a
 * live-fight cast. DISTINCT from every other above-pool cost (the SPD skills top out at 81).
 */
export const DOOM_PERCENT_CURSE_ENERGY_COST = 82;

/**
 * TASK-67 (R-17c, 16th combat wave) — the FOURTH DoT ailment and a genuinely NEW
 * mechanical SHAPE the engine did not have before: an ESCALATING / RAMPING
 * damage-over-time. The three existing DoTs (Burn 4/turn, Poison 3/turn, Bleed
 * 2/turn) each deal a CONSTANT amount every tick; Corrode instead GROWS the longer it
 * lingers — its per-turn damage starts at {@link CORRODE_INITIAL_DAMAGE} and climbs by
 * a fixed {@link CORRODE_RAMP} step at each successive tick, punishing a drawn-out
 * fight. It is the FIRST DoT whose `damagePerTurn` is not fixed for the ailment's life.
 *
 * How it stays add-only DATA (extend-pure-battle-engine skill, L-16 / invariant 5 /
 * A-36 #3): the `corrode` arm reuses the SAME `damagePerTurn` HP-tick field the flat
 * DoTs carry, and ADDITIONALLY carries a `ramp` step; its tick is one dedicated branch
 * that subtracts the CURRENT `damagePerTurn`, then INCREASES it by `ramp` for the next
 * tick (the ONLY new behaviour beyond the flat-DoT substrate). The turn LOOP itself is
 * untouched. Fixed short duration (4 turns — deterministic, tunable to hold the
 * regression). It NEVER heals — a corrode tick only ever SUBTRACTS HP (floored at 0),
 * so HP stays MONOTONICALLY NON-INCREASING (GUARDRAIL 2 — the A-42-gated Heal/HoT
 * family stays deferred), and because it only ADDS growing damage it can only SHORTEN
 * a fight, never STALL it (no MAX_ROUNDS starvation, unlike a pure-control lock).
 */
export const CORRODE_DURATION = 4;

/**
 * The HP a Corrode removes on its FIRST tick (TASK-67), before any ramp. Deliberately
 * SMALL — smaller than every flat DoT's per-turn tick (Burn 4 / Poison 3 / Bleed 2) —
 * so the ramping DoT reads as "starts weak, grows scary": it opens BELOW Bleed's 2 and
 * only overtakes the flat DoTs after a couple of {@link CORRODE_RAMP} steps. Modest so
 * the regression-tuned win-vs-numemon / loss-vs-kuwagamon outcomes hold.
 */
export const CORRODE_INITIAL_DAMAGE = 2;

/**
 * How much a Corrode's per-turn tick GROWS at each successive tick (TASK-67) — the
 * defining "escalating" parameter. Its `damagePerTurn` climbs
 * `CORRODE_INITIAL_DAMAGE`, `+ CORRODE_RAMP`, `+ 2·CORRODE_RAMP`, … over its
 * {@link CORRODE_DURATION} ticks. Kept modest (2) so a corroded target takes a
 * meaningfully-growing but not runaway hit sequence (2 → 4 → 6 → 8 over 4 ticks =
 * 20 total across the fight, comparable to the flat DoTs' totals so the shipped
 * outcomes hold), and so the growth is VISIBLE in the log tick-over-tick.
 */
export const CORRODE_RAMP = 2;

/**
 * Corrode Strike's energy cost (TASK-67). DISTINCT from every other costed skill —
 * Double Strike (24) / Lullaby Hex (21) / Guard (14) / Doom Curse (12) / Frost Bite
 * (11) / Vulnerable Strike (10) / Shock Strike (9) / Enfeeble Strike (8) / Focus (7) /
 * Fire Breath (6) / Armor Break (5) / Bleed Strike (3) / Poison Sting (2) — set at 13,
 * slotting between Guard (14) and Doom Curse (12), so the affordability ladder stays
 * strictly cost-descending and ALL fourteen existing skill costs stay BYTE-UNCHANGED
 * (no MAX_ENERGY / regen re-tune) — the safest regression posture: the shipped
 * win-vs-numemon / loss-vs-kuwagamon fights' greedy-sawtooth energy math is unmoved.
 *
 * OBSERVABLE-BY-DEFAULT (the TASK-64/D-154 posture): because `corrode-strike` is a
 * DAMAGING composite (`[damage, corrode]`, the bleed-strike/armor-break family)
 * applying a FRESH defender ailment, the deterministic tactical {@link chooseSkill}
 * rule 1 ROTATES it onto the foe in the shipped `simulateBattle(agumon, numemon)`
 * fight regardless of the greedy energy band (cost 13 ≤ MAX_ENERGY 41 is affordable on
 * the opening turn), so a /battle player SEES the foe start Corroding and take a
 * GROWING amount of damage turn after turn — the whole point of the wave (present ⇒
 * observable). Because it deals its damage half on cast (unlike the pure-control
 * Lullaby Hex) it is SAFE mid-ladder — no zero-damage stall toward MAX_ROUNDS.
 */
export const CORRODE_STRIKE_ENERGY_COST = 13;

/**
 * Shock Strike's energy cost (TASK-57). DISTINCT from Guard (14) / Focus (7) / Fire
 * Breath (6) / Armor Break (5) / Poison Sting (2) — set at 9 (below only Guard) so the
 * energy economy still gates meaningfully. TASK-57 re-tuned the LADDER (Guard 9→14,
 * MAX_ENERGY 13→23, ENERGY_REGEN_PER_TURN kept at 4) so the greedy drain-and-climb
 * sawtooth now visits ALL SIX costed tiers as the top affordable pick in one
 * deterministic fight: Guard@23 → Shock Strike@13 → Focus@8 → Armor Break@5 → (climb)
 * Fire Breath@6 → Poison Sting@4 → the free Attack. Widening MAX_ENERGY to 23 (with
 * Guard raised to 14) is what makes the extra sixth tier land — a duplicate cost or a
 * too-tight ladder would leave a skill (and its status) never observed (L-16).
 */
export const SHOCK_STRIKE_ENERGY_COST = 9;

/**
 * Double Strike's energy cost (TASK-58). DISTINCT from Guard (14) / Shock Strike (9)
 * / Focus (7) / Fire Breath (6) / Armor Break (5) / Poison Sting (2) — set at 24 (the
 * MOST expensive skill, fitting a burst multi-hit). TASK-58 re-tuned ONLY the pool
 * size (MAX_ENERGY 23→43, ENERGY_REGEN_PER_TURN kept at 4; every EXISTING cost is
 * byte-unchanged) so the greedy drain-and-climb OPENING cascade from a full pool now
 * steps down through ALL SEVEN costed tiers as the top affordable pick in one
 * deterministic fight: Double Strike@43 → Guard@… → Shock Strike → Focus → Armor Break
 * → Poison Sting → (climb) Fire Breath → the free Attack. A single greedy sawtooth can
 * visit at most as many tiers as this opening descent reaches before it settles into
 * its 2/6 fixed cycle; widening MAX_ENERGY to 43 is what makes the seventh tier land
 * in that opening descent (a duplicate cost or a too-tight pool would leave a skill —
 * and its multi-hit — never observed; L-16, the 6th proof).
 */
export const DOUBLE_STRIKE_ENERGY_COST = 24;

/**
 * How many discrete damage STRIKES a {@link SKILLS}['double-strike'] multi-hit lands
 * in ONE action (TASK-58). Kept SMALL (2) — the smallest observable multi-hit — so the
 * burstier per-action damage cannot flip the shipped win-vs-numemon / loss-vs-kuwagamon
 * outcomes by ending the fight a round early (a multi-hit converges the fight at least
 * as fast, never slower; the win/loss pair is regression-asserted). Each strike routes
 * through the EXISTING {@link resolveAttack} (so it reads the live Weaken/Empower
 * modifiers) and the SAME shield-absorb-before-HP path a single `damage` strike uses,
 * emitting its OWN {@link TurnLogEntry} so the player SEES each hit land.
 */
export const DOUBLE_STRIKE_HITS = 2;

/**
 * Frost Bite's energy cost (TASK-59). DISTINCT from every other costed skill —
 * Double Strike (24) / Guard (14) / Shock Strike (9) / Focus (7) / Fire Breath (6) /
 * Armor Break (5) / Poison Sting (2) — set at 11, slotting between Guard (14) and
 * Shock Strike (9), so the energy economy still gates meaningfully and the greedy
 * drain-and-climb OPENING cascade from a full pool steps down through ALL EIGHT
 * costed tiers as the top affordable pick in one deterministic fight. TASK-59
 * widened ONLY the pool (MAX_ENERGY 43→57, ENERGY_REGEN_PER_TURN kept at 4; every
 * EXISTING cost byte-unchanged) so the opening descent reaches this new eighth tier
 * (a duplicate cost or a too-tight pool would leave Frost Bite — and its Freeze —
 * never observed; L-16, the 7th proof).
 */
export const FROST_BITE_ENERGY_COST = 11;

/**
 * TASK-59 (R-17c, next combat wave) — the SEVENTH status kind (and SECOND control
 * ailment): Freeze, a MULTI-TURN action lock. It shares the CONTROL-ailment category
 * with Stun (the afflicted side CANNOT ACT while it holds — NOT a DoT like
 * Burn/Poison, NOT a stat-modifier like Weaken/Empower, NOT a damage-absorb like
 * Shield), and REUSES the exact `stunnedThisTurn` skip-turn substrate Stun introduced
 * (TASK-57). The genuinely NEW *shape*: where Stun locks exactly ONE turn
 * (STUN_DURATION 1), Freeze locks SEVERAL CONSECUTIVE turns — so a single cast makes
 * the foe forgo its action across {@link FREEZE_DURATION} of its OWN turns, each a
 * distinct "frozen and cannot act" line the player SEES in the shipped battle log.
 * Like Stun it carries NO magnitude — its whole effect is "lose your turn", so its
 * arm holds only `turnsRemaining`.
 *
 * Applied by the OFFENSIVE, DEFENDER-targeting Frost Bite skill (`[damage, freeze]`),
 * mirroring how Shock Strike (`[damage, stun]`) introduced Stun. Because a frozen side
 * simply FORGOES its action (it removes and adds NO HP), HP stays monotonically
 * non-increasing and the fight still converges — a freeze can only make the fight
 * LONGER (the frozen side deals no damage on the locked turns), never heal HP back
 * (A-47 — Freeze over the HP-raising Heal/HoT/Revive/Drain family keeps MAX_ROUNDS
 * termination + the shipped win/loss tuning structurally safe).
 *
 * KEPT SHORT (2 turns — the SMALLEST duration that is genuinely MULTI-turn, so a
 * player observes two consecutive locked turns from one cast) so it is observable in
 * the log but cannot stall the fight into a MAX_ROUNDS tie-break that would flip a
 * shipped outcome. THE TICK-AND-CHECK RULE is IDENTICAL to Stun's (one unambiguous
 * placement, the shared substrate): a freeze is ticked at the TOP of the afflicted
 * actor's OWN turn (in AILMENT_TICK_ORDER, before the action step). If an active
 * freeze is present at the top of that actor's turn, the action step is SKIPPED for
 * that turn (the actor loses exactly FREEZE_DURATION of its OWN action turns), then
 * the freeze decrements and drops on expiry — so across FREEZE_DURATION > 1 the actor
 * is suppressed on multiple successive turns before shaking it off.
 */
export const FREEZE_DURATION = 2;

/**
 * Lullaby Hex's energy cost (TASK-60, RE-TUNED in-pool by TASK-61). DISTINCT from
 * every other costed skill — Double Strike (24) / Guard (14) / Frost Bite (11) /
 * Shock Strike (9) / Focus (7) / Fire Breath (6) / Armor Break (5) / Poison Sting (2)
 * — set at 21, IN the fight pool ({@link MAX_ENERGY} = 41) and slotting between Double
 * Strike (24) and Guard (14).
 *
 * WHY 21 + the GUARDRAIL-2 fallback slot (TASK-61 / D-147 / A-50): TASK-60 shipped
 * Sleep + this ninth skill but priced Lullaby Hex ABOVE the pool (43 > 41) so it was
 * PRESENT but never OBSERVABLE — a player never saw the foe fall asleep in a real
 * fight. TASK-61's job is to make it SURFACE. The task's Posture-A default (Lullaby
 * Hex as the top-of-ladder OPENER at full energy) was attempted and REJECTED here: a
 * NON-damaging control skill firing first starves the winnable agumon-vs-numemon
 * fight of damage and FLIPS it to a loss (the exact "pure-control skill at the top of
 * the ladder starves the fight" tension GUARDRAIL-2 anticipates, and the coupled wall
 * that stalled the original TASK-60 four times). So per GUARDRAIL-2 Lullaby Hex is
 * DEMOTED to the second priority slot (see {@link COMBATANT_SKILLS}): Double Strike
 * still OPENS every fight (byte-unchanged opener), and Lullaby Hex surfaces the FIRST
 * turn energy sits in its band (21, one regen tick after the opening Double Strike
 * drops the pool 41→17). This KEEPS both shipped outcomes correct (win-vs-numemon in
 * ~8 rounds, loss-vs-kuwagamon in ~3), both well clear of {@link MAX_ROUNDS}, and HP
 * monotonically non-increasing (Sleep only skips turns) — while Lullaby Hex is now
 * ACTUALLY CAST in a shipped fight, putting the foe to sleep, VISIBLE in the log
 * (present AND observable). Cost 21 is DISTINCT (keeps the ladder strictly
 * cost-descending) and ≤ MAX_ENERGY (reachable), so {@link selectSkill}(21) returns it.
 * L-16 #6: this trace is derived from the FINAL constants (MAX_ENERGY 41, regen 4).
 */
export const LULLABY_HEX_ENERGY_COST = 21;

/**
 * TASK-60 (R-17c, next combat wave) — the EIGHTH status kind (and THIRD control
 * ailment): Sleep, an INTERRUPTIBLE MULTI-TURN action lock. It shares the
 * control-ailment category with Stun/Freeze (the afflicted side CANNOT ACT while it
 * holds — NOT a DoT like Burn/Poison, NOT a stat-modifier like Weaken/Empower, NOT a
 * damage-absorb like Shield), and REUSES the exact `stunnedThisTurn` skip-turn
 * substrate Stun introduced (TASK-57) and Freeze reused (TASK-59) — NO third skip
 * variable. Like Stun/Freeze it carries NO magnitude (its whole effect is "lose your
 * turn"), so its arm holds only `turnsRemaining`.
 *
 * THE GENUINELY NEW *shape* — INTERRUPTIBLE (event-driven early clear): where Stun
 * locks exactly ONE turn and Freeze locks {@link FREEZE_DURATION} turns
 * UNCONDITIONALLY, Sleep locks the LONGEST ({@link SLEEP_DURATION} = 3) but is WOKEN
 * EARLY the instant the sleeper takes `damage > 0` (see the wake hook in
 * {@link resolveDamageStrike}). It is the FIRST ailment whose effective duration
 * depends on COMBAT EVENTS, not only its own turn counter — the heavier lock BALANCED
 * by being breakable. Applied by the NON-damaging OFFENSIVE, DEFENDER-targeting
 * Lullaby Hex skill (`[sleep]` — deliberately no `damage` arm so a cast cannot wake
 * its OWN target on the same turn, which would self-defeat).
 *
 * HP stays MONOTONICALLY NON-INCREASING (A-48): a slept side simply FORGOES its
 * action (removes and adds no HP), and the wake hook only REMOVES the sleep arm on a
 * damage event — it NEVER adds HP. A sleep can only make the fight LONGER (the slept
 * side deals no damage on locked turns), but wake-on-damage self-limits that, and
 * SLEEP_DURATION is kept bounded (3) + MAX_ROUNDS is NOT raised, so termination + the
 * shipped win/loss tuning stay structurally safe (the shipped fights never cast it).
 */
export const SLEEP_DURATION = 3;

/**
 * TASK-57 (R-17c, next combat wave) — the SIXTH status kind: Stun, a CONTROL AILMENT
 * (a genuinely NEW category — the afflicted side CANNOT ACT while it holds; NOT a DoT
 * like Burn/Poison, NOT a stat-modifier like Weaken/Empower, NOT a damage-absorb like
 * Shield). It is the FIRST "skip the action step" mechanic. It carries NO magnitude —
 * its whole effect is "lose your turn", so its arm holds only `turnsRemaining`.
 *
 * Applied by the OFFENSIVE, DEFENDER-targeting Shock Strike skill (`[damage, stun]`).
 * Because a stunned side simply FORGOES its action (it removes and adds NO HP), HP
 * stays monotonically non-increasing and the fight still converges — a stun can only
 * make the fight LONGER by the skipped side dealing no damage that turn, never heal it
 * back (A-45 — Stun over Heal keeps MAX_ROUNDS termination + the shipped win/loss
 * tuning structurally safe).
 *
 * KEPT SHORT (1 turn) so it is observable in the log but cannot stall the fight into a
 * MAX_ROUNDS tie-break that would flip a shipped outcome. THE TICK-AND-CHECK RULE (one
 * unambiguous placement): a stun is ticked at the TOP of the afflicted actor's OWN
 * turn (in AILMENT_TICK_ORDER, before the action step). If an active stun is present
 * at the top of that actor's turn, the action step is SKIPPED for that turn (the actor
 * loses exactly STUN_DURATION of its OWN action turns), then the stun decrements and
 * drops on expiry. A stun applied to the DEFENDER during the attacker's turn therefore
 * causes the DEFENDER's NEXT turn to be skipped (it reaches its own turn still
 * stunned).
 */
export const STUN_DURATION = 1;

/**
 * A single active status ailment on a combatant — a DISCRIMINATED UNION so a second
 * (Poison) can coexist with the first (Burn) and a later wave can add more arms
 * purely additively (TASK-53 generalized the former single special-cased `burn`
 * field into this typed collection). A combatant carries AT MOST ONE ailment of
 * each `kind`; re-applying the same kind REFRESHES `turnsRemaining` (overwrites,
 * never stacks) — the deliberate, tested choice that keeps the state a small keyed
 * collection rather than an unbounded stack, matching today's Burn semantics.
 */
export type StatusAilment =
  | { kind: 'burn'; turnsRemaining: number; damagePerTurn: number }
  // Burn-Percent (TASK-120) — the FRACTIONAL (percent-of-CURRENT-HP) twin of the flat `burn` DoT,
  // the DoT family's FIRST fidelity twin. Instead of `burn`'s fixed `damagePerTurn` magnitude it
  // carries a `damagePerTurnRatio` in (0,1); each tick subtracts `floor(hp × damagePerTurnRatio)` of
  // the bearer's CURRENT HP (reading only `hp`, NO maxHp) via the SAME monotone `Math.max(0, hp − X)`
  // DoT seam — so HP stays monotonically non-increasing (A-42). No RNG (deterministic).
  | { kind: 'burn-percent'; turnsRemaining: number; damagePerTurnRatio: number }
  | { kind: 'poison'; turnsRemaining: number; damagePerTurn: number }
  // Poison-Percent (TASK-121) — the fractional (percent-of-CURRENT-HP) twin of `poison`, the DoT
  // family's SECOND `-percent` fidelity twin. Like `burn-percent` it carries a `damagePerTurnRatio`
  // in (0,1); each tick subtracts `floor(hp × damagePerTurnRatio)` of CURRENT HP (reading only `hp`,
  // NO maxHp) via the SAME monotone `Math.max(0, hp − X)` DoT seam — HP monotone (A-42), no RNG.
  | { kind: 'poison-percent'; turnsRemaining: number; damagePerTurnRatio: number }
  | { kind: 'bleed'; turnsRemaining: number; damagePerTurn: number }
  // Bleed-Percent (TASK-122) — the fractional (percent-of-CURRENT-HP) twin of `bleed`, the DoT
  // family's THIRD `-percent` fidelity twin. Like `burn-percent`/`poison-percent` it carries a
  // `damagePerTurnRatio` in (0,1); each tick subtracts `floor(hp × damagePerTurnRatio)` of CURRENT HP
  // (reading only `hp`, NO maxHp) via the SAME monotone `Math.max(0, hp − X)` DoT seam — HP monotone
  // (A-42), no RNG. The flat-`bleed` mirror (NO `ramp` field — that is the deferred `corrode` twin).
  | { kind: 'bleed-percent'; turnsRemaining: number; damagePerTurnRatio: number }
  // Wither-Percent (TASK-132) — the FIRST DoT sized off the bearer's OWN `maxHp` rather than its
  // CURRENT `hp`. Structurally a FLAT DoT (a `turnsRemaining` countdown + a fixed `damagePerTurn`,
  // mirroring the `burn` arm's shape), NOT a ratio arm like `burn-percent` — because the maxHp-fraction
  // is MATERIALIZED ONCE at apply time (`applyAilment` bakes `floor(bearer.maxHp × ratio)` into
  // `damagePerTurn`). This is provably identical to reading `maxHp × ratio` each tick since `maxHp` is
  // immutable during a fight, and it keeps the tick a byte-identical subtract (the same one `burn`
  // uses). The DISTINGUISHING property vs every current-hp percent DoT: the per-turn amount is CONSTANT
  // as HP falls (a relentless, non-slowing attrition), whereas a current-hp DoT shrinks each tick. Each
  // tick subtracts the fixed `damagePerTurn` via the SAME monotone `Math.max(0, hp − X)` DoT seam — HP
  // stays monotonically non-increasing (A-42). No RNG (deterministic).
  | { kind: 'wither-percent'; turnsRemaining: number; damagePerTurn: number }
  | { kind: 'weaken'; turnsRemaining: number; defReduction: number }
  // Crumble / weaken-percent (TASK-100) — the fractional MIRROR of `weaken`: a DEF debuff
  // on the DEFENDER that, at the resolveDamageStrike weaken-read seam, removes a FRACTION
  // (`defReductionRatio`, floored) of the target's CURRENT def as effective-DEF reduction,
  // instead of the FIXED WEAKEN_DEF_REDUCTION. It carries the RATIO (not a baked magnitude —
  // exactly as retaliate-percent carries `reflectRatio`) so `applyAilment` stays
  // target-independent and needn't know the target's def at apply-time. Its tick removes NO HP
  // (a stat-mod debuff), and the reduction is clamped at MIN_EFFECTIVE_DEF in resolveAttack, so
  // HP stays monotone (A-42). The fractional twin of the fixed `weaken`, continuing the
  // percentage/fidelity axis onto the stat-modifier mechanic.
  | { kind: 'weaken-percent'; turnsRemaining: number; defReductionRatio: number }
  | { kind: 'shield'; turnsRemaining: number; absorbRemaining: number }
  // Barrier / shield-percent (TASK-131) — the FRACTIONAL twin of `shield`, and the LAST buff/status
  // family to receive a `-percent` mirror. Structurally IDENTICAL to `shield` (a `turnsRemaining`
  // countdown + a mutable `absorbRemaining` pool drained BEFORE HP through the shared
  // absorbWithShield seam). The ONE distinguishing property is the SIZING at APPLICATION time: its
  // `absorbRemaining` is `floor(bearer.maxHp × SHIELD_PERCENT_ABSORB_RATIO)` (a fraction of the
  // BEARER's OWN maxHp), vs `shield`'s flat SHIELD_ABSORB_AMOUNT — the FIRST time maxHp sizes a
  // MITIGATION pool. Its tick removes NO HP (a self-buff, exactly like the shield tick), and a shield
  // only ever REDUCES the HP a hit removes, never raises it, so HP stays monotone (A-42).
  | { kind: 'shield-percent'; turnsRemaining: number; absorbRemaining: number }
  | { kind: 'empower'; turnsRemaining: number; atkBonus: number }
  // Fortify (TASK-108) — the missing DEFENSIVE member of the self-buff family: a DEF-up SELF-BUFF
  // that, at the resolveDamageStrike weaken/netDefReduction seam, RAISES the fortified DEFENDER's
  // effective DEF by a FIXED `defBonus` (folded in as a NEGATIVE reduction), so every incoming
  // strike deals LESS damage. It is the exact SELF-BUFF MIRROR of `weaken` ({...; defReduction})
  // and the DEF-axis twin of `empower` ({...; atkBonus}). Its tick removes NO HP (a stat-mod
  // self-buff — it only lowers incoming damage), so HP stays monotone (A-42). resolveAttack clamps
  // effectiveDef at MIN_EFFECTIVE_DEF and floors damage at ≥1, so a def-BONUS can never invert the
  // mitigation term.
  | { kind: 'fortify'; turnsRemaining: number; defBonus: number }
  // Reinforce / empower-percent (TASK-102) — the fractional MIRROR of `empower`: an ATK-BONUS
  // SELF-BUFF that, at the resolveDamageStrike empower-read seam, ADDS a FRACTION (`atkBonusRatio`,
  // floored) of the caster's CURRENT atk to the caster's outgoing effective-ATK bonus, instead of
  // the FIXED EMPOWER_ATK_BONUS. It carries the RATIO (not a baked magnitude — exactly as
  // enfeeble-percent carries `atkReductionRatio`) so `applyAilment` stays caster-independent and
  // needn't know the caster's atk at apply-time. Its tick removes NO HP (a stat-mod self-buff — it
  // only sharpens the caster's hits), so HP stays monotone (A-42). The ATK-BONUS (self-buff) twin of
  // Sunder (`enfeeble-percent`), continuing the percentage/fidelity axis onto the ATK-BONUS side of
  // the stat-modifier mechanic.
  | { kind: 'empower-percent'; turnsRemaining: number; atkBonusRatio: number }
  // Retaliate (TASK-69) — the FIRST REACTIVE / ON-BEING-HIT family: a SELF-buff that,
  // while active, carries a FIXED `reflectDamage` dealt back to whoever lands a damaging
  // strike on the buffed combatant (the payoff lives at the shared resolveDamageStrike
  // hit site, NOT in its tick — its tick only counts down). Removes NO HP on its own tick
  // and only ever SUBTRACTS the attacker's HP (never heals) — HP-monotone (A-42).
  | { kind: 'retaliate'; turnsRemaining: number; reflectDamage: number }
  // Thorn Mirror / retaliate-percent (TASK-99) — the fractional MIRROR of `retaliate`: a
  // SELF-buff that, while active, reflects a FRACTION (`reflectRatio`, floored) of the
  // incoming overflow back at whoever lands a damaging strike (the payoff lives at the
  // shared resolveDamageStrike hit site, NOT in its tick — its tick only counts down).
  // Removes NO HP on its own tick and only ever SUBTRACTS the attacker's HP — HP-monotone
  // (A-42). The fractional twin of the fixed `retaliate` (the way sap-percent/leech-percent
  // mirror sap/leech), continuing the percentage/fidelity axis onto the reflect mechanic.
  | { kind: 'retaliate-percent'; turnsRemaining: number; reflectRatio: number }
  | { kind: 'enfeeble'; turnsRemaining: number; atkReduction: number }
  // Sunder / enfeeble-percent (TASK-101) — the fractional MIRROR of `enfeeble`: an ATK debuff
  // on the DEFENDER that, at the resolveDamageStrike enfeeble-read seam, removes a FRACTION
  // (`atkReductionRatio`, floored) of the target's CURRENT atk as effective-ATK reduction,
  // instead of the FIXED ENFEEBLE_ATK_REDUCTION. It carries the RATIO (not a baked magnitude —
  // exactly as weaken-percent carries `defReductionRatio`) so `applyAilment` stays
  // target-independent and needn't know the target's atk at apply-time. Its tick removes NO HP
  // (a stat-mod debuff), and the reduction is clamped at MIN_EFFECTIVE_ATK in resolveAttack, so
  // HP stays monotone (A-42). The ATK-side twin of Crumble (`weaken-percent`), continuing the
  // percentage/fidelity axis onto the ATK-side of the stat-modifier mechanic.
  | { kind: 'enfeeble-percent'; turnsRemaining: number; atkReductionRatio: number }
  | { kind: 'vulnerable'; turnsRemaining: number; damageTakenBonus: number }
  // Rupture / vulnerable-percent (TASK-103) — the fractional MIRROR of `vulnerable`: a DEFENDER
  // damage-taken DEBUFF whose bonus is a RATIO (a FRACTION of the base strike) rather than the
  // FIXED damageTakenBonus. It carries `damageTakenBonusRatio` (not a baked magnitude) EXACTLY as
  // enfeeble-percent carries `atkReductionRatio`, read at the amplifyForVulnerable seam which SUMS
  // the fixed and percent bonuses. Structurally SIMPLER than the enfeeble/empower twins — the
  // vulnerable bonus is already a multiplier, so the ratio is target-independent (no floor / stat
  // lookup). A DEBUFF like `vulnerable` (NOT a self-buff). Above-pool (Posture-B).
  | { kind: 'vulnerable-percent'; turnsRemaining: number; damageTakenBonusRatio: number }
  // Brace (TASK-109) — the missing damage-application-seam BUFF: the exact POSITIVE MIRROR of
  // `vulnerable` (the damage-taken-UP debuff, `{...; damageTakenBonus}`). A damage-taken-DOWN
  // SELF-BUFF that, at the SAME amplifyForVulnerable damage-application seam, REDUCES the FINAL
  // damage of every incoming strike by a fractional `damageTakenReduction` (folded in as a NEGATIVE
  // bonus into the SAME totalBonus sum), so the braced defender takes LESS damage. Distinct from
  // `fortify` ({...; defBonus}) which lives at the OTHER (DEF-mitigation / netDefReduction) seam.
  // Its tick removes NO HP (a damage-application self-buff — it only lowers incoming damage) and the
  // existing Math.max(1, …) floor keeps damage ≥1 even when totalBonus goes negative, so HP stays
  // monotone (A-42). A SELF-buff (self-cast like `fortify`/`empower`), NOT a defender-target debuff.
  | { kind: 'brace'; turnsRemaining: number; damageTakenReduction: number }
  // Bulwark (TASK-110) — the PERCENTAGE damage-taken-DOWN SELF-BUFF: the fractional MIRROR of `brace`
  // (its FLAT `damageTakenReduction` scalar swapped for a `damageTakenReductionRatio` fraction) and the
  // exact DOWN-side percent twin of `vulnerable-percent` (`{...; damageTakenBonusRatio}`). At the SAME
  // amplifyForVulnerable damage-application seam it REDUCES the FINAL damage of every incoming strike by
  // a FRACTION of the base strike (folded in as a NEGATIVE ratio bonus into the SAME totalBonus sum), so
  // the bulwarked defender takes proportionally LESS damage. Its tick removes NO HP (a
  // damage-application self-buff — it only lowers incoming damage) and the existing Math.max(1, …) floor
  // keeps damage ≥1 even when totalBonus goes negative, so HP stays monotone (A-42). A SELF-buff
  // (self-cast like `brace`/`fortify`/`empower`), NOT a defender-target debuff.
  | { kind: 'brace-percent'; turnsRemaining: number; damageTakenReductionRatio: number }
  // Aegis (TASK-111) — the PERCENTAGE DEF-UP SELF-BUFF: the missing percent-UP member of the
  // DEF-mitigation seam. The fractional MIRROR of the FLAT `fortify` (its FLAT `defBonus` scalar
  // swapped for a `defBonusRatio` fraction) and the exact DEF-UP percent twin of the DEBUFF
  // `weaken-percent` (`{...; defReductionRatio}`). At the SAME netDefReduction DEF-mitigation seam
  // it RAISES the bearer's effective DEF by floor(def × defBonusRatio) — folded in as a NEGATIVE
  // reduction (SUBTRACTED from netDefReduction) EXACTLY like `weaken-percent`'s `defReductionRatio`
  // folds `+ floor(def × ratio)` but with opposite sign — so every incoming strike deals
  // proportionally LESS damage. It carries the RATIO (not a baked magnitude, exactly as
  // weaken-percent carries `defReductionRatio`) so `applyAilment` stays bearer-independent. Its tick
  // removes NO HP (a stat-mod self-buff — it only lowers incoming damage) and resolveAttack clamps
  // effectiveDef at MIN_EFFECTIVE_DEF and floors damage ≥1, so a def-BONUS can never invert the
  // mitigation term — HP stays monotone (A-42). A SELF-buff (self-cast like `fortify`/`brace`/
  // `empower`), NOT a defender-target debuff.
  | { kind: 'fortify-percent'; turnsRemaining: number; defBonusRatio: number }
  // Hasten (TASK-112) — the FLAT SPD-UP SELF-BUFF: the FIRST member of the SPD stat-mod axis (the SOLE
  // previously-unfilled stat-mod axis). It RAISES the caster's effective SPD by a FIXED `spdBonus`,
  // read through the NEW pure `effectiveSpd(combatant, statuses)` helper (mirroring effectiveDef/
  // effectiveAtk). It is the exact SPD-axis SELF-BUFF MIRROR of the DEF-up `fortify` ({...; defBonus})
  // and the ATK-up `empower` ({...; atkBonus}). Its tick removes NO HP (a stat-mod self-buff — it only
  // RAISES effective SPD), so HP stays monotone (A-42). NOTE (A-99): this slice establishes the SPD
  // stat-mod axis + the effectiveSpd read helper ONLY — it deliberately does NOT wire effectiveSpd into
  // the once-computed turn-order line (`playerFirst = player.spd >= enemy.spd`); a true turn-order-
  // re-ordering haste is a CARVED later wave built ON this helper. A SELF-buff (self-cast like `fortify`/
  // `empower`), NOT an opponent-target debuff.
  | { kind: 'hasten'; turnsRemaining: number; spdBonus: number }
  // Rush (TASK-113) — the PERCENTAGE SPD-UP SELF-BUFF: the percent-UP twin of the flat `hasten` on the
  // SPD stat-mod axis (its FLAT `spdBonus` scalar swapped for a `spdBonusRatio` fraction). At the SAME
  // effectiveSpd read seam it RAISES the bearer's effective SPD by floor(spd × spdBonusRatio) — folded
  // in additively alongside the flat `hasten` arm's `spdBonus`, the SAME floor(stat × ratio) idiom
  // `fortify-percent` uses for DEF and `empower-percent` for ATK. It carries the RATIO (not a baked
  // magnitude, exactly as fortify-percent carries `defBonusRatio`) so `applyAilment` stays
  // bearer-independent. Its tick removes NO HP (a stat-mod self-buff — it only RAISES effective SPD),
  // so HP stays monotone (A-42). NOTE (A-99 unchanged): effectiveSpd is STILL NOT wired into the
  // once-computed turn-order line; a true turn-order-re-ordering haste is a CARVED later wave built ON
  // this helper. A SELF-buff (self-cast like `hasten`/`fortify-percent`/`empower`), NOT an opponent-target debuff.
  | { kind: 'hasten-percent'; turnsRemaining: number; spdBonusRatio: number }
  // Hobble (TASK-114) — the FLAT SPD-DOWN DEBUFF and the FIRST member of the SPD-axis DOWN half
  // (opening it exactly as `weaken` opened DEF-down and `enfeeble` opened ATK-down). Cast on the FOE
  // (a DEBUFF, appended to the DEFENDER's statuses — NOT a self-buff). At the effectiveSpd read seam it
  // LOWERS the bearer's effective SPD by a FIXED `spdReduction` (SUBTRACTED, the exact SPD-axis mirror
  // of how weaken's `defReduction` lowers effectiveDef and enfeeble's `atkReduction` lowers
  // effectiveAtk). Its tick removes NO HP (a stat-mod debuff — it only lowers effective SPD), so HP
  // stays monotone (A-42); effectiveSpd clamps the result at MIN_EFFECTIVE_SPD (pre-built TASK-112),
  // so a large `hobble` can never drive it negative. NOTE (A-99 unchanged): effectiveSpd is STILL NOT
  // wired into the once-computed turn-order line; a true turn-order-re-order slow is a CARVED later
  // wave built ON this helper. A DEBUFF (foe-cast like `weaken`/`enfeeble`), NOT a self-buff.
  | { kind: 'hobble'; turnsRemaining: number; spdReduction: number }
  // Cripple (TASK-115) — the PERCENTAGE SPD-DOWN DEBUFF, COMPLETING the SPD-axis DOWN percent square
  // (the percentage twin of the flat `hobble`, exactly as `weaken-percent`/`enfeeble-percent` are the
  // percentage twins of the flat `weaken`/`enfeeble`, and `hasten-percent` is of `hasten`). Cast on the
  // FOE (a DEBUFF, appended to the DEFENDER's statuses — NOT a self-buff). At the effectiveSpd read seam
  // it LOWERS the bearer's effective SPD by floor(spd × spdReductionRatio) (SUBTRACTED via the SAME
  // floor(stat × ratio) idiom `hasten-percent` uses to RAISE it, with opposite sign). It carries the
  // RATIO (not a baked magnitude, exactly as weaken-percent carries `defReductionRatio`) so
  // `applyAilment` stays bearer-independent — unlike the flat `hobble`, it scales with the bearer's OWN
  // raw spd. Its tick removes NO HP (a stat-mod debuff), so HP stays monotone (A-42); effectiveSpd clamps
  // the result at MIN_EFFECTIVE_SPD (pre-built TASK-112), so a large percent can never drive it negative.
  // NOTE (A-99 unchanged): effectiveSpd is STILL NOT wired into the once-computed turn-order line; a true
  // turn-order-re-order slow is a CARVED later wave built ON this helper. A DEBUFF (foe-cast like
  // `hobble`/`weaken-percent`/`enfeeble-percent`), NOT a self-buff.
  | { kind: 'hobble-percent'; turnsRemaining: number; spdReductionRatio: number }
  // Doom (TASK-66) — the DEFERRED / SCHEDULED-damage family: while active it does NO
  // per-turn damage (unlike a DoT) — its tick only counts DOWN `turnsRemaining`; when
  // that hits 0 it detonates a ONE-TIME `detonationDamage` burst before expiring.
  | { kind: 'doom'; turnsRemaining: number; detonationDamage: number }
  // Doom-Percent (TASK-119) — the FRACTIONAL (percent-of-CURRENT-HP) twin of `doom`, the LAST
  // lingering family to gain its `-percent` fidelity mirror (weaken/enfeeble/vulnerable/empower/
  // fortify/brace/hasten/hobble/sap/leech/retaliate already have theirs). Structurally identical to
  // `doom` — while active its tick does NO per-turn damage, only counting DOWN `turnsRemaining` —
  // but instead of a FIXED `detonationDamage` it carries a `detonationRatio` in (0,1) and, on
  // fuse-end, detonates a ONE-TIME burst of `floor(hp × detonationRatio)` of the bearer's CURRENT
  // HP. It reads only the existing `hp` (NO `maxHp` — percent-of-CURRENT, not max) and floors ≥ 0
  // through the SAME monotone `Math.max(0, hp − burst)` seam, so HP stays monotone (A-42) and there
  // is NO RNG (fully deterministic).
  | { kind: 'doom-percent'; turnsRemaining: number; detonationRatio: number }
  // Corrode (TASK-67) — the ESCALATING / RAMPING DoT family: like a flat DoT it
  // subtracts `damagePerTurn` HP each tick, but ADDITIONALLY carries a `ramp` step and
  // GROWS `damagePerTurn` by it after each tick (the FIRST DoT whose per-turn damage is
  // not fixed for the ailment's life). Starts at CORRODE_INITIAL_DAMAGE, climbs by
  // CORRODE_RAMP each successive turn it lingers.
  | { kind: 'corrode'; turnsRemaining: number; damagePerTurn: number; ramp: number }
  // Corrode-Percent (TASK-123) — the DoT family's FOURTH & FINAL `-percent` fidelity twin: the
  // fractional-RAMP COMBINATION. Like `bleed-percent` it subtracts `floor(hp × damagePerTurnRatio)`
  // of CURRENT HP each tick (reading only `hp`, NO maxHp), but like `corrode` it ADDITIONALLY carries
  // a `rampRatio` step and GROWS `damagePerTurnRatio` by it after each tick — so it is BOTH
  // percent-of-current (shrinks with HP) AND ramping (the ratio climbs). Starts at
  // CORRODE_PERCENT_INITIAL_RATIO, climbs by CORRODE_PERCENT_RAMP_RATIO each successive turn. Routed
  // through the SAME monotone `Math.max(0, hp − X)` DoT seam — HP monotone (A-42), no RNG. The percent
  // MIRROR of `corrode` (grows the RATIO, not the flat magnitude).
  | {
      kind: 'corrode-percent';
      turnsRemaining: number;
      damagePerTurnRatio: number;
      rampRatio: number;
    }
  | { kind: 'stun'; turnsRemaining: number }
  | { kind: 'freeze'; turnsRemaining: number }
  | { kind: 'sleep'; turnsRemaining: number };

/**
 * The three CONTROL-LOCK ailments — the exact set the per-turn loop funnels through the
 * single `stunnedThisTurn` guard (battle.ts) that returns early and SKIPS the whole action
 * step (no skill cast). Sourced here as an explicit set so a future control ailment joins it
 * in ONE place and `activeControlLock` stays in lock-step with what `resolveActorTurn` skips.
 */
const CONTROL_LOCK_KINDS: ReadonlySet<StatusAilment['kind']> = new Set(['stun', 'freeze', 'sleep']);

/** The player-facing label for each control-lock kind. */
const CONTROL_LOCK_LABEL: Readonly<Record<'stun' | 'freeze' | 'sleep', string>> = {
  stun: 'Stunned',
  freeze: 'Frozen',
  sleep: 'Asleep',
};

/**
 * A control-lock the actor is carrying INTO its upcoming turn — the FIRST active ailment whose
 * `kind` is `stun` | `freeze` | `sleep` (the SAME set `resolveActorTurn`'s `stunnedThisTurn`
 * guard skips a turn for), else `null`.
 *
 * TASK-153 (R-22 slice 14): a PURE, RNG-free, mutation-free DERIVATION over the already-in-scope
 * `statuses`. It exists to make the ALREADY-BUILT stun/freeze/sleep family LEGIBLE + HONEST on the
 * INTERACTIVE path — the interactive `battleTurn` seam READS this to surface the forced skip to the
 * player (present ≠ observable, L-17) instead of letting the menu offer a pick the engine silently
 * discards. It is a NEW export (changes no existing byte → the pinned battle.spec suite stays green,
 * invariant 5): NO turn-order/damage/termination rule reads it, and `resolveActorTurn`/
 * `simulateBattle`/the `stunnedThisTurn` guard are BYTE-UNCHANGED. It does NOT decrement or expire
 * the ailment — the tick loop still owns that; this only DETECTS the lock's presence.
 */
export function activeControlLock(
  statuses: readonly StatusAilment[],
): { kind: 'stun' | 'freeze' | 'sleep'; label: string } | null {
  const locked = statuses.find((s) => CONTROL_LOCK_KINDS.has(s.kind));
  if (locked === undefined) return null;
  const kind = locked.kind as 'stun' | 'freeze' | 'sleep';
  return { kind, label: CONTROL_LOCK_LABEL[kind] };
}

/**
 * The DETERMINISTIC tick order for a combatant's coexisting ailments. The per-turn
 * loop ticks each active ailment in THIS fixed order (Burn before Poison before
 * Weaken before Shield), so a fighter carrying all four takes their ticks in a
 * stable, e2e-assertable sequence — never RNG, never insertion-order-dependent. A new
 * ailment kind joins this list.
 */
export const AILMENT_TICK_ORDER: readonly StatusAilment['kind'][] = [
  'burn',
  // Burn-Percent (TASK-120) — the fractional (percent-of-CURRENT-HP) twin of `burn`; slotted
  // IMMEDIATELY after `burn` (deterministic). Each tick subtracts `floor(hp × damagePerTurnRatio)` of
  // CURRENT HP via the SAME monotone `Math.max(0, hp − X)` DoT seam — reads only `hp`, no maxHp.
  'burn-percent',
  'poison',
  // Poison-Percent (TASK-121) — the fractional twin of `poison`; slotted IMMEDIATELY after `poison`
  // (deterministic). Same percent-of-CURRENT-HP DoT tick shape as `burn-percent`.
  'poison-percent',
  'bleed',
  // Bleed-Percent (TASK-122) — the fractional twin of `bleed`; slotted IMMEDIATELY after `bleed`
  // (deterministic). Same percent-of-CURRENT-HP DoT tick shape as `burn-percent`/`poison-percent`.
  'bleed-percent',
  'corrode',
  // Corrode-Percent (TASK-123) — the fractional RAMPING twin of `corrode`; slotted IMMEDIATELY after
  // `corrode` (deterministic). Its tick subtracts `floor(hp × damagePerTurnRatio)` of CURRENT HP via the
  // SAME monotone `Math.max(0, hp − X)` DoT seam, THEN advances `damagePerTurnRatio += rampRatio` — the
  // percent-of-current + ramping combination.
  'corrode-percent',
  // Wither-Percent (TASK-132) — the FIRST maxHp-fraction DoT; slotted at the END of the DoT band
  // (after the corrode family), keeping the "DoTs first" convention. Its tick subtracts a FIXED
  // `damagePerTurn` (materialized at apply as `floor(maxHp × ratio)`) via the SAME monotone
  // `Math.max(0, hp − X)` DoT seam — a CONSTANT amount every turn (unlike the current-hp twins, which
  // shrink). Reads the baked flat amount, so no `maxHp` read is even needed in the tick.
  'wither-percent',
  'weaken',
  'weaken-percent',
  'enfeeble',
  'enfeeble-percent',
  'vulnerable',
  'vulnerable-percent',
  'doom',
  // Doom-Percent (TASK-119) — the fractional (percent-of-CURRENT-HP) twin of `doom`; slotted
  // IMMEDIATELY after `doom` (deterministic). Its tick only counts down + logs on the intermediate
  // turns, then on fuse-end detonates a SINGLE burst of `floor(hp × detonationRatio)` of CURRENT HP
  // via the SAME monotone `Math.max(0, hp − burst)` seam — reads only `hp`, no maxHp.
  'doom-percent',
  'shield',
  // Barrier / shield-percent (TASK-131) — the FRACTIONAL twin of `shield` in the TICK ORDER; slotted
  // IMMEDIATELY after `shield`. Its per-turn tick is `shield`'s: count down `turnsRemaining`,
  // drop-on-expiry, NO HP change (its absorb payoff is drained at the damage seam, not here).
  'shield-percent',
  'empower',
  'empower-percent',
  // Fortify (TASK-108) — a DEF-up self-buff; its tick only counts down + logs (removes NO HP),
  // exactly like the empower tick. Its DEF-raising payoff lives at the resolveDamageStrike
  // netDefReduction seam, not here.
  'fortify',
  // Brace (TASK-109) — a damage-taken-DOWN self-buff; its tick only counts down + logs (removes NO
  // HP), exactly like the fortify/empower tick. Its damage-reducing payoff lives at the
  // amplifyForVulnerable damage-application seam, not here.
  'brace',
  // Bulwark (TASK-110) — a percentage damage-taken-DOWN self-buff; its tick only counts down + logs
  // (removes NO HP), exactly like the brace/fortify/empower tick. Its damage-reducing payoff lives at
  // the amplifyForVulnerable damage-application seam, not here.
  'brace-percent',
  // Aegis (TASK-111) — a percentage DEF-up self-buff; its tick only counts down + logs (removes NO
  // HP), exactly like the fortify/brace/empower tick. Its DEF-raising payoff lives at the
  // resolveDamageStrike netDefReduction DEF-mitigation seam, not here.
  'fortify-percent',
  // Hasten (TASK-112) — a flat SPD-up self-buff; its tick only counts down + logs (removes NO HP),
  // exactly like the fortify-percent/fortify/brace/empower tick. Its SPD-raising payoff lives in the
  // pure effectiveSpd read helper (NOT wired into the turn-order line this slice, A-99), not here.
  'hasten',
  // Rush (TASK-113) — a percentage SPD-up self-buff; its tick only counts down + logs (removes NO HP),
  // exactly like the hasten/fortify-percent/fortify/brace/empower tick. Its SPD-raising payoff lives in
  // the pure effectiveSpd read helper (floor(spd × ratio); NOT wired into the turn-order line, A-99), not here.
  'hasten-percent',
  // Hobble (TASK-114) — the flat SPD-DOWN debuff (foe-cast); its tick only counts down + logs (removes
  // NO HP), exactly like the weaken/enfeeble stat-debuff tick. Its SPD-LOWERING payoff lives in the pure
  // effectiveSpd read helper (spd - spdReduction; NOT wired into the turn-order line, A-99), not here.
  'hobble',
  // Cripple (TASK-115) — the percentage SPD-DOWN debuff (foe-cast); its tick only counts down + logs
  // (removes NO HP), exactly like the hobble/weaken-percent stat-debuff tick. Its SPD-LOWERING payoff
  // lives in the pure effectiveSpd read helper (spd - floor(spd × ratio); NOT wired into the turn-order
  // line, A-99), not here.
  'hobble-percent',
  'retaliate',
  'retaliate-percent',
  'stun',
  'freeze',
  'sleep',
];

/**
 * Per-kind ailment tuning + display metadata — the ONE source of truth for each
 * ailment's duration and the human-readable words used in the log. A new ailment
 * kind adds one entry here (plus a tick-order slot + a {@link SkillEffect} arm).
 * `AILMENT_LABEL` is the tick verb ("Burn deals …" / "… DEF is lowered"),
 * `AILMENT_APPLIED_LABEL` the applied adjective ("… is Burned" / "… is Weakened").
 *
 * A DoT arm carries `damagePerTurn`; the Weaken stat-modifier arm carries
 * `defReduction` instead (it removes no HP). The optional shape keeps ONE spec map
 * across both categories of lingering effect.
 */
const AILMENT_SPEC: Readonly<
  Record<
    StatusAilment['kind'],
    {
      duration: number;
      damagePerTurn?: number;
      // Burn-Percent (TASK-120) — the FRACTIONAL per-turn DoT magnitude; carried on its spec/arm the
      // percent-of-CURRENT-HP twin of the flat `damagePerTurn`, threaded exactly as the other
      // `-percent` twins thread their `ratio` (weaken-percent's `defReductionRatio`, doom-percent's
      // `detonationRatio`, etc.).
      damagePerTurnRatio?: number;
      defReduction?: number;
      defReductionRatio?: number;
      // Aegis (TASK-111) — a FRACTIONAL DEF-BONUS self-buff; carried on its spec/arm exactly as
      // `defReductionRatio` is for weaken-percent (its DEF-mitigation-seam negative percent mirror),
      // and the fractional twin of `defBonus` (fortify).
      defBonusRatio?: number;
      // Fortify (TASK-108) — a fixed DEF-BONUS self-buff; carried on its spec/arm exactly as
      // `defReduction` is for weaken (its negative mirror) and `atkBonus` for empower (its twin).
      defBonus?: number;
      // Hasten (TASK-112) — a fixed SPD-BONUS self-buff; carried on its spec/arm exactly as `defBonus`
      // is for fortify and `atkBonus` for empower (its DEF/ATK-axis twins). Read by effectiveSpd.
      spdBonus?: number;
      // Rush (TASK-113) — a FRACTIONAL SPD-BONUS self-buff; carried on its spec/arm exactly as
      // `defBonusRatio` is for fortify-percent / `atkBonusRatio` for empower-percent (its DEF/ATK-axis
      // percent twins), and the fractional twin of the flat `spdBonus` (hasten). Read by effectiveSpd.
      spdBonusRatio?: number;
      // Hobble (TASK-114) — a fixed SPD-REDUCTION foe-debuff; carried on its spec/arm exactly as
      // `defReduction` is for weaken and `atkReduction` for enfeeble (its DEF/ATK-axis debuff twins).
      // Read by effectiveSpd (SUBTRACTED, floored at MIN_EFFECTIVE_SPD).
      spdReduction?: number;
      // Cripple (TASK-115) — a FRACTIONAL SPD-REDUCTION foe-debuff; carried on its spec/arm exactly as
      // `defReductionRatio` is for weaken-percent and `atkReductionRatio` for enfeeble-percent (its
      // DEF/ATK-axis percent debuff twins), and the fractional twin of the flat `spdReduction` (hobble).
      // Read by effectiveSpd (SUBTRACTED via floor(spd × ratio), floored at MIN_EFFECTIVE_SPD).
      spdReductionRatio?: number;
      absorbAmount?: number;
      // Barrier / shield-percent (TASK-131) — the FRACTIONAL absorb-pool RATIO; carried on its spec the
      // percent-of-maxHp twin of the flat `absorbAmount`. Additive optional field — only `shield-percent`
      // sets it; every existing entry stays valid. The pool `floor(bearer.maxHp × absorbRatio)` is
      // materialized at APPLICATION time (applyAilment reads the bearer's maxHp), not stored here.
      absorbRatio?: number;
      atkBonus?: number;
      atkBonusRatio?: number;
      atkReduction?: number;
      atkReductionRatio?: number;
      damageTakenBonus?: number;
      damageTakenBonusRatio?: number;
      // Brace (TASK-109) — a fixed damage-taken REDUCTION self-buff; carried on its spec/arm exactly
      // as `damageTakenBonus` is for vulnerable (its damage-application-seam negative mirror).
      damageTakenReduction?: number;
      // Bulwark (TASK-110) — a FRACTIONAL damage-taken REDUCTION self-buff; carried on its spec/arm
      // exactly as `damageTakenBonusRatio` is for vulnerable-percent (its damage-application-seam
      // negative percent mirror), and the fractional twin of `damageTakenReduction`.
      damageTakenReductionRatio?: number;
      detonationDamage?: number;
      // Doom-Percent (TASK-119) — the FRACTIONAL detonation magnitude; carried on its spec/arm the
      // percent-of-CURRENT-HP twin of the flat `detonationDamage`, threaded exactly as the other
      // `-percent` twins thread their `ratio` (weaken-percent's `defReductionRatio`, etc.).
      detonationRatio?: number;
      ramp?: number;
      // Corrode-Percent (TASK-123) — the ratio-growth step for the fractional-RAMP DoT: carried on its
      // spec/arm the percent MIRROR of the flat `ramp` (which grows `corrode`'s flat `damagePerTurn`).
      // Additive optional field — only `corrode-percent` sets it; every existing entry stays valid. The
      // per-tick advance `damagePerTurnRatio += rampRatio` is the ratio-growth twin of `damagePerTurn += ramp`.
      rampRatio?: number;
      reflectDamage?: number;
      reflectRatio?: number;
    }
  >
> = {
  burn: { duration: BURN_DURATION, damagePerTurn: BURN_DAMAGE_PER_TURN },
  // Burn-Percent (TASK-120) — the FRACTIONAL (percent-of-CURRENT-HP) twin of the flat `burn` DoT.
  // Reuses `burn`'s duration; instead of a flat `damagePerTurn` it carries a `damagePerTurnRatio`,
  // so each tick subtracts `floor(hp × ratio)` of CURRENT HP (no maxHp read, no RNG).
  'burn-percent': { duration: BURN_DURATION, damagePerTurnRatio: BURN_PERCENT_DAMAGE_RATIO },
  // Wither-Percent (TASK-132) — the maxHp-fraction DoT. Carries `WITHER_DURATION` + the
  // `damagePerTurnRatio` (WITHER_PERCENT_DAMAGE_RATIO); `applyAilment` reads the ratio and the bearer's
  // maxHp to MATERIALIZE the fixed `damagePerTurn` = `floor(bearerMaxHp × ratio)` into the arm.
  'wither-percent': {
    duration: WITHER_DURATION,
    damagePerTurnRatio: WITHER_PERCENT_DAMAGE_RATIO,
  },
  poison: { duration: POISON_DURATION, damagePerTurn: POISON_DAMAGE_PER_TURN },
  // Poison-Percent (TASK-121) — reuses `poison`'s duration; instead of a flat `damagePerTurn` it
  // carries a `damagePerTurnRatio`, so each tick subtracts `floor(hp × ratio)` of CURRENT HP.
  'poison-percent': { duration: POISON_DURATION, damagePerTurnRatio: POISON_PERCENT_DAMAGE_RATIO },
  // Bleed (TASK-62) is the THIRD DoT — same shape as Burn/Poison (a per-turn HP tick),
  // just tuned longer-but-weaker so it reads distinct in the log.
  bleed: { duration: BLEED_DURATION, damagePerTurn: BLEED_DAMAGE_PER_TURN },
  // Bleed-Percent (TASK-122) — the fractional twin of `bleed`; reuses BLEED_DURATION and carries a
  // `damagePerTurnRatio` (percent-of-CURRENT-HP) instead of a flat `damagePerTurn`, mirroring
  // `poison-percent`/`burn-percent`.
  'bleed-percent': { duration: BLEED_DURATION, damagePerTurnRatio: BLEED_PERCENT_DAMAGE_RATIO },
  // Corrode (TASK-67) is the FOURTH DoT and the FIRST ESCALATING one — it carries a DoT's
  // `damagePerTurn` (seeded from CORRODE_INITIAL_DAMAGE) PLUS a `ramp` step by which its
  // tick grows each successive turn. Its dedicated tick branch reads/writes both.
  corrode: {
    duration: CORRODE_DURATION,
    damagePerTurn: CORRODE_INITIAL_DAMAGE,
    ramp: CORRODE_RAMP,
  },
  // Corrode-Percent (TASK-123) — the DoT family's FOURTH & FINAL `-percent` twin: the fractional-RAMP
  // combination. Reuses CORRODE_DURATION; instead of a flat `damagePerTurn`+`ramp` it carries a
  // `damagePerTurnRatio` (seeded from CORRODE_PERCENT_INITIAL_RATIO) PLUS a `rampRatio` step by which the
  // RATIO (not a flat magnitude) grows each successive tick. Its dedicated tick branch reads/writes both.
  'corrode-percent': {
    duration: CORRODE_DURATION,
    damagePerTurnRatio: CORRODE_PERCENT_INITIAL_RATIO,
    rampRatio: CORRODE_PERCENT_RAMP_RATIO,
  },
  weaken: { duration: WEAKEN_DURATION, defReduction: WEAKEN_DEF_REDUCTION },
  // Crumble / weaken-percent (TASK-100) — the fractional MIRROR of weaken. Like weaken its
  // tick removes no HP; it carries the `defReductionRatio` (a FRACTION of the target's CURRENT
  // def) read at the resolveDamageStrike weaken seam. Re-uses WEAKEN_DURATION (no duration
  // re-tune this wave), exactly as retaliate-percent re-uses RETALIATE_DURATION.
  'weaken-percent': {
    duration: WEAKEN_DURATION,
    defReductionRatio: WEAKEN_PERCENT_RATIO,
  },
  // Enfeeble (TASK-63) is the FOURTH stat-modifier — the OFFENSIVE-ATK mirror of
  // Weaken's DEF-debuff: it removes no HP, it lowers the afflicted attacker's ATK.
  enfeeble: { duration: ENFEEBLE_DURATION, atkReduction: ENFEEBLE_ATK_REDUCTION },
  // Sunder / enfeeble-percent (TASK-101) — the fractional MIRROR of enfeeble (the ATK-side twin
  // of Crumble/weaken-percent). Like enfeeble its tick removes no HP; it carries the
  // `atkReductionRatio` (a FRACTION of the target's CURRENT atk) read at the resolveDamageStrike
  // enfeeble seam. Re-uses ENFEEBLE_DURATION (no duration re-tune this wave), exactly as
  // weaken-percent re-uses WEAKEN_DURATION.
  'enfeeble-percent': {
    duration: ENFEEBLE_DURATION,
    atkReductionRatio: ENFEEBLE_PERCENT_RATIO,
  },
  // Vulnerable (TASK-65) is the FIFTH stat-modifier — the damage-AMP INVERSE of
  // Weaken's DEF-debuff / Enfeeble's ATK-debuff: it removes no HP, it raises the
  // incoming damage the afflicted DEFENDER takes (read at the damage seam).
  vulnerable: {
    duration: VULNERABLE_DURATION,
    damageTakenBonus: VULNERABLE_DAMAGE_TAKEN_BONUS,
  },
  // Rupture / vulnerable-percent (TASK-103) — the fractional MIRROR of vulnerable (the
  // damage-taken twin). Like vulnerable its tick removes no HP; it carries the
  // `damageTakenBonusRatio` (a FRACTION of the base strike) read at the amplifyForVulnerable
  // seam. Re-uses VULNERABLE_DURATION (no duration re-tune this wave), exactly as
  // enfeeble-percent re-uses ENFEEBLE_DURATION.
  'vulnerable-percent': {
    duration: VULNERABLE_DURATION,
    damageTakenBonusRatio: VULNERABLE_PERCENT_RATIO,
  },
  // Brace (TASK-109) — the damage-taken-DOWN self-buff, the exact POSITIVE MIRROR of vulnerable (its
  // damage-application-seam negative). Like vulnerable/fortify its tick removes no HP; it carries the
  // FIXED `damageTakenReduction` (read at the amplifyForVulnerable seam as a NEGATIVE bonus on the
  // DEFENDER side). Mirrors the vulnerable spec entry, one polarity over.
  brace: { duration: BRACE_DURATION, damageTakenReduction: BRACE_DAMAGE_TAKEN_REDUCTION },
  // Bulwark (TASK-110) — the PERCENTAGE damage-taken-DOWN self-buff, the fractional MIRROR of `brace`
  // and the DOWN-side percent twin of vulnerable-percent. Like brace/vulnerable-percent its tick removes
  // no HP; it carries the FRACTIONAL `damageTakenReductionRatio` (read at the amplifyForVulnerable seam
  // as a NEGATIVE ratio bonus on the DEFENDER side). Mirrors the vulnerable-percent spec, one polarity over.
  'brace-percent': {
    duration: BRACE_PERCENT_DURATION,
    damageTakenReductionRatio: BRACE_PERCENT_RATIO,
  },
  // Aegis / fortify-percent (TASK-111) — the PERCENTAGE DEF-UP self-buff, the fractional MIRROR of
  // `fortify` and the DEF-UP percent twin of the DEBUFF weaken-percent. Like fortify/weaken-percent its
  // tick removes no HP; it carries the FRACTIONAL `defBonusRatio` (read at the resolveDamageStrike
  // netDefReduction seam as a NEGATIVE reduction on the DEFENDER side — floor(def × ratio) SUBTRACTED).
  // Mirrors the weaken-percent spec, one polarity over.
  'fortify-percent': {
    duration: FORTIFY_PERCENT_DURATION,
    defBonusRatio: FORTIFY_PERCENT_RATIO,
  },
  // Hasten (TASK-112) — the FLAT SPD-UP self-buff, the FIRST member of the SPD stat-mod axis and the
  // SPD-axis twin of the DEF-up `fortify` (defBonus) / ATK-up `empower` (atkBonus). Like fortify/empower
  // its tick removes no HP; it carries the FIXED `spdBonus` read by the pure effectiveSpd helper (NOT
  // wired into the turn-order line this slice, A-99). Mirrors the fortify spec entry one axis over.
  hasten: { duration: HASTEN_DURATION, spdBonus: HASTEN_SPD_BONUS },
  // Rush (TASK-113) — the PERCENTAGE SPD-UP self-buff, the percent-UP twin of the flat `hasten` and the
  // SPD-axis mirror of the DEF-up `fortify-percent` (defBonusRatio) / ATK-up `empower-percent`
  // (atkBonusRatio). Like fortify-percent its tick removes no HP; it carries the RATIO read by the pure
  // effectiveSpd helper via floor(spd × ratio) (NOT wired into the turn-order line, A-99). Mirrors the
  // fortify-percent spec entry one axis over.
  'hasten-percent': {
    duration: HASTEN_PERCENT_DURATION,
    spdBonusRatio: HASTEN_PERCENT_RATIO,
  },
  // Hobble (TASK-114) — the FLAT SPD-DOWN debuff, the FIRST member of the SPD-axis DOWN half and the
  // SPD-axis mirror of the DEF-down `weaken` (defReduction) / ATK-down `enfeeble` (atkReduction). Like
  // weaken/enfeeble its tick removes no HP; it carries the FIXED `spdReduction` read by the pure
  // effectiveSpd helper (spd - spdReduction, floored at MIN_EFFECTIVE_SPD; NOT wired into the turn-order
  // line, A-99). Mirrors the weaken spec entry one axis over.
  hobble: { duration: HOBBLE_DURATION, spdReduction: HOBBLE_SPD_REDUCTION },
  // Cripple (TASK-115) — the PERCENTAGE SPD-DOWN debuff, COMPLETING the SPD-axis DOWN percent square
  // (the percentage twin of the flat `hobble` and the SPD-axis mirror of weaken-percent/enfeeble-percent).
  // Like hobble/weaken-percent its tick removes no HP; it carries the FRACTIONAL `spdReductionRatio` read
  // by the pure effectiveSpd helper (spd - floor(spd × ratio), floored at MIN_EFFECTIVE_SPD; NOT wired
  // into the turn-order line, A-99). Mirrors the weaken-percent spec entry one axis over.
  'hobble-percent': {
    duration: HOBBLE_PERCENT_DURATION,
    spdReductionRatio: HOBBLE_PERCENT_RATIO,
  },
  // Doom (TASK-66) is the DEFERRED-damage family — the FIRST scheduled/detonation
  // ailment. It carries a `detonationDamage` payload dealt ONCE at expiry (NOT per
  // turn), so its spec has no `damagePerTurn` — the tick loop counts it down and only
  // subtracts HP at the moment the fuse hits 0.
  doom: { duration: DOOM_DURATION, detonationDamage: DOOM_DETONATION_DAMAGE },
  // Doom-Percent (TASK-119) — the FRACTIONAL twin of `doom`: reuses DOOM_DURATION (same fuse) but
  // carries a `detonationRatio` instead of a flat `detonationDamage`, detonating
  // `floor(hp × DOOM_PERCENT_DETONATION_RATIO)` of CURRENT HP at fuse-end (no maxHp read).
  'doom-percent': { duration: DOOM_DURATION, detonationRatio: DOOM_PERCENT_DETONATION_RATIO },
  shield: { duration: SHIELD_DURATION, absorbAmount: SHIELD_ABSORB_AMOUNT },
  // Barrier / shield-percent (TASK-131) — the FRACTIONAL twin of `shield`: reuses SHIELD_PERCENT_DURATION
  // (= SHIELD_DURATION) but carries an `absorbRatio` instead of a flat `absorbAmount`, so its absorb pool
  // is materialized as `floor(bearer.maxHp × SHIELD_PERCENT_ABSORB_RATIO)` at apply time.
  'shield-percent': { duration: SHIELD_PERCENT_DURATION, absorbRatio: SHIELD_PERCENT_ABSORB_RATIO },
  empower: { duration: EMPOWER_DURATION, atkBonus: EMPOWER_ATK_BONUS },
  // Fortify (TASK-108) — the DEF-up self-buff, the exact SELF-BUFF MIRROR of weaken (its negative)
  // and the DEF-axis twin of empower. Like empower its tick removes no HP; it carries the FIXED
  // `defBonus` (read at the resolveDamageStrike netDefReduction seam as a NEGATIVE reduction on the
  // DEFENDER side). Mirrors the empower spec entry one axis over.
  fortify: { duration: FORTIFY_DURATION, defBonus: FORTIFY_DEF_BONUS },
  // Reinforce / empower-percent (TASK-102) — the fractional MIRROR of empower (the ATK-BONUS twin of
  // Sunder/enfeeble-percent). Like empower its tick removes no HP; it carries the `atkBonusRatio`
  // (a FRACTION of the caster's CURRENT atk) read at the resolveDamageStrike empower seam. Re-uses
  // EMPOWER_DURATION (no duration re-tune this wave), exactly as enfeeble-percent re-uses ENFEEBLE_DURATION.
  'empower-percent': {
    duration: EMPOWER_DURATION,
    atkBonusRatio: EMPOWER_PERCENT_RATIO,
  },
  // Retaliate (TASK-69) — the FIRST reactive/on-being-hit self-buff. Like the other
  // self-buffs its tick removes no HP; it carries the FIXED `reflectDamage` read at the
  // hit site when the retaliator is STRUCK for real HP damage.
  retaliate: {
    duration: RETALIATE_DURATION,
    reflectDamage: RETALIATE_REFLECT_DAMAGE,
  },
  // Thorn Mirror / retaliate-percent (TASK-99) — the fractional MIRROR of retaliate. Like
  // the other self-buffs its tick removes no HP; it carries the `reflectRatio` (a FRACTION
  // of the incoming overflow) read at the hit site when the retaliator is STRUCK. Re-uses
  // RETALIATE_DURATION (no duration re-tune this wave).
  'retaliate-percent': {
    duration: RETALIATE_DURATION,
    reflectRatio: RETALIATE_PERCENT_RATIO,
  },
  // Stun (TASK-57) carries NO numeric payload — its effect is "skip the action step",
  // not a magnitude — so it has ONLY a duration (no damagePerTurn/defReduction/etc).
  stun: { duration: STUN_DURATION },
  // Freeze (TASK-59) is the SECOND control ailment — like Stun it carries NO numeric
  // payload (its effect is "skip the action step"), but for MULTIPLE consecutive turns
  // (FREEZE_DURATION > 1). Only a duration.
  freeze: { duration: FREEZE_DURATION },
  // Sleep (TASK-60) is the THIRD control ailment — like Stun/Freeze it carries NO
  // numeric payload (its effect is "skip the action step"), but for the LONGEST
  // duration (SLEEP_DURATION) UNLESS broken early by a damage hit. Only a duration.
  sleep: { duration: SLEEP_DURATION },
};

const AILMENT_LABEL: Readonly<Record<StatusAilment['kind'], string>> = {
  burn: 'Burn',
  // Burn-Percent (TASK-120) — the fractional (percent-of-CURRENT-HP) DoT twin of Burn.
  'burn-percent': 'Smolder',
  // Wither-Percent (TASK-132) — the maxHp-fraction DoT (the FIRST DoT sized off `maxHp`).
  'wither-percent': 'Wither',
  poison: 'Poison',
  // Poison-Percent (TASK-121) — the fractional (percent-of-CURRENT-HP) DoT twin of Poison.
  'poison-percent': 'Toxin',
  bleed: 'Bleed',
  'bleed-percent': 'Hemorrhage',
  weaken: 'Weaken',
  'weaken-percent': 'Crumble',
  enfeeble: 'Enfeeble',
  'enfeeble-percent': 'Sunder',
  vulnerable: 'Vulnerable',
  'vulnerable-percent': 'Rupture',
  doom: 'Doom',
  // Doom-Percent (TASK-119) — the fractional detonation twin of Doom.
  'doom-percent': 'Doom-Percent',
  shield: 'Shield',
  // Barrier / shield-percent (TASK-131) — the maxHp-fraction absorb twin of Shield.
  'shield-percent': 'Barrier',
  empower: 'Empower',
  'empower-percent': 'Reinforce',
  fortify: 'Fortify',
  retaliate: 'Retaliate',
  'retaliate-percent': 'Thorn Mirror',
  stun: 'Stun',
  freeze: 'Freeze',
  sleep: 'Sleep',
  corrode: 'Corrode',
  // Corrode-Percent (TASK-123) — the fractional-RAMP DoT twin of `corrode`.
  'corrode-percent': 'Necrosis',
  brace: 'Brace',
  'brace-percent': 'Bulwark',
  'fortify-percent': 'Aegis',
  // Hasten (TASK-112) — the flat SPD-up self-buff; label mirrors fortify/empower (a buff, not a debuff).
  hasten: 'Quicken',
  'hasten-percent': 'Rush',
  // Hobble (TASK-114) — the flat SPD-DOWN debuff; label mirrors weaken/enfeeble (a debuff).
  hobble: 'Hobble',
  // Cripple (TASK-115) — the percentage SPD-DOWN debuff display name (A-100).
  'hobble-percent': 'Cripple',
};

const AILMENT_APPLIED_LABEL: Readonly<Record<StatusAilment['kind'], string>> = {
  burn: 'Burned',
  // Burn-Percent (TASK-120) — the fractional DoT twin of Burned.
  'burn-percent': 'Smoldering',
  // Wither-Percent (TASK-132) — the maxHp-fraction DoT applied-label.
  'wither-percent': 'Withering',
  poison: 'Poisoned',
  // Poison-Percent (TASK-121) — the fractional DoT twin of Poisoned.
  'poison-percent': 'Toxified',
  bleed: 'Bleeding',
  'bleed-percent': 'Hemorrhaging',
  weaken: 'Weakened',
  'weaken-percent': 'Crumbling',
  enfeeble: 'Enfeebled',
  'enfeeble-percent': 'Sundering',
  vulnerable: 'Vulnerable',
  'vulnerable-percent': 'Ruptured',
  doom: 'Doomed',
  // Doom-Percent (TASK-119) — the fractional detonation twin of Doomed.
  'doom-percent': 'Doom-Percent-Cursed',
  shield: 'Shielded',
  // Barrier / shield-percent (TASK-131) — the applied-adjective for the maxHp-fraction absorb buff.
  'shield-percent': 'Barriered',
  empower: 'Empowered',
  'empower-percent': 'Reinforced',
  fortify: 'Fortified',
  retaliate: 'Retaliating',
  'retaliate-percent': 'Mirroring',
  stun: 'Stunned',
  freeze: 'Frozen',
  sleep: 'Asleep',
  corrode: 'Corroding',
  // Corrode-Percent (TASK-123) — the fractional-RAMP DoT twin of `corrode`.
  'corrode-percent': 'Necrotic',
  brace: 'Braced',
  'brace-percent': 'Bulwarked',
  'fortify-percent': 'Aegis-warded',
  // Hasten (TASK-112) — the flat SPD-up self-buff applied-adjective, mirroring fortify/empower.
  hasten: 'Quickened',
  'hasten-percent': 'Rushed',
  // Hobble (TASK-114) — the flat SPD-DOWN debuff applied-adjective, mirroring weaken/enfeeble.
  hobble: 'Hobbled',
  // Cripple (TASK-115) — the applied-adjective for the percentage SPD-DOWN debuff (A-100).
  'hobble-percent': 'Crippled',
};

/**
 * Apply (or REFRESH) an ailment of `kind` on a status collection — PURE: returns a
 * NEW array with at most one entry per kind, its `turnsRemaining` reset to the
 * kind's full duration (a re-apply overwrites in place, never stacks — matching the
 * original Burn semantics). Other kinds already present are preserved so a fighter
 * can carry Burn AND Poison AND Weaken at once. The fresh arm is built to match the
 * union arm's shape — a DoT arm gets `damagePerTurn`, the Weaken arm `defReduction`.
 */
export function applyAilment(
  statuses: readonly StatusAilment[],
  kind: StatusAilment['kind'],
  // Barrier / shield-percent (TASK-131) — the ONLY kind whose payload is SIZED from the bearer's OWN
  // maxHp (a maxHp-fraction absorb pool), so it needs the bearer's maxHp at apply time. Additive
  // optional param, defaulting to 0 — every existing call (which never applies `shield-percent`) is
  // byte-unchanged. The flat `shield` and every other kind ignore it entirely.
  bearerMaxHp = 0,
): StatusAilment[] {
  const spec = AILMENT_SPEC[kind];
  const others = statuses.filter((s) => s.kind !== kind);
  if (kind === 'weaken') {
    return [
      ...others,
      { kind: 'weaken', turnsRemaining: spec.duration, defReduction: spec.defReduction! },
    ];
  }
  if (kind === 'weaken-percent') {
    // Crumble (TASK-100) — the fractional MIRROR of weaken. Its arm carries a
    // `defReductionRatio` payload (read at the resolveDamageStrike weaken seam as a FRACTION
    // of the target's CURRENT def), exactly as weaken carries defReduction and
    // retaliate-percent carries reflectRatio. Applied to the DEFENDER (the opponent), like
    // weaken; a re-apply REFRESHES turnsRemaining (the deliberate no-stack refresh).
    return [
      ...others,
      {
        kind: 'weaken-percent',
        turnsRemaining: spec.duration,
        defReductionRatio: spec.defReductionRatio!,
      },
    ];
  }
  if (kind === 'enfeeble') {
    // The FOURTH stat-modifier (TASK-63) — the OFFENSIVE-ATK mirror of Weaken. Its
    // arm carries an `atkReduction` payload (read off the AFFLICTED attacker at the
    // damage seam), exactly as Weaken carries `defReduction` and Empower `atkBonus`.
    return [
      ...others,
      { kind: 'enfeeble', turnsRemaining: spec.duration, atkReduction: spec.atkReduction! },
    ];
  }
  if (kind === 'hobble') {
    // Hobble (TASK-114) — the FLAT SPD-DOWN debuff, the SPD-axis mirror of Weaken (DEF-down) and
    // Enfeeble (ATK-down). Its arm carries a `spdReduction` payload (read off the AFFLICTED combatant
    // by the pure effectiveSpd helper via `spd - spdReduction`), exactly as Weaken carries
    // `defReduction` and Enfeeble `atkReduction`. Applied to the FOE (the opponent), like
    // weaken/enfeeble; a re-apply REFRESHES turnsRemaining (the deliberate no-stack refresh).
    return [
      ...others,
      { kind: 'hobble', turnsRemaining: spec.duration, spdReduction: spec.spdReduction! },
    ];
  }
  if (kind === 'hobble-percent') {
    // Cripple (TASK-115) — the PERCENTAGE SPD-DOWN debuff, the percentage twin of the flat Hobble and
    // the SPD-axis mirror of weaken-percent (DEF-down) / enfeeble-percent (ATK-down). Its arm carries a
    // `spdReductionRatio` payload (read off the AFFLICTED combatant by the pure effectiveSpd helper via
    // `spd - floor(spd × ratio)`), exactly as weaken-percent carries defReductionRatio. Applied to the
    // FOE (the opponent), like hobble/weaken-percent; a re-apply REFRESHES turnsRemaining (the deliberate
    // no-stack refresh).
    return [
      ...others,
      {
        kind: 'hobble-percent',
        turnsRemaining: spec.duration,
        spdReductionRatio: spec.spdReductionRatio!,
      },
    ];
  }
  if (kind === 'enfeeble-percent') {
    // Sunder (TASK-101) — the fractional MIRROR of enfeeble (the ATK-side twin of Crumble).
    // Its arm carries an `atkReductionRatio` payload (read at the resolveDamageStrike enfeeble
    // seam as a FRACTION of the AFFLICTED attacker's CURRENT atk), exactly as enfeeble carries
    // atkReduction and weaken-percent carries defReductionRatio. Applied to the DEFENDER (the
    // opponent), like enfeeble; a re-apply REFRESHES turnsRemaining (the deliberate no-stack
    // refresh).
    return [
      ...others,
      {
        kind: 'enfeeble-percent',
        turnsRemaining: spec.duration,
        atkReductionRatio: spec.atkReductionRatio!,
      },
    ];
  }
  if (kind === 'vulnerable') {
    // The FIFTH stat-modifier (TASK-65) — the damage-AMP inverse of Weaken/Enfeeble.
    // Its arm carries a `damageTakenBonus` payload (read off the AFFLICTED defender at
    // the damage seam), exactly as Weaken carries `defReduction` and Enfeeble
    // `atkReduction`. Applied to the DEFENDER (the opponent), like Weaken/Enfeeble.
    return [
      ...others,
      {
        kind: 'vulnerable',
        turnsRemaining: spec.duration,
        damageTakenBonus: spec.damageTakenBonus!,
      },
    ];
  }
  if (kind === 'vulnerable-percent') {
    // Rupture (TASK-103) — the fractional MIRROR of vulnerable (the damage-taken twin). Its
    // arm carries a `damageTakenBonusRatio` payload (read at the amplifyForVulnerable seam as a
    // FRACTION of the base strike), exactly as vulnerable carries damageTakenBonus and
    // enfeeble-percent carries atkReductionRatio. Applied to the DEFENDER (the opponent), like
    // vulnerable; a re-apply REFRESHES turnsRemaining (the deliberate no-stack refresh).
    return [
      ...others,
      {
        kind: 'vulnerable-percent',
        turnsRemaining: spec.duration,
        damageTakenBonusRatio: spec.damageTakenBonusRatio!,
      },
    ];
  }
  if (kind === 'doom') {
    // The DEFERRED-damage family (TASK-66) — the FIRST scheduled/detonation ailment.
    // Its arm carries a `detonationDamage` payload (dealt ONCE at expiry by the tick
    // loop, NOT per turn), distinct from a DoT's `damagePerTurn`. Applied to the
    // DEFENDER (the opponent), like the DoTs/debuffs. A re-apply REFRESHES the fuse
    // (overwrites in place — the deliberate no-stack refresh, matching every ailment).
    return [
      ...others,
      {
        kind: 'doom',
        turnsRemaining: spec.duration,
        detonationDamage: spec.detonationDamage!,
      },
    ];
  }
  if (kind === 'doom-percent') {
    // Doom-Percent (TASK-119) — the FRACTIONAL twin of `doom`. Its arm carries a `detonationRatio`
    // (dealt ONCE at fuse-end as `floor(hp × ratio)` of CURRENT HP by the tick loop, NOT per turn),
    // the percent-of-CURRENT mirror of `doom`'s flat `detonationDamage`. Applied to the DEFENDER
    // (the opponent), like `doom`. A re-apply REFRESHES the fuse (overwrites in place — the
    // deliberate no-stack refresh, matching every ailment).
    return [
      ...others,
      {
        kind: 'doom-percent',
        turnsRemaining: spec.duration,
        detonationRatio: spec.detonationRatio!,
      },
    ];
  }
  if (kind === 'shield') {
    return [
      ...others,
      { kind: 'shield', turnsRemaining: spec.duration, absorbRemaining: spec.absorbAmount! },
    ];
  }
  if (kind === 'shield-percent') {
    // Barrier (TASK-131) — the FRACTIONAL twin of `shield` (the LAST buff family to get a `-percent`
    // mirror). Structurally identical to the shield arm, but its `absorbRemaining` pool is SIZED as a
    // bounded FRACTION of the BEARER's OWN maxHp — `floor(bearerMaxHp × SHIELD_PERCENT_ABSORB_RATIO)` —
    // rather than the flat SHIELD_ABSORB_AMOUNT. This is the ONE place the mechanic differs from `shield`
    // (the drain seam + the tick are byte-identical); a bulkier bearer therefore gets a strictly larger
    // pool. Floored (never fractional HP). Applied to SELF (the caster), like `shield`; a re-apply
    // REFRESHES via the `others`-filter no-stack refresh. HP is never written here (A-42).
    return [
      ...others,
      {
        kind: 'shield-percent',
        turnsRemaining: spec.duration,
        absorbRemaining: Math.floor(bearerMaxHp * spec.absorbRatio!),
      },
    ];
  }
  if (kind === 'empower') {
    return [
      ...others,
      { kind: 'empower', turnsRemaining: spec.duration, atkBonus: spec.atkBonus! },
    ];
  }
  if (kind === 'fortify') {
    // Fortify (TASK-108) — the DEF-up self-buff (the SELF-BUFF mirror of weaken, the DEF-axis twin
    // of empower). Applied to SELF (the caster), like empower. Its arm carries the FIXED `defBonus`
    // (read at the resolveDamageStrike netDefReduction seam as a NEGATIVE reduction). A re-apply
    // REFRESHES turnsRemaining via the existing `others`-filter no-stack refresh, exactly like empower.
    return [
      ...others,
      { kind: 'fortify', turnsRemaining: spec.duration, defBonus: spec.defBonus! },
    ];
  }
  if (kind === 'brace') {
    // Brace (TASK-109) — the damage-taken-DOWN self-buff (the POSITIVE MIRROR of vulnerable at the
    // damage-application seam). Applied to SELF (the caster), like fortify/empower. Its arm carries
    // the FIXED `damageTakenReduction` (read at the amplifyForVulnerable seam as a NEGATIVE bonus).
    // A re-apply REFRESHES turnsRemaining via the existing `others`-filter no-stack refresh, exactly
    // like fortify.
    return [
      ...others,
      {
        kind: 'brace',
        turnsRemaining: spec.duration,
        damageTakenReduction: spec.damageTakenReduction!,
      },
    ];
  }
  if (kind === 'brace-percent') {
    // Bulwark (TASK-110) — the PERCENTAGE damage-taken-DOWN self-buff (the fractional MIRROR of brace,
    // and the DOWN-side percent twin of vulnerable-percent at the damage-application seam). Applied to
    // SELF (the caster), like brace/fortify/empower. Its arm carries the FRACTIONAL
    // `damageTakenReductionRatio` (read at the amplifyForVulnerable seam as a NEGATIVE ratio bonus). A
    // re-apply REFRESHES turnsRemaining via the existing `others`-filter no-stack refresh, exactly like brace.
    return [
      ...others,
      {
        kind: 'brace-percent',
        turnsRemaining: spec.duration,
        damageTakenReductionRatio: spec.damageTakenReductionRatio!,
      },
    ];
  }
  if (kind === 'fortify-percent') {
    // Aegis (TASK-111) — the PERCENTAGE DEF-UP self-buff (the fractional MIRROR of fortify, and the
    // DEF-UP percent twin of the DEBUFF weaken-percent at the DEF-mitigation seam). Applied to SELF
    // (the caster), like fortify/brace/empower. Its arm carries the FRACTIONAL `defBonusRatio` (read
    // at the resolveDamageStrike netDefReduction seam as a NEGATIVE reduction — floor(def × ratio)
    // SUBTRACTED). A re-apply REFRESHES turnsRemaining via the existing `others`-filter no-stack
    // refresh, exactly like fortify.
    return [
      ...others,
      {
        kind: 'fortify-percent',
        turnsRemaining: spec.duration,
        defBonusRatio: spec.defBonusRatio!,
      },
    ];
  }
  if (kind === 'hasten') {
    // Hasten (TASK-112) — the FLAT SPD-UP self-buff (the SPD-axis twin of the DEF-up fortify and the
    // ATK-up empower). Applied to SELF (the caster), like fortify/empower. Its arm carries the FIXED
    // `spdBonus` (read by the pure effectiveSpd helper — NOT wired into the turn-order line this slice,
    // A-99). A re-apply REFRESHES turnsRemaining via the existing `others`-filter no-stack refresh,
    // exactly like fortify/empower.
    return [
      ...others,
      {
        kind: 'hasten',
        turnsRemaining: spec.duration,
        spdBonus: spec.spdBonus!,
      },
    ];
  }
  if (kind === 'hasten-percent') {
    // Rush (TASK-113) — the PERCENTAGE SPD-UP self-buff (the fractional MIRROR of hasten, and the
    // SPD-axis mirror of the DEF-up fortify-percent / ATK-up empower-percent). Applied to SELF (the
    // caster), like hasten/fortify-percent/empower. Its arm carries the FRACTIONAL `spdBonusRatio`
    // (read by the pure effectiveSpd helper via floor(spd × ratio) — NOT wired into the turn-order
    // line, A-99). A re-apply REFRESHES turnsRemaining via the existing `others`-filter no-stack
    // refresh, exactly like fortify-percent.
    return [
      ...others,
      {
        kind: 'hasten-percent',
        turnsRemaining: spec.duration,
        spdBonusRatio: spec.spdBonusRatio!,
      },
    ];
  }
  if (kind === 'empower-percent') {
    // Reinforce (TASK-102) — the fractional MIRROR of empower (the ATK-BONUS twin of Sunder).
    // Its arm carries an `atkBonusRatio` payload (read at the resolveDamageStrike empower seam as
    // a FRACTION of the CASTER's CURRENT atk), exactly as empower carries atkBonus and
    // enfeeble-percent carries atkReductionRatio. Applied to SELF (the caster), like empower; a
    // re-apply REFRESHES turnsRemaining (the deliberate no-stack refresh).
    return [
      ...others,
      {
        kind: 'empower-percent',
        turnsRemaining: spec.duration,
        atkBonusRatio: spec.atkBonusRatio!,
      },
    ];
  }
  if (kind === 'retaliate') {
    // The FIRST reactive/on-being-hit self-buff (TASK-69). Its arm carries a fixed
    // `reflectDamage` payload (read at the resolveDamageStrike hit site when this side
    // is STRUCK for real HP damage), exactly as Empower carries `atkBonus`. A re-apply
    // REFRESHES turnsRemaining in place (the deliberate no-stack refresh, matching every
    // ailment). Self-targeting like shield/empower.
    return [
      ...others,
      {
        kind: 'retaliate',
        turnsRemaining: spec.duration,
        reflectDamage: spec.reflectDamage!,
      },
    ];
  }
  if (kind === 'retaliate-percent') {
    // Thorn Mirror (TASK-99) — the fractional MIRROR of retaliate. Its arm carries a
    // `reflectRatio` payload (read at the resolveDamageStrike hit site as a FRACTION of the
    // incoming overflow when this side is STRUCK), exactly as retaliate carries reflectDamage.
    // Self-targeting like retaliate/shield/empower; a re-apply REFRESHES turnsRemaining.
    return [
      ...others,
      {
        kind: 'retaliate-percent',
        turnsRemaining: spec.duration,
        reflectRatio: spec.reflectRatio!,
      },
    ];
  }
  if (kind === 'stun') {
    // A control ailment (TASK-57): no numeric payload — its arm holds only
    // turnsRemaining (its effect is "skip the action step", not a magnitude).
    return [...others, { kind: 'stun', turnsRemaining: spec.duration }];
  }
  if (kind === 'freeze') {
    // The SECOND control ailment (TASK-59): also payload-free — its arm holds only
    // turnsRemaining, but at FREEZE_DURATION (> 1) it suppresses SEVERAL turns.
    return [...others, { kind: 'freeze', turnsRemaining: spec.duration }];
  }
  if (kind === 'sleep') {
    // The THIRD control ailment (TASK-60): also payload-free — its arm holds only
    // turnsRemaining, at SLEEP_DURATION (the LONGEST lock), but INTERRUPTIBLE (the
    // wake hook in resolveDamageStrike removes it early on a damage hit).
    return [...others, { kind: 'sleep', turnsRemaining: spec.duration }];
  }
  if (kind === 'wither-percent') {
    // Wither-Percent (TASK-132) — the FIRST DoT sized off the bearer's OWN `maxHp`. Unlike the
    // current-hp percent-DoT branches (which stash the RATIO and let the tick read `hp × ratio`), this
    // MATERIALIZES the per-turn amount ONCE here as `floor(bearerMaxHp × damagePerTurnRatio)` and
    // stores it as a FLAT `damagePerTurn` (the same shape the `burn` arm carries) — safe because
    // `maxHp` is immutable during a fight, so materialize-at-apply === recompute-each-tick, and it
    // keeps the tick a byte-identical subtract. The DEFENDER's maxHp arrives via the `bearerMaxHp` arg
    // (the SAME arg shield-percent uses; the wither-percent effect branch in simulateBattle passes
    // `them.maxHp`). A re-apply REFRESHES the fuse (overwrites in place — the deliberate no-stack
    // refresh). Writes NO HP here (A-42).
    return [
      ...others,
      {
        kind: 'wither-percent',
        turnsRemaining: spec.duration,
        damagePerTurn: Math.floor(bearerMaxHp * spec.damagePerTurnRatio!),
      },
    ];
  }
  if (kind === 'burn-percent') {
    // Burn-Percent (TASK-120) — the FRACTIONAL DoT twin of `burn`. Its arm carries a
    // `damagePerTurnRatio` (seeded from the spec's BURN_PERCENT_DAMAGE_RATIO) instead of a flat
    // `damagePerTurn`, so the dedicated tick can subtract `floor(hp × ratio)` of CURRENT HP. A
    // re-apply REFRESHES the fuse (overwrites in place — the deliberate no-stack refresh).
    return [
      ...others,
      {
        kind: 'burn-percent',
        turnsRemaining: spec.duration,
        damagePerTurnRatio: spec.damagePerTurnRatio!,
      },
    ];
  }
  if (kind === 'poison-percent') {
    // Poison-Percent (TASK-121) — the FRACTIONAL DoT twin of `poison`, mirroring the `burn-percent`
    // dedicated branch. Its arm carries a `damagePerTurnRatio` (seeded from the spec's
    // POISON_PERCENT_DAMAGE_RATIO) instead of a flat `damagePerTurn`, so the dedicated tick can
    // subtract `floor(hp × ratio)` of CURRENT HP. A re-apply REFRESHES the fuse (no-stack refresh).
    return [
      ...others,
      {
        kind: 'poison-percent',
        turnsRemaining: spec.duration,
        damagePerTurnRatio: spec.damagePerTurnRatio!,
      },
    ];
  }
  if (kind === 'bleed-percent') {
    // Bleed-Percent (TASK-122) — the FRACTIONAL DoT twin of `bleed`, mirroring the `poison-percent`
    // dedicated branch. Its arm carries a `damagePerTurnRatio` (seeded from the spec's
    // BLEED_PERCENT_DAMAGE_RATIO) instead of a flat `damagePerTurn`, so the dedicated tick can
    // subtract `floor(hp × ratio)` of CURRENT HP. A re-apply REFRESHES the fuse (no-stack refresh).
    return [
      ...others,
      {
        kind: 'bleed-percent',
        turnsRemaining: spec.duration,
        damagePerTurnRatio: spec.damagePerTurnRatio!,
      },
    ];
  }
  if (kind === 'corrode') {
    // The FOURTH DoT (TASK-67) — the FIRST ESCALATING one. Like the flat DoTs its arm    // carries `damagePerTurn` (seeded from the spec's CORRODE_INITIAL_DAMAGE) so the
    // dedicated tick can subtract it, but it ADDITIONALLY carries the `ramp` step by
    // which the tick GROWS that per-turn damage after each turn — the escalating shape.
    // A re-apply REFRESHES both the fuse AND resets damagePerTurn to the INITIAL value
    // (overwrites in place — the deliberate no-stack refresh, matching every ailment).
    return [
      ...others,
      {
        kind: 'corrode',
        turnsRemaining: spec.duration,
        damagePerTurn: spec.damagePerTurn!,
        ramp: spec.ramp!,
      },
    ];
  }
  if (kind === 'corrode-percent') {
    // Corrode-Percent (TASK-123) — the fractional-RAMP DoT twin of `corrode`, the DoT family's FOURTH &
    // FINAL `-percent` member. Like `bleed-percent` its arm carries a `damagePerTurnRatio` (seeded from
    // the spec's CORRODE_PERCENT_INITIAL_RATIO) so the dedicated tick subtracts `floor(hp × ratio)` of
    // CURRENT HP, but it ADDITIONALLY carries the `rampRatio` step by which the tick GROWS that RATIO after
    // each turn — the ratio-growth mirror of `corrode`'s flat-magnitude ramp. A re-apply REFRESHES both
    // the fuse AND resets damagePerTurnRatio to the INITIAL value AND rampRatio from spec (overwrites in
    // place — the deliberate no-stack refresh, matching `corrode`).
    return [
      ...others,
      {
        kind: 'corrode-percent',
        turnsRemaining: spec.duration,
        damagePerTurnRatio: spec.damagePerTurnRatio!,
        rampRatio: spec.rampRatio!,
      },
    ];
  }
  return [...others, { kind, turnsRemaining: spec.duration, damagePerTurn: spec.damagePerTurn! }];
}

/**
 * Back-compat alias (TASK-51 exported `BurnStatus`; TASK-53 generalized it). Kept as
 * the Burn arm of {@link StatusAilment} so any existing import keeps compiling
 * (invariant 5 — additive, no released shape broken).
 */
export type BurnStatus = Extract<StatusAilment, { kind: 'burn' }>;

/**
 * A composite effect a skill applies, in order. SEVEN kinds as of TASK-58: a raw
 * single `damage` hit, a `burn` DoT application, a `poison` DoT application, a
 * `weaken` stat-modifier (DEF-debuff), a `shield` damage-absorbing buffer, an
 * `empower` ATK-buff, a `stun` control ailment, and a `multihit` — the FIRST effect
 * that lands REPEATED discrete damage STRIKES in one action (each its own log entry).
 * The offensive arms (`damage`/`burn`/`poison`/`weaken`/`stun`/`multihit`) apply to
 * the DEFENDER; the `shield`/`empower` arms are SELF-targeting (they apply to the
 * ACTOR's OWN statuses — see the self-vs-defender branch in {@link simulateBattle}).
 *
 * `multihit` is the FIRST PARAMETERIZED effect arm — it carries a `hits` count (the
 * six other arms are payload-free). Its `hits` strikes each route through the SAME
 * damage-application path (`resolveAttack` → shield-absorb-before-HP → the monotonic
 * `max(0, hp − dmg)` write) the single `damage` arm uses, so shield/overflow/Weaken/
 * Empower behaviour stays identical and regression-safe. Kept a SEPARATE arm from
 * `damage` so the existing single-hit skills stay byte-unchanged (a `hits:1` multihit
 * would behave identically, but `damage` is NOT collapsed into it).
 */
export type SkillEffect =
  | { kind: 'damage' }
  // TASK-126 (R-17c): the FIRST mechanic the new `maxHp` substrate unlocks — an EXECUTE finisher.
  // It resolves through the SHARED {@link resolveDamageStrike} seam (deal the normal strike), then
  // — WHEN the defender's CURRENT `hp <= floor(maxHp × hpThresholdRatio)` (the FIRST percent-of-MAX
  // read in the engine, a pure read of `maxHp`) — deals `bonusDamage` MORE through the SAME monotone
  // `hp = max(0, hp − X)` write. Above the threshold → just the normal strike. Execute only ever
  // DEALS more damage, never heals → HP stays monotonically non-increasing (A-42). The magnitudes
  // live in the arm ({@link EXECUTE_BONUS_DAMAGE} / {@link EXECUTE_HP_THRESHOLD_RATIO}) so the
  // catalog row is data. Shipped Posture-B (cost 87 > MAX_ENERGY) so it never fires in-sim; proven
  // by a direct-seam apply unit at both sides of the threshold + a `selectSkill(87)` boundary unit.
  | { kind: 'execute'; bonusDamage: number; hpThresholdRatio: number }
  // GUILLOTINE (TASK-127) — the FIRST max-HP-FRACTION burst. Deal the normal strike through the
  // SHARED core, then — WHEN the defender's CURRENT `hp <= floor(maxHp × hpThresholdRatio)` — deal a
  // bonus SIZED as `floor(maxHp × bonusRatio)` (the FIRST time `maxHp` SIZES a damage number; execute
  // only READS `maxHp` to gate a FIXED bonus). Above the threshold → just the normal strike. The
  // bonus is subtracted through the SAME monotone `hp = max(0, hp − X)` write, so HP stays
  // monotonically non-increasing (A-42 — guillotine only ever DEALS more, never heals). The
  // magnitudes live in the arm ({@link GUILLOTINE_BONUS_RATIO} / {@link GUILLOTINE_HP_THRESHOLD_RATIO})
  // so the catalog row is data. Shipped Posture-B (cost 88 > MAX_ENERGY) so it never fires in-sim;
  // proven by direct-seam apply units (both sides of the threshold + a maxHp-SCALING contrast) + a
  // `selectSkill(88)` boundary unit.
  | { kind: 'guillotine'; bonusRatio: number; hpThresholdRatio: number }
  // RAMPAGE (TASK-128) — the FIRST MISSING-HP-FRACTION burst. Deal the normal strike through the
  // SHARED core, then — UNCONDITIONALLY (NO threshold) — add a bonus SIZED as
  // `floor(max(0, maxHp − hp) × bonusRatio)` (the FIRST time the engine reads the defender's MISSING
  // HP to SIZE a number; execute/guillotine both read CURRENT hp against a fraction of MAX). The
  // bonus is naturally 0 at full HP and grows as the foe is worn down — the SMT rampage/vengeance
  // idiom. Subtracted through the SAME monotone `hp = max(0, hp − X)` write, so HP stays
  // monotonically non-increasing (A-42 — rampage only ever DEALS more, never heals). The magnitude
  // lives in the arm ({@link RAMPAGE_BONUS_RATIO}) so the catalog row is data. Shipped Posture-B
  // (cost 89 > MAX_ENERGY) so it never fires in-sim; proven by direct-seam apply units (a missing-HP
  // SCALING contrast + the full-HP → 0 case + a floor-truncation case) + a `selectSkill(89)` boundary.
  | { kind: 'rampage'; bonusRatio: number }
  // BRAVADO (TASK-129) — the FIRST ATTACKER-OWN-maxHp-FRACTION burst. Deal the normal strike through
  // the shared {@link resolveDamageStrike} seam, then add a bonus SIZED as
  // `floor(attackerMaxHp × bonusRatio)` UNCONDITIONALLY (the FIRST time the engine sizes a bonus off
  // the CASTER's OWN frame; execute/guillotine/rampage all read the DEFENDER's hp/maxHp). It reads
  // `attacker.maxHp` from the Combatant ALREADY passed to the shared seam — NO new param, NO
  // signature change. The bonus is subtracted via the SAME monotone `Math.max(0, hp − X)` write, so
  // HP stays monotonically non-increasing (A-42 — bravado only ever DEALS more, never heals). The
  // magnitude lives in the arm ({@link BRAVADO_BONUS_RATIO}) so the catalog row is data. Shipped
  // Posture-B (cost 90 > MAX_ENERGY) so it never fires in-sim; proven by direct-seam apply units (an
  // attacker-maxHp SCALING contrast + a floor-truncation case) + a `selectSkill(90)` boundary.
  | { kind: 'bravado'; bonusRatio: number }
  // LAST-STAND (TASK-130) — the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst, completing the 2×2
  // `{MAX-HP | MISSING-HP} × {DEFENDER | ATTACKER-OWN}` frame matrix. Deal the normal strike through
  // the shared {@link resolveDamageStrike} seam, then add a bonus SIZED as
  // `floor(max(0, attackerMaxHp − attackerHp) × bonusRatio)` UNCONDITIONALLY (the FIRST time the
  // engine sizes a bonus off the CASTER's OWN MISSING HP; bravado reads the attacker's MAX, rampage
  // reads the DEFENDER's missing — this is bravado's missing-HP sibling and rampage's attacker-frame
  // mirror, the SMT "vengeance-of-the-wounded" idiom: harder-hitting the more worn-down the caster).
  // It reads `attacker.hp` AND `attacker.maxHp` from the Combatant ALREADY passed to the shared seam
  // — NO new param, NO signature change. The bonus is subtracted via the SAME monotone
  // `Math.max(0, hp − X)` write, so HP stays monotonically non-increasing (A-42 — last-stand only
  // ever DEALS more, never heals). The magnitude lives in the arm ({@link LAST_STAND_BONUS_RATIO}) so
  // the catalog row is data. Shipped Posture-B (cost 91 > MAX_ENERGY) so it never fires in-sim;
  // proven by direct-seam apply units (an attacker-own-missing-HP SCALING contrast + the full-HP → 0
  // case + a floor-truncation case) + a `selectSkill(91)` boundary.
  | { kind: 'last-stand'; bonusRatio: number }
  | { kind: 'burn' }
  // Burn-Percent (TASK-120) — the DoT-family's FIRST fidelity-twin inflictor (a MIRROR of `burn`). It
  // inflicts the `burn-percent` StatusAilment on the DEFENDER via the SAME generic offensive
  // applyAilment else-branch `burn` uses (the effect kind matches its ailment kind name); the ratio
  // lives in the arm/const (spec's damagePerTurnRatio). Priced ABOVE MAX_ENERGY (Posture-B), so it
  // never fires in the shipped fights.
  | { kind: 'burn-percent' }
  // Wither-Percent (TASK-132) — the maxHp-fraction DoT inflictor (the FIRST DoT sized off the target's
  // `maxHp`, not its CURRENT `hp`). It inflicts the `wither-percent` StatusAilment on the DEFENDER, but
  // — UNLIKE the other percent-DoT inflictors, which route through the generic offensive else — it
  // needs the DEFENDER's `maxHp` at apply time to materialize the flat per-turn amount, so it has its
  // OWN apply branch in simulateBattle that passes `them.maxHp` as the applyAilment `bearerMaxHp` arg
  // (the SAME arg shield-percent uses). Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the
  // shipped fights.
  | { kind: 'wither-percent' }
  // Rot-When-Weak (TASK-133) — the FIRST THRESHOLD-GATED status/DoT inflictor. Where every existing
  // inflictor (burn/poison/wither-percent/doom/…) applies its status UNCONDITIONALLY the instant the
  // skill resolves, this one GATES the apply on the DEFENDER's HP: it inflicts its `wither-percent`
  // DoT on the foe ONLY when `foe.hp <= floor(foe.maxHp × hpThresholdRatio)` (the SAME percent-of-MAX
  // read `execute`/`guillotine` use to gate a BURST — reused here to gate an INFLICTOR). Above the
  // gate it resolves as a NO-OP status attempt (a `statusEvents?` "too healthy to rot" note on the
  // EXISTING optional field — no wire change). The applied DoT REUSES the `wither-percent` arm/spec/
  // tick/label (TASK-132) verbatim — this wave adds NO new tick machinery; the only new thing is the
  // gate predicate wrapping the `applyAilment` call. HP stays monotone (A-42 — the applied effect is a
  // subtractive DoT; this gates WHEN it applies, it does NOT open the HP-raising family). Priced
  // ABOVE MAX_ENERGY (Posture-B @94, the ladder TOP), so it never fires in the shipped fights; proven
  // by direct gate-true/gate-false/boundary apply units + a `selectSkill(94)` boundary.
  | { kind: 'rot-when-weak'; hpThresholdRatio: number; damageRatio: number; turns: number }
  // Weaken-When-Weak (TASK-134) — the FIRST THRESHOLD-GATED STAT-MOD inflictor. A DEFENDER-targeting
  // arm whose resolution GATES on the foe's HP (`them.hp <= floor(them.maxHp × hpThresholdRatio)`,
  // the SAME percent-of-MAX read rot-when-weak/execute/guillotine use). IF gated true, it inflicts the
  // EXISTING `weaken` DEF-reduction status (reusing the `weaken` applyAilment branch + spec + tick — NO
  // new machinery); ELSE a no-op status attempt. Unlike `rot-when-weak` (which gates a DoT) this gates
  // a lingering STAT-MODIFIER — the axis of novelty. The `turns` field is carried for symmetry/log
  // parity with rot-when-weak; the applied `weaken` uses its OWN spec duration (WEAKEN_DURATION). HP
  // stays monotone (a DEF debuff writes NO HP). Priced ABOVE MAX_ENERGY (Posture-B @95, the ladder TOP),
  // so it never fires in the shipped fights; proven by direct gate-true/gate-false/boundary apply units
  // + a `selectSkill(95)` boundary.
  | { kind: 'weaken-when-weak'; hpThresholdRatio: number; turns: number }
  // Weaken-When-Strong (TASK-135) — the FIRST `>=` HIGH-hp ("prey on the healthy") gate in the engine.
  // A DEFENDER-targeting arm whose resolution GATES on the foe's HP with the SAME percent-of-MAX read
  // rot-when-weak/weaken-when-weak/execute/guillotine use, but with the operator FLIPPED `<=` → `>=`:
  // `them.hp >= floor(them.maxHp × hpThresholdRatio)`. IF gated true (foe still fresh), it inflicts the
  // EXISTING `weaken` DEF-reduction status (reusing the `weaken` applyAilment branch + spec + tick — NO
  // new machinery); ELSE a no-op status attempt (foe too weak to bother). Every existing threshold gate
  // is `<=` low-hp; the genuinely-NEW thing is the predicate DIRECTION (punish the healthy foe). The
  // `turns` field is carried for symmetry/log parity with weaken-when-weak; the applied `weaken` uses its
  // OWN spec duration (WEAKEN_DURATION). HP stays monotone (a DEF debuff writes NO HP). Priced ABOVE
  // MAX_ENERGY (Posture-B @96, the ladder TOP), so it never fires in the shipped fights; proven by direct
  // gate-true/gate-false/boundary apply units + a `selectSkill(96)` boundary.
  | { kind: 'weaken-when-strong'; hpThresholdRatio: number; turns: number }
  // Enfeeble-When-Weak (TASK-136) — the SECOND stat-mod FAMILY's FIRST threshold-gated inflictor. A
  // DEFENDER-targeting arm whose resolution GATES on the foe's HP with the SAME `<=` percent-of-MAX read
  // weaken-when-weak/rot-when-weak/execute/guillotine use: `them.hp <= floor(them.maxHp × hpThresholdRatio)`.
  // IF gated true (foe already wounded), it inflicts the EXISTING `enfeeble` ATK-reduction status (reusing
  // the `enfeeble` applyAilment branch + spec + tick — NO new machinery); ELSE a no-op status attempt (foe
  // too healthy). Where TASK-134/135 varied the predicate DIRECTION under a FIXED apply-family (`weaken`),
  // the genuinely-NEW thing here is the APPLY-FAMILY (`enfeeble`, ATK-down, not the DEF-down `weaken`). The
  // `turns` field is carried for symmetry/log parity with weaken-when-weak; the applied `enfeeble` uses its
  // OWN spec duration (ENFEEBLE_DURATION). HP stays monotone (an ATK debuff writes NO HP). Priced ABOVE
  // MAX_ENERGY (Posture-B @97, the ladder TOP), so it never fires in the shipped fights; proven by direct
  // gate-true/gate-false/boundary apply units + a `selectSkill(97)` boundary.
  | { kind: 'enfeeble-when-weak'; hpThresholdRatio: number; turns: number }
  // Enfeeble-When-Strong (TASK-137) — CLOSES the `enfeeble` (ATK-down) family's SECOND predicate
  // DIRECTION. A DEFENDER-targeting arm whose resolution GATES on the foe's HP with the SAME `>=`
  // percent-of-MAX read `weaken-when-strong` uses: `them.hp >= floor(them.maxHp × hpThresholdRatio)`.
  // IF gated true (foe still fresh), it inflicts the EXISTING `enfeeble` ATK-reduction status (reusing
  // the `enfeeble` applyAilment branch + spec + tick — NO new machinery); ELSE a no-op status attempt (foe
  // too wounded). Where TASK-136's `enfeeble-when-weak` gates the SAME `enfeeble` family on a `<=` LOW-hp
  // foe, the genuinely-NEW thing here is the flipped predicate DIRECTION (`>=` HIGH-hp), mirroring
  // TASK-135's `>=` gate on `weaken`. The `turns` field is carried for symmetry/log parity; the applied
  // `enfeeble` uses its OWN spec duration (ENFEEBLE_DURATION). HP stays monotone (an ATK debuff writes NO
  // HP). Priced ABOVE MAX_ENERGY (Posture-B @98, the ladder TOP), so it never fires in the shipped fights;
  // proven by direct gate-true/gate-false/boundary apply units + a `selectSkill(98)` boundary.
  | { kind: 'enfeeble-when-strong'; hpThresholdRatio: number; turns: number }
  // Vulnerable-When-Weak (TASK-138) — the THIRD stat-mod FAMILY's FIRST threshold-gated inflictor. A
  // DEFENDER-targeting arm whose resolution GATES on the foe's HP with the SAME `<=` percent-of-MAX read
  // `weaken-when-weak`/`enfeeble-when-weak` use: `them.hp <= floor(them.maxHp × hpThresholdRatio)`. IF gated
  // true (foe already wounded), it inflicts the EXISTING `vulnerable` damage-taken-UP status (reusing the
  // `vulnerable` applyAilment branch + spec + tick — NO new machinery); ELSE a no-op status attempt (foe too
  // healthy). Where TASK-134/135 gated the DEF-down `weaken` and TASK-136/137 the ATK-down `enfeeble`, the
  // genuinely-NEW thing here is the APPLY-FAMILY — `vulnerable` (damage-taken-UP, which SCALES incoming
  // damage), a fundamentally different effect KIND than a flat DEF/ATK reduction — opening the third family's
  // first cell. The `turns` field is carried for symmetry/log parity; the applied `vulnerable` uses its OWN
  // spec duration (VULNERABLE_DURATION). HP stays monotone (a damage-taken-UP debuff writes NO HP; it only
  // makes the FOE take more per hit → fight faster or unchanged, never longer — ZERO MAX_ROUNDS hazard).
  // Priced ABOVE MAX_ENERGY (Posture-B @99, the ladder TOP), so it never fires in the shipped fights; proven
  // by direct gate-true/gate-false/boundary apply units + a `selectSkill(99)` boundary.
  | { kind: 'vulnerable-when-weak'; hpThresholdRatio: number; turns: number }
  // Vulnerable-When-Strong (TASK-139) — CLOSES the THIRD stat-mod family (`vulnerable`, damage-taken-UP)
  // across BOTH predicate directions. A DEFENDER-targeting inflictor that applies the EXISTING `vulnerable`
  // damage-taken-UP status ONLY when the foe is still HEALTHY (`them.hp >= floor(them.maxHp × ratio)`, the
  // `>=` HIGH-hp mirror of TASK-138's `<=` LOW-hp cell). TASK-138 opened the family at `<=` 0.35; this flips
  // the OPERATOR (and moves to the distinct 0.60 HIGH-hp band `weaken-when-strong`/`enfeeble-when-strong`
  // use) — the genuinely-NEW variable is the predicate DIRECTION, nothing else. REUSES the `vulnerable` arm +
  // spec + applyAilment branch byte-for-byte (no new spec/tick/label). The `turns` field is carried for
  // symmetry/log parity; the applied `vulnerable` uses its OWN spec duration (VULNERABLE_DURATION). HP stays
  // monotone (a damage-taken-UP debuff writes NO HP; it only makes the FOE take more per hit → fight faster
  // or unchanged, never longer — ZERO MAX_ROUNDS hazard). Priced ABOVE MAX_ENERGY (Posture-B @100, the ladder
  // TOP), so it never fires in the shipped fights; proven by direct gate-true/gate-false/boundary apply units
  // + a `selectSkill(100)` boundary.
  | { kind: 'vulnerable-when-strong'; hpThresholdRatio: number; turns: number }
  | { kind: 'poison' }
  // Poison-Percent (TASK-121) — inflicts the `poison-percent` fractional DoT on the DEFENDER via the
  // SAME generic offensive applyAilment else-branch. Priced ABOVE MAX_ENERGY (Posture-B), never fires.
  | { kind: 'poison-percent' }
  | { kind: 'bleed' }
  // Bleed-Percent (TASK-122) — inflicts the `bleed-percent` fractional DoT on the DEFENDER via the
  // SAME generic offensive applyAilment else-branch. Priced ABOVE MAX_ENERGY (Posture-B), never fires.
  | { kind: 'bleed-percent' }
  | { kind: 'corrode' }
  // Corrode-Percent (TASK-123) — inflicts the `corrode-percent` fractional-RAMP DoT on the DEFENDER via
  // the SAME generic offensive applyAilment else-branch. Priced ABOVE MAX_ENERGY (Posture-B), never fires.
  | { kind: 'corrode-percent' }
  | { kind: 'weaken' }
  // Crumble / weaken-percent (TASK-100) — a DAMAGING debuff-strike effect (the DEFENDER-
  // targeting fractional MIRROR of `weaken`/Armor Break), NOT a self-buff: it inflicts the
  // `weaken-percent` StatusAilment on the DEFENDER via the SAME generic offensive applyAilment
  // path `weaken` uses (the effect kind matches its ailment kind name, so it routes through the
  // generic else with NO new switch branch). Payload-free (the ratio lives in the arm/const).
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights.
  | { kind: 'weaken-percent' }
  | { kind: 'enfeeble' }
  // Sunder / enfeeble-percent (TASK-101) — a DAMAGING debuff-strike effect (the DEFENDER-
  // targeting fractional MIRROR of `enfeeble`/Enfeeble Strike, the ATK-side twin of Crumble),
  // NOT a self-buff: it inflicts the `enfeeble-percent` StatusAilment on the DEFENDER via the
  // SAME generic offensive applyAilment path `enfeeble` uses. Payload-free (the ratio lives in
  // the arm/const). Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights.
  | { kind: 'enfeeble-percent' }
  | { kind: 'vulnerable' }
  // Rupture / vulnerable-percent (TASK-103) — a DAMAGING debuff-strike effect (the DEFENDER-
  // targeting fractional MIRROR of `vulnerable`/Vulnerable Strike), NOT a self-buff: it inflicts
  // the `vulnerable-percent` StatusAilment on the DEFENDER via the SAME generic offensive
  // applyAilment path `vulnerable` uses. Payload-free (the ratio lives in the arm/const). Priced
  // ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights.
  | { kind: 'vulnerable-percent' }
  | { kind: 'doom' }
  // Doom-Percent (TASK-119) — the DEFERRED FRACTIONAL-detonation inflictor (the percent-of-CURRENT-HP
  // MIRROR of `doom`). It inflicts the `doom-percent` StatusAilment on the DEFENDER via the SAME
  // generic offensive applyAilment path `doom` uses; the ratio lives in the arm/const (spec's
  // detonationRatio). Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights.
  | { kind: 'doom-percent' }
  | { kind: 'shield' }
  // Barrier / shield-percent (TASK-131) — a SELF-targeting BUFF effect (like shield/empower), NOT a
  // damaging strike: it GRANTS the CASTER the `shield-percent` StatusAilment arm via the SAME self-apply
  // path shield/empower use, but SIZED from the CASTER's OWN maxHp (`floor(maxHp × ratio)`). Payload-free
  // (the ratio lives in the arm/const). The FRACTIONAL twin of `shield` and the LAST buff family to gain
  // a `-percent` mirror. Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights —
  // proven in isolation via direct apply/drain units + a selectSkill(92) boundary.
  | { kind: 'shield-percent' }
  | { kind: 'empower' }
  // Fortify (TASK-108) — a SELF-targeting BUFF effect (like shield/empower), NOT a damaging strike:
  // it GRANTS the CASTER the `fortify` DEF-up StatusAilment arm via the SAME self-apply path
  // empower/Focus uses. Payload-free (the magnitude lives in the arm/const). The missing DEFENSIVE
  // self-buff — the DEF-axis twin of empower and the self-buff mirror of weaken. Priced ABOVE
  // MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'fortify' }
  // Brace (TASK-109) — a SELF-targeting BUFF effect (like shield/empower/fortify), NOT a damaging
  // strike: it GRANTS the CASTER the `brace` StatusAilment arm via the SAME self-apply path
  // fortify/empower/Focus use. Payload-free (the magnitude lives in the arm/const). The damage-taken-DOWN
  // POSITIVE MIRROR of `vulnerable` at the damage-application seam. Priced ABOVE MAX_ENERGY (Posture-B),
  // so it never fires in the shipped fights — proven in isolation.
  | { kind: 'brace' }
  // Bulwark (TASK-110) — a SELF-targeting BUFF effect (like brace/shield/empower/fortify), NOT a
  // damaging strike: it GRANTS the CASTER the `brace-percent` StatusAilment arm via the SAME self-apply
  // path brace/fortify/empower use. Payload-free (the ratio lives in the arm/const). The PERCENTAGE
  // damage-taken-DOWN fractional MIRROR of `brace` and the DOWN-side percent twin of `vulnerable-percent`
  // at the damage-application seam. Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped
  // fights — proven in isolation.
  | { kind: 'brace-percent' }
  // Aegis (TASK-111) — a SELF-targeting BUFF effect (like brace/shield/empower/fortify), NOT a
  // damaging strike: it GRANTS the CASTER the `fortify-percent` StatusAilment arm via the SAME
  // self-apply path fortify/brace/empower use. Payload-free (the ratio lives in the arm/const). The
  // PERCENTAGE DEF-UP fractional MIRROR of `fortify` and the DEF-UP percent twin of the DEBUFF
  // `weaken-percent` at the DEF-mitigation seam. Priced ABOVE MAX_ENERGY (Posture-B), so it never
  // fires in the shipped fights — proven in isolation.
  | { kind: 'fortify-percent' }
  // Hasten (TASK-112) — a SELF-targeting BUFF effect (like fortify/empower), NOT a damaging strike: it
  // GRANTS the CASTER the `hasten` StatusAilment arm via the SAME self-apply path fortify/empower use.
  // Payload-free (the bonus lives in the arm/const). The FLAT SPD-UP self-buff, the SPD-axis twin of the
  // DEF-up `fortify` and the ATK-up `empower`. Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in
  // the shipped fights — proven in isolation via the effectiveSpd read helper.
  | { kind: 'hasten' }
  // Rush (TASK-113) — a SELF-targeting BUFF effect (like hasten/fortify-percent), NOT a damaging strike:
  // it GRANTS the CASTER the `hasten-percent` StatusAilment arm via the SAME self-apply path
  // hasten/fortify-percent use. Payload-free (the ratio lives in the arm/const). The PERCENTAGE SPD-UP
  // self-buff, the percent-UP twin of the flat `hasten` and the SPD-axis mirror of the DEF-up
  // `fortify-percent` / ATK-up `empower-percent`. Priced ABOVE MAX_ENERGY (Posture-B), so it never fires
  // in the shipped fights — proven in isolation via the effectiveSpd read helper.
  | { kind: 'hasten-percent' }
  // Hobble (TASK-114) — a FOE-targeting DEBUFF effect (like weaken/enfeeble), NOT a self-buff and NOT a
  // damaging strike: it inflicts the `hobble` SPD-DOWN StatusAilment on the FOE via the SAME generic
  // offensive applyAilment path weaken/enfeeble use (the effect kind matches its ailment kind name, so
  // it routes through the generic else with NO new switch branch and is NOT listed on skillAilment's
  // self-target side). Payload-free (the magnitude lives in the arm/const). The FLAT SPD-DOWN debuff,
  // the SPD-axis mirror of the DEF-down `weaken` and ATK-down `enfeeble`. Priced ABOVE MAX_ENERGY
  // (Posture-B), so it never fires in the shipped fights — proven in isolation via the effectiveSpd
  // read helper.
  | { kind: 'hobble' }
  // Cripple (TASK-115) — a FOE-targeting DEBUFF effect (like hobble/weaken-percent), NOT a self-buff and
  // NOT a damaging strike: it inflicts the `hobble-percent` PERCENTAGE SPD-DOWN StatusAilment on the FOE
  // via the SAME generic offensive applyAilment path hobble/weaken-percent use (the effect kind matches
  // its ailment kind name, so it routes through the generic else with NO new switch branch and is NOT
  // listed on skillAilment's self-target side). Payload-free (the magnitude lives in the arm/const). The
  // PERCENTAGE SPD-DOWN debuff completing the SPD-axis DOWN percent square, the SPD-axis mirror of the
  // DEF-down `weaken-percent` and ATK-down `enfeeble-percent`. Priced ABOVE MAX_ENERGY (Posture-B), so it
  // never fires in the shipped fights — proven in isolation via the effectiveSpd read helper.
  | { kind: 'hobble-percent' }
  // Reinforce / empower-percent (TASK-102) — a SELF-targeting BUFF effect (like shield/empower),
  // NOT a damaging strike: it GRANTS the CASTER the `empower-percent` StatusAilment arm via the
  // SAME self-apply path empower/Focus uses. Payload-free (the ratio lives in the arm/const). The
  // fractional MIRROR of `empower`, the ATK-BONUS twin of Sunder — extending the percentage/fidelity
  // axis onto the ATK-BONUS side. Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the
  // shipped fights — proven in isolation.
  | { kind: 'empower-percent' }
  | { kind: 'retaliate' }
  // Thorn Mirror / reflect-percent (TASK-99) — a SELF-targeting BUFF effect (like
  // shield/empower/retaliate), NOT a lingering StatusAilment payload itself: it GRANTS the
  // CASTER the `retaliate-percent` StatusAilment arm via the SAME self-apply path retaliate
  // uses. Payload-free (the ratio lives in the arm/const). The fractional MIRROR of
  // `retaliate`, extending the percentage/fidelity axis to the reflect mechanic. Priced ABOVE
  // MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'reflect-percent' }
  | { kind: 'stun' }
  | { kind: 'multihit'; hits: number }
  | { kind: 'freeze' }
  | { kind: 'sleep' }
  // TASK-70: the FIRST resource-interference effect. `sap` is an IMMEDIATE-resolve
  // effect (like `damage`/`multihit`), NOT a lingering StatusAilment — it removes a
  // FIXED {@link SAP_ENERGY_AMOUNT} from the DEFENDER's in-combat energy pool (floored
  // at 0) on the turn it lands, so it needs NO AILMENT_SPEC/label/tick/priority slot.
  // Payload-free: the amount is the const.
  | { kind: 'sap' }
  // TASK-97: the FIRST fractional-MAGNITUDE resource-interference effect and the
  // percentage MIRROR of `sap`. `sap-percent` is an IMMEDIATE-resolve effect (like
  // `damage`/`sap`), NOT a lingering StatusAilment — it removes a FRACTION
  // ({@link SAP_PERCENT_RATIO}, floored) of the DEFENDER's CURRENT in-combat energy pool
  // (via {@link drainEnergyPercent}) on the turn it lands, so it needs NO
  // AILMENT_SPEC/label/tick/priority slot. Payload-free: the ratio is the const. It OPENS
  // the percentage/fidelity axis on the energy substrate.
  | { kind: 'sap-percent' }
  // `leech` is an IMMEDIATE-resolve effect (like `damage`/`sap`), NOT a lingering
  // StatusAilment — it CREDITS a FIXED {@link LEECH_ENERGY_AMOUNT} to the ATTACKER's OWN
  // in-combat energy pool (capped at {@link MAX_ENERGY}) on the turn it lands, so it needs
  // NO AILMENT_SPEC/label/tick/priority slot. Payload-free: the amount is the const.
  | { kind: 'leech' }
  // TASK-98: the SECOND fractional-MAGNITUDE resource-interference effect and the
  // percentage MIRROR of `leech` (the CREDIT twin of `sap-percent`). `leech-percent` is an
  // IMMEDIATE-resolve effect (like `damage`/`leech`), NOT a lingering StatusAilment — it
  // CREDITS a FRACTION ({@link LEECH_PERCENT_RATIO}, floored) of the ATTACKER's OWN CURRENT
  // in-combat energy pool (via {@link restoreEnergyPercent}, capped at {@link MAX_ENERGY}) on
  // the turn it lands, so it needs NO AILMENT_SPEC/label/tick/priority slot. Payload-free: the
  // ratio is the const. It CONTINUES the percentage/fidelity axis on the resource-CREDIT side.
  // Because it writes NO HP it is HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY
  // (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'leech-percent' }
  // (like `damage`/`sap`/`leech`), NOT a lingering StatusAilment — it resolves ON CAST,
  // it does not linger, so it needs NO AILMENT_SPEC/label/tick/priority slot. It is
  // SELF-targeting (it strips the CASTER's OWN harmful arms via {@link clearDebuffs},
  // leaving the caster's self-buffs intact — A-65). Payload-free. Because it writes NO
  // HP it is HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY (Posture-B), so
  // it never fires in the shipped fights — proven in isolation.
  | { kind: 'cleanse' }
  // TASK-77: the SECOND status-REMOVAL effect and the HOSTILE inverse of `cleanse`.
  // `dispel` is an IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`), NOT a
  // lingering StatusAilment — it resolves ON CAST, does not linger, so it needs NO
  // AILMENT_SPEC/label/tick/priority slot. UNLIKE the SELF-targeting `cleanse`, it targets
  // the OPPONENT: it strips the FOE's SELF-BUFFS (empower/shield/retaliate) via
  // {@link stripBuffs}, leaving the foe's harmful arms intact (A-66) — so it routes through
  // the hostile/opponent-targeting apply branch, not the self-branch. Payload-free. Because
  // it writes NO HP it is HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY
  // (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'dispel' }
  // TASK-78: the THIRD status-REMOVAL effect and the FIRST strip-and-TRANSFER. `purloin`
  // is an IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`), NOT a
  // lingering StatusAilment — it resolves ON CAST, does not linger, so it needs NO
  // AILMENT_SPEC/label/tick/priority slot. It COMPOSES the two existing hostile/self
  // primitives via {@link stealBuffs}: it strips the FOE's SELF-BUFFS (empower/shield/
  // retaliate) via {@link stripBuffs} AND — ONLY when a strip actually occurred — grants the
  // CASTER a FIXED `empower` self-buff (the genuine steal is conditional). So it touches BOTH
  // combatants' status arrays: it routes through the opponent-AND-self apply branch. Payload-
  // free (the grant is a fixed `empower`; a payload-cloned "steal the exact buff" is a carved
  // follow-up, A-67). Because it writes NO HP it is HP-monotone by construction (A-42). Priced
  // ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'purloin' }
  // TASK-79: the FOURTH status-REMOVAL effect and the FIRST self→foe DEBUFF TRANSFER
  // (the MIRROR of `purloin`). `displace` is an IMMEDIATE-resolve effect (like
  // `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`), NOT a lingering StatusAilment
  // — it resolves ON CAST, does not linger, so it needs NO AILMENT_SPEC/label/tick/
  // priority slot. It COMPOSES two existing primitives: it CLEARS the CASTER's OWN harmful
  // debuffs via {@link clearDebuffs}/{@link CLEANSABLE_DEBUFF_KINDS} (verbatim — leaving the
  // caster's self-buffs intact, A-65) AND — ONLY when a clear actually occurred (the caster
  // HAD at least one harmful debuff) — inflicts a FIXED `weaken` (DEF-down) on the FOE via
  // the EXISTING `weaken` {@link applyAilment} builder (a GENUINE transfer, conditional: a
  // debuff-free caster clears nothing AND inflicts nothing). So it touches BOTH combatants'
  // status arrays: it routes through the self-AND-opponent apply branch. Payload-free (the
  // inflict is a fixed `weaken`; a payload-cloned "transfer the exact debuff(s) verbatim" is
  // a carved follow-up, A-68). Because it writes NO HP it is HP-monotone by construction
  // (A-42). Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights —
  // proven in isolation.
  | { kind: 'displace' }
  // TASK-80: the FIFTH status-REMOVAL effect and the FIRST PAYLOAD-PRESERVING self→foe
  // DEBUFF TRANSFER (the A-68 refinement of `displace`). `reclaim` is an IMMEDIATE-resolve
  // effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`), NOT a
  // lingering StatusAilment — it resolves ON CAST, does not linger, so it needs NO
  // AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing primitives: it CAPTURES the
  // set of the CASTER's OWN harmful debuff KINDS (those in {@link CLEANSABLE_DEBUFF_KINDS}),
  // CLEARS them off the caster via {@link clearDebuffs} (verbatim — leaving the caster's
  // self-buffs intact, A-65) AND — ONLY when a clear actually occurred (the caster HAD at
  // least one harmful debuff) — inflicts EACH of those SAME cleared kinds on the FOE via the
  // EXISTING {@link applyAilment} builder (a payload-PRESERVING clone: the exact kinds, not
  // Displace's fixed `weaken`). A debuff-free caster clears nothing AND inflicts nothing (a
  // GENUINE conditional transfer). So it touches BOTH combatants' status arrays: it routes
  // through the self-AND-opponent apply branch. Because it writes NO HP it is HP-monotone by
  // construction (A-42) — the cloned foe DoTs/stat-mods tick via the EXISTING per-turn seam.
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in
  // isolation. A raw arm-by-arm deep-copy preserving remaining turns/ramp is a further carved
  // refinement (A-69) — here each re-application uses the builder's canonical duration/magnitude.
  | { kind: 'reclaim' }
  // TASK-81: the SIXTH status-REMOVAL effect and the FIRST RAW ARM-BY-ARM DEEP-COPY self→foe
  // DEBUFF TRANSFER (the A-69 refinement of `reclaim`). `reclaim-deep` is an IMMEDIATE-resolve
  // effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`/`reclaim`), NOT
  // a lingering StatusAilment — it resolves ON CAST, does not linger, so it needs NO
  // AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing primitives: it CAPTURES the
  // caster's OWN harmful debuff ARMS (those whose kind is in {@link CLEANSABLE_DEBUFF_KINDS}),
  // CLEARS them off the caster via {@link clearDebuffs} (verbatim — leaving the caster's
  // self-buffs intact, A-65) AND — ONLY when at least one arm was captured — DEEP-COPIES each
  // captured arm onto the FOE via a per-arm `{ ...arm }` spread (a full deep copy of these flat
  // primitive-only arms), de-duped by kind (refresh-not-stack: a transferred arm REPLACES the
  // foe's existing arm of the same kind). Unlike `reclaim` (which re-brews each kind at its
  // canonical AILMENT_SPEC duration/magnitude via applyAilment), Rebound PRESERVES each arm's
  // EXACT remaining `turnsRemaining`/`damagePerTurn`/`ramp` — THIS preserved-remaining-state IS
  // the new mechanic. A debuff-free caster clears nothing AND moves nothing (a GENUINE
  // conditional transfer). Touches BOTH combatants' status arrays but writes NO HP — HP-monotone
  // by construction (A-42); the moved DoTs/stat-mods tick via the EXISTING per-turn seam. Priced
  // ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-deep' }
  // TASK-82: the SEVENTH status-REMOVAL effect and the FIRST PERCENTAGE/PARTIAL-DURATION
  // self→foe DEBUFF TRANSFER (the A-70 refinement of `reclaim-deep`). `reclaim-partial` is an
  // IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/
  // `displace`/`reclaim`/`reclaim-deep`), NOT a lingering StatusAilment — it resolves ON CAST,
  // does not linger, so it needs NO AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing
  // primitives: it CAPTURES the caster's OWN harmful debuff ARMS (those whose kind is in
  // {@link CLEANSABLE_DEBUFF_KINDS}), CLEARS them off the caster via {@link clearDebuffs}
  // (verbatim — leaving the caster's self-buffs intact, A-65) AND — ONLY when at least one arm
  // was captured — DEEP-COPIES each captured arm onto the FOE via a per-arm
  // `{ ...arm, turnsRemaining: max(1, ceil(turnsRemaining * REBOUND_PARTIAL_RATIO)) }` spread
  // (a full deep copy of these flat primitive-only arms with the duration HALVED), de-duped by
  // kind (refresh-not-stack: a transferred arm REPLACES the foe's existing arm of the same
  // kind). Unlike `reclaim-deep` (which moves each arm at its FULL current `turnsRemaining`),
  // Rebound-Lite moves each arm at a HALVED remaining duration (`burn`@4 → foe `burn`@2; `burn`@1
  // stays 1 by the floor) while PRESERVING `damagePerTurn`/`ramp` — THIS halved-remaining-turns
  // IS the new mechanic. A debuff-free caster clears nothing AND moves nothing (a GENUINE
  // conditional transfer). Touches BOTH combatants' status arrays but writes NO HP — HP-monotone
  // by construction (A-42); the moved DoTs/stat-mods tick via the EXISTING per-turn seam, and
  // halving a foe DoT only ever SHORTENS the fight. Priced ABOVE MAX_ENERGY (Posture-B), so it
  // never fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-partial' }
  // TASK-83: the EIGHTH status-REMOVAL effect and the FIRST SUBSET-OF-KINDS self→foe DEBUFF
  // TRANSFER (the A-70/A-71 subset variant). `reclaim-subset` is an IMMEDIATE-resolve effect
  // (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`/`reclaim`/
  // `reclaim-deep`/`reclaim-partial`), NOT a lingering StatusAilment — it resolves ON CAST,
  // does not linger, so it needs NO AILMENT_SPEC/label/tick/priority slot. It COMPOSES
  // existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in the
  // SUBSET {@link REBOUND_SPLIT_KINDS} (the DoTs burn/poison/bleed/corrode — a strict subset
  // of CLEANSABLE_DEBUFF_KINDS), CLEARS ONLY those subset kinds off the caster via the pure
  // {@link clearKinds}(me.statuses, REBOUND_SPLIT_KINDS) — the caster KEEPS its non-subset
  // debuffs (weaken/stun/…) AND its self-buffs — AND — ONLY when at least one arm was
  // captured — FULL-duration DEEP-COPIES each captured arm onto the FOE via a per-arm
  // `{ ...arm }` spread (exactly like Rebound/`reclaim-deep`), de-duped by kind
  // (refresh-not-stack). Unlike `reclaim-deep` (which moves the WHOLE cleansable set),
  // Rebound-Split moves ONLY the DoT subset — THIS kind-selectivity IS the new mechanic. A
  // caster carrying NONE of the subset kinds clears nothing AND moves nothing (a GENUINE
  // conditional transfer). Touches BOTH combatants' status arrays but writes NO HP —
  // HP-monotone by construction (A-42); the moved DoTs tick via the EXISTING per-turn seam.
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in
  // isolation.
  | { kind: 'reclaim-subset' }
  // TASK-84: the NINTH status-REMOVAL effect and the SECOND SUBSET-OF-KINDS self→foe DEBUFF
  // TRANSFER (the A-72/A-73 stat-mod-subset variant). `reclaim-stats` is an IMMEDIATE-resolve
  // effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`/`reclaim`/
  // `reclaim-deep`/`reclaim-partial`/`reclaim-subset`), NOT a lingering StatusAilment — it
  // resolves ON CAST, does not linger, so it needs NO AILMENT_SPEC/label/tick/priority slot.
  // It COMPOSES existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in
  // the SUBSET {@link REBOUND_SNAP_KINDS} (the STAT-MODS weaken/enfeeble/vulnerable — a strict
  // subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from the DoT subset REBOUND_SPLIT_KINDS),
  // CLEARS ONLY those subset kinds off the caster via the pure
  // {@link clearKinds}(me.statuses, REBOUND_SNAP_KINDS) — the caster KEEPS its DoTs
  // (burn/poison/bleed/corrode), control-locks (stun/freeze/sleep), doom AND its self-buffs —
  // AND — ONLY when at least one arm was captured — FULL-duration DEEP-COPIES each captured arm
  // onto the FOE via a per-arm `{ ...arm }` spread (exactly like Rebound-Split), de-duped by
  // kind (refresh-not-stack). Unlike `reclaim-subset` (which moves the DoT subset), Rebound-Snap
  // moves ONLY the DISJOINT stat-mod subset — THIS disjoint kind-selectivity IS the new
  // mechanic. A caster carrying NONE of the subset kinds clears nothing AND moves nothing (a
  // GENUINE conditional transfer). Touches BOTH combatants' status arrays but writes NO HP —
  // stat-mods are pure modifiers that NEVER tick HP, so HP-monotone by construction (A-42).
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in
  // isolation.
  | { kind: 'reclaim-stats' }
  // TASK-85: the TENTH status-REMOVAL effect and the THIRD (and final natural) SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER (the A-73 control-lock-subset variant). `reclaim-locks` is an
  // IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/
  // `displace`/`reclaim`/`reclaim-deep`/`reclaim-partial`/`reclaim-subset`/`reclaim-stats`),
  // NOT a lingering StatusAilment — it resolves ON CAST, does not linger, so it needs NO
  // AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing primitives: it CAPTURES the
  // caster's OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_LOCK_KINDS} (the
  // CONTROL-LOCKS stun/freeze/sleep — a strict subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from
  // BOTH the DoT subset REBOUND_SPLIT_KINDS AND the stat-mod subset REBOUND_SNAP_KINDS), CLEARS
  // ONLY those subset kinds off the caster via the pure
  // {@link clearKinds}(me.statuses, REBOUND_LOCK_KINDS) — the caster KEEPS its DoTs
  // (burn/poison/bleed/corrode), stat-mods (weaken/enfeeble/vulnerable), doom AND its self-buffs
  // — AND — ONLY when at least one arm was captured — FULL-duration DEEP-COPIES each captured
  // arm onto the FOE via a per-arm `{ ...arm }` spread (exactly like Rebound-Split/Rebound-Snap),
  // de-duped by kind (refresh-not-stack). Unlike `reclaim-subset` (DoTs) / `reclaim-stats`
  // (stat-mods), Rebound-Lock moves ONLY the DISJOINT control-lock subset — THIS disjoint
  // kind-selectivity IS the new mechanic, and it CLOSES the subset-of-kinds axis (the three
  // subsets partition the harmful non-doom families). A caster carrying NONE of the subset kinds
  // clears nothing AND moves nothing (a GENUINE conditional transfer). Touches BOTH combatants'
  // status arrays but writes NO HP — control-locks are turn-skip modifiers that NEVER tick HP,
  // so HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY (Posture-B), so it never
  // fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-locks' }
  // TASK-86: the ELEVENTH status-REMOVAL effect and the FOURTH (and final) SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER (the A-74 doom-subset variant). `reclaim-doom` is an
  // IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/
  // `displace`/`reclaim`/`reclaim-deep`/`reclaim-partial`/`reclaim-subset`/`reclaim-stats`/
  // `reclaim-locks`), NOT a lingering StatusAilment — it resolves ON CAST, so it needs NO
  // AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing primitives: it CAPTURES the
  // caster's OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_DOOM_KINDS} (the single
  // deferred-detonation `doom` — a strict subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from the
  // DoT/stat-mod/control-lock subsets), CLEARS ONLY that subset kind off the caster via the pure
  // {@link clearKinds}(me.statuses, REBOUND_DOOM_KINDS) — the caster KEEPS its DoTs, stat-mods,
  // control-locks AND its self-buffs — AND — ONLY when at least one arm was captured —
  // FULL-duration DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }` spread
  // (exactly like Rebound-Split/Snap/Lock — the flat `doom` arm's turnsRemaining AND
  // detonationDamage are preserved), de-duped by kind (refresh-not-stack). Unlike `reclaim-subset`
  // (DoTs) / `reclaim-stats` (stat-mods) / `reclaim-locks` (control-locks), Rebound-Doom moves
  // ONLY the DISJOINT `doom` subset — THIS disjoint kind-selectivity IS the new mechanic, and it
  // CLOSES the subset-of-kinds axis (the four subsets partition the full cleansable set). A caster
  // carrying NO `doom` arm clears nothing AND moves nothing (a GENUINE conditional transfer).
  // Touches BOTH combatants' status arrays but writes NO HP at cast — the moved `doom` detonates
  // LATER via the EXISTING monotone seam — so HP-monotone by construction (A-42). Priced ABOVE
  // MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-doom' }
  // TASK-87: the TWELFTH status-REMOVAL effect and the FIRST MULTI-FAMILY (PAIR/UNION)
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the A-75 union-subset variant). `reclaim-blight`
  // is an IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/
  // `displace`/`reclaim`/`reclaim-deep`/`reclaim-partial`/`reclaim-subset`/`reclaim-stats`/
  // `reclaim-locks`/`reclaim-doom`), NOT a lingering StatusAilment — it resolves ON CAST, so it
  // needs NO AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing primitives: it CAPTURES
  // the caster's OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_BLIGHT_KINDS} (the
  // UNION of the DoTs AND the control-locks = REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS — a strict
  // subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from the stat-mod AND doom subsets), CLEARS ONLY
  // those subset kinds off the caster via the pure {@link clearKinds}(me.statuses,
  // REBOUND_BLIGHT_KINDS) — the caster KEEPS its stat-mods (weaken/enfeeble/vulnerable), its
  // `doom` AND its self-buffs (empower/shield/retaliate) — AND — ONLY when at least one arm was
  // captured — FULL-duration DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }`
  // spread (exactly like Rebound-Split/Snap/Lock/Doom — each DoT's turnsRemaining+damagePerTurn+
  // ramp and each lock's turnsRemaining are preserved), de-duped by kind (refresh-not-stack).
  // Unlike the single-family subsets, Rebound-Blight moves the UNION of TWO disjoint families —
  // THIS multi-family kind-selectivity IS the new mechanic, OPENING the union axis (the FIRST
  // non-singleton set fed to clearKinds). A caster carrying NONE of the subset kinds clears
  // nothing AND moves nothing (a GENUINE conditional transfer). Touches BOTH combatants' status
  // arrays but writes NO HP at cast — the moved DoTs tick LATER via the EXISTING monotone seam,
  // the moved locks write no HP — so HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY
  // (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-blight' }
  // TASK-88: the THIRTEENTH status-REMOVAL effect and the SECOND MULTI-FAMILY (PAIR/UNION)
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the A-76 union-subset variant). `reclaim-cripple`
  // is an IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/
  // `displace`/`reclaim`/`reclaim-deep`/`reclaim-partial`/`reclaim-subset`/`reclaim-stats`/
  // `reclaim-locks`/`reclaim-doom`/`reclaim-blight`), NOT a lingering StatusAilment — it resolves
  // ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing
  // primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in the SUBSET
  // {@link REBOUND_CRIPPLE_KINDS} (the UNION of the stat-mods AND the control-locks =
  // REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS — a strict subset of CLEANSABLE_DEBUFF_KINDS,
  // DISJOINT from the DoT AND doom subsets), CLEARS ONLY those subset kinds off the caster via
  // the pure {@link clearKinds}(me.statuses, REBOUND_CRIPPLE_KINDS) — the caster KEEPS its DoTs
  // (burn/poison/bleed/corrode), its `doom` AND its self-buffs (empower/shield/retaliate) — AND
  // — ONLY when at least one arm was captured — FULL-duration DEEP-COPIES each captured arm onto
  // the FOE via a per-arm `{ ...arm }` spread (exactly like Rebound-Snap/Lock/Blight — each
  // stat-mod's turnsRemaining+magnitude and each lock's turnsRemaining are preserved), de-duped
  // by kind (refresh-not-stack). It is the COMPLEMENTARY 2-of-4 union to Rebound-Blight (they
  // overlap only on the control-locks) — THIS multi-family kind-selectivity IS the new mechanic,
  // CONTINUING the union axis (the SECOND non-singleton set fed to clearKinds). A caster carrying
  // NONE of the subset kinds clears nothing AND moves nothing (a GENUINE conditional transfer).
  // Touches BOTH combatants' status arrays but writes NO HP at cast — and NEITHER moved family
  // ticks HP (stat-mods only scale damage, control-locks only skip turns), so unlike Blight there
  // is not even a deferred DoT — so HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY
  // (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-cripple' }
  // TASK-89: the FOURTEENTH status-REMOVAL effect and the THIRD MULTI-FAMILY (PAIR/UNION)
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the A-77 union-subset variant). `reclaim-sear`
  // is an IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/
  // `displace`/`reclaim`/`reclaim-deep`/`reclaim-partial`/`reclaim-subset`/`reclaim-stats`/
  // `reclaim-locks`/`reclaim-doom`/`reclaim-blight`/`reclaim-cripple`), NOT a lingering
  // StatusAilment — it resolves ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority slot.
  // It COMPOSES existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in
  // the SUBSET {@link REBOUND_SEAR_KINDS} (the UNION of the DoTs AND the stat-mods =
  // REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS — a strict subset of CLEANSABLE_DEBUFF_KINDS,
  // DISJOINT from the control-lock AND doom subsets), CLEARS ONLY those subset kinds off the
  // caster via the pure {@link clearKinds}(me.statuses, REBOUND_SEAR_KINDS) — the caster KEEPS
  // its control-locks (stun/freeze/sleep), its `doom` AND its self-buffs (empower/shield/
  // retaliate) — AND — ONLY when at least one arm was captured — FULL-duration DEEP-COPIES each
  // captured arm onto the FOE via a per-arm `{ ...arm }` spread (exactly like Rebound-Split/Snap/
  // Blight/Cripple — each DoT's turnsRemaining+damagePerTurn+ramp and each stat-mod's
  // turnsRemaining+magnitude are preserved), de-duped by kind (refresh-not-stack). It is the
  // FIRST union NOT containing the control-locks (Blight/Cripple both share the locks; Sear =
  // Split ∪ Snap, disjoint from Lock ∪ Doom) — THIS multi-family kind-selectivity IS the new
  // mechanic, CONTINUING the union axis (the THIRD non-singleton set fed to clearKinds). A caster
  // carrying NONE of the subset kinds clears nothing AND moves nothing (a GENUINE conditional
  // transfer). Touches BOTH combatants' status arrays but writes NO HP at cast — the moved DoTs
  // tick LATER via the EXISTING monotone seam, the moved stat-mods only scale damage — so
  // HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in
  // the shipped fights — proven in isolation.
  | { kind: 'reclaim-sear' }
  // TASK-90: the FIFTEENTH status-REMOVAL effect and the FOURTH MULTI-FAMILY (PAIR/UNION)
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the A-78 union-subset variant) — the FIRST
  // union CONTAINING `doom`. `reclaim-doomburn` is an IMMEDIATE-resolve effect (like
  // `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`/`reclaim`/`reclaim-deep`/
  // `reclaim-partial`/`reclaim-subset`/`reclaim-stats`/`reclaim-locks`/`reclaim-doom`/
  // `reclaim-blight`/`reclaim-cripple`/`reclaim-sear`), NOT a lingering StatusAilment — it
  // resolves ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority slot. It COMPOSES
  // existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in the SUBSET
  // {@link REBOUND_DOOMBURN_KINDS} (the UNION of the DoTs AND `doom` = REBOUND_SPLIT_KINDS ∪
  // REBOUND_DOOM_KINDS — a strict subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from the stat-mod
  // AND control-lock subsets), CLEARS ONLY those subset kinds off the caster via the pure
  // {@link clearKinds}(me.statuses, REBOUND_DOOMBURN_KINDS) — the caster KEEPS its stat-mods
  // (weaken/enfeeble/vulnerable), its control-locks (stun/freeze/sleep) AND its self-buffs
  // (empower/shield/retaliate) — AND — ONLY when at least one arm was captured — FULL-duration
  // DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }` spread (exactly like
  // Rebound-Split/Snap/Blight/Cripple/Sear — each DoT's turnsRemaining+damagePerTurn+ramp and
  // the `doom` arm's turnsRemaining are preserved), de-duped by kind (refresh-not-stack). It is
  // the FIRST union CONTAINING `doom` (Blight/Cripple/Sear all EXCLUDE it; Doomburn = Split ∪
  // Doom, disjoint from Snap ∪ Lock) — THIS multi-family kind-selectivity IS the new mechanic,
  // CONTINUING the union axis (the FOURTH non-singleton set fed to clearKinds). A caster carrying
  // NONE of the subset kinds clears nothing AND moves nothing (a GENUINE conditional transfer).
  // Touches BOTH combatants' status arrays but writes NO HP at cast — the moved DoTs tick LATER
  // via the EXISTING monotone seam and the moved `doom` fires via its EXISTING delayed-kill seam
  // — so HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY (Posture-B), so it never
  // fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-doomburn' }
  // TASK-91: the SIXTEENTH status-REMOVAL effect and the FIFTH MULTI-FAMILY (PAIR/UNION)
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the A-79 union-subset variant) — the SECOND
  // union CONTAINING `doom`. `reclaim-snapdoom` is an IMMEDIATE-resolve effect (like
  // `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`/`reclaim`/`reclaim-deep`/
  // `reclaim-partial`/`reclaim-subset`/`reclaim-stats`/`reclaim-locks`/`reclaim-doom`/
  // `reclaim-blight`/`reclaim-cripple`/`reclaim-sear`/`reclaim-doomburn`), NOT a lingering
  // StatusAilment — it resolves ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority slot.
  // It COMPOSES existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in
  // the SUBSET {@link REBOUND_SNAPDOOM_KINDS} (the UNION of the STAT-MODS AND `doom` =
  // REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS — a strict subset of CLEANSABLE_DEBUFF_KINDS,
  // DISJOINT from the DoT AND control-lock subsets), CLEARS ONLY those subset kinds off the
  // caster via the pure {@link clearKinds}(me.statuses, REBOUND_SNAPDOOM_KINDS) — the caster
  // KEEPS its DoTs (burn/poison/bleed/corrode), its control-locks (stun/freeze/sleep) AND its
  // self-buffs (empower/shield/retaliate) — AND — ONLY when at least one arm was captured —
  // FULL-duration DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }` spread
  // (exactly like Rebound-Split/Snap/Blight/Cripple/Sear/Doomburn — each stat-mod's
  // turnsRemaining+magnitude and the `doom` arm's turnsRemaining are preserved), de-duped by
  // kind (refresh-not-stack). It is the SECOND union CONTAINING `doom` (Doomburn = Split ∪ Doom
  // was the first; Blight/Cripple/Sear all EXCLUDE it; Snapdoom = Snap ∪ Doom, disjoint from
  // Split ∪ Lock) — THIS multi-family kind-selectivity IS the new mechanic, CONTINUING the union
  // axis (the FIFTH non-singleton set fed to clearKinds). A caster carrying NONE of the subset
  // kinds clears nothing AND moves nothing (a GENUINE conditional transfer). Touches BOTH
  // combatants' status arrays but writes NO HP at cast — the moved stat-mods change only the
  // foe's damage-side payoff via their EXISTING seams and the moved `doom` fires via its
  // EXISTING delayed-kill seam — so HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY
  // (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-snapdoom' }
  // TASK-92: the SEVENTEENTH status-REMOVAL effect and the SIXTH (and FINAL) MULTI-FAMILY
  // (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the A-80 union-subset variant) — the
  // THIRD (and last) union CONTAINING `doom`. `reclaim-doomlock` is an IMMEDIATE-resolve effect
  // (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`/`reclaim`/`reclaim-deep`/
  // `reclaim-partial`/`reclaim-subset`/`reclaim-stats`/`reclaim-locks`/`reclaim-doom`/
  // `reclaim-blight`/`reclaim-cripple`/`reclaim-sear`/`reclaim-doomburn`/`reclaim-snapdoom`), NOT a
  // lingering StatusAilment — it resolves ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority
  // slot. It COMPOSES existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in
  // the SUBSET {@link REBOUND_DOOMLOCK_KINDS} (the UNION of the CONTROL-LOCKS AND `doom` =
  // REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS — a strict subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT
  // from the DoT AND stat-mod subsets), CLEARS ONLY those subset kinds off the caster via the pure
  // {@link clearKinds}(me.statuses, REBOUND_DOOMLOCK_KINDS) — the caster KEEPS its DoTs
  // (burn/poison/bleed/corrode), its stat-mods (weaken/enfeeble/vulnerable) AND its self-buffs
  // (empower/shield/retaliate) — AND — ONLY when at least one arm was captured — FULL-duration
  // DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }` spread (exactly like
  // Rebound-Split/Snap/Blight/Cripple/Sear/Doomburn/Snapdoom — each control-lock's turnsRemaining
  // and the `doom` arm's turnsRemaining are preserved), de-duped by kind (refresh-not-stack). It is
  // the THIRD (and last) union CONTAINING `doom` (Doomburn = Split ∪ Doom was first, Snapdoom = Snap
  // ∪ Doom second; Blight/Cripple/Sear all EXCLUDE it; Doomlock = Lock ∪ Doom, disjoint from Split ∪
  // Snap) — CLOSING all six 2-of-4 unions. THIS multi-family kind-selectivity IS the new mechanic.
  // A caster carrying NONE of the subset kinds clears nothing AND moves nothing (a GENUINE
  // conditional transfer). Touches BOTH combatants' status arrays but writes NO HP at cast — the
  // moved control-locks change only the foe's skip/timing payoff via their EXISTING seams and the
  // moved `doom` fires via its EXISTING delayed-kill seam — so HP-monotone by construction (A-42).
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in
  // isolation.
  | { kind: 'reclaim-doomlock' }
  // TASK-93: the EIGHTEENTH status-REMOVAL effect and the FIRST 3-of-4 MULTI-FAMILY
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the A-81 3-of-4-union variant) — OPENING the 3-of-4
  // selectivity DEPTH. `reclaim-purge` is an IMMEDIATE-resolve effect (like `damage`/`sap`/`leech`/
  // `cleanse`/`dispel`/`purloin`/`displace`/`reclaim`/`reclaim-deep`/`reclaim-partial`/
  // `reclaim-subset`/`reclaim-stats`/`reclaim-locks`/`reclaim-doom`/`reclaim-blight`/
  // `reclaim-cripple`/`reclaim-sear`/`reclaim-doomburn`/`reclaim-snapdoom`/`reclaim-doomlock`), NOT
  // a lingering StatusAilment — it resolves ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority
  // slot. It COMPOSES existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in
  // the SUBSET {@link REBOUND_PURGE_KINDS} (the UNION of the DoTs, the STAT-MODS AND the
  // CONTROL-LOCKS = REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS = "everything but
  // `doom`" — a strict subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_DOOM_KINDS), CLEARS
  // ONLY those subset kinds off the caster via the pure {@link clearKinds}(me.statuses,
  // REBOUND_PURGE_KINDS) — the caster KEEPS ONLY its `doom` arm AND its self-buffs
  // (empower/shield/retaliate) — AND — ONLY when at least one arm was captured — FULL-duration
  // DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }` spread (exactly like
  // Rebound-Split/Snap/Lock/Blight/Cripple/Sear/Doomburn/Snapdoom/Doomlock — each DoT's
  // turnsRemaining+damagePerTurn, each stat-mod's turnsRemaining+magnitude and each control-lock's
  // turnsRemaining are preserved), de-duped by kind (refresh-not-stack). It is the FIRST 3-family
  // (3-of-4) kind-set — spanning THREE disjoint families (DoT + stat-mod + lock) but LESS than the
  // whole set (it LEAVES `doom` behind) — OPENING the 3-of-4 selectivity depth after the six 2-of-4
  // unions closed. THIS 3-family kind-selectivity IS the new mechanic. A caster carrying NONE of the
  // subset kinds clears nothing AND moves nothing (a GENUINE conditional transfer). Touches BOTH
  // combatants' status arrays but writes NO HP at cast — the moved DoTs tick LATER via the EXISTING
  // monotone `Math.max(0, hp − X)` seam on the FOE and the moved stat-mods/control-locks change only
  // the foe's damage/skip payoff via their EXISTING seams — so HP-monotone by construction (A-42).
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in
  // isolation.
  | { kind: 'reclaim-purge' }
  // TASK-94: the NINETEENTH status-REMOVAL effect and the SECOND 3-of-4 MULTI-FAMILY
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the FIRST 3-of-4 union that INCLUDES `doom`) —
  // ADVANCING the 3-of-4 selectivity DEPTH. `reclaim-seardoom` is an IMMEDIATE-resolve effect (like
  // `reclaim-purge`/…/`reclaim-doomlock`), NOT a lingering StatusAilment — it resolves ON CAST, so
  // it needs NO AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing primitives: it CAPTURES
  // the caster's OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_SEARDOOM_KINDS} (the
  // UNION of the DoTs, the STAT-MODS AND `doom` = REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪
  // REBOUND_DOOM_KINDS = "everything but the CONTROL-LOCKS" — a strict subset of
  // CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_LOCK_KINDS), CLEARS ONLY those subset kinds off
  // the caster via the pure {@link clearKinds}(me.statuses, REBOUND_SEARDOOM_KINDS) — the caster
  // KEEPS ONLY its control-lock arms (stun/freeze/sleep) AND its self-buffs (empower/shield/
  // retaliate) — AND — ONLY when at least one arm was captured — FULL-duration DEEP-COPIES each
  // captured arm onto the FOE via a per-arm `{ ...arm }` spread (exactly like
  // Rebound-Split/…/Doomlock/Purge — each DoT's turnsRemaining+damagePerTurn, each stat-mod's
  // turnsRemaining+magnitude and the `doom` arm's detonationDamage+turnsRemaining are preserved),
  // de-duped by kind (refresh-not-stack). It is the SECOND 3-family (3-of-4) kind-set (Seardoom =
  // Split ∪ Snap ∪ Doom; the MIRROR of Purge across the doom/control-lock swap — Seardoom has `doom`
  // and not the locks, Purge has the locks and not `doom`) — ADVANCING the 3-of-4 depth. THIS
  // 3-family kind-selectivity IS the new mechanic. A caster carrying NONE of the subset kinds clears
  // nothing AND moves nothing (a GENUINE conditional transfer). Touches BOTH combatants' status
  // arrays but writes NO HP at cast — the moved DoTs tick LATER via the EXISTING monotone
  // `Math.max(0, hp − X)` seam on the FOE, the moved `doom` detonates via its EXISTING seam, and the
  // moved stat-mods change only the foe's damage payoff via their EXISTING seams — so HP-monotone by
  // construction (A-42). Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped
  // fights — proven in isolation.
  | { kind: 'reclaim-seardoom' }
  // TASK-95: the TWENTIETH status-REMOVAL effect and the THIRD 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER (the SECOND 3-of-4 union that INCLUDES `doom`) — ADVANCING the 3-of-4
  // selectivity DEPTH. `reclaim-blightdoom` is an IMMEDIATE-resolve effect (like
  // `reclaim-purge`/`reclaim-seardoom`/…/`reclaim-doomlock`), NOT a lingering StatusAilment — it
  // resolves ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority slot. It COMPOSES existing
  // primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in the SUBSET
  // {@link REBOUND_BLIGHTDOOM_KINDS} (the UNION of the DoTs, the CONTROL-LOCKS AND `doom` =
  // REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS = "everything but the STAT-MODS" —
  // a strict subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_SNAP_KINDS), CLEARS ONLY those
  // subset kinds off the caster via the pure {@link clearKinds}(me.statuses, REBOUND_BLIGHTDOOM_KINDS)
  // — the caster KEEPS ONLY its stat-mod arms (weaken/enfeeble/vulnerable) AND its self-buffs
  // (empower/shield/retaliate) — AND — ONLY when at least one arm was captured — FULL-duration
  // DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }` spread (exactly like
  // Rebound-Split/…/Doomlock/Purge/Seardoom — each DoT's turnsRemaining+damagePerTurn, each
  // control-lock's turnsRemaining and the `doom` arm's detonationDamage+turnsRemaining are
  // preserved), de-duped by kind (refresh-not-stack). It is the THIRD 3-family (3-of-4) kind-set
  // (Blightdoom = Split ∪ Lock ∪ Doom; the MIRROR of Seardoom across the stat-mod/control-lock swap —
  // Blightdoom has the locks and not the stat-mods, Seardoom has the stat-mods and not the locks) —
  // ADVANCING the 3-of-4 depth. THIS 3-family kind-selectivity IS the new mechanic. A caster carrying
  // NONE of the subset kinds clears nothing AND moves nothing (a GENUINE conditional transfer).
  // Touches BOTH combatants' status arrays but writes NO HP at cast — the moved DoTs tick LATER via
  // the EXISTING monotone `Math.max(0, hp − X)` seam on the FOE, the moved `doom` detonates via its
  // EXISTING seam, and the moved control-locks change only the foe's skip payoff via their EXISTING
  // seams — so HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY (Posture-B), so it never
  // fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-blightdoom' }
  // TASK-96: the TWENTY-FIRST status-REMOVAL effect and the FOURTH and LAST 3-of-4 MULTI-FAMILY
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the THIRD 3-of-4 union that INCLUDES `doom`) — CLOSING
  // the 3-of-4 selectivity axis. `reclaim-snaplockdoom` is an IMMEDIATE-resolve effect (like
  // `reclaim-purge`/`reclaim-seardoom`/`reclaim-blightdoom`/…/`reclaim-doomlock`), NOT a lingering
  // StatusAilment — it resolves ON CAST, so it needs NO AILMENT_SPEC/label/tick/priority slot. It
  // COMPOSES existing primitives: it CAPTURES the caster's OWN debuff ARMS whose kind is in the
  // SUBSET {@link REBOUND_SNAPLOCKDOOM_KINDS} (the UNION of the STAT-MODS, the CONTROL-LOCKS AND
  // `doom` = REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS = "everything but the
  // DoTs" — a strict subset of CLEANSABLE_DEBUFF_KINDS, DISJOINT from REBOUND_SPLIT_KINDS), CLEARS
  // ONLY those subset kinds off the caster via the pure {@link clearKinds}(me.statuses,
  // REBOUND_SNAPLOCKDOOM_KINDS) — the caster KEEPS ONLY its DoT arms (burn/poison/bleed/corrode) AND
  // its self-buffs (empower/shield/retaliate) — AND — ONLY when at least one arm was captured —
  // FULL-duration DEEP-COPIES each captured arm onto the FOE via a per-arm `{ ...arm }` spread
  // (exactly like Rebound-Split/…/Doomlock/Purge/Seardoom/Blightdoom — each stat-mod's magnitude,
  // each control-lock's turnsRemaining and the `doom` arm's detonationDamage+turnsRemaining are
  // preserved), de-duped by kind (refresh-not-stack). It is the FOURTH and LAST 3-family (3-of-4)
  // kind-set (Snaplockdoom = Snap ∪ Lock ∪ Doom; the ONLY 3-of-4 triple that EXCLUDES the DoTs) —
  // CLOSING the 3-of-4 depth. THIS 3-family kind-selectivity IS the new mechanic. A caster carrying
  // NONE of the subset kinds clears nothing AND moves nothing (a GENUINE conditional transfer).
  // Touches BOTH combatants' status arrays but writes NO HP at cast — the moved `doom` detonates via
  // its EXISTING seam on the FOE, and the moved control-locks change only the foe's skip payoff via
  // their EXISTING seams — so HP-monotone by construction (A-42). Priced ABOVE MAX_ENERGY
  // (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'reclaim-snaplockdoom' }
  // TASK-104: Chaos Shift — the FIRST stat-VALUE SWAP effect, opening a genuinely-NEW *shape*
  // axis: the transfer of raw STAT VALUES (distinct from the transfer of status ARRAYS by the
  // cleanse/dispel/purloin/displace/reclaim family). `swap-atk` is an IMMEDIATE-resolve effect
  // (like `damage`/`sap`/`leech`/`cleanse`/`dispel`/`purloin`/`displace`/`reclaim`/…), NOT a
  // lingering StatusAilment — it resolves ON CAST (EXCHANGES the two combatants' raw `atk` values
  // in place), so it needs NO AILMENT_SPEC/label/tick/priority slot and NO new `StatusAilment`
  // arm. Payload-free (like `dispel`/`purloin`/`displace`). It writes NO HP — only swaps the two
  // scalars — so HP stays monotonically non-increasing (A-42). Crucially it needs NO new substrate
  // (`Combatant` already carries `atk`): unlike percent-of-max-HP / execute (each would require a
  // NEW `maxHp` field, DEFERRED) or the HP-raising heal family (breaks HP-monotonicity, DEFERRED).
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in
  // isolation. `swap-def`/`swap-spd`/full-swap are trivial later twins of this SAME shape.
  | { kind: 'swap-atk' }
  // TASK-105: Chaos Warp — the SECOND stat-VALUE SWAP effect and the defensive twin of `swap-atk`,
  // ADVANCING the stat-VALUE-transfer *shape* axis TASK-104 opened (distinct from the transfer of
  // status ARRAYS by the cleanse/dispel/purloin/displace/reclaim family). `swap-def` is an
  // IMMEDIATE-resolve effect (like `swap-atk`/`dispel`/`purloin`/…), NOT a lingering StatusAilment —
  // it resolves ON CAST (EXCHANGES the two combatants' raw `def` values in place), so it needs NO
  // AILMENT_SPEC/label/tick/priority slot and NO new `StatusAilment` arm. Payload-free. It writes NO
  // HP — only swaps the two scalars — so HP stays monotonically non-increasing (A-42). Crucially it
  // needs NO new substrate (`Combatant` already carries `def`, exactly like `swap-atk` reused `atk`):
  // unlike percent-of-max-HP / execute (each would require a NEW `maxHp` field, DEFERRED) or the
  // HP-raising heal family (breaks HP-monotonicity, DEFERRED). Priced ABOVE MAX_ENERGY (Posture-B),
  // so it never fires in the shipped fights — proven in isolation. `swap-spd`/full-swap remain the
  // trivial later twins of this SAME shape.
  | { kind: 'swap-def' }
  // TASK-106: Chaos Cyclone — the THIRD stat-VALUE SWAP effect and the speed twin of `swap-atk`/
  // `swap-def`, COMPLETING the per-scalar atk→def→spd swap trio (distinct from the transfer of
  // status ARRAYS by the cleanse/dispel/purloin/displace/reclaim family). `swap-spd` is an
  // IMMEDIATE-resolve effect (like `swap-atk`/`swap-def`/`dispel`/`purloin`/…), NOT a lingering
  // StatusAilment — it resolves ON CAST (EXCHANGES the two combatants' raw `spd` values in place),
  // so it needs NO AILMENT_SPEC/label/tick/priority slot and NO new `StatusAilment` arm.
  // Payload-free. It writes NO HP — only swaps the two scalars — so HP stays monotonically
  // non-increasing (A-42). Crucially it needs NO new substrate (`Combatant` already carries `spd`,
  // exactly like `swap-def` reused `def`): unlike percent-of-max-HP / execute (each would require a
  // NEW `maxHp` field, DEFERRED) or the HP-raising heal family (breaks HP-monotonicity, DEFERRED).
  // Priced ABOVE MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in
  // isolation. This completes the stat-value-swap per-scalar sweep of the three combat stats.
  | { kind: 'swap-spd' }
  // TASK-107: Chaos Nexus — the FULL three-stat SWAP effect that EXCHANGES `atk` + `def` + `spd`
  // TOGETHER in a single cast, EXHAUSTING the stat-value-swap shape family the per-scalar
  // `swap-atk`/`swap-def`/`swap-spd` trio opened (distinct from the transfer of status ARRAYS by
  // cleanse/dispel/purloin/displace/reclaim). `swap-all` is an IMMEDIATE-resolve effect (like
  // `swap-atk`/`swap-def`/`swap-spd`/`dispel`/`purloin`/…), NOT a lingering StatusAilment — it
  // resolves ON CAST (EXCHANGES all three raw scalar pairs in place), so it needs NO AILMENT_SPEC/
  // label/tick/priority slot and NO new `StatusAilment` arm. Payload-free. Its on-cast branch
  // COMPOSES the three shipped pure helpers (swapAtk/swapDef/swapSpd) — it re-derives NO math. It
  // writes NO HP — only swaps the three scalar pairs — so HP stays monotonically non-increasing
  // (A-42). Crucially it needs NO new substrate (`Combatant` already carries all three scalars,
  // NO `maxHp`): unlike percent-of-max-HP / execute (each would require a NEW `maxHp` field,
  // DEFERRED) or the HP-raising heal family (breaks HP-monotonicity, DEFERRED). Priced ABOVE
  // MAX_ENERGY (Posture-B), so it never fires in the shipped fights — proven in isolation.
  | { kind: 'swap-all' };

/**
 * The element/attribute vocabulary a skill is grouped under on the `/battle` menu
 * (R-34 / TASK-205). Reuses the ALREADY-SHIPPED element set (`digimon.seed.ts:40`,
 * the {@link ELEMENT_BEATS} advantage cycle) as the grouping key rather than a
 * parallel "dinosaur/metal" taxonomy — A-187: consistency > novelty, keeping the
 * tag in lock-step with the engine's existing element semantics.
 */
export type SkillElement = 'Fire' | 'Water' | 'Nature' | 'Electric' | 'Neutral';

/** A skill: an id, a display name, an energy cost, and an ordered effect list. */
export interface Skill {
  id: string;
  name: string;
  energyCost: number;
  effects: readonly SkillEffect[];
  /**
   * R-34 / TASK-205 — the DISPLAY element/attribute this skill is grouped under on
   * the `/battle` menu. **OPTIONAL and display-only: NO combat rule reads it** (the
   * pure engine keys exclusively off `id`/`energyCost`/`effect.kind`, verified
   * `grep '.element' battle.ts` in a rule = 0), so every `simulateBattle`/
   * `resolveActorTurn`/`battleTurn` fixture resolves BYTE-IDENTICALLY (invariant 5,
   * add-only DATA posture A-36 #3 / L-16). Optional so the ~78 above-`MAX_ENERGY`
   * decoupled probe rows a player never reads need no assignment and stay
   * byte-compiling — assigned only on the CORE in-menu set below.
   */
  element?: SkillElement;
}

/**
 * R-28 / I-16 (TASK-187) — canonical digi-api.com move names for the CORE player-facing
 * skills. I-16 asked (verbatim): "all skills we created should ... reflect (their name,
 * for now) as they appear in the API's skills section — https://digi-api.com/." Every
 * combat skill a player SEES on `/battle` (the turn menu, the enemy-intent telegraph, the
 * "used <skill>" turn-log rows) and `/pvp` was labelled with an ad-hoc internal name
 * invented across the R-17c/R-22 waves; NONE matched a canonical Digimon move. This map
 * relabels the CORE set — the affordable, in-menu, in-turn-log staples a real fight
 * surfaces stepping down {@link COMBATANT_SKILLS} (cost ≤ {@link MAX_ENERGY} = 41) — to
 * authentic digi-api move names, each picked as the closest canonical move to that skill's
 * existing THEME (a fire skill → a canonical fire move, a poison DoT → Poison Ivy, etc.,
 * A-169 #3). The ~78 above-MAX_ENERGY Posture-B DECOUPLED probe rows a player never reads
 * are carved to an R-28 child slice.
 *
 * PURE TS DATA — digi-api is a KEYLESS public DATA SOURCE, seeded as static data with NO
 * live network call from the engine (A-36 #3 / L-16 / A-169 #1 — a rename that needs no
 * external resource does NOT park). Keyed by the `SKILLS` `id` (the RULE key). Relabelling
 * only touches the DISPLAY `name` field: the pure combat rules switch EXCLUSIVELY on
 * `energyCost`/catalog order ({@link selectSkill}), `skill.id` ({@link findSkill}), and
 * `effect.kind` — NEVER on `name` — so the engine is BYTE-FROZEN (invariant 5). The single
 * source of truth: each core `SKILLS` row's `name` literal below equals its value here
 * (asserted in `battle.spec.ts`, so the anchor cannot silently drift). Two-way door: revert
 * = restore the old ad-hoc `name` strings + drop this map; zero migration, zero fixture
 * OUTCOME impact (only LABEL-asserting fixtures re-pin).
 */
export const CANONICAL_SKILL_NAMES: Readonly<Record<string, string>> = {
  attack: 'Sharp Nail',
  'fire-breath': 'Pepper Breath',
  'poison-sting': 'Poison Ivy',
  'armor-break': 'Heat Upper',
  'bleed-strike': 'Surudoi Tsume',
  'energy-siphon': 'Energy Ray',
  'energy-drain': 'Capture Beam',
  'shock-strike': 'Mach Jab',
  'frost-bite': 'Blue Blaster',
  'corrode-strike': 'Nenchakusei no Awa',
  'enfeeble-strike': 'Silence Hug',
  'vulnerable-strike': 'Hunting Cannon',
  'doom-curse': 'Hell Squeeze',
  'lullaby-hex': 'Love Song',
  'double-strike': 'Mach Jab Combo',
  'counter-stance': 'Cross Fight',
  // TASK-206 (R-28a) — the two REMAINING in-menu (`energyCost ≤ MAX_ENERGY = 41`) stragglers
  // not covered by TASK-187's core-16 relabel. A player opens the /battle skill MENU and reads
  // these, so they earn authentic digi-api.com canonical move names in the same lore style:
  //  - `guard` (a purely defensive self-shield) → Seraphimon's canonical DEFENSIVE move.
  //  - `focus` (a self ATK-buff / charge) → WarGrowlmon's canonical CHARGE move.
  // Above-MAX_ENERGY probe/long-tail rows (`barrier`@92, `wither-curse`@93, `reclaim-*`/`swap-*`)
  // are NEVER selected in `simulateBattle` and never surface in the menu → carved off (a player
  // cannot see their name), per A-188. No rule reads `name` (keys are id/energyCost/effect.kind),
  // so this is a pure DISPLAY relabel — the engine stays byte-frozen (invariant 5).
  guard: 'Shield of the Just',
  focus: 'Berserk Charge',
} as const;

/**
 * The pure skill catalog (TASK-51/53/54/55/56). Six skills:
 *  - `attack` — the shipped basic hit: free (cost 0), a single Damage effect.
 *  - `fire-breath` — costs energy, deals Damage THEN applies Burn (a DoT).
 *  - `poison-sting` — cheaper, deals Damage THEN applies Poison (a longer/weaker DoT).
 *  - `armor-break` — deals Damage THEN applies Weaken (a DEF-debuff stat-modifier).
 *  - `guard` — a purely DEFENSIVE, SELF-targeting skill: no Damage, it raises a Shield
 *    (a damage-absorbing buffer) on the CASTER (TASK-55).
 *  - `focus` — an OFFENSIVE self-buff, SELF-targeting: no Damage, it raises an Empower
 *    (an ATK buff) on the CASTER (TASK-56) — the second self-targeting skill.
 * A per-species skill list is a later wave; for the MVP BOTH sides know
 * {@link COMBATANT_SKILLS} (ordered by selection priority).
 */
export const SKILLS: Readonly<Record<string, Skill>> = {
  attack: {
    id: 'attack',
    name: 'Sharp Nail',
    energyCost: 0,
    element: 'Neutral',
    effects: [{ kind: 'damage' }],
  },
  'fire-breath': {
    id: 'fire-breath',
    name: 'Pepper Breath',
    energyCost: FIRE_BREATH_ENERGY_COST,
    element: 'Fire',
    effects: [{ kind: 'damage' }, { kind: 'burn' }],
  },
  'wither-curse': {
    id: 'wither-curse',
    name: 'Wither Curse',
    energyCost: WITHER_PERCENT_ENERGY_COST,
    // TASK-132 — inflicts the `wither-percent` DoT (the FIRST DoT sized off the target's `maxHp`, not
    // its CURRENT `hp`) on the DEFENDER. A NON-damaging, DEFENDER-targeting inflictor (NO `damage` arm),
    // mirroring the pure-inflictor `doom-curse`/`lullaby-hex` shape — its whole effect is the applied
    // curse, whose per-turn attrition is a CONSTANT `floor(maxHp × ratio)` (unlike the current-hp twins
    // that diminish). Priced 93 > MAX_ENERGY (41), the NEW ladder TOP (above `barrier`@92) — Posture-B
    // DECOUPLED, so `selectSkill`/`chooseSkill` NEVER pick it in-sim and the shipped fights stay
    // byte-identical; its maxHp-scaled tick is proven via the direct apply/tick units, not a live cast.
    effects: [{ kind: 'wither-percent' }],
  },
  'rot-when-weak-curse': {
    id: 'rot-when-weak-curse',
    name: 'Rot When Weak',
    energyCost: ROT_WHEN_WEAK_ENERGY_COST,
    // TASK-133 — the FIRST THRESHOLD-GATED inflictor. A NON-damaging, DEFENDER-targeting curse (NO
    // `damage` arm, mirroring the pure-inflictor `wither-curse`/`doom-curse`/`lullaby-hex` shape) whose
    // `rot-when-weak` effect applies its `wither-percent` DoT to the foe ONLY when the foe is already
    // wounded (`foe.hp <= floor(foe.maxHp × ROT_WHEN_WEAK_HP_THRESHOLD_RATIO=0.35)`) — the SMT "prey on
    // the wounded" finisher-rot idiom; a healthy foe resists (a "too healthy to rot" note). The applied
    // DoT payload REUSES the TASK-132 `wither-percent` consts (ratio 0.08 / duration 3) unchanged — the
    // NEW knob is only the apply-gate. Priced 94 > MAX_ENERGY (41), the NEW ladder TOP (above
    // `wither-curse`@93) — Posture-B DECOUPLED, so `selectSkill`/`chooseSkill` NEVER pick it in-sim and
    // the shipped fights stay byte-identical; the gate is proven via direct gate-true/gate-false/
    // boundary apply units + a `selectSkill(94)` boundary, not a live cast.
    effects: [
      {
        kind: 'rot-when-weak',
        hpThresholdRatio: ROT_WHEN_WEAK_HP_THRESHOLD_RATIO,
        damageRatio: WITHER_PERCENT_DAMAGE_RATIO,
        turns: WITHER_DURATION,
      },
    ],
  },
  'wither-when-weak-hex': {
    id: 'wither-when-weak-hex',
    name: 'Wither When Weak',
    energyCost: WEAKEN_WHEN_WEAK_ENERGY_COST,
    // TASK-134 — the FIRST THRESHOLD-GATED STAT-MOD inflictor. A NON-damaging, DEFENDER-targeting hex
    // (NO `damage` arm, mirroring the pure-inflictor `rot-when-weak-curse`/`wither-curse`/`doom-curse`
    // shape) whose `weaken-when-weak` effect applies the EXISTING `weaken` DEF-reduction status to the
    // foe ONLY when the foe is already wounded (`foe.hp <= floor(foe.maxHp ×
    // WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO=0.35)`) — the SMT "cripple the wounded" idiom; a healthy foe
    // resists (a "too healthy to weaken" note). Where TASK-133's `rot-when-weak` gates a DoT, this
    // gates a lingering STAT-MODIFIER — same conditional-application predicate, DIFFERENT apply-family.
    // The applied stat-mod REUSES the `weaken` spec (WEAKEN_DURATION / WEAKEN_DEF_REDUCTION) unchanged —
    // the NEW knob is only the apply-gate. Priced 95 > MAX_ENERGY (41), the NEW ladder TOP (above
    // `rot-when-weak-curse`@94) — Posture-B DECOUPLED, so `selectSkill`/`chooseSkill` NEVER pick it
    // in-sim and the shipped fights stay byte-identical; the gate is proven via direct
    // gate-true/gate-false/boundary apply units + a `selectSkill(95)` boundary, not a live cast.
    effects: [
      {
        kind: 'weaken-when-weak',
        hpThresholdRatio: WEAKEN_WHEN_WEAK_HP_THRESHOLD_RATIO,
        turns: WEAKEN_DURATION,
      },
    ],
  },
  'wither-when-strong-hex': {
    id: 'wither-when-strong-hex',
    name: 'Wither When Strong',
    energyCost: WEAKEN_WHEN_STRONG_ENERGY_COST,
    // TASK-135 — the FIRST `>=` HIGH-hp ("prey on the healthy") gated inflictor. A NON-damaging,
    // DEFENDER-targeting hex (NO `damage` arm, mirroring the pure-inflictor `wither-when-weak-hex`/
    // `rot-when-weak-curse`/`wither-curse` shape) whose `weaken-when-strong` effect applies the EXISTING
    // `weaken` DEF-reduction status to the foe ONLY when the foe is still fresh (`foe.hp >=
    // floor(foe.maxHp × WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO=0.60)`) — the SMT/Pokémon "soften the
    // full-strength enemy" idiom; a badly-wounded foe is spared (a "too weak to bother weakening" note).
    // Where TASK-134's `weaken-when-weak` gates the SAME `weaken` DEF-down on a `<=` LOW-hp foe, this
    // FLIPS the predicate DIRECTION to `>=` HIGH-hp — the engine's first `>=` application gate (the axis
    // of novelty). The applied stat-mod REUSES the `weaken` spec (WEAKEN_DURATION / WEAKEN_DEF_REDUCTION)
    // unchanged — the NEW knob is only the flipped apply-gate. Priced 96 > MAX_ENERGY (41), the NEW ladder
    // TOP (above `wither-when-weak-hex`@95) — Posture-B DECOUPLED, so `selectSkill`/`chooseSkill` NEVER
    // pick it in-sim and the shipped fights stay byte-identical; the gate is proven via direct
    // gate-true/gate-false/boundary apply units + a `selectSkill(96)` boundary, not a live cast.
    effects: [
      {
        kind: 'weaken-when-strong',
        hpThresholdRatio: WEAKEN_WHEN_STRONG_HP_THRESHOLD_RATIO,
        turns: WEAKEN_DURATION,
      },
    ],
  },
  'enfeeble-when-weak-hex': {
    id: 'enfeeble-when-weak-hex',
    name: 'Enfeeble When Weak',
    energyCost: ENFEEBLE_WHEN_WEAK_ENERGY_COST,
    // TASK-136 — the SECOND stat-mod FAMILY's FIRST threshold-gated inflictor. A NON-damaging,
    // DEFENDER-targeting hex (NO `damage` arm, mirroring the pure-inflictor `wither-when-weak-hex`/
    // `wither-when-strong-hex`/`rot-when-weak-curse` shape) whose `enfeeble-when-weak` effect applies the
    // EXISTING `enfeeble` ATK-reduction status to the foe ONLY when the foe is already wounded (`foe.hp <=
    // floor(foe.maxHp × ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO=0.35)`) — the SMT "kick the ATK out of an
    // already-wounded foe" idiom; a healthy foe resists (a "too healthy to enfeeble" note). Where TASK-134/
    // 135 varied the predicate DIRECTION under the FIXED `weaken` DEF-down family, this varies the
    // APPLY-FAMILY itself to `enfeeble` (ATK-down) — the axis of novelty. The applied stat-mod REUSES the
    // `enfeeble` spec (ENFEEBLE_DURATION / ENFEEBLE_ATK_REDUCTION) unchanged — the NEW knob is only the
    // `<=` apply-gate. Priced 97 > MAX_ENERGY (41), the NEW ladder TOP (above `wither-when-strong-hex`@96) —
    // Posture-B DECOUPLED, so `selectSkill`/`chooseSkill` NEVER pick it in-sim and the shipped fights stay
    // byte-identical; the gate is proven via direct gate-true/gate-false/boundary apply units + a
    // `selectSkill(97)` boundary, not a live cast.
    effects: [
      {
        kind: 'enfeeble-when-weak',
        hpThresholdRatio: ENFEEBLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
        turns: ENFEEBLE_DURATION,
      },
    ],
  },
  'enfeeble-when-strong-hex': {
    id: 'enfeeble-when-strong-hex',
    name: 'Enfeeble When Strong',
    energyCost: ENFEEBLE_WHEN_STRONG_ENERGY_COST,
    // TASK-137 — CLOSES the `enfeeble` (ATK-down) family's SECOND predicate DIRECTION. A NON-damaging,
    // DEFENDER-targeting hex (NO `damage` arm, mirroring the pure-inflictor `wither-when-strong-hex`/
    // `enfeeble-when-weak-hex`/`rot-when-weak-curse` shape) whose `enfeeble-when-strong` effect applies the
    // EXISTING `enfeeble` ATK-reduction status to the foe ONLY when the foe is still fresh (`foe.hp >=
    // floor(foe.maxHp × ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO=0.60)`) — the SMT "kick the ATK out of a
    // still-fresh, dangerous foe" idiom; a badly-wounded foe is spared (a "too wounded to bother
    // enfeebling" note). Where TASK-136's `enfeeble-when-weak` gates the SAME `enfeeble` ATK-down on a `<=`
    // LOW-hp foe, this FLIPS the predicate DIRECTION to `>=` HIGH-hp (mirroring TASK-135's `>=` gate on
    // `weaken`) — the axis of novelty, closing the `enfeeble` family across both directions. The applied
    // stat-mod REUSES the `enfeeble` spec (ENFEEBLE_DURATION / ENFEEBLE_ATK_REDUCTION) unchanged — the NEW
    // knob is only the flipped apply-gate. Priced 98 > MAX_ENERGY (41), the NEW ladder TOP (above
    // `enfeeble-when-weak-hex`@97) — Posture-B DECOUPLED, so `selectSkill`/`chooseSkill` NEVER pick it
    // in-sim and the shipped fights stay byte-identical; the gate is proven via direct
    // gate-true/gate-false/boundary apply units + a `selectSkill(98)` boundary, not a live cast.
    effects: [
      {
        kind: 'enfeeble-when-strong',
        hpThresholdRatio: ENFEEBLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
        turns: ENFEEBLE_DURATION,
      },
    ],
  },
  'vulnerable-when-strong-hex': {
    id: 'vulnerable-when-strong-hex',
    name: 'Vulnerable When Strong',
    energyCost: VULNERABLE_WHEN_STRONG_ENERGY_COST,
    // TASK-139 — CLOSES the THIRD stat-mod FAMILY (`vulnerable`, damage-taken-UP) across BOTH predicate
    // directions. A NON-damaging, DEFENDER-targeting hex (NO `damage` arm, mirroring the pure-inflictor
    // `enfeeble-when-strong-hex`/`vulnerable-when-weak-hex` shape — distinct from the UNCONDITIONAL
    // `vulnerable-strike` which IS a `[{damage},{vulnerable}]` composite, and distinct from the `<=`-gated
    // `vulnerable-when-weak-hex`) whose `vulnerable-when-strong` effect applies the EXISTING `vulnerable`
    // damage-taken-UP status to the foe ONLY when the foe is still HEALTHY (`foe.hp >= floor(foe.maxHp ×
    // VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO=0.60)`) — the SMT "hit a still-fresh foe with a
    // damage-taken-UP hex so the big early hits land harder" idiom; a wounded foe resists (a "too wounded
    // to bother exposing" note). Where TASK-138 opened the `vulnerable` family at its `<=` LOW-hp cell, this
    // wave flips the OPERATOR to `>=` HIGH-hp at the distinct 0.60 band (the exact mirror of how TASK-135
    // flipped TASK-134 and TASK-137 flipped TASK-136), CLOSING the family — the axis of novelty is only the
    // predicate DIRECTION. The applied stat-mod REUSES the `vulnerable` spec (VULNERABLE_DURATION /
    // VULNERABLE_DAMAGE_TAKEN_BONUS) unchanged. Priced 100 > MAX_ENERGY (41), the NEW ladder TOP (above
    // `vulnerable-when-weak-hex`@99) — Posture-B DECOUPLED, so `selectSkill`/`chooseSkill` NEVER pick it
    // in-sim and the shipped fights stay byte-identical; the gate is proven via direct
    // gate-true/gate-false/boundary apply units + a `selectSkill(100)` boundary, not a live cast.
    effects: [
      {
        kind: 'vulnerable-when-strong',
        hpThresholdRatio: VULNERABLE_WHEN_STRONG_HP_THRESHOLD_RATIO,
        turns: VULNERABLE_DURATION,
      },
    ],
  },
  'vulnerable-when-weak-hex': {
    id: 'vulnerable-when-weak-hex',
    name: 'Vulnerable When Weak',
    energyCost: VULNERABLE_WHEN_WEAK_ENERGY_COST,
    // TASK-138 — the THIRD stat-mod FAMILY's FIRST threshold-gated inflictor. A NON-damaging,
    // DEFENDER-targeting hex (NO `damage` arm, mirroring the pure-inflictor `enfeeble-when-weak-hex`/
    // `wither-when-strong-hex`/`rot-when-weak-curse` shape — distinct from the UNCONDITIONAL
    // `vulnerable-strike` which IS a `[{damage},{vulnerable}]` composite) whose `vulnerable-when-weak` effect
    // applies the EXISTING `vulnerable` damage-taken-UP status to the foe ONLY when the foe is already
    // wounded (`foe.hp <= floor(foe.maxHp × VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO=0.35)`) — the SMT "expose
    // an already-wounded foe to bigger hits" idiom; a healthy foe resists (a "too healthy to expose" note).
    // Where TASK-134/135 closed the `weaken` (DEF-down) family and TASK-136/137 the `enfeeble` (ATK-down)
    // family across both directions, L-37 forbids a third gated variant of either — so this CROSSES to the
    // THIRD stat-mod family, `vulnerable` (damage-taken-UP), the axis of novelty. The applied stat-mod REUSES
    // the `vulnerable` spec (VULNERABLE_DURATION / VULNERABLE_DAMAGE_TAKEN_BONUS) unchanged — the NEW knob is
    // only the `<=` apply-gate on the `vulnerable` family. Priced 99 > MAX_ENERGY (41), the NEW ladder TOP
    // (above `enfeeble-when-strong-hex`@98) — Posture-B DECOUPLED, so `selectSkill`/`chooseSkill` NEVER pick
    // it in-sim and the shipped fights stay byte-identical; the gate is proven via direct
    // gate-true/gate-false/boundary apply units + a `selectSkill(99)` boundary, not a live cast.
    effects: [
      {
        kind: 'vulnerable-when-weak',
        hpThresholdRatio: VULNERABLE_WHEN_WEAK_HP_THRESHOLD_RATIO,
        turns: VULNERABLE_DURATION,
      },
    ],
  },
  'smolder-strike': {
    id: 'smolder-strike',
    name: 'Smolder Strike',
    energyCost: SMOLDER_STRIKE_ENERGY_COST,
    // TASK-120 — inflicts the `burn-percent` fractional DoT (the DoT family's FIRST `-percent` twin)
    // on the DEFENDER via the SAME generic offensive-ailment branch `fire-breath`'s `burn` uses. A
    // DoT-only inflictor (no `damage` arm), so it mirrors `fire-breath`'s `[damage, burn]` shape with
    // the flat `burn` replaced by `burn-percent`. Priced 83 > MAX_ENERGY (41) — Posture-B DECOUPLED,
    // so `selectSkill`/`chooseSkill` NEVER pick it in-sim and the shipped fights stay byte-identical;
    // its fractional tick is proven via the direct-seam tick unit, not a live cast.
    effects: [{ kind: 'burn-percent' }],
  },
  'toxin-sting': {
    id: 'toxin-sting',
    name: 'Toxin Sting',
    energyCost: TOXIN_STING_ENERGY_COST,
    // TASK-121 — inflicts the `poison-percent` fractional DoT (the DoT family's SECOND `-percent` twin)
    // on the DEFENDER via the SAME generic offensive-ailment branch `poison-sting`'s `poison` uses. A
    // DoT-only inflictor (no `damage` arm), mirroring `smolder-strike`'s shape with `burn-percent`
    // replaced by `poison-percent`. Priced 84 > MAX_ENERGY (41) — Posture-B DECOUPLED, so
    // `selectSkill`/`chooseSkill` NEVER pick it in-sim and the shipped fights stay byte-identical; its
    // fractional tick is proven via the direct-seam tick unit, not a live cast.
    effects: [{ kind: 'poison-percent' }],
  },
  hemorrhage: {
    id: 'hemorrhage',
    name: 'Hemorrhage',
    energyCost: HEMORRHAGE_ENERGY_COST,
    // TASK-122 — inflicts the `bleed-percent` fractional DoT (the DoT family's THIRD `-percent` twin)
    // on the DEFENDER via the SAME generic offensive-ailment branch `bleed-strike`'s `bleed` uses. A
    // DoT-only inflictor (no `damage` arm), mirroring `toxin-sting`'s shape with `poison-percent`
    // replaced by `bleed-percent`. Priced 85 > MAX_ENERGY (41) — Posture-B DECOUPLED, so
    // `selectSkill`/`chooseSkill` NEVER pick it in-sim and the shipped fights stay byte-identical; its
    // fractional tick is proven via the direct-seam tick unit, not a live cast.
    effects: [{ kind: 'bleed-percent' }],
  },
  necrosis: {
    id: 'necrosis',
    name: 'Necrosis',
    energyCost: NECROSIS_ENERGY_COST,
    // TASK-123 — inflicts the `corrode-percent` fractional-RAMP DoT (the DoT family's FOURTH & FINAL
    // `-percent` twin) on the DEFENDER via the SAME generic offensive-ailment branch. A DoT-only inflictor
    // (no `damage` arm), mirroring `hemorrhage`'s shape with `bleed-percent` replaced by `corrode-percent`.
    // Priced 86 > MAX_ENERGY (41) — Posture-B DECOUPLED, the NEW ladder TOP above `hemorrhage`@85, so
    // `selectSkill`/`chooseSkill` NEVER pick it in-sim and the shipped fights stay byte-identical; its
    // fractional RAMPING tick is proven via the direct-seam tick unit, not a live cast.
    effects: [{ kind: 'corrode-percent' }],
  },
  'execute-strike': {
    id: 'execute-strike',
    name: 'Execute Strike',
    energyCost: EXECUTE_ENERGY_COST,
    // TASK-126 — the FIRST mechanic the `maxHp` substrate unlocks. A DAMAGING composite: deal the
    // normal strike (`damage`), then the `execute` arm reads the defender's hp against its `maxHp`
    // and adds EXECUTE_BONUS_DAMAGE iff it is at/below floor(maxHp × EXECUTE_HP_THRESHOLD_RATIO).
    // Priced 87 > MAX_ENERGY (41) — Posture-B DECOUPLED, the NEW ladder TOP above `necrosis`@86: a
    // below-pool DAMAGING skill would be `chooseSkill`-rotated onto the foe and PERTURB the shipped
    // fights, so it stays above the pool and the two reference fights stay byte-identical. Its
    // finisher payoff is proven via the direct `executeBonus` apply units + the selectSkill(87)
    // boundary unit, not a live cast.
    effects: [
      { kind: 'damage' },
      {
        kind: 'execute',
        bonusDamage: EXECUTE_BONUS_DAMAGE,
        hpThresholdRatio: EXECUTE_HP_THRESHOLD_RATIO,
      },
    ],
  },
  'guillotine-strike': {
    id: 'guillotine-strike',
    name: 'Guillotine',
    energyCost: GUILLOTINE_ENERGY_COST,
    // TASK-127 — the FIRST max-HP-FRACTION burst. A DAMAGING composite: deal the normal strike
    // (`damage`), then the `guillotine` arm reads the defender's hp against its `maxHp` and adds
    // `floor(maxHp × GUILLOTINE_BONUS_RATIO)` iff it is at/below floor(maxHp × GUILLOTINE_HP_THRESHOLD_RATIO).
    // This is the FIRST time `maxHp` SIZES a damage number (execute only READS it to gate a FIXED
    // bonus). Priced 88 > MAX_ENERGY (41) — Posture-B DECOUPLED, the NEW ladder TOP above
    // `execute-strike`@87: a below-pool DAMAGING skill would be `chooseSkill`-rotated onto the foe
    // and PERTURB the shipped fights, so it stays above the pool and the two reference fights stay
    // byte-identical. Its finisher payoff is proven via the direct `guillotineBonus` apply units + a
    // maxHp-scaling contrast + the selectSkill(88) boundary unit, not a live cast.
    effects: [
      { kind: 'damage' },
      {
        kind: 'guillotine',
        bonusRatio: GUILLOTINE_BONUS_RATIO,
        hpThresholdRatio: GUILLOTINE_HP_THRESHOLD_RATIO,
      },
    ],
  },
  'rampage-strike': {
    id: 'rampage-strike',
    name: 'Rampage',
    energyCost: RAMPAGE_ENERGY_COST,
    // TASK-128 — the FIRST MISSING-HP-FRACTION burst. A DAMAGING composite: deal the normal strike
    // (`damage`), then the `rampage` arm reads the defender's MISSING HP (`maxHp − hp`) and adds
    // `floor(max(0, maxHp − hp) × RAMPAGE_BONUS_RATIO)` UNCONDITIONALLY (no threshold; the bonus is
    // 0 at full HP and grows as the foe is worn down). This is the FIRST time MISSING HP SIZES a
    // damage number (execute/guillotine both read CURRENT hp against a fraction of MAX). Priced
    // 89 > MAX_ENERGY (41) — Posture-B DECOUPLED, the NEW ladder TOP above `guillotine-strike`@88: a
    // below-pool DAMAGING skill would be `chooseSkill`-rotated onto the foe and PERTURB the shipped
    // fights, so it stays above the pool and the two reference fights stay byte-identical. Its
    // finisher payoff is proven via the direct `rampageBonus` apply units (a missing-HP-scaling
    // contrast + the full-HP → 0 case) + the selectSkill(89) boundary unit, not a live cast.
    effects: [{ kind: 'damage' }, { kind: 'rampage', bonusRatio: RAMPAGE_BONUS_RATIO }],
  },
  'bravado-strike': {
    id: 'bravado-strike',
    name: 'Bravado',
    energyCost: BRAVADO_ENERGY_COST,
    // TASK-129 — the FIRST ATTACKER-OWN-maxHp-FRACTION burst. A DAMAGING composite: deal the normal
    // strike (`damage`), then the `bravado` arm reads the ATTACKER's OWN `maxHp` and adds
    // `floor(attackerMaxHp × BRAVADO_BONUS_RATIO)` UNCONDITIONALLY (no threshold; no defender read).
    // This is the FIRST time the engine sizes a bonus off the CASTER's frame (execute/guillotine/
    // rampage all read the DEFENDER). Priced 90 > MAX_ENERGY (41) — Posture-B DECOUPLED, the NEW
    // ladder TOP above `rampage-strike`@89: a below-pool DAMAGING skill would be `chooseSkill`-rotated
    // onto the foe and PERTURB the shipped fights, so it stays above the pool and the two reference
    // fights stay byte-identical. Its finisher payoff is proven via the direct `bravadoBonus` apply
    // units (an attacker-maxHp-scaling contrast + a floor-truncation case) + the selectSkill(90)
    // boundary unit, not a live cast.
    effects: [{ kind: 'damage' }, { kind: 'bravado', bonusRatio: BRAVADO_BONUS_RATIO }],
  },
  'last-stand-strike': {
    id: 'last-stand-strike',
    name: 'Last Stand',
    energyCost: LAST_STAND_ENERGY_COST,
    // TASK-130 — the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst, completing the 2×2 maxHp-frame
    // matrix. A DAMAGING composite: deal the normal strike (`damage`), then the `last-stand` arm
    // reads the ATTACKER's OWN missing HP and adds `floor(max(0, attackerMaxHp − attackerHp) ×
    // LAST_STAND_BONUS_RATIO)` UNCONDITIONALLY (no threshold). It is bravado's missing-HP sibling
    // (bravado reads the attacker's MAX) and rampage's attacker-frame mirror (rampage reads the
    // DEFENDER's missing) — the SMT "vengeance-of-the-wounded" idiom (harder-hitting the more
    // worn-down the caster). Priced 91 > MAX_ENERGY (41) — Posture-B DECOUPLED, the NEW ladder TOP
    // above `bravado-strike`@90: a below-pool DAMAGING skill would be `chooseSkill`-rotated onto the
    // foe and PERTURB the shipped fights, so it stays above the pool and the two reference fights stay
    // byte-identical. Its finisher payoff is proven via the direct `lastStandBonus` apply units (an
    // attacker-own-missing-HP-scaling contrast + the full-HP → 0 case + a floor-truncation case) + the
    // selectSkill(91) boundary unit, not a live cast.
    effects: [{ kind: 'damage' }, { kind: 'last-stand', bonusRatio: LAST_STAND_BONUS_RATIO }],
  },
  'poison-sting': {
    id: 'poison-sting',
    name: 'Poison Ivy',
    energyCost: POISON_STING_ENERGY_COST,
    element: 'Nature',
    effects: [{ kind: 'damage' }, { kind: 'poison' }],
  },
  'armor-break': {
    id: 'armor-break',
    name: 'Heat Upper',
    energyCost: ARMOR_BREAK_ENERGY_COST,
    element: 'Fire',
    effects: [{ kind: 'damage' }, { kind: 'weaken' }],
  },
  guard: {
    id: 'guard',
    name: 'Shield of the Just',
    energyCost: GUARD_ENERGY_COST,
    element: 'Neutral',
    // A purely DEFENSIVE, SELF-targeting skill (TASK-55): no `damage` arm at all — it
    // only raises a Shield on the CASTER. The first non-offensive skill.
    effects: [{ kind: 'shield' }],
  },
  barrier: {
    id: 'barrier',
    name: 'Barrier',
    energyCost: SHIELD_PERCENT_ENERGY_COST,
    element: 'Neutral',
    // A purely DEFENSIVE, SELF-targeting skill (TASK-131): no `damage` arm — it raises a Barrier
    // (`shield-percent`, a maxHp-fraction absorb pool) on the CASTER. The FRACTIONAL twin of Guard/Shield.
    // Its single `{ kind: 'shield-percent' }` effect resolves ON CAST through the same self-target branch
    // shield/empower use; the absorb pool is SIZED `floor(caster.maxHp × SHIELD_PERCENT_ABSORB_RATIO)`.
    // Priced above the pool (Posture-B @92), so this branch never runs in-sim.
    effects: [{ kind: 'shield-percent' }],
  },
  focus: {
    id: 'focus',
    name: 'Berserk Charge',
    energyCost: FOCUS_ENERGY_COST,
    element: 'Neutral',
    // An OFFENSIVE, SELF-targeting buff skill (TASK-56): no `damage` arm — it only
    // raises an Empower (an ATK buff) on the CASTER. The SECOND self-targeting skill
    // (after Guard/Shield), routed through the same self-vs-defender branch.
    effects: [{ kind: 'empower' }],
  },
  'shock-strike': {
    id: 'shock-strike',
    name: 'Mach Jab',
    energyCost: SHOCK_STRIKE_ENERGY_COST,
    element: 'Electric',
    // An OFFENSIVE composite skill (TASK-57), like fire-breath (damage + burn): it both
    // HITS and STUNS the DEFENDER. The stun is a CONTROL ailment (skip-turn), routed
    // through the EXISTING defender-targeting branch (it afflicts the OPPONENT, not the
    // caster — NOT the self-targeting shield/empower branch).
    effects: [{ kind: 'damage' }, { kind: 'stun' }],
  },
  'double-strike': {
    id: 'double-strike',
    name: 'Mach Jab Combo',
    energyCost: DOUBLE_STRIKE_ENERGY_COST,
    element: 'Electric',
    // An OFFENSIVE MULTI-HIT skill (TASK-58) — the FIRST effect that lands REPEATED
    // discrete strikes in one action. Each of its DOUBLE_STRIKE_HITS strikes is a
    // separate damage application + log entry the player SEES, routed through the SAME
    // defender-targeting damage path as the single `damage` effect (so each strike
    // reads the live Weaken/Empower modifiers and consults an active shield in turn).
    effects: [{ kind: 'multihit', hits: DOUBLE_STRIKE_HITS }],
  },
  'frost-bite': {
    id: 'frost-bite',
    name: 'Blue Blaster',
    energyCost: FROST_BITE_ENERGY_COST,
    element: 'Water',
    // An OFFENSIVE composite skill (TASK-59), like shock-strike (damage + stun): it both
    // HITS and FREEZES the DEFENDER. The freeze is a MULTI-TURN control ailment (skip
    // SEVERAL consecutive turns), routed through the EXISTING defender-targeting branch
    // (it afflicts the OPPONENT, not the caster — NOT the self-targeting shield/empower
    // branch). Freeze reuses the same `stunnedThisTurn` skip-turn substrate as Stun.
    effects: [{ kind: 'damage' }, { kind: 'freeze' }],
  },
  'lullaby-hex': {
    id: 'lullaby-hex',
    name: 'Love Song',
    energyCost: LULLABY_HEX_ENERGY_COST,
    element: 'Neutral',
    // A PURE CONTROL skill (TASK-60) — the FIRST Sleep carrier. DELIBERATELY
    // NON-damaging (NO `damage` arm): a `[damage, sleep]` composite would wake its
    // OWN target on the same cast (the wake-on-damage hook), self-defeating. So it
    // mirrors guard/focus (pure single-effect skills) but is DEFENDER-targeting like
    // shock-strike/frost-bite — it only applies the INTERRUPTIBLE multi-turn Sleep
    // lock to the OPPONENT. Priced ABOVE MAX_ENERGY so it never surfaces in the
    // shipped fights (D-145/A-49) — but it IS selectable (selectSkill boundary test).
    effects: [{ kind: 'sleep' }],
  },
  'bleed-strike': {
    id: 'bleed-strike',
    name: 'Surudoi Tsume',
    energyCost: BLEED_STRIKE_ENERGY_COST,
    element: 'Nature',
    // An OFFENSIVE composite skill (TASK-62), the SAME composition family as
    // fire-breath (`[damage, burn]`) / poison-sting (`[damage, poison]`): it HITS and
    // applies the THIRD DoT, Bleed, to the DEFENDER (routed through the EXISTING
    // defender-targeting offensive-ailment branch — bleed is a DoT, so it flows through
    // the generic damagePerTurn path, no new apply logic). Unlike the pure-control
    // Lullaby Hex it deals damage on its cast turn, so it is SAFE mid-ladder (cost 4)
    // and Bleed actually SURFACES in the shipped fights.
    effects: [{ kind: 'damage' }, { kind: 'bleed' }],
  },
  'corrode-strike': {
    id: 'corrode-strike',
    name: 'Nenchakusei no Awa',
    energyCost: CORRODE_STRIKE_ENERGY_COST,
    element: 'Water',
    // An OFFENSIVE composite skill (TASK-67), the SAME composition family as
    // bleed-strike (`[damage, bleed]`) / fire-breath (`[damage, burn]`): it HITS and
    // applies the FOURTH DoT — the ESCALATING Corrode — to the DEFENDER (routed through
    // the EXISTING defender-targeting offensive-ailment branch; corrode is a DoT, so
    // applyAilment builds its arm and the dedicated corrode tick handles the ramp — no
    // new apply/effect branch in simulateBattle beyond the tick). Unlike the pure-control
    // Lullaby Hex it deals damage on its cast turn, so it is SAFE mid-ladder (cost 13) and
    // Corrode actually SURFACES in the shipped fights — a player SEES the foe start
    // Corroding and take a GROWING amount of damage turn after turn.
    effects: [{ kind: 'damage' }, { kind: 'corrode' }],
  },
  'enfeeble-strike': {
    id: 'enfeeble-strike',
    name: 'Silence Hug',
    energyCost: ENFEEBLE_STRIKE_ENERGY_COST,
    element: 'Neutral',
    // An OFFENSIVE composite skill (TASK-63), the SAME composition family as
    // armor-break (`[damage, weaken]`) / bleed-strike (`[damage, bleed]`): it HITS and
    // applies the FOURTH stat-modifier, Enfeeble, to the DEFENDER. Enfeeble is
    // DEFENDER-targeted (it debuffs the OPPONENT's outgoing ATK), so it FALLS THROUGH
    // to the generic offensive-ailment branch (`them.statuses`), NOT the self-targeting
    // shield/empower branch. Unlike the pure-control Lullaby Hex it deals damage on its
    // cast turn, so it is SAFE mid-ladder (cost 8) and Enfeeble actually SURFACES in the
    // shipped fights — a player SEES the foe enfeebled and then hit for less.
    effects: [{ kind: 'damage' }, { kind: 'enfeeble' }],
  },
  'vulnerable-strike': {
    id: 'vulnerable-strike',
    name: 'Hunting Cannon',
    energyCost: VULNERABLE_STRIKE_ENERGY_COST,
    element: 'Neutral',
    // An OFFENSIVE composite skill (TASK-65), the SAME composition family as
    // armor-break (`[damage, weaken]`) / enfeeble-strike (`[damage, enfeeble]`): it
    // HITS and applies the FIFTH stat-modifier, Vulnerable, to the DEFENDER. Vulnerable
    // is DEFENDER-targeted (it AMPLIFIES the OPPONENT's incoming damage), so it FALLS
    // THROUGH to the generic offensive-ailment branch (`them.statuses`), NOT the
    // self-targeting shield/empower branch. Unlike the pure-control Lullaby Hex it deals
    // damage on its cast turn, so it is SAFE mid-ladder (cost 10). Because it applies a
    // FRESH defender ailment the deterministic tactical chooseSkill rotates it onto the
    // foe in the shipped fight, so a player SEES the foe marked Vulnerable then hit harder.
    effects: [{ kind: 'damage' }, { kind: 'vulnerable' }],
  },
  'doom-curse': {
    id: 'doom-curse',
    name: 'Hell Squeeze',
    energyCost: DOOM_CURSE_ENERGY_COST,
    element: 'Neutral',
    // A PURE-CURSE skill (TASK-66) — the FIRST Doom carrier. DELIBERATELY NON-damaging
    // (NO `damage` arm), mirroring the pure-control lullaby-hex: it only applies the
    // DEFERRED-detonation Doom curse to the DEFENDER. But UNLIKE the pure-control
    // Lullaby Hex (whose sleep deals NO damage and so is never preferred by the tactical
    // policy to avoid a MAX_ROUNDS stall), Doom WILL deal a damage burst when its fuse
    // detonates — so it is a DEFERRED-damage tactical, not a zero-sum control lock. The
    // tactical chooseSkill therefore rotates it onto the foe (it counts as "deals damage,
    // deferred"), so a player SEES the foe Doomed and, a few turns later, Doom detonate.
    effects: [{ kind: 'doom' }],
  },
  'doom-percent-curse': {
    id: 'doom-percent-curse',
    name: 'Doom-Percent Curse',
    energyCost: DOOM_PERCENT_CURSE_ENERGY_COST,
    // A PURE-CURSE skill (TASK-119) — the FRACTIONAL twin of Doom Curse. DELIBERATELY NON-damaging
    // (NO `damage` arm), mirroring `doom-curse`: it only applies the DEFERRED FRACTIONAL-detonation
    // `doom-percent` curse to the DEFENDER (detonating `floor(hp × ratio)` of CURRENT HP at
    // fuse-end). Unlike castable `doom-curse@12`, it is priced 82 > MAX_ENERGY (41) — Posture-B
    // DECOUPLED: `selectSkill`/`chooseSkill` NEVER afford it inside simulateBattle, so the shipped
    // agumon fights stay BYTE-IDENTICAL (a castable fractional-doom WOULD be picked as a deferred-
    // damage tactical and perturb the shipped fight). The fractional detonation is proven OBSERVABLE
    // via the DIRECT-SEAM tick unit (assert (b)) instead of a live-fight cast (see
    // DOOM_PERCENT_CURSE_ENERGY_COST).
    effects: [{ kind: 'doom-percent' }],
  },
  'counter-stance': {
    id: 'counter-stance',
    name: 'Cross Fight',
    energyCost: COUNTER_STANCE_ENERGY_COST,
    element: 'Neutral',
    // A PURE, SELF-targeting BUFF skill (TASK-69) — the THIRD self-buff after Guard
    // (Shield) and Focus (Empower): no `damage` arm, it only raises the reactive
    // Retaliate (Thorns) on the CASTER, routed through the SAME self-vs-defender branch.
    // TASK-75 PROMOTED it IN-pool (cost 45→30, the ladder's TOP slot): the Rule-1b self-buff
    // opener now casts it once the ailment arsenal is spent + energy has climbed to 30, so it
    // is OBSERVABLE (cast + reflect) in a real fight (proven in a dedicated deterministic
    // fixture; numemon/kuwagamon stay byte-identical because their low-energy opener window
    // can't afford it — see the COUNTER_STANCE_ENERGY_COST doc).
    effects: [{ kind: 'retaliate' }],
  },
  'reflect-percent': {
    id: 'reflect-percent',
    name: 'Thorn Mirror',
    energyCost: RETALIATE_PERCENT_ENERGY_COST,
    // A PURE, SELF-targeting BUFF skill (TASK-99) — the fractional MIRROR of Counter Stance
    // (`[retaliate]`): no `damage` arm, it only raises the reactive `retaliate-percent`
    // (Thorn Mirror) on the CASTER via the same self-apply path retaliate uses. Its reflect
    // deals back a FRACTION (RETALIATE_PERCENT_RATIO = 0.5, floored) of the incoming overflow
    // instead of the FIXED RETALIATE_REFLECT_DAMAGE — the way sap-percent/leech-percent mirror
    // sap/leech, EXTENDING the percentage/fidelity axis to the reflect mechanic. Priced 66 >
    // MAX_ENERGY (41) — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped
    // fights stay byte-identical (see RETALIATE_PERCENT_ENERGY_COST).
    effects: [{ kind: 'reflect-percent' }],
  },
  'weaken-percent': {
    id: 'weaken-percent',
    name: 'Crumble',
    energyCost: WEAKEN_PERCENT_ENERGY_COST,
    // A DAMAGING debuff-strike (TASK-100) — the fractional MIRROR of Armor Break
    // (`[damage, weaken]`): it HITS then inflicts the `weaken-percent` ailment on the DEFENDER
    // (via the same generic offensive applyAilment path Armor Break's `weaken` uses). Its DEF cut
    // is a FRACTION (WEAKEN_PERCENT_RATIO = 0.5, floored) of the target's CURRENT def instead of
    // the FIXED WEAKEN_DEF_REDUCTION — the way sap-percent/leech-percent/reflect-percent mirror
    // the fixed sap/leech/retaliate, EXTENDING the percentage/fidelity axis onto the stat-modifier
    // mechanic. Priced 67 > MAX_ENERGY (41) — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see WEAKEN_PERCENT_ENERGY_COST).
    effects: [{ kind: 'damage' }, { kind: 'weaken-percent' }],
  },
  'enfeeble-percent': {
    id: 'enfeeble-percent',
    name: 'Sunder',
    energyCost: ENFEEBLE_PERCENT_ENERGY_COST,
    // A DAMAGING debuff-strike (TASK-101) — the fractional MIRROR of Enfeeble Strike
    // (`[damage, enfeeble]`), the ATK-side twin of Crumble: it HITS then inflicts the
    // `enfeeble-percent` ailment on the DEFENDER (via the same generic offensive applyAilment
    // path Enfeeble Strike's `enfeeble` uses). Its ATK cut is a FRACTION (ENFEEBLE_PERCENT_RATIO
    // = 0.5, floored) of the target's CURRENT atk instead of the FIXED ENFEEBLE_ATK_REDUCTION —
    // the way weaken-percent/sap-percent/leech-percent mirror the fixed weaken/sap/leech,
    // EXTENDING the percentage/fidelity axis onto the ATK-side of the stat-modifier mechanic.
    // Priced 68 > MAX_ENERGY (41) — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so
    // the shipped fights stay byte-identical (see ENFEEBLE_PERCENT_ENERGY_COST).
    effects: [{ kind: 'damage' }, { kind: 'enfeeble-percent' }],
  },
  'empower-percent': {
    id: 'empower-percent',
    name: 'Reinforce',
    energyCost: EMPOWER_PERCENT_ENERGY_COST,
    // A PURE self-buff (TASK-102) — the fractional MIRROR of Focus (`[{ kind: 'empower' }]`), the
    // ATK-BONUS twin of Sunder: NO `damage` arm — it only raises an `empower-percent` (a fractional
    // ATK bonus) on the CASTER (via the same self-apply path Focus's `empower` uses). Its ATK bonus
    // is a FRACTION (EMPOWER_PERCENT_RATIO = 0.5, floored) of the caster's CURRENT atk instead of the
    // FIXED EMPOWER_ATK_BONUS — the way weaken-percent/enfeeble-percent mirror the fixed weaken/enfeeble,
    // EXTENDING the percentage/fidelity axis onto the ATK-BONUS side of the stat-modifier mechanic.
    // Priced 69 > MAX_ENERGY (41) — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the
    // shipped fights stay byte-identical (see EMPOWER_PERCENT_ENERGY_COST).
    effects: [{ kind: 'empower-percent' }],
  },
  'vulnerable-percent': {
    id: 'vulnerable-percent',
    name: 'Rupture',
    energyCost: VULNERABLE_PERCENT_ENERGY_COST,
    // A DAMAGING debuff-strike (TASK-103) — the fractional MIRROR of Vulnerable Strike
    // (`[damage, vulnerable]`), the damage-taken twin of Sunder/Crumble: it HITS then inflicts the
    // `vulnerable-percent` ailment on the DEFENDER (via the same generic offensive applyAilment path
    // Vulnerable Strike's `vulnerable` uses). Its damage-taken bump is a RATIO (VULNERABLE_PERCENT_RATIO
    // = 0.5 = +50%) of the base strike instead of the FIXED VULNERABLE_DAMAGE_TAKEN_BONUS (+25%) —
    // the way weaken-percent/enfeeble-percent/empower-percent mirror the fixed weaken/enfeeble/empower,
    // CLOSING the percentage/fidelity axis on the LAST damage-side stat-modifier without a fractional
    // twin. Priced 70 > MAX_ENERGY (41) — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so
    // the shipped fights stay byte-identical (see VULNERABLE_PERCENT_ENERGY_COST).
    effects: [{ kind: 'damage' }, { kind: 'vulnerable-percent' }],
  },
  'energy-drain': {
    id: 'energy-drain',
    name: 'Capture Beam',
    energyCost: ENERGY_DRAIN_ENERGY_COST,
    element: 'Electric',
    // An OFFENSIVE COMPOSITE skill (TASK-70) — the FIRST resource-interference carrier.
    // Like fire-breath (`[damage, burn]`) it HITS then applies a second effect, but its
    // second arm is the genuinely-new `sap`: it removes a FIXED SAP_ENERGY_AMOUNT from
    // the DEFENDER's ENERGY pool (the resource that gates their skill selection), not
    // their HP / a stat / a control lock. The `damage` half still resolves through the
    // shared monotone resolveDamageStrike; the `sap` half writes only the non-HP energy
    // (A-42 held). PROMOTED IN-POOL by TASK-72 (cost 1, in the fixture's hammer-phase
    // energy band, DELIBERATELY < regen so it never fixed-point-starves Double Strike) so
    // chooseSkill Rule 2 finally casts it in the numemon hammer phase — the mechanic is
    // OBSERVABLE. Effects ordered [damage, sap] so the hit lands before the drain.
    effects: [{ kind: 'damage' }, { kind: 'sap' }],
  },
  'sap-percent': {
    id: 'sap-percent',
    name: 'Energy Rend',
    energyCost: SAP_PERCENT_ENERGY_COST,
    // An OFFENSIVE COMPOSITE skill (TASK-97) — the FIRST fractional-MAGNITUDE
    // resource-interference carrier and the percentage MIRROR of `energy-drain`
    // (`[damage, sap]`). Like `energy-drain` it HITS then drains the DEFENDER's energy,
    // but its second arm is the genuinely-new `sap-percent`: it removes a FRACTION
    // (SAP_PERCENT_RATIO = 0.5, floored) of the defender's CURRENT energy instead of the
    // FIXED SAP_ENERGY_AMOUNT. The `damage` half resolves through the shared monotone
    // resolveDamageStrike; the `sap-percent` half writes only the non-HP energy (A-42
    // held). Effects ordered [damage, sap-percent] so the hit lands before the drain.
    // Priced 64 > MAX_ENERGY (41) — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see SAP_PERCENT_ENERGY_COST).
    effects: [{ kind: 'damage' }, { kind: 'sap-percent' }],
  },
  'leech-percent': {
    id: 'leech-percent',
    name: 'Energy Surge',
    energyCost: LEECH_PERCENT_ENERGY_COST,
    // An OFFENSIVE COMPOSITE skill (TASK-98) — the SECOND fractional-MAGNITUDE
    // resource-interference carrier and the percentage MIRROR of `energy-siphon`
    // (`[damage, leech]`), the CREDIT twin of `sap-percent`. Like `energy-siphon` it HITS
    // then credits the ATTACKER's OWN energy, but its second arm is the genuinely-new
    // `leech-percent`: it regains a FRACTION (LEECH_PERCENT_RATIO = 0.5, floored) of the
    // caster's CURRENT energy instead of the FIXED LEECH_ENERGY_AMOUNT. The `damage` half
    // resolves through the shared monotone resolveDamageStrike; the `leech-percent` half
    // writes only the non-HP energy (A-42 held). Effects ordered [damage, leech-percent] so
    // the hit lands before the credit. Priced 65 > MAX_ENERGY (41) — Posture-B DECOUPLED:
    // NEVER picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // LEECH_PERCENT_ENERGY_COST).
    effects: [{ kind: 'damage' }, { kind: 'leech-percent' }],
  },
  'energy-siphon': {
    id: 'energy-siphon',
    name: 'Energy Ray',
    energyCost: ENERGY_SIPHON_ENERGY_COST,
    element: 'Electric',
    // An OFFENSIVE COMPOSITE skill (TASK-71) — the SECOND resource-interference carrier
    // and the exact MIRROR of energy-drain. Like fire-breath (`[damage, burn]`) it HITS
    // then applies a second effect, but its second arm is the genuinely-new `leech`: it
    // CREDITS a FIXED LEECH_ENERGY_AMOUNT to the ATTACKER's OWN energy pool (capped at
    // MAX_ENERGY) — the FIRST effect to raise a combatant's own energy above the regen
    // path (sap removes from the defender; leech grants to the attacker). The `damage`
    // half still resolves through the shared monotone resolveDamageStrike; the `leech`
    // half writes only the non-HP energy (A-42 held). PROMOTED IN-POOL by TASK-73 (cost 4,
    // between armor-break@5 and bleed-strike@3) — the 2nd OBSERVABLE PROMOTION — so
    // chooseSkill Rule 2 casts it in the numemon hammer turn and Leech is finally SEEN (the
    // mirror of Sap). Effects ordered [damage, leech] so the hit lands before the leech.
    effects: [{ kind: 'damage' }, { kind: 'leech' }],
  },
  'swap-atk': {
    id: 'swap-atk',
    name: 'Chaos Shift',
    energyCost: SWAP_ATK_ENERGY_COST,
    // A PURE, NON-damaging UTILITY skill (TASK-104) — the FIRST stat-VALUE SWAP carrier,
    // opening a genuinely-NEW *shape* axis (transfer of raw STAT VALUES, distinct from the
    // transfer of status ARRAYS by cleanse/dispel/purloin/displace/reclaim). No `damage` arm
    // (like `dispel`/`counter-stance`): its single `{ kind: 'swap-atk' }` effect resolves ON
    // CAST and EXCHANGES the two combatants' raw `atk` values in place (see the on-cast branch
    // in simulateBattle), touching the opponent like `displace`/`purloin` but writing NO HP
    // (A-42). Priced 42 > MAX_ENERGY (41) and DISTINCT from every above-pool cost —
    // Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay
    // byte-identical (see SWAP_ATK_ENERGY_COST).
    effects: [{ kind: 'swap-atk' }],
  },
  'swap-def': {
    id: 'swap-def',
    name: 'Chaos Warp',
    energyCost: SWAP_DEF_ENERGY_COST,
    // A PURE, NON-damaging UTILITY skill (TASK-105) — the SECOND stat-VALUE SWAP carrier and
    // the defensive twin of Chaos Shift/`swap-atk`, ADVANCING the stat-VALUE-transfer *shape*
    // axis (distinct from the transfer of status ARRAYS by cleanse/dispel/purloin/displace/
    // reclaim). No `damage` arm (like `swap-atk`/`dispel`/`counter-stance`): its single
    // `{ kind: 'swap-def' }` effect resolves ON CAST and EXCHANGES the two combatants' raw `def`
    // values in place (see the on-cast branch in simulateBattle), touching the opponent like
    // `swap-atk`/`displace` but writing NO HP (A-42). Priced 71 > MAX_ENERGY (41) and DISTINCT
    // from every above-pool cost — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so
    // the shipped fights stay byte-identical (see SWAP_DEF_ENERGY_COST).
    effects: [{ kind: 'swap-def' }],
  },
  'swap-spd': {
    id: 'swap-spd',
    name: 'Chaos Cyclone',
    energyCost: SWAP_SPD_ENERGY_COST,
    // A PURE, NON-damaging UTILITY skill (TASK-106) — the THIRD stat-VALUE SWAP carrier and
    // the speed twin of Chaos Shift/`swap-atk` + Chaos Warp/`swap-def`, COMPLETING the per-scalar
    // atk→def→spd swap trio (distinct from the transfer of status ARRAYS by cleanse/dispel/
    // purloin/displace/reclaim). No `damage` arm (like `swap-atk`/`swap-def`/`dispel`/
    // `counter-stance`): its single `{ kind: 'swap-spd' }` effect resolves ON CAST and EXCHANGES
    // the two combatants' raw `spd` values in place (see the on-cast branch in simulateBattle),
    // touching the opponent like `swap-def`/`displace` but writing NO HP (A-42). Priced 72 >
    // MAX_ENERGY (41) and DISTINCT from every above-pool cost — Posture-B DECOUPLED: NEVER picked
    // inside simulateBattle, so the shipped fights stay byte-identical (see SWAP_SPD_ENERGY_COST).
    effects: [{ kind: 'swap-spd' }],
  },
  'swap-all': {
    id: 'swap-all',
    name: 'Chaos Nexus',
    energyCost: SWAP_ALL_ENERGY_COST,
    // A PURE, NON-damaging UTILITY skill (TASK-107) — the FULL three-stat SWAP carrier that
    // EXCHANGES `atk` + `def` + `spd` TOGETHER in a single cast, EXHAUSTING the stat-value-swap
    // shape family the per-scalar Chaos Shift/`swap-atk` + Chaos Warp/`swap-def` + Chaos Cyclone/
    // `swap-spd` trio opened (distinct from the transfer of status ARRAYS by cleanse/dispel/
    // purloin/displace/reclaim). No `damage` arm (like `swap-atk`/`swap-def`/`swap-spd`/`dispel`/
    // `counter-stance`): its single `{ kind: 'swap-all' }` effect resolves ON CAST and EXCHANGES
    // all three of the two combatants' raw scalar pairs in place (see the on-cast branch in
    // simulateBattle, which COMPOSES swapAtk/swapDef/swapSpd), touching the opponent like
    // `swap-spd`/`displace` but writing NO HP (A-42). Priced 73 > MAX_ENERGY (41) and DISTINCT
    // from every above-pool cost — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the
    // shipped fights stay byte-identical (see SWAP_ALL_ENERGY_COST).
    effects: [{ kind: 'swap-all' }],
  },
  fortify: {
    id: 'fortify',
    name: 'Fortify',
    energyCost: FORTIFY_ENERGY_COST,
    // A PURE, NON-damaging SELF-targeting BUFF skill (TASK-108) — the missing DEFENSIVE member of
    // the self-buff family: the DEF-up self-buff (the SELF-BUFF mirror of weaken/DEF-down, the
    // DEF-axis twin of the shipped empower/ATK-up Focus). No `damage` arm (like Focus/Guard): its
    // single `{ kind: 'fortify' }` effect resolves ON CAST and raises/refreshes the lingering
    // `fortify` DEF-up buff on the CASTER (self-target), via the SAME applyAilment self-branch
    // shield/empower use. Its DEF-raising payoff is read at the resolveDamageStrike netDefReduction
    // seam when the fortified side is ATTACKED. Priced 74 > MAX_ENERGY (41) and DISTINCT from every
    // above-pool cost — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped
    // fights stay byte-identical (see FORTIFY_ENERGY_COST). Writes NO HP (A-42).
    effects: [{ kind: 'fortify' }],
  },
  brace: {
    id: 'brace',
    name: 'Brace',
    energyCost: BRACE_ENERGY_COST,
    // A PURE, NON-damaging SELF-targeting BUFF skill (TASK-109) — the missing damage-application-seam
    // member: the damage-taken-DOWN self-buff (the POSITIVE MIRROR of vulnerable/damage-taken-UP,
    // distinct from fortify which lives at the OTHER/DEF-mitigation seam). No `damage` arm (like
    // Focus/Fortify): its single `{ kind: 'brace' }` effect resolves ON CAST and grants/refreshes the
    // lingering `brace` damage-taken-DOWN buff on the CASTER (self-target), via the SAME applyAilment
    // self-branch shield/empower/fortify use. Its damage-reducing payoff is read at the
    // amplifyForVulnerable damage-application seam when the braced side is ATTACKED. Priced 75 >
    // MAX_ENERGY (41) and DISTINCT from every above-pool cost — Posture-B DECOUPLED: NEVER picked
    // inside simulateBattle, so the shipped fights stay byte-identical (see BRACE_ENERGY_COST). Writes
    // NO HP (A-42).
    effects: [{ kind: 'brace' }],
  },
  'brace-percent': {
    id: 'brace-percent',
    name: 'Bulwark',
    energyCost: BRACE_PERCENT_ENERGY_COST,
    // A PURE, NON-damaging SELF-targeting BUFF skill (TASK-110) — the missing PERCENT member of the
    // damage-application seam: the PERCENTAGE damage-taken-DOWN self-buff (the fractional MIRROR of
    // `brace` and the DOWN-side percent twin of `vulnerable-percent`). No `damage` arm (like
    // Focus/Fortify/Brace): its single `{ kind: 'brace-percent' }` effect resolves ON CAST and
    // grants/refreshes the lingering `brace-percent` damage-taken-DOWN buff on the CASTER (self-target),
    // via the SAME applyAilment self-branch shield/empower/fortify/brace use. Its damage-reducing payoff
    // is read at the amplifyForVulnerable damage-application seam when the bulwarked side is ATTACKED.
    // Priced 76 > MAX_ENERGY (41) and DISTINCT from every above-pool cost — Posture-B DECOUPLED: NEVER
    // picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // BRACE_PERCENT_ENERGY_COST). Writes NO HP (A-42).
    effects: [{ kind: 'brace-percent' }],
  },
  'fortify-percent': {
    id: 'fortify-percent',
    name: 'Aegis',
    energyCost: FORTIFY_PERCENT_ENERGY_COST,
    // A PURE, NON-damaging SELF-targeting BUFF skill (TASK-111) — the missing PERCENT-UP member of the
    // DEF-mitigation seam: the PERCENTAGE DEF-UP self-buff (the fractional MIRROR of `fortify` and the
    // DEF-UP percent twin of the DEBUFF `weaken-percent`). No `damage` arm (like Focus/Fortify/Brace):
    // its single `{ kind: 'fortify-percent' }` effect resolves ON CAST and grants/refreshes the
    // lingering `fortify-percent` DEF-up buff on the CASTER (self-target), via the SAME applyAilment
    // self-branch shield/empower/fortify/brace use. Its DEF-raising payoff is read at the
    // resolveDamageStrike netDefReduction DEF-mitigation seam when the aegis'd side is ATTACKED —
    // floor(def × defBonusRatio) SUBTRACTED from the reduction sum, EXACTLY mirroring how
    // weaken-percent ADDS floor(def × ratio). Priced 77 > MAX_ENERGY (41) and DISTINCT from every
    // above-pool cost — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights
    // stay byte-identical (see FORTIFY_PERCENT_ENERGY_COST). Writes NO HP (A-42).
    effects: [{ kind: 'fortify-percent' }],
  },
  hasten: {
    id: 'hasten',
    name: 'Quicken',
    energyCost: HASTEN_ENERGY_COST,
    // A PURE, NON-damaging SELF-targeting BUFF skill (TASK-112) — the FIRST member of the SPD stat-mod
    // axis (the SOLE previously-unfilled stat-mod axis): the FLAT SPD-UP self-buff, the SPD-axis twin of
    // the DEF-up `fortify` and the ATK-up `empower`. No `damage` arm (like Focus/Fortify/Empower): its
    // single `{ kind: 'hasten' }` effect resolves ON CAST and grants/refreshes the lingering `hasten`
    // SPD-up buff on the CASTER (self-target), via the SAME applyAilment self-branch
    // shield/empower/fortify/brace use. Its SPD-raising payoff is read by the pure effectiveSpd helper
    // (spd + spdBonus, clamped ≥ MIN_EFFECTIVE_SPD) — DELIBERATELY NOT wired into the once-computed
    // turn-order line this slice (A-99); a true turn-order-re-order haste is a carved later wave built ON
    // this helper. Priced 78 > MAX_ENERGY (41) and DISTINCT from every above-pool cost — Posture-B
    // DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // HASTEN_ENERGY_COST). Writes NO HP (A-42).
    effects: [{ kind: 'hasten' }],
  },
  'hasten-percent': {
    id: 'hasten-percent',
    name: 'Rush',
    energyCost: HASTEN_PERCENT_ENERGY_COST,
    // A PURE, NON-damaging SELF-targeting BUFF skill (TASK-113) — the PERCENTAGE SPD-UP self-buff, the
    // percent-UP twin of the flat `hasten` and the SPD-axis mirror of the DEF-up `fortify-percent` and
    // ATK-up `empower-percent`. No `damage` arm (like Fortify/Aegis/Quicken): its single
    // `{ kind: 'hasten-percent' }` effect resolves ON CAST and grants/refreshes the lingering
    // `hasten-percent` SPD-up buff on the CASTER (self-target), via the SAME applyAilment self-branch
    // hasten/fortify-percent use. Its SPD-raising payoff is read by the pure effectiveSpd helper
    // (spd + floor(spd × ratio), clamped ≥ MIN_EFFECTIVE_SPD) — DELIBERATELY NOT wired into the
    // once-computed turn-order line (A-99 unchanged); a true turn-order-re-order haste is a carved later
    // wave built ON this helper. Priced 79 > MAX_ENERGY (41) and DISTINCT from every above-pool cost —
    // Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay byte-identical
    // (see HASTEN_PERCENT_ENERGY_COST). Writes NO HP (A-42).
    effects: [{ kind: 'hasten-percent' }],
  },
  hobble: {
    id: 'hobble',
    name: 'Hobble',
    energyCost: HOBBLE_ENERGY_COST,
    // A PURE, NON-damaging FOE-targeting DEBUFF skill (TASK-114) — the FIRST member of the SPD-axis DOWN
    // half: the FLAT SPD-DOWN debuff, the SPD-axis mirror of the DEF-down `weaken` (Armor Break) and the
    // ATK-down `enfeeble` (Enfeeble Strike). No `damage` arm (a clean single-effect debuff like the
    // self-buff shapes, but foe-targeted): its single `{ kind: 'hobble' }` effect resolves ON CAST and
    // grants/refreshes the lingering `hobble` SPD-down debuff on the FOE (defender-target), routing
    // through the SAME generic offensive applyAilment else-branch weaken/enfeeble use (its effect kind
    // equals its ailment kind, so it is NOT on skillAilment's self-target list). Its SPD-lowering payoff
    // is read by the pure effectiveSpd helper (spd - spdReduction, clamped ≥ MIN_EFFECTIVE_SPD) —
    // DELIBERATELY NOT wired into the once-computed turn-order line this slice (A-99); a true
    // turn-order-re-order slow is a carved later wave built ON this helper. Priced 80 > MAX_ENERGY (41)
    // and DISTINCT from every above-pool cost — Posture-B DECOUPLED: NEVER picked inside simulateBattle,
    // so the shipped fights stay byte-identical (see HOBBLE_ENERGY_COST). Writes NO HP (A-42).
    effects: [{ kind: 'hobble' }],
  },
  'hobble-percent': {
    id: 'hobble-percent',
    name: 'Cripple',
    energyCost: HOBBLE_PERCENT_ENERGY_COST,
    // A PURE, NON-damaging FOE-targeting DEBUFF skill (TASK-115) — the PERCENTAGE SPD-DOWN debuff
    // COMPLETING the SPD-axis DOWN percent square: the percentage twin of the flat `hobble` (Hobble) and
    // the SPD-axis mirror of the DEF-down `weaken-percent` (Crumble) and ATK-down `enfeeble-percent`
    // (Sunder). No `damage` arm (a clean single-effect debuff like hobble/hasten-percent, foe-targeted):
    // its single `{ kind: 'hobble-percent' }` effect resolves ON CAST and grants/refreshes the lingering
    // `hobble-percent` SPD-down debuff on the FOE (defender-target), routing through the SAME generic
    // offensive applyAilment else-branch hobble/weaken-percent use (its effect kind equals its ailment
    // kind, so it is NOT on skillAilment's self-target list). Its SPD-lowering payoff is read by the pure
    // effectiveSpd helper (spd - floor(spd × ratio), clamped ≥ MIN_EFFECTIVE_SPD) — DELIBERATELY NOT wired
    // into the once-computed turn-order line this slice (A-99); a true turn-order-re-order slow is a
    // carved later wave built ON this helper. Priced 81 > MAX_ENERGY (41) and DISTINCT from every
    // above-pool cost (incl. hobble@80) — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the
    // shipped fights stay byte-identical (see HOBBLE_PERCENT_ENERGY_COST). Writes NO HP (A-42).
    effects: [{ kind: 'hobble-percent' }],
  },
  cleanse: {
    id: 'cleanse',
    name: 'Purify',
    energyCost: CLEANSE_ENERGY_COST,
    // A PURE, SELF-targeting UTILITY skill (TASK-76) — the FIRST status-REMOVAL carrier
    // and the first NEW mechanic after the observable-promotion arc closed. No `damage`
    // arm: it only STRIPS the CASTER's OWN harmful arms (DoTs / stat-downs / control
    // locks) via {@link clearDebuffs}, leaving the caster's self-buffs intact (A-65),
    // routed through the SAME self-vs-defender branch as guard/focus/counter-stance.
    // Priced 43 > MAX_ENERGY (41) — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see CLEANSE_ENERGY_COST).
    effects: [{ kind: 'cleanse' }],
  },
  dispel: {
    id: 'dispel',
    name: 'Purge',
    energyCost: DISPEL_ENERGY_COST,
    // A PURE, HOSTILE UTILITY skill (TASK-77) — the SECOND status-REMOVAL carrier and the
    // inverse of Purify. No `damage` arm: it only STRIPS the FOE's SELF-BUFFS
    // (empower/shield/retaliate) via {@link stripBuffs}, leaving the foe's harmful arms
    // intact (A-66), routed through the OPPONENT-targeting apply branch (NOT the self-branch
    // that cleanse/guard/focus/counter-stance use). Priced 44 > MAX_ENERGY (41) and DISTINCT
    // from cleanse@43 — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the
    // shipped fights stay byte-identical (see DISPEL_ENERGY_COST).
    effects: [{ kind: 'dispel' }],
  },
  purloin: {
    id: 'purloin',
    name: 'Spellthief',
    energyCost: PURLOIN_ENERGY_COST,
    // A PURE, HOSTILE UTILITY skill (TASK-78) — the THIRD status-REMOVAL carrier and the
    // FIRST strip-and-TRANSFER. No `damage` arm: it strips the FOE's SELF-BUFFS
    // (empower/shield/retaliate) via {@link stripBuffs} AND, when a strip actually occurred,
    // grants the CASTER a FIXED `empower` self-buff (via {@link stealBuffs}) — a genuine,
    // conditional steal. Priced 45 > MAX_ENERGY (41) and DISTINCT from dispel@44 / cleanse@43
    // — Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay
    // byte-identical (see PURLOIN_ENERGY_COST).
    effects: [{ kind: 'purloin' }],
  },
  displace: {
    id: 'displace',
    name: 'Scapegoat',
    energyCost: DISPLACE_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-79) — the FOURTH status-REMOVAL carrier
    // and the FIRST self→foe DEBUFF TRANSFER (the MIRROR of Spellthief). No `damage` arm: it
    // CLEARS the CASTER's OWN harmful debuffs via {@link clearDebuffs} AND, when a clear
    // actually occurred, inflicts a FIXED `weaken` on the FOE via the EXISTING `weaken`
    // {@link applyAilment} builder — a genuine, conditional transfer. Priced 46 > MAX_ENERGY
    // (41) and DISTINCT from purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER
    // picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // DISPLACE_ENERGY_COST).
    effects: [{ kind: 'displace' }],
  },
  reclaim: {
    id: 'reclaim',
    name: 'Backfire',
    energyCost: RECLAIM_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-80) — the FIFTH status-REMOVAL carrier
    // and the FIRST PAYLOAD-PRESERVING self→foe DEBUFF TRANSFER (the A-68 refinement of
    // Scapegoat). No `damage` arm: it CLEARS the CASTER's OWN harmful debuffs via
    // {@link clearDebuffs} AND, when a clear actually occurred, inflicts the SAME cleared
    // KINDS on the FOE via the EXISTING {@link applyAilment} builder — a genuine, conditional,
    // payload-preserving clone (not Displace's fixed `weaken`). Priced 47 > MAX_ENERGY (41) and
    // DISTINCT from displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED:
    // NEVER picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // RECLAIM_ENERGY_COST).
    effects: [{ kind: 'reclaim' }],
  },
  'reclaim-deep': {
    id: 'reclaim-deep',
    name: 'Rebound',
    energyCost: REBOUND_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-81) — the SIXTH status-REMOVAL carrier
    // and the FIRST RAW ARM-BY-ARM DEEP-COPY self→foe DEBUFF TRANSFER (the A-69 refinement of
    // Backfire). No `damage` arm: it CLEARS the CASTER's OWN harmful debuff ARMS via
    // {@link clearDebuffs} AND, when at least one arm was captured, DEEP-COPIES those exact arms
    // onto the FOE (preserving each arm's remaining turnsRemaining/damagePerTurn/ramp — NOT
    // Backfire's reset-to-canonical re-brew). Priced 48 > MAX_ENERGY (41) and DISTINCT from
    // reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED:
    // NEVER picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // REBOUND_ENERGY_COST).
    effects: [{ kind: 'reclaim-deep' }],
  },
  'reclaim-cripple': {
    id: 'reclaim-cripple',
    name: 'Rebound-Cripple',
    energyCost: REBOUND_CRIPPLE_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-88) — the THIRTEENTH status-REMOVAL carrier
    // and the SECOND MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. No
    // `damage` arm: it CLEARS ONLY the caster's SUBSET debuff ARMS (the UNION of the STAT-MOD AND
    // control-lock kinds in {@link REBOUND_CRIPPLE_KINDS} = REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS)
    // via {@link clearKinds} — leaving the caster's DoTs, `doom` and self-buffs intact — AND, when
    // at least one subset arm was captured, FULL-duration DEEP-COPIES those exact arms onto the FOE
    // (like Rebound-Snap/Lock/Blight). REBOUND_CRIPPLE_KINDS is a STRICT SUBSET of
    // CLEANSABLE_DEBUFF_KINDS and DISJOINT from BOTH REBOUND_SPLIT_KINDS (DoTs) AND
    // REBOUND_DOOM_KINDS (`doom`) — it spans MORE THAN ONE disjoint family but LESS than the whole
    // set (the union axis), and is the COMPLEMENTARY 2-of-4 pair to Rebound-Blight (they overlap
    // only on the control-locks). Priced 55 > MAX_ENERGY (41) and DISTINCT from reclaim-blight@54 /
    // reclaim-doom@53 / reclaim-locks@52 / reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49
    // / reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B
    // DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // REBOUND_CRIPPLE_ENERGY_COST).
    effects: [{ kind: 'reclaim-cripple' }],
  },
  'reclaim-sear': {
    id: 'reclaim-sear',
    name: 'Rebound-Sear',
    energyCost: REBOUND_SEAR_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-89) — the FOURTEENTH status-REMOVAL carrier
    // and the THIRD MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. No
    // `damage` arm: it CLEARS ONLY the caster's SUBSET debuff ARMS (the UNION of the DoT AND
    // stat-mod kinds in {@link REBOUND_SEAR_KINDS} = REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS)
    // via {@link clearKinds} — leaving the caster's control-locks, `doom` and self-buffs intact
    // — AND, when at least one subset arm was captured, FULL-duration DEEP-COPIES those exact arms
    // onto the FOE (like Rebound-Split/Snap/Blight/Cripple). REBOUND_SEAR_KINDS is a STRICT SUBSET
    // of CLEANSABLE_DEBUFF_KINDS and DISJOINT from BOTH REBOUND_LOCK_KINDS (control-locks) AND
    // REBOUND_DOOM_KINDS (`doom`) — it spans MORE THAN ONE disjoint family but LESS than the whole
    // set (the union axis), and is the FIRST union NOT containing the control-locks (Sear = Split ∪
    // Snap; distinct from Blight and Cripple which both share the locks). Priced 56 > MAX_ENERGY
    // (41) and DISTINCT from reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 /
    // reclaim-locks@52 / reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48
    // / reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER
    // picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // REBOUND_SEAR_ENERGY_COST).
    effects: [{ kind: 'reclaim-sear' }],
  },
  'reclaim-doomburn': {
    id: 'reclaim-doomburn',
    name: 'Rebound-Doomburn',
    energyCost: REBOUND_DOOMBURN_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-90) — the FIFTEENTH status-REMOVAL carrier
    // and the FOURTH MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the
    // FIRST union CONTAINING `doom`. No `damage` arm: it CLEARS ONLY the caster's SUBSET debuff
    // ARMS (the UNION of the DoT AND `doom` kinds in {@link REBOUND_DOOMBURN_KINDS} =
    // REBOUND_SPLIT_KINDS ∪ REBOUND_DOOM_KINDS) via {@link clearKinds} — leaving the caster's
    // stat-mods, control-locks and self-buffs intact — AND, when at least one subset arm was
    // captured, FULL-duration DEEP-COPIES those exact arms onto the FOE (like Rebound-Split/Snap/
    // Blight/Cripple/Sear). REBOUND_DOOMBURN_KINDS is a STRICT SUBSET of CLEANSABLE_DEBUFF_KINDS
    // and DISJOINT from BOTH REBOUND_SNAP_KINDS (stat-mods) AND REBOUND_LOCK_KINDS (control-locks)
    // — it spans MORE THAN ONE disjoint family but LESS than the whole set (the union axis), and
    // is the FIRST union CONTAINING `doom` (Doomburn = Split ∪ Doom; distinct from Blight, Cripple
    // and Sear which all EXCLUDE `doom`). Priced 57 > MAX_ENERGY (41) and DISTINCT from
    // reclaim-sear@56 / reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52
    // / reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
    // displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see REBOUND_DOOMBURN_ENERGY_COST).
    effects: [{ kind: 'reclaim-doomburn' }],
  },
  'reclaim-snapdoom': {
    id: 'reclaim-snapdoom',
    name: 'Rebound-Snapdoom',
    energyCost: REBOUND_SNAPDOOM_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-91) — the SIXTEENTH status-REMOVAL carrier
    // and the FIFTH MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the
    // SECOND union CONTAINING `doom`. No `damage` arm: it CLEARS ONLY the caster's SUBSET debuff
    // ARMS (the UNION of the STAT-MOD AND `doom` kinds in {@link REBOUND_SNAPDOOM_KINDS} =
    // REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS) via {@link clearKinds} — leaving the caster's
    // DoTs, control-locks and self-buffs intact — AND, when at least one subset arm was
    // captured, FULL-duration DEEP-COPIES those exact arms onto the FOE (like Rebound-Split/Snap/
    // Blight/Cripple/Sear/Doomburn). REBOUND_SNAPDOOM_KINDS is a STRICT SUBSET of
    // CLEANSABLE_DEBUFF_KINDS and DISJOINT from BOTH REBOUND_SPLIT_KINDS (DoTs) AND
    // REBOUND_LOCK_KINDS (control-locks) — it spans MORE THAN ONE disjoint family but LESS than
    // the whole set (the union axis), and is the SECOND union CONTAINING `doom` (Snapdoom = Snap
    // ∪ Doom; distinct from Doomburn = Split ∪ Doom, and from Blight, Cripple and Sear which all
    // EXCLUDE `doom`). Priced 58 > MAX_ENERGY (41) and DISTINCT from reclaim-doomburn@57 /
    // reclaim-sear@56 / reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52
    // / reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
    // displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see REBOUND_SNAPDOOM_ENERGY_COST).
    effects: [{ kind: 'reclaim-snapdoom' }],
  },
  'reclaim-doomlock': {
    id: 'reclaim-doomlock',
    name: 'Rebound-Doomlock',
    energyCost: REBOUND_DOOMLOCK_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-92) — the SEVENTEENTH status-REMOVAL carrier
    // and the SIXTH (and FINAL) MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER,
    // the THIRD (and last) union CONTAINING `doom`. No `damage` arm: it CLEARS ONLY the caster's
    // SUBSET debuff ARMS (the UNION of the CONTROL-LOCK AND `doom` kinds in
    // {@link REBOUND_DOOMLOCK_KINDS} = REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS) via
    // {@link clearKinds} — leaving the caster's DoTs, stat-mods and self-buffs intact — AND, when at
    // least one subset arm was captured, FULL-duration DEEP-COPIES those exact arms onto the FOE
    // (like Rebound-Split/Snap/Blight/Cripple/Sear/Doomburn/Snapdoom). REBOUND_DOOMLOCK_KINDS is a
    // STRICT SUBSET of CLEANSABLE_DEBUFF_KINDS and DISJOINT from BOTH REBOUND_SPLIT_KINDS (DoTs) AND
    // REBOUND_SNAP_KINDS (stat-mods) — it spans MORE THAN ONE disjoint family but LESS than the whole
    // set (the union axis), and is the THIRD union CONTAINING `doom` (Doomlock = Lock ∪ Doom;
    // distinct from Doomburn = Split ∪ Doom and Snapdoom = Snap ∪ Doom which share only `doom`, and
    // from Blight, Cripple and Sear which all EXCLUDE `doom`), CLOSING all six 2-of-4 unions. Priced
    // 59 > MAX_ENERGY (41) and DISTINCT from reclaim-snapdoom@58 / reclaim-doomburn@57 /
    // reclaim-sear@56 / reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 /
    // reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
    // displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see REBOUND_DOOMLOCK_ENERGY_COST).
    effects: [{ kind: 'reclaim-doomlock' }],
  },
  'reclaim-purge': {
    id: 'reclaim-purge',
    name: 'Rebound-Purge',
    energyCost: REBOUND_PURGE_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-93) — the EIGHTEENTH status-REMOVAL carrier
    // and the FIRST 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, OPENING the
    // 3-of-4 selectivity DEPTH. No `damage` arm: it CLEARS ONLY the caster's SUBSET debuff ARMS
    // (the UNION of the DoT, STAT-MOD AND CONTROL-LOCK kinds in {@link REBOUND_PURGE_KINDS} =
    // REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS = "everything but `doom`") via
    // {@link clearKinds} — leaving ONLY the caster's `doom` arm and self-buffs intact — AND, when at
    // least one subset arm was captured, FULL-duration DEEP-COPIES those exact arms onto the FOE
    // (like Rebound-Split/Snap/Lock/Blight/Cripple/Sear/Doomburn/Snapdoom/Doomlock).
    // REBOUND_PURGE_KINDS is a STRICT SUBSET of CLEANSABLE_DEBUFF_KINDS (10 < 11), DISJOINT from
    // REBOUND_DOOM_KINDS (it leaves `doom` behind), and a STRICT SUPERSET of every singleton subset
    // AND every 2-of-4 union that EXCLUDES `doom` (Blight/Cripple/Sear) — it spans THREE disjoint
    // families but LESS than the whole set (the 3-of-4 rung), and is strictly LARGER than Sear
    // (Sear excludes the control-locks). Priced 60 > MAX_ENERGY (41) and DISTINCT from
    // reclaim-doomlock@59 / reclaim-snapdoom@58 / reclaim-doomburn@57 / reclaim-sear@56 /
    // reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 / reclaim-stats@51
    // / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 /
    // purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside simulateBattle,
    // so the shipped fights stay byte-identical (see REBOUND_PURGE_ENERGY_COST).
    effects: [{ kind: 'reclaim-purge' }],
  },
  'reclaim-seardoom': {
    id: 'reclaim-seardoom',
    name: 'Rebound-Seardoom',
    energyCost: REBOUND_SEARDOOM_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-94) — the NINETEENTH status-REMOVAL carrier
    // and the SECOND 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the FIRST 3-of-4
    // union that INCLUDES `doom`, ADVANCING the 3-of-4 selectivity DEPTH. No `damage` arm: it CLEARS
    // ONLY the caster's SUBSET debuff ARMS (the UNION of the DoT, STAT-MOD AND `doom` kinds in
    // {@link REBOUND_SEARDOOM_KINDS} = REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS
    // = "everything but the CONTROL-LOCKS") via {@link clearKinds} — leaving ONLY the caster's
    // control-lock arms and self-buffs intact — AND, when at least one subset arm was captured,
    // FULL-duration DEEP-COPIES those exact arms onto the FOE (like Rebound-Split/…/Doomlock/Purge).
    // REBOUND_SEARDOOM_KINDS is a STRICT SUBSET of CLEANSABLE_DEBUFF_KINDS (8 < 11), DISJOINT from
    // REBOUND_LOCK_KINDS (it leaves the control-locks behind), and a STRICT SUPERSET of Sear
    // (Split∪Snap) plus Doomburn (Split∪Doom) and Snapdoom (Snap∪Doom) — it spans THREE disjoint
    // families but LESS than the whole set (the 3-of-4 rung), the MIRROR of Purge across the
    // doom/control-lock swap (sizes 8 vs 10). Priced 61 > MAX_ENERGY (41) and DISTINCT from
    // reclaim-purge@60 / reclaim-doomlock@59 / reclaim-snapdoom@58 / reclaim-doomburn@57 /
    // reclaim-sear@56 / reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 /
    // reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
    // displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see REBOUND_SEARDOOM_ENERGY_COST).
    effects: [{ kind: 'reclaim-seardoom' }],
  },
  'reclaim-blightdoom': {
    id: 'reclaim-blightdoom',
    name: 'Rebound-Blightdoom',
    energyCost: REBOUND_BLIGHTDOOM_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-95) — the TWENTIETH status-REMOVAL carrier
    // and the THIRD 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the SECOND 3-of-4
    // union that INCLUDES `doom`, ADVANCING the 3-of-4 selectivity DEPTH. No `damage` arm: it CLEARS
    // ONLY the caster's SUBSET debuff ARMS (the UNION of the DoT, CONTROL-LOCK AND `doom` kinds in
    // {@link REBOUND_BLIGHTDOOM_KINDS} = REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS
    // = "everything but the STAT-MODS") via {@link clearKinds} — leaving ONLY the caster's stat-mod
    // arms and self-buffs intact — AND, when at least one subset arm was captured, FULL-duration
    // DEEP-COPIES those exact arms onto the FOE (like Rebound-Split/…/Doomlock/Purge/Seardoom).
    // REBOUND_BLIGHTDOOM_KINDS is a STRICT SUBSET of CLEANSABLE_DEBUFF_KINDS (8 < 11), DISJOINT from
    // REBOUND_SNAP_KINDS (it leaves the stat-mods behind), and a STRICT SUPERSET of Blight
    // (Split∪Lock) plus Doomburn (Split∪Doom) and Doomlock (Lock∪Doom) — it spans THREE disjoint
    // families but LESS than the whole set (the 3-of-4 rung), the MIRROR of Seardoom across the
    // stat-mod/control-lock swap (equal size 8, different membership; DISTINCT from Purge 8 vs 10).
    // Priced 62 > MAX_ENERGY (41) and DISTINCT from reclaim-seardoom@61 / reclaim-purge@60 /
    // reclaim-doomlock@59 / reclaim-snapdoom@58 / reclaim-doomburn@57 / reclaim-sear@56 /
    // reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 / reclaim-stats@51 /
    // reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 /
    // purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside simulateBattle,
    // so the shipped fights stay byte-identical (see REBOUND_BLIGHTDOOM_ENERGY_COST).
    effects: [{ kind: 'reclaim-blightdoom' }],
  },
  'reclaim-snaplockdoom': {
    id: 'reclaim-snaplockdoom',
    name: 'Rebound-Snaplockdoom',
    energyCost: REBOUND_SNAPLOCKDOOM_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-96) — the TWENTY-FIRST status-REMOVAL carrier
    // and the FOURTH and LAST 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the
    // THIRD 3-of-4 union that INCLUDES `doom`, CLOSING the 3-of-4 selectivity axis. No `damage` arm:
    // it CLEARS ONLY the caster's SUBSET debuff ARMS (the UNION of the STAT-MOD, CONTROL-LOCK AND
    // `doom` kinds in {@link REBOUND_SNAPLOCKDOOM_KINDS} = REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS ∪
    // REBOUND_DOOM_KINDS = "everything but the DoTs") via {@link clearKinds} — leaving ONLY the
    // caster's DoT arms and self-buffs intact — AND, when at least one subset arm was captured,
    // FULL-duration DEEP-COPIES those exact arms onto the FOE (like Rebound-Split/…/Purge/Seardoom/
    // Blightdoom). REBOUND_SNAPLOCKDOOM_KINDS is a STRICT SUBSET of CLEANSABLE_DEBUFF_KINDS (7 < 11),
    // DISJOINT from REBOUND_SPLIT_KINDS (it leaves the DoTs behind), and a STRICT SUPERSET of Cripple
    // (Snap∪Lock) plus Snapdoom (Snap∪Doom) and Doomlock (Lock∪Doom) — it spans THREE disjoint
    // families but LESS than the whole set (the 3-of-4 rung), the ONLY 3-of-4 triple that EXCLUDES
    // the DoTs (DISTINCT from Purge 7 vs 10, from Seardoom 7 vs 8 and from Blightdoom 7 vs 8).
    // Priced 63 > MAX_ENERGY (41) and DISTINCT from reclaim-blightdoom@62 / reclaim-seardoom@61 /
    // reclaim-purge@60 / reclaim-doomlock@59 / reclaim-snapdoom@58 / reclaim-doomburn@57 /
    // reclaim-sear@56 / reclaim-cripple@55 / reclaim-blight@54 / reclaim-doom@53 / reclaim-locks@52 /
    // reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 /
    // displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see REBOUND_SNAPLOCKDOOM_ENERGY_COST).
    effects: [{ kind: 'reclaim-snaplockdoom' }],
  },
  'reclaim-blight': {
    id: 'reclaim-blight',
    name: 'Rebound-Blight',
    energyCost: REBOUND_BLIGHT_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-87) — the TWELFTH status-REMOVAL carrier
    // and the FIRST MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. No
    // `damage` arm: it CLEARS ONLY the caster's SUBSET debuff ARMS (the UNION of the DoT AND
    // control-lock kinds in {@link REBOUND_BLIGHT_KINDS} = REBOUND_SPLIT_KINDS ∪
    // REBOUND_LOCK_KINDS) via {@link clearKinds} — leaving the caster's stat-mods, `doom` and
    // self-buffs intact — AND, when at least one subset arm was captured, FULL-duration
    // DEEP-COPIES those exact arms onto the FOE (like Rebound-Split/Snap/Lock/Doom).
    // REBOUND_BLIGHT_KINDS is a STRICT SUBSET of CLEANSABLE_DEBUFF_KINDS and DISJOINT from
    // BOTH REBOUND_SNAP_KINDS (stat-mods) AND REBOUND_DOOM_KINDS (`doom`) — it spans MORE THAN
    // ONE disjoint family but LESS than the whole set (the new union axis). Priced 54 >
    // MAX_ENERGY (41) and DISTINCT from reclaim-doom@53 / reclaim-locks@52 / reclaim-stats@51 /
    // reclaim-subset@50 / reclaim-partial@49 / reclaim-deep@48 / reclaim@47 / displace@46 /
    // purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see REBOUND_BLIGHT_ENERGY_COST).
    effects: [{ kind: 'reclaim-blight' }],
  },
  'reclaim-doom': {
    id: 'reclaim-doom',
    name: 'Rebound-Doom',
    energyCost: REBOUND_DOOM_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-86) — the ELEVENTH status-REMOVAL carrier
    // and the FOURTH (and final) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. No `damage` arm: it
    // CLEARS ONLY the caster's SUBSET debuff ARM (the deferred `doom` kind in
    // {@link REBOUND_DOOM_KINDS}) via {@link clearKinds} — leaving the caster's DoTs/stat-mods/
    // control-locks and self-buffs intact — AND, when the `doom` arm was captured, FULL-duration
    // DEEP-COPIES it onto the FOE (preserving turnsRemaining + detonationDamage, like
    // Rebound-Split/Snap/Lock). REBOUND_DOOM_KINDS is DISJOINT from all three other subsets
    // (Split→DoTs, Snap→stat-mods, Lock→control-locks, Doom→doom) — the four partition the full
    // cleansable set, CLOSING the axis. Priced 53 > MAX_ENERGY (41) and DISTINCT from
    // reclaim-locks@52 / reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49 /
    // reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43 —
    // Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay
    // byte-identical (see REBOUND_DOOM_ENERGY_COST).
    effects: [{ kind: 'reclaim-doom' }],
  },
  'reclaim-locks': {
    id: 'reclaim-locks',
    name: 'Rebound-Lock',
    energyCost: REBOUND_LOCK_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-85) — the TENTH status-REMOVAL carrier
    // and the THIRD (and final natural) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. No `damage`
    // arm: it CLEARS ONLY the caster's SUBSET debuff ARMS (the CONTROL-LOCK kinds in
    // {@link REBOUND_LOCK_KINDS}) via {@link clearKinds} — leaving the caster's DoTs/stat-mods
    // and self-buffs intact — AND, when at least one subset arm was captured, FULL-duration
    // DEEP-COPIES those exact arms onto the FOE (like Rebound-Split/Rebound-Snap).
    // REBOUND_LOCK_KINDS is DISJOINT from BOTH Rebound-Split's REBOUND_SPLIT_KINDS AND
    // Rebound-Snap's REBOUND_SNAP_KINDS (Split moves DoTs, Snap moves stat-mods, Lock moves
    // control-locks) — the three subsets partition the harmful non-doom families. Priced 52 >
    // MAX_ENERGY (41) and DISTINCT from reclaim-stats@51 / reclaim-subset@50 / reclaim-partial@49
    // / reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43 —
    // Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay
    // byte-identical (see REBOUND_LOCK_ENERGY_COST).
    effects: [{ kind: 'reclaim-locks' }],
  },
  'reclaim-stats': {
    id: 'reclaim-stats',
    name: 'Rebound-Snap',
    energyCost: REBOUND_SNAP_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-84) — the NINTH status-REMOVAL carrier
    // and the SECOND SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. No `damage` arm: it CLEARS ONLY
    // the caster's SUBSET debuff ARMS (the STAT-MOD kinds in {@link REBOUND_SNAP_KINDS}) via
    // {@link clearKinds} — leaving the caster's DoTs/control-locks and self-buffs intact — AND,
    // when at least one subset arm was captured, FULL-duration DEEP-COPIES those exact arms onto
    // the FOE (like Rebound-Split, NOT Rebound-Lite's halving). REBOUND_SNAP_KINDS is DISJOINT
    // from Rebound-Split's REBOUND_SPLIT_KINDS (Split moves DoTs, Snap moves stat-mods). Priced
    // 51 > MAX_ENERGY (41) and DISTINCT from reclaim-subset@50 / reclaim-partial@49 /
    // reclaim-deep@48 / reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43 —
    // Posture-B DECOUPLED: NEVER picked inside simulateBattle, so the shipped fights stay
    // byte-identical (see REBOUND_SNAP_ENERGY_COST).
    effects: [{ kind: 'reclaim-stats' }],
  },
  'reclaim-subset': {
    id: 'reclaim-subset',
    name: 'Rebound-Split',
    energyCost: REBOUND_SPLIT_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-83) — the EIGHTH status-REMOVAL carrier
    // and the FIRST SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. No `damage` arm: it CLEARS ONLY
    // the caster's SUBSET debuff ARMS (the DoT kinds in {@link REBOUND_SPLIT_KINDS}) via
    // {@link clearKinds} — leaving the caster's non-subset debuffs (weaken/stun/…) and
    // self-buffs intact — AND, when at least one subset arm was captured, FULL-duration
    // DEEP-COPIES those exact arms onto the FOE (like Rebound, NOT Rebound-Lite's halving).
    // Priced 50 > MAX_ENERGY (41) and DISTINCT from reclaim-partial@49 / reclaim-deep@48 /
    // reclaim@47 / displace@46 / purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED:
    // NEVER picked inside simulateBattle, so the shipped fights stay byte-identical (see
    // REBOUND_SPLIT_ENERGY_COST).
    effects: [{ kind: 'reclaim-subset' }],
  },
  'reclaim-partial': {
    id: 'reclaim-partial',
    name: 'Rebound-Lite',
    energyCost: REBOUND_LITE_ENERGY_COST,
    // A PURE, self→foe TRANSFER UTILITY skill (TASK-82) — the SEVENTH status-REMOVAL carrier
    // and the FIRST PERCENTAGE/PARTIAL-DURATION self→foe DEBUFF TRANSFER (the A-70 refinement
    // of Rebound). No `damage` arm: it CLEARS the CASTER's OWN harmful debuff ARMS via
    // {@link clearDebuffs} AND, when at least one arm was captured, DEEP-COPIES those exact arms
    // onto the FOE at a HALVED remaining duration (max(1, ceil(turnsRemaining * 0.5))) while
    // preserving each arm's damagePerTurn/ramp — NOT Rebound's full-duration raw move. Priced
    // 49 > MAX_ENERGY (41) and DISTINCT from reclaim-deep@48 / reclaim@47 / displace@46 /
    // purloin@45 / dispel@44 / cleanse@43 — Posture-B DECOUPLED: NEVER picked inside
    // simulateBattle, so the shipped fights stay byte-identical (see REBOUND_LITE_ENERGY_COST).
    effects: [{ kind: 'reclaim-partial' }],
  },
} as const;

/**
 * Every combatant's ordered skill list (both player and enemy know the same twelve as
 * of TASK-63). Order = SELECTION PRIORITY: prefer the first skill the fighter can
 * currently AFFORD (see {@link selectSkill}). The order is strictly cost-descending —
 * Double Strike (24) → Lullaby Hex (21) → Guard (14) → Frost Bite (11) → Shock Strike
 * (9) → Enfeeble Strike (8) → Focus (7) → Fire Breath (6) → Armor Break (5) → Bleed
 * Strike (3) → Poison Sting (2) → the free Attack (0) — so the greedy drain-and-climb
 * sawtooth steps down through the tiers as energy ebbs.
 *
 * TASK-63 slotted `enfeeble-strike` (cost 8) between Shock Strike (9) and Focus (7);
 * every OTHER cost is BYTE-UNCHANGED (no MAX_ENERGY / regen re-tune). It is a DAMAGING
 * composite (safe mid-ladder — deals its damage half on cast, no pure-control
 * starvation hazard), but cost 8 is a NON-surfacing tier in the shipped fights: the
 * greedy sawtooth opens Double Strike → Lullaby Hex then settles into the low
 * {Armor Break ↔ Bleed Strike} band whose pool never re-climbs to 8 (see
 * {@link ENFEEBLE_STRIKE_ENERGY_COST}), exactly like Shock Strike/Focus/Fire Breath/
 * Frost Bite. So Enfeeble is proven via the selectSkill(8) boundary + direct
 * applyAilment/resolveAttack/resolveDamageStrike unit tests, NOT a shipped-fight cast.
 *
 * TASK-61 (the GUARDRAIL-2 fallback slot): Lullaby Hex is DEMOTED to SECOND priority
 * (just below Double Strike), NOT first. If Lullaby Hex (a NON-damaging control skill)
 * opened at full energy it would starve the winnable numemon fight of damage and flip
 * it to a loss (see {@link LULLABY_HEX_ENERGY_COST}). Demoted, Double Strike still
 * opens every fight, and Lullaby Hex surfaces the first turn energy sits at 21 (one
 * regen tick after the opening Double Strike drains the pool 41→17) — so a player DOES
 * see the foe put to sleep in a shipped fight, while both shipped outcomes hold clear
 * of MAX_ROUNDS. Because Lullaby Hex drains the pool deeply (21→~0) it displaces the
 * mid-tier skills that the pre-TASK-61 numemon fight surfaced on that same slot; that
 * is the deliberate, documented cost of surfacing a control skill in-pool (each such
 * skill/status is still unit-proven directly via applyAilment/resolveDamageStrike).
 */
export const COMBATANT_SKILLS: readonly Skill[] = [
  // TASK-139: `vulnerable-when-strong-hex`/"Vulnerable When Strong" (CLOSES the `vulnerable` damage-taken-UP
  // family's SECOND predicate DIRECTION — a DEFENDER-targeting `vulnerable-when-strong` that applies the
  // EXISTING `vulnerable` status to the foe ONLY when `foe.hp >= floor(foe.maxHp × 0.60)`, the `>=` HIGH-hp
  // mirror of TASK-138's `<=` LOW-hp cell — the SMT "hit a still-fresh foe with a damage-taken-UP hex" idiom;
  // exactly as TASK-135 flipped TASK-134 to close `weaken` and TASK-137 flipped TASK-136 to close `enfeeble`,
  // this flips TASK-138's operator to CLOSE `vulnerable`) — priced 100 > MAX_ENERGY (41), the NEW ladder TOP
  // (above `vulnerable-when-weak-hex`@99), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, byte-identical shipped fights). A damage-taken-UP debuff writes NO HP and can only
  // make a fight faster, so MAX_ROUNDS is protected trivially. It never fires in-sim (its gated apply is
  // proven via direct gate-true/gate-false/boundary units + the selectSkill(100) boundary unit).
  SKILLS['vulnerable-when-strong-hex'],
  // TASK-138: `vulnerable-when-weak-hex`/"Vulnerable When Weak" (the THIRD stat-mod FAMILY's FIRST
  // threshold-gated inflictor — a DEFENDER-targeting `vulnerable-when-weak` that applies the EXISTING
  // `vulnerable` damage-taken-UP status to the foe ONLY when `foe.hp <= floor(foe.maxHp × 0.35)`, the SMT
  // "expose an already-wounded foe to bigger hits" idiom; where TASK-134/135 closed the `weaken` DEF-down
  // family and TASK-136/137 the `enfeeble` ATK-down family, L-37 forbids a third gated variant of either — so
  // this CROSSES to the THIRD stat-mod family, `vulnerable` damage-taken-UP, the axis of novelty) — priced
  // 99 > MAX_ENERGY (41), the NEW ladder TOP (above `enfeeble-when-strong-hex`@98), so `selectSkill`/
  // `chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). A
  // damage-taken-UP debuff writes NO HP and can only make a fight faster, so MAX_ROUNDS is protected
  // trivially. It never fires in-sim (its gated apply is proven via direct gate-true/gate-false/boundary
  // units + the selectSkill(99) boundary unit).
  SKILLS['vulnerable-when-weak-hex'],
  // TASK-137: `enfeeble-when-strong-hex`/"Enfeeble When Strong" (CLOSES the `enfeeble` ATK-down family's
  // SECOND predicate DIRECTION — a DEFENDER-targeting `enfeeble-when-strong` that applies the EXISTING
  // `enfeeble` ATK-reduction to the foe ONLY when `foe.hp >= floor(foe.maxHp × 0.60)`, the SMT "kick the
  // ATK out of a still-fresh, dangerous foe" idiom; where TASK-136's `enfeeble-when-weak` gates the SAME
  // `enfeeble` family on a `<=` LOW-hp foe, this FLIPS the predicate DIRECTION to `>=` HIGH-hp, mirroring
  // TASK-135's `>=` gate on `weaken` — the axis of novelty) — priced 98 > MAX_ENERGY (41), the NEW ladder
  // TOP (above `enfeeble-when-weak-hex`@97), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). An ATK debuff writes NO HP and can
  // only make a fight faster, so MAX_ROUNDS is protected trivially. It never fires in-sim (its gated apply
  // is proven via direct gate-true/gate-false/boundary units + the selectSkill(98) boundary unit).
  SKILLS['enfeeble-when-strong-hex'],
  // TASK-136: `enfeeble-when-weak-hex`/"Enfeeble When Weak" (the SECOND stat-mod FAMILY's FIRST
  // threshold-gated inflictor — a DEFENDER-targeting `enfeeble-when-weak` that applies the EXISTING
  // `enfeeble` ATK-reduction to the foe ONLY when `foe.hp <= floor(foe.maxHp × 0.35)`, the SMT "kick the
  // ATK out of a wounded foe" idiom; where TASK-134/135 varied the predicate DIRECTION under the FIXED
  // `weaken` DEF-down family, this varies the APPLY-FAMILY itself to `enfeeble` ATK-down — the axis of
  // novelty) — priced 97 > MAX_ENERGY (41), the NEW ladder TOP (above `wither-when-strong-hex`@96), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical
  // shipped fights). An ATK debuff writes NO HP and can only make a fight faster, so MAX_ROUNDS is
  // protected trivially. It never fires in-sim (its gated apply is proven via direct
  // gate-true/gate-false/boundary units + the selectSkill(97) boundary unit).
  SKILLS['enfeeble-when-weak-hex'],
  // TASK-135: `wither-when-strong-hex`/"Wither When Strong" (the FIRST `>=` HIGH-hp "prey on the healthy"
  // gate — a DEFENDER-targeting `weaken-when-strong` that applies the EXISTING `weaken` DEF-reduction to
  // the foe ONLY when `foe.hp >= floor(foe.maxHp × 0.60)`, the SMT "soften the fresh enemy" idiom; every
  // prior gate — execute/guillotine/rot-when-weak/weaken-when-weak — is `<=` low-hp, so this flipped `>=`
  // direction is the axis of novelty) — priced 96 > MAX_ENERGY (41), the NEW ladder TOP (above
  // `wither-when-weak-hex`@95), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, byte-identical shipped fights). A DEF debuff writes NO HP and can only make a
  // fight faster, so MAX_ROUNDS is protected trivially. It never fires in-sim (its gated apply is proven
  // via direct gate-true/gate-false/boundary units + the selectSkill(96) boundary unit).
  SKILLS['wither-when-strong-hex'],
  // TASK-134: `wither-when-weak-hex`/"Wither When Weak" (the FIRST THRESHOLD-GATED STAT-MOD inflictor —
  // a DEFENDER-targeting `weaken-when-weak` that applies the EXISTING `weaken` DEF-reduction to the foe
  // ONLY when `foe.hp <= floor(foe.maxHp × 0.35)`, the SMT "cripple the wounded" idiom; where TASK-133's
  // `rot-when-weak` gates a DoT, this gates a lingering STAT-MODIFIER — same conditional-application
  // predicate, DIFFERENT apply-family) — priced 95 > MAX_ENERGY (41), the NEW ladder TOP (above
  // `rot-when-weak-curse`@94), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, byte-identical shipped fights). A DEF debuff writes NO HP and can only make a
  // fight faster, so MAX_ROUNDS is protected trivially. It never fires in-sim (its gated apply is proven
  // via direct gate-true/gate-false/boundary units + the selectSkill(95) boundary unit).
  SKILLS['wither-when-weak-hex'],
  // TASK-133: `rot-when-weak-curse`/"Rot When Weak" (the FIRST THRESHOLD-GATED inflictor — a
  // DEFENDER-targeting `rot-when-weak` that applies its `wither-percent` DoT to the foe ONLY when
  // `foe.hp <= floor(foe.maxHp × 0.35)`, the SMT "prey on the wounded" idiom; every existing inflictor
  // is UNCONDITIONAL — this is the first CONDITIONAL-application predicate, reusing the execute/
  // guillotine maxHp-threshold read to gate an inflictor instead of a burst) — priced 94 > MAX_ENERGY
  // (41), the NEW ladder TOP (above `wither-curse`@93), so `selectSkill`/`chooseSkill` NEVER pick it
  // inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). A DoT can only LENGTHEN
  // a fight, so keeping it out of the sim also protects MAX_ROUNDS termination. It never fires in-sim
  // (its gated apply is proven via direct gate-true/gate-false/boundary units + the selectSkill(94)
  // boundary unit).
  SKILLS['rot-when-weak-curse'],
  // TASK-132: `wither-curse`/"Wither Curse" (the FIRST maxHp-fraction DoT — a DEFENDER-targeting
  // `wither-percent` whose per-turn attrition is a CONSTANT `floor(target.maxHp × 0.08)`, unlike every
  // current-hp percent DoT which DIMINISHES as HP falls) — priced 93 > MAX_ENERGY (41), the NEW ladder
  // TOP (above `barrier`@92), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, byte-identical shipped fights). A DoT can only LENGTHEN a fight, so keeping it
  // out of the sim also protects MAX_ROUNDS termination. It never fires in-sim (its maxHp-scaled per-turn
  // amount is proven via direct apply/tick units — a maxHp-scaling contrast + a fixed-amount-as-hp-falls
  // contrast — + the selectSkill(93) boundary unit).
  SKILLS['wither-curse'],
  // TASK-131: `barrier`/"Barrier" (the FIRST maxHp-FRACTION MITIGATION buff — a SELF-targeting
  // `shield-percent` whose absorb pool is SIZED `floor(caster.maxHp × 0.20)`, the FRACTIONAL twin of the
  // flat `shield` and the LAST buff/status family to gain a `-percent` mirror; where the completed
  // maxHp-frame DAMAGE matrix sized DAMAGE off maxHp, this sizes what damage is SOAKED) — priced 92 >
  // MAX_ENERGY (41), the NEW ladder TOP (above `last-stand-strike`@91), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). A mitigation
  // buff can only LENGTHEN a fight (a DoT in reverse), so keeping it out of the sim also protects
  // MAX_ROUNDS termination. It never fires in-sim (its maxHp-scaled absorb payoff is proven via direct
  // apply/absorbWithShield-drain units — a maxHp-scaling pool-size contrast + a strictly-less-HP-damage
  // contrast — + the selectSkill(92) boundary unit).
  SKILLS['barrier'],
  // TASK-130: `last-stand-strike`/"Last Stand" (the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst — a
  // finisher that SIZES its bonus damage as `floor(max(0, attackerMaxHp − attackerHp) × 0.30)`
  // UNCONDITIONALLY, completing the 2×2 maxHp-frame matrix; bravado reads the attacker's MAX, rampage
  // reads the DEFENDER's missing — this reads the CASTER's OWN missing HP, the SMT
  // "vengeance-of-the-wounded" idiom; the bonus is 0 at full HP and grows as the caster is worn down)
  // — priced 91 > MAX_ENERGY (41), the NEW ladder TOP (above `bravado-strike`@90), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights: a below-pool DAMAGING composite WOULD be chooseSkill-rotated onto
  // the foe and perturb the shipped WIN/LOSS pair). It never fires in-sim (its
  // attacker-own-missing-HP-scaled finisher payoff is proven via the direct `lastStandBonus` apply
  // units — an attacker-own-missing-HP-scaling contrast + the full-HP → 0 case + a floor-truncation
  // case — + the selectSkill(91) boundary unit).
  SKILLS['last-stand-strike'],
  // TASK-129: `bravado-strike`/"Bravado" (the FIRST ATTACKER-OWN-maxHp-FRACTION burst — a finisher
  // that SIZES its bonus damage as `floor(attackerMaxHp × 0.15)` UNCONDITIONALLY, the FIRST time the
  // engine sizes a bonus off the CASTER's OWN frame; execute/guillotine/rampage all read the
  // DEFENDER) — priced 90 > MAX_ENERGY (41), the NEW ladder TOP (above `rampage-strike`@89), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights: a below-pool DAMAGING composite WOULD be chooseSkill-rotated onto
  // the foe and perturb the shipped WIN/LOSS pair). It never fires in-sim (its attacker-maxHp-scaled
  // finisher payoff is proven via the direct `bravadoBonus` apply units — an attacker-maxHp-scaling
  // contrast + a floor-truncation case — + the selectSkill(90) boundary unit).
  SKILLS['bravado-strike'],
  // TASK-128: `rampage-strike`/"Rampage" (the FIRST MISSING-HP-FRACTION burst — a finisher that SIZES
  // its bonus damage as `floor(max(0, maxHp − hp) × 0.25)` UNCONDITIONALLY, the FIRST time the engine
  // reads the defender's MISSING HP; the bonus is 0 at full HP and grows as the foe is worn down) —
  // priced 89 > MAX_ENERGY (41), the NEW ladder TOP (above `guillotine-strike`@88), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights: a below-pool DAMAGING composite WOULD be chooseSkill-rotated onto
  // the foe and perturb the shipped WIN/LOSS pair). It never fires in-sim (its missing-HP-scaled
  // finisher payoff is proven via the direct `rampageBonus` apply units — a missing-HP-scaling
  // contrast + the full-HP → 0 case — + the selectSkill(89) boundary unit).
  SKILLS['rampage-strike'],
  // TASK-127: `guillotine-strike`/"Guillotine" (the FIRST max-HP-FRACTION burst — a finisher that
  // SIZES its bonus damage as `floor(maxHp × 0.20)` when the foe is at/below floor(maxHp × 0.30); the
  // FIRST time `maxHp` SIZES a damage number, vs execute which only READS it to gate a FIXED bonus) —
  // priced 88 > MAX_ENERGY (41), the NEW ladder TOP (above `execute-strike`@87), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights: a below-pool DAMAGING composite WOULD be chooseSkill-rotated onto
  // the foe and perturb the shipped WIN/LOSS pair). It never fires in-sim (its max-HP-scaled finisher
  // payoff is proven via the direct `guillotineBonus` apply units at BOTH sides of the threshold + a
  // maxHp-scaling contrast + the selectSkill(88) boundary unit).
  SKILLS['guillotine-strike'],
  // TASK-126: `execute-strike`/"Execute Strike" (the FIRST mechanic the new `maxHp` substrate
  // unlocks — a percent-of-MAX-HP FINISHER: deal the normal strike, then bonus damage when the foe
  // is at/below floor(maxHp × 0.25)) — priced 87 > MAX_ENERGY (41), the NEW ladder TOP (above
  // `necrosis`@86), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, byte-identical shipped fights: a below-pool DAMAGING composite WOULD be
  // chooseSkill-rotated onto the foe and perturb the shipped WIN/LOSS pair). It never fires in-sim
  // (its finisher payoff is proven via the direct `executeBonus` apply units at BOTH sides of the
  // threshold + the selectSkill(87) boundary unit).
  SKILLS['execute-strike'],
  // TASK-123: `necrosis`/"Necrosis" (the DoT family's FOURTH & FINAL `-percent` fidelity twin — a
  // fractional-RAMP percent-of-CURRENT-HP DoT inflictor mirroring `corrode-strike`'s flat ramping
  // `corrode`) — priced 86 > MAX_ENERGY (41), the NEW ladder TOP (above `hemorrhage`@85), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical
  // shipped fights: a below-pool DoT-only inflictor carries no `damage` arm, so chooseSkill rule-1 would
  // rotate it onto the foe as a DoT tactical and perturb the shipped fight). It never fires in-sim (its
  // fractional RAMPING tick is proven via the direct-seam tick unit + the selectSkill(86) boundary unit).
  SKILLS['necrosis'],
  // TASK-122: `hemorrhage`/"Hemorrhage" (the DoT family's THIRD `-percent` fidelity twin — a fractional
  // percent-of-CURRENT-HP DoT inflictor mirroring `bleed-strike`'s flat `bleed`) — priced 85 >
  // MAX_ENERGY (41), the NEW ladder TOP (above `toxin-sting`@84), so `selectSkill`/`chooseSkill` NEVER
  // pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights: a below-pool
  // DoT-only inflictor carries no `damage` arm, so chooseSkill rule-1 would rotate it onto the foe as a
  // DoT tactical and perturb the shipped fight). It never fires in-sim (its fractional tick is proven
  // via the direct-seam tick unit + the selectSkill(85) boundary unit).
  SKILLS['hemorrhage'],
  // TASK-121: `toxin-sting`/"Toxin Sting" (the DoT family's SECOND `-percent` fidelity twin — a
  // fractional percent-of-CURRENT-HP DoT inflictor mirroring `poison-sting`'s flat `poison`) — priced
  // 84 > MAX_ENERGY (41), the NEW ladder TOP (above `smolder-strike`@83), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights: a
  // below-pool DoT-only inflictor carries no `damage` arm, so chooseSkill rule-1 would rotate it onto
  // the foe as a DoT tactical and perturb the shipped fight). It never fires in-sim (its fractional
  // tick is proven via the direct-seam tick unit + the selectSkill(84) boundary unit).
  SKILLS['toxin-sting'],
  // TASK-120: `smolder-strike`/"Smolder Strike" (the DoT family's FIRST `-percent` fidelity twin — a
  // fractional percent-of-CURRENT-HP DoT inflictor mirroring `fire-breath`'s flat `burn`) — priced
  // 83 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, byte-identical shipped fights: a below-pool DoT-only inflictor carries no `damage` arm,
  // so chooseSkill rule-1 would rotate it onto the foe as a DoT tactical and perturb the shipped fight;
  // it stays above the pool). Placed just below `toxin-sting`@84 (the FIRST free integer below it) to
  // keep it strictly cost-descending for the selectSkill(83) boundary unit;
  // it never fires in-sim (its fractional tick is proven via the direct-seam tick unit).
  SKILLS['smolder-strike'],
  // TASK-119: `doom-percent-curse`/"Doom-Percent Curse" (the DEFERRED FRACTIONAL-detonation curse —
  // the percent-of-CURRENT-HP twin of the castable `doom-curse`@12, CLOSING the `doom` family's
  // missing `-percent` fidelity mirror) — priced 82 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights: a
  // castable fractional-doom WOULD be picked as a deferred-damage tactical and perturb the shipped
  // fight, so it stays above the pool). Placed at the NEW ladder TOP (above `hobble-percent`@81, the
  // FIRST free integer above the contiguous 42→81 band) to keep it strictly cost-descending for the
  // selectSkill(82) boundary unit; it never fires in-sim (its fractional detonation is proven via the
  // direct-seam tick unit).
  SKILLS['doom-percent-curse'],
  // TASK-115: `hobble-percent`/"Cripple" (the PERCENTAGE SPD-DOWN DEBUFF — COMPLETES the SPD-axis DOWN
  // percent square, the percentage twin of the flat `hobble` and the SPD-axis mirror of the DEF-down
  // `weaken-percent` and ATK-down `enfeeble-percent`; a FOE-cast debuff, NOT a self-buff) — priced
  // 81 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, byte-identical shipped fights). Placed at the NEW ladder TOP (above `hobble`@80, the FIRST
  // free integer above the contiguous 42→80 band) to keep it strictly cost-descending for the
  // selectSkill(81) boundary unit; it never fires in-sim (its effectiveSpd SPD-lowering payoff is proven
  // in isolation).
  SKILLS['hobble-percent'],
  // TASK-114: `hobble`/"Hobble" (the FLAT SPD-DOWN DEBUFF — the FIRST member of the SPD-axis DOWN half,
  // the SPD-axis mirror of the DEF-down `weaken` and ATK-down `enfeeble`; a FOE-cast debuff, NOT a
  // self-buff) — priced 80 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed at the new ladder TOP
  // (above `hasten-percent`@79, the FIRST free integer above the contiguous 42→79 band) to keep it
  // strictly cost-descending for the selectSkill(80) boundary unit; it never fires in-sim (its
  // effectiveSpd SPD-lowering payoff is proven in isolation).
  SKILLS['hobble'],
  // TASK-113: `hasten-percent`/"Rush" (the PERCENTAGE SPD-UP SELF-BUFF — the percent-UP twin of the flat
  // `hasten`, the SPD-axis mirror of the DEF-up `fortify-percent` and ATK-up `empower-percent`) — priced
  // 79 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, byte-identical shipped fights). Placed at the new ladder TOP (above `hasten`@78, the FIRST
  // free integer above the contiguous 42→78 band) to keep it strictly cost-descending for the
  // selectSkill(79) boundary unit; it never fires in-sim (its effectiveSpd payoff is proven in isolation).
  SKILLS['hasten-percent'],
  // TASK-112: `hasten`/"Quicken" (the FLAT SPD-UP SELF-BUFF — the FIRST member of the SPD stat-mod axis,
  // the SPD-axis twin of the DEF-up `fortify` and the ATK-up `empower`) — priced 78 > MAX_ENERGY (41),
  // so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights). Placed at the new ladder TOP (above `fortify-percent`@77, the FIRST
  // free integer above the contiguous 42→77 band) to keep it strictly cost-descending for the
  // selectSkill(78) boundary unit; it never fires in-sim (its effectiveSpd payoff is proven in isolation).
  SKILLS['hasten'],
  // TASK-111: `fortify-percent`/"Aegis" (the PERCENTAGE DEF-UP SELF-BUFF — the missing PERCENT-UP
  // member of the DEF-mitigation seam, the fractional MIRROR of `fortify` and the DEF-UP percent twin
  // of the DEBUFF `weaken-percent`) — priced 77 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed at
  // the new ladder TOP (above `brace-percent`@76, the FIRST free integer above the contiguous 42→76
  // band) to keep it strictly cost-descending for the selectSkill(77) boundary unit; it never fires in-sim.
  SKILLS['fortify-percent'],
  // TASK-110: `brace-percent`/"Bulwark" (the PERCENTAGE damage-taken-DOWN SELF-BUFF — the missing
  // PERCENT member of the damage-application seam, the fractional MIRROR of `brace` and the DOWN-side
  // percent twin of `vulnerable-percent`) — priced 76 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed at
  // the new ladder TOP (above `brace`@75, the FIRST free integer above the contiguous 42→75 band) to
  // keep it strictly cost-descending for the selectSkill(76) boundary unit; it never fires in-sim.
  SKILLS['brace-percent'],
  // TASK-109: `brace`/"Brace" (the damage-taken-DOWN SELF-BUFF — the missing damage-application-seam
  // member, the POSITIVE MIRROR of vulnerable, distinct from `fortify` at the DEF-mitigation seam) —
  // priced 75 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, byte-identical shipped fights). Placed at the new ladder TOP (above
  // `fortify`@74, the FIRST free integer above the contiguous 42→74 band) to keep it strictly
  // cost-descending for the selectSkill(75) boundary unit; it never fires in-sim.
  SKILLS['brace'],
  // TASK-108: `fortify`/"Fortify" (the DEF-up SELF-BUFF — the missing DEFENSIVE member of the
  // self-buff family, the SELF-BUFF mirror of weaken and the DEF-axis twin of empower) — priced 74 >
  // MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, byte-identical shipped fights). Placed at the new ladder TOP (above `swap-all`@73,
  // the FIRST free integer above the contiguous 42→73 band) to keep it strictly cost-descending for
  // the selectSkill(74) boundary unit; it never fires in-sim.
  SKILLS['fortify'],
  // TASK-107: `swap-all`/"Chaos Nexus" (the FULL three-stat SWAP — atk+def+spd exchanged together,
  // EXHAUSTING the stat-value-swap shape family the per-scalar trio opened) — priced 73 >
  // MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, byte-identical shipped fights). Placed at the new ladder TOP (above `swap-spd`@72,
  // the FIRST free integer above the contiguous 42→72 band) to keep it strictly cost-descending
  // for the selectSkill(73) boundary unit; it never fires in-sim.
  SKILLS['swap-all'],
  // TASK-106: `swap-spd`/"Chaos Cyclone" (the THIRD stat-VALUE SWAP, the speed twin of `swap-atk`/
  // `swap-def`, completing the atk→def→spd trio) — priced 72 > MAX_ENERGY (41), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights). Placed at the new ladder TOP (above `swap-def`@71, the FIRST
  // free integer above the contiguous 42→71 band) to keep it strictly cost-descending for the
  // selectSkill(72) boundary unit; it never fires in-sim.
  SKILLS['swap-spd'],
  // TASK-105: `swap-def`/"Chaos Warp" (the SECOND stat-VALUE SWAP, the defensive twin of `swap-atk`)
  // — priced 71 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed at the new ladder
  // TOP (above `vulnerable-percent`@70, the FIRST free integer above the contiguous 42→70 band) to
  // keep it strictly cost-descending for the selectSkill(71) boundary unit; it never fires in-sim.
  SKILLS['swap-def'],
  // TASK-103: `vulnerable-percent`/"Rupture" (the SEVENTH fractional-MAGNITUDE mechanic — a
  // PERCENTAGE-of-base damage-taken amplifier adding +VULNERABLE_PERCENT_RATIO=0.5 = +50% to the
  // afflicted defender's incoming damage, the fractional MIRROR of the fixed +25% Vulnerable Strike
  // and the damage-taken twin of Sunder/Crumble/Reinforce, CLOSING the percentage/fidelity axis on
  // the LAST damage-side stat-modifier) — priced 70 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed
  // at the new ladder TOP (above `empower-percent`@69) to keep it strictly cost-descending for the
  // selectSkill(70) boundary unit; it never fires in-sim.
  SKILLS['vulnerable-percent'],
  // TASK-102: `empower-percent`/"Reinforce" (the SIXTH fractional-MAGNITUDE mechanic — a
  // PERCENTAGE-of-current-ATK Empower granting floor(atk * 0.5) of the caster's CURRENT atk as ATK
  // bonus, the fractional MIRROR of the fixed-6 Focus `empower` and the ATK-BONUS (self-buff) twin of
  // Sunder's ATK-reduction, EXTENDING the percentage/fidelity axis onto the ATK-BONUS side of the
  // STAT-MODIFIER family) — priced 69 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it
  // inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed at the new
  // ladder TOP (above `enfeeble-percent`@68) to keep it strictly cost-descending for the
  // selectSkill(69) boundary unit; it never fires in-sim.
  SKILLS['empower-percent'],
  // TASK-101: `enfeeble-percent`/"Sunder" (the FIFTH fractional-MAGNITUDE mechanic — a
  // PERCENTAGE-of-current-ATK Enfeeble cutting floor(atk * 0.5) of the target's CURRENT atk, the
  // fractional MIRROR of the fixed-6 Enfeeble Strike `enfeeble` and the ATK-side twin of Crumble,
  // EXTENDING the percentage/fidelity axis onto the ATK-side of the STAT-MODIFIER family) — priced
  // 68 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, byte-identical shipped fights). Placed at the new ladder TOP (above
  // `weaken-percent`@67) to keep it strictly cost-descending for the selectSkill(68) boundary
  // unit; it never fires in-sim.
  SKILLS['enfeeble-percent'],
  // TASK-100: `weaken-percent`/"Crumble" (the FOURTH fractional-MAGNITUDE mechanic — a
  // PERCENTAGE-of-current-DEF Weaken cutting floor(def * 0.5) of the target's CURRENT def, the
  // fractional MIRROR of the fixed-6 Armor Break `weaken`, EXTENDING the percentage/fidelity axis
  // onto the STAT-MODIFIER family) — priced 67 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights).
  // Placed at the new ladder TOP (above `reflect-percent`@66) to keep it strictly cost-descending
  // for the selectSkill(67) boundary unit; it never fires in-sim.
  SKILLS['weaken-percent'],
  // TASK-99: `reflect-percent`/"Thorn Mirror" (the THIRD fractional-MAGNITUDE mechanic — a
  // PERCENTAGE reflect dealing back floor(overflow * 0.5) of the incoming overflow, the
  // fractional MIRROR of the fixed-5 Retaliate, EXTENDING the percentage/fidelity axis to the
  // reflect side) — priced 66 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it
  // inside simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed at the
  // new ladder TOP (above `leech-percent`@65) to keep it strictly cost-descending for the
  // selectSkill(66) boundary unit; it never fires in-sim.
  SKILLS['reflect-percent'],
  // TASK-98: `leech-percent`/"Energy Surge" (the SECOND fractional-MAGNITUDE resource-interference
  // skill — a PERCENTAGE energy CREDIT regaining floor(currentEnergy * 0.5) of the ATTACKER's OWN
  // CURRENT energy, the percentage MIRROR of the fixed-12 Leech, the CREDIT twin of `sap-percent`
  // CONTINUING the percentage/fidelity axis) — priced 65 > MAX_ENERGY (41), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights). Placed at the new ladder TOP (above `sap-percent`@64) to keep
  // it strictly cost-descending for the selectSkill(65) boundary unit; it never fires in-sim.
  SKILLS['leech-percent'],
  // TASK-97: `sap-percent`/"Energy Rend" (the FIRST fractional-MAGNITUDE resource-interference
  // skill — a PERCENTAGE energy drain removing floor(currentEnergy * 0.5) of the DEFENDER's
  // CURRENT energy, the percentage MIRROR of the fixed-12 Sap, OPENING the percentage/fidelity
  // axis) — priced 64 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, byte-identical shipped fights). Placed at the new ladder
  // TOP (above `reclaim-snaplockdoom`@63) to keep it strictly cost-descending for the
  // selectSkill(64) boundary unit; it never fires in-sim.
  SKILLS['sap-percent'],
  // TASK-96: `reclaim-snaplockdoom`/"Rebound-Snaplockdoom" (the FOURTH and LAST 3-of-4 MULTI-FAMILY
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER — stat-mod ∪ control-lock ∪ `doom` = "everything but
  // the DoTs", the THIRD 3-of-4 union that INCLUDES `doom`, the ONLY 3-of-4 triple that EXCLUDES the
  // DoTs, CLOSING the 3-of-4 selectivity axis) — priced 63 > MAX_ENERGY (41), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights). Placed at the new ladder TOP (above `reclaim-blightdoom`@62) to
  // keep it strictly cost-descending for the selectSkill(63) boundary unit; it never fires in-sim.
  SKILLS['reclaim-snaplockdoom'],
  // TASK-95: `reclaim-blightdoom`/"Rebound-Blightdoom" (the THIRD 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER — DoT ∪ control-lock ∪ `doom` = "everything but the stat-mods", the
  // SECOND 3-of-4 union that INCLUDES `doom`, the MIRROR of Seardoom across the stat-mod/control-lock
  // swap, ADVANCING the 3-of-4 selectivity DEPTH) — priced 62 > MAX_ENERGY (41), so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // byte-identical shipped fights). Placed at the new ladder TOP (above `reclaim-seardoom`@61) to
  // keep it strictly cost-descending for the selectSkill(62) boundary unit; it never fires in-sim.
  SKILLS['reclaim-blightdoom'],
  // TASK-94: `reclaim-seardoom`/"Rebound-Seardoom" (the SECOND 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER — DoT ∪ stat-mod ∪ `doom` = "everything but the control-locks", the
  // FIRST 3-of-4 union that INCLUDES `doom`, ADVANCING the 3-of-4 selectivity DEPTH) — priced 61 >
  // MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, byte-identical shipped fights). Placed at the new ladder TOP (above `reclaim-purge`
  // @60) to keep it strictly cost-descending for the selectSkill(61) boundary unit; it never fires
  // in-sim.
  SKILLS['reclaim-seardoom'],
  // TASK-93: `reclaim-purge`/"Rebound-Purge" (the FIRST 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe
  // DEBUFF TRANSFER — the union of the DoT, STAT-MOD AND CONTROL-LOCK kinds = "everything but
  // `doom`", full duration, DISJOINT from `doom`; a strict SUPERSET of every singleton subset and of
  // the three `doom`-excluding 2-of-4 unions Blight/Cripple/Sear — OPENING the 3-of-4 selectivity
  // DEPTH) — priced 60 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above
  // `reclaim-doomlock`@59) to keep it strictly cost-descending for the selectSkill(60) boundary
  // unit; it never fires in-sim.
  SKILLS['reclaim-purge'],
  // TASK-92: `reclaim-doomlock`/"Rebound-Doomlock" (the SIXTH and FINAL MULTI-FAMILY / UNION
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER — the union of the CONTROL-LOCK AND `doom` kinds, full
  // duration, DISJOINT from the DoT AND stat-mod subsets; the THIRD and last union CONTAINING
  // `doom` — distinct from Doomburn = DoT ∪ doom and Snapdoom = stat-mod ∪ doom, and from Blight,
  // Cripple and Sear which all EXCLUDE it — CLOSING all six 2-of-4 unions) — priced 59 >
  // MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above `reclaim-snapdoom`@58) to
  // keep it strictly cost-descending for the selectSkill(59) boundary unit; it never fires in-sim.
  SKILLS['reclaim-doomlock'],
  // TASK-91: `reclaim-snapdoom`/"Rebound-Snapdoom" (the FIFTH MULTI-FAMILY / UNION
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER — the union of the STAT-MOD AND `doom` kinds, full
  // duration, DISJOINT from the DoT AND control-lock subsets; the SECOND union CONTAINING
  // `doom` — distinct from Doomburn = DoT ∪ doom, and from Blight, Cripple and Sear which all
  // EXCLUDE it) — priced 58 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it
  // inside simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above
  // `reclaim-doomburn`@57) to keep it strictly cost-descending for the selectSkill(58) boundary
  // unit; it never fires in-sim.
  SKILLS['reclaim-snapdoom'],
  // TASK-90: `reclaim-doomburn`/"Rebound-Doomburn" (the FOURTH MULTI-FAMILY / UNION
  // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER — the union of the DoT AND `doom` kinds, full
  // duration, DISJOINT from the stat-mod AND control-lock subsets; the FIRST union CONTAINING
  // `doom` — distinct from Blight, Cripple and Sear which all EXCLUDE it) — priced 57 >
  // MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above `reclaim-sear`@56) to
  // keep it strictly cost-descending for the selectSkill(57) boundary unit; it never fires in-sim.
  SKILLS['reclaim-doomburn'],
  // TASK-89: `reclaim-sear`/"Rebound-Sear" (the THIRD MULTI-FAMILY / UNION SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER — the union of the DoT AND stat-mod kinds, full duration,
  // DISJOINT from the control-lock AND doom subsets; the FIRST union NOT containing the
  // control-locks — distinct from Blight and Cripple which both share the locks) — priced 56 >
  // MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above `reclaim-cripple`@55) to
  // keep it strictly cost-descending for the selectSkill(56) boundary unit; it never fires in-sim.
  SKILLS['reclaim-sear'],
  // TASK-88: `reclaim-cripple`/"Rebound-Cripple" (the SECOND MULTI-FAMILY / UNION SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER — the union of the STAT-MOD AND control-lock kinds, full duration,
  // DISJOINT from the DoT AND doom subsets; the COMPLEMENTARY 2-of-4 pair to Rebound-Blight) —
  // priced 55 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above
  // `reclaim-blight`@54) to keep it strictly cost-descending for the selectSkill(55) boundary
  // unit; it never fires in-sim.
  SKILLS['reclaim-cripple'],
  // TASK-87: `reclaim-blight`/"Rebound-Blight" (the FIRST MULTI-FAMILY / UNION SUBSET-OF-KINDS
  // self→foe DEBUFF TRANSFER — the union of the DoT AND control-lock kinds, full duration,
  // DISJOINT from the stat-mod AND doom subsets) — priced 54 > MAX_ENERGY (41), so `selectSkill`/
  // `chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at
  // the new ladder TOP (above `reclaim-doom`@53) to keep it strictly cost-descending for the
  // selectSkill(54) boundary unit; it never fires in-sim.
  SKILLS['reclaim-blight'],
  // TASK-86: `reclaim-doom`/"Rebound-Doom" (SUBSET-OF-KINDS self→foe DEBUFF TRANSFER —
  // only the deferred `doom` kind, full duration preserving turnsRemaining+detonationDamage,
  // DISJOINT from all three other subsets) — priced 53 > MAX_ENERGY (41), so `selectSkill`/
  // `chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at
  // the new ladder TOP (above `reclaim-locks`@52) to keep it strictly cost-descending for the
  // selectSkill(53) boundary unit; it never fires in-sim.
  SKILLS['reclaim-doom'],
  // TASK-85: `reclaim-locks`/"Rebound-Lock" (SUBSET-OF-KINDS self→foe DEBUFF TRANSFER —
  // only the CONTROL-LOCK kinds stun/freeze/sleep, full duration, DISJOINT from BOTH
  // Rebound-Split's DoT subset AND Rebound-Snap's stat-mod subset) — priced 52 > MAX_ENERGY
  // (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, L-16 #7). Placed at the new ladder TOP (above `reclaim-stats`@51) to keep it
  // strictly cost-descending for the selectSkill(52) boundary unit; it never fires in-sim.
  SKILLS['reclaim-locks'],
  // TASK-84: `reclaim-stats`/"Rebound-Snap" (SUBSET-OF-KINDS self→foe DEBUFF TRANSFER —
  // only the STAT-MOD kinds weaken/enfeeble/vulnerable, full duration, DISJOINT from
  // Rebound-Split's DoT subset) — priced 51 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at the new
  // ladder TOP (above `reclaim-subset`@50) to keep it strictly cost-descending for the
  // selectSkill(51) boundary unit; it never fires in-sim.
  SKILLS['reclaim-stats'],
  // TASK-83: `reclaim-subset`/"Rebound-Split" (SUBSET-OF-KINDS self→foe DEBUFF TRANSFER —
  // only the DoT kinds, full duration) — priced 50 > MAX_ENERGY (41), so `selectSkill`/
  // `chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED, L-16 #7). At the
  // new ladder TOP (above `reclaim-partial`@49) to keep it strictly cost-descending for the
  // selectSkill(50) boundary unit; it never fires in-sim.
  SKILLS['reclaim-subset'],
  // TASK-82: `reclaim-partial`/"Rebound-Lite" (PERCENTAGE/PARTIAL-DURATION self→foe DEBUFF
  // TRANSFER — halved remaining turns) — priced 49 > MAX_ENERGY (41), so `selectSkill`/
  // `chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at
  // the new ladder TOP (above `reclaim-deep`@48) to keep it strictly cost-descending for the
  // selectSkill(49) boundary unit; it never fires in-sim.
  SKILLS['reclaim-partial'],
  // TASK-81: `reclaim-deep`/"Rebound" (raw arm-by-arm DEEP-COPY self→foe DEBUFF TRANSFER) —
  // priced 48 > MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above
  // `reclaim`@47) to keep it strictly cost-descending for the selectSkill(48) boundary unit;
  // it never fires in-sim.
  SKILLS['reclaim-deep'],
  // TASK-80: `reclaim`/"Backfire" (payload-PRESERVING self→foe DEBUFF TRANSFER) — priced 47 >
  // MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle
  // (Posture-B DECOUPLED, L-16 #7). Placed at the new ladder TOP (above `displace`@46) to keep
  // it strictly cost-descending for the selectSkill(47) boundary unit; it never fires in-sim.
  SKILLS.reclaim,
  // TASK-79: `displace`/"Scapegoat" (self→foe DEBUFF TRANSFER) — priced 46 > MAX_ENERGY (41),
  // so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // L-16 #7). At the ladder TOP (above purloin@45), DISTINCT from every other cost so it keeps
  // it strictly cost-descending for the selectSkill(46) boundary unit; it never fires in-sim.
  SKILLS.displace,
  // Spellthief (purloin) at the new ladder TOP (TASK-78) at cost 45 — ABOVE dispel@44. It is
  // priced ABOVE MAX_ENERGY (41) AND distinct from dispel@44 / cleanse@43, so
  // `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B DECOUPLED,
  // L-16 #7 — the shipped fights stay byte-identical). It sits at the ladder top only to keep
  // it strictly cost-descending for the selectSkill(45) boundary unit; it never fires in-sim.
  SKILLS.purloin,
  // Purge (dispel) at cost 44 — ABOVE cleanse@43. It is
  // priced ABOVE MAX_ENERGY (41), so `selectSkill`/`chooseSkill` NEVER pick it inside
  // simulateBattle (Posture-B DECOUPLED, L-16 #7 — the shipped fights stay byte-identical).
  // It sits at the ladder top only to keep it strictly cost-descending for the
  // selectSkill(44) boundary unit; it never fires in-sim.
  SKILLS.dispel,
  // Purify (cleanse) PROMOTED to the ladder TOP (TASK-76) at cost 43 — ABOVE
  // counter-stance@30. It is priced ABOVE MAX_ENERGY (41), so `selectSkill`/`chooseSkill`
  // NEVER pick it inside simulateBattle (Posture-B DECOUPLED, L-16 #7 — the shipped fights
  // stay byte-identical). It sits at the ladder top only to keep it strictly
  // cost-descending for the selectSkill(43) boundary unit; it never fires in-sim.
  SKILLS.cleanse,
  // TASK-104: `swap-atk`/"Chaos Shift" (the FIRST stat-VALUE SWAP) — priced 42 > MAX_ENERGY
  // (41), so `selectSkill`/`chooseSkill` NEVER pick it inside simulateBattle (Posture-B
  // DECOUPLED, L-16 #7 — the shipped fights stay byte-identical). Slots between cleanse@43 and
  // counter-stance@30, the LAST free integer above MAX_ENERGY, so the ladder stays strictly
  // cost-descending for the selectSkill(42) boundary unit; it never fires in-sim.
  SKILLS['swap-atk'],
  SKILLS['counter-stance'],
  SKILLS['double-strike'],
  SKILLS['lullaby-hex'],
  SKILLS.guard,
  SKILLS['corrode-strike'],
  SKILLS['doom-curse'],
  SKILLS['frost-bite'],
  SKILLS['vulnerable-strike'],
  SKILLS['shock-strike'],
  SKILLS['enfeeble-strike'],
  SKILLS.focus,
  SKILLS['fire-breath'],
  SKILLS['armor-break'],
  // energy-siphon (Leech) PROMOTED IN-POOL (TASK-73) at cost 4 — the 2nd OBSERVABLE
  // PROMOTION, slotted between armor-break@5 and bleed-strike@3 so the ladder stays
  // strictly cost-descending. It is a pure-DAMAGE composite ([damage, leech]) with NO
  // ailment arm, so chooseSkill Rule 1 (fresh-ailment rotation) never picks it; Rule 2
  // (strongestDamage) casts it in the numemon fight's single late hammer turn (round 13,
  // energy ~10 after the tactical arsenal is spent) — finally OBSERVABLE, the mirror of
  // Sap. Because energy-siphon@4 sits ABOVE energy-drain@1, Rule 2 (which prefers the
  // HIGHEST-cost affordable pure-damage skill) picks Leech over Sap in that ONE hammer
  // slot; the fight ends there (numemon dies at round 13, agumon one hit from death), so
  // this fight now surfaces LEECH where TASK-72 surfaced SAP — a deliberate, bounded
  // perturbation (still a clean WIN, Leech now VISIBLE). Sap stays fully WIRED + unit-proven
  // directly; it simply no longer wins the single hammer slot in THIS fixture. NOTE cost 4
  // == ENERGY_REGEN_PER_TURN, which is a FIXED-POINT trap ONLY for a skill that does NOT
  // restore energy; energy-siphon LEECHES +12 (a NET energy GAIN), so it can never pin the
  // pool the way the cost-4 ENFEEBLE_STRIKE degeneracy does — the pool climbs after each
  // cast. It is the lone free in-pool integer that actually FIRES (5/3/2/1/0 are taken; a
  // higher cost like 13 never re-climbs in the low hammer band, so it would never surface).
  SKILLS['energy-siphon'],
  SKILLS['bleed-strike'],
  SKILLS['poison-sting'],
  // energy-drain (Sap) PROMOTED IN-POOL (TASK-72) at cost 1 — slotted between
  // poison-sting@2 and the free attack@0 so the ladder stays strictly cost-descending. It
  // is a pure-DAMAGE composite ([damage, sap]) with NO ailment arm, so chooseSkill Rule 1
  // (fresh-ailment rotation) never picks it; only Rule 2 (strongestDamage) can. Cost 1 is
  // DELIBERATELY < the 4/turn regen (NOT == it): a cost==regen pick forms a
  // drain→regen→recast FIXED POINT that starves Double Strike out of a long fight (the
  // ENFEEBLE_STRIKE_ENERGY_COST / cost-4 degeneracy). Distinct from every other cost. NOTE
  // (TASK-73): energy-drain@1 no longer WINS the numemon fight's single hammer turn — the
  // newly-promoted energy-siphon@4 sits ABOVE it, and Rule 2 prefers the higher-cost
  // affordable pure-damage skill, so Leech now casts in that slot (energy ~10 at round 13).
  // Sap stays fully wired + unit-proven directly; a future fixture with a longer hammer
  // phase (or a re-tune) can surface both. Sap would still win the hammer whenever energy
  // sits in [1,3] (below energy-siphon@4).
  SKILLS['energy-drain'],
  SKILLS.attack,
];

/**
 * Deterministic skill SELECTION — the seed of the enemy AI (NEVER random): pick the
 * FIRST skill in {@link COMBATANT_SKILLS} whose `energyCost ≤ currentEnergy`. Since
 * `attack` costs 0 it is always affordable, so this is total (always returns a
 * skill). Fire Breath is chosen while energy ≥ its cost, else it falls back to
 * Attack — the "skill disabled when energy is short" mechanic.
 */
export function selectSkill(currentEnergy: number): Skill {
  return COMBATANT_SKILLS.find((skill) => skill.energyCost <= currentEnergy) ?? SKILLS.attack;
}

/**
 * Look up a castable skill by id from the player's PALETTE (TASK-140, R-22). The
 * interactive turn route validates the client's `skillId` against this — a skill the
 * menu can offer is exactly one in {@link COMBATANT_SKILLS} (`attack` included). Returns
 * `undefined` for an unknown id (the route rejects it), so the client can never conjure
 * a skill outside the server-authoritative palette.
 */
export function findCombatantSkill(id: string): Skill | undefined {
  return COMBATANT_SKILLS.find((skill) => skill.id === id);
}

/**
 * Energy a side will have at the START of its own upcoming turn (TASK-140): the same
 * `min(MAX_ENERGY, energy + REGEN)` regen {@link resolveActorTurn} applies FIRST, before
 * the skill is spent. The interactive menu's affordability + the route's server-side
 * affordability guard both read THIS (not the raw carried energy), so what the menu
 * offers is exactly what `resolveActorTurn` can pay for this turn.
 */
export function energyAtTurnStart(energy: number): number {
  return Math.min(MAX_ENERGY, energy + ENERGY_REGEN_PER_TURN);
}

/**
 * (DoTs, stat-modifiers, control locks, and self-buffs) — as opposed to a raw
 * `damage`/`multihit` strike. A skill carrying one of these is a "tactical" skill:
 * casting it is only VALUABLE if that ailment is not ALREADY active on the intended
 * target (re-casting merely refreshes an already-ticking ailment — a wasted turn the
 * tactical policy avoids). Derived from the union so a future ailment arm is covered
 * automatically.
 */
const AILMENT_EFFECT_KINDS: ReadonlySet<StatusAilment['kind']> = new Set([
  'burn',
  // Burn-Percent (TASK-120) — a DEFENDER-targeting fractional DoT applier, classified here like
  // `burn` so skillAilment recognizes it and routes it to the DEFENDER (it is NOT on skillAilment's
  // self list). Posture-B: its skill is priced above the pool, so it is never chosen in-sim.
  'burn-percent',
  // Wither-Percent (TASK-132) — a DEFENDER-targeting maxHp-fraction DoT applier; classified here like
  // `burn` so skillAilment recognizes it and routes it to the DEFENDER. Posture-B (above the pool).
  'wither-percent',
  'poison',
  // Poison-Percent (TASK-121) — routed to the DEFENDER like `poison`/`burn-percent` (NOT on
  // skillAilment's self list). Posture-B: its skill is priced above the pool, never chosen in-sim.
  'poison-percent',
  'bleed',
  // Bleed-Percent (TASK-122) — routed to the DEFENDER like `bleed`/`poison-percent` (NOT on
  // skillAilment's self list). Posture-B: its skill is priced above the pool, never chosen in-sim.
  'bleed-percent',
  'corrode',
  // Corrode-Percent (TASK-123) — routed to the DEFENDER like `corrode`/`bleed-percent` (NOT on
  // skillAilment's self list). Posture-B: its skill is priced above the pool, never chosen in-sim.
  'corrode-percent',
  'weaken',
  'weaken-percent',
  'enfeeble',
  'enfeeble-percent',
  'vulnerable',
  'vulnerable-percent',
  'doom',
  // Doom-Percent (TASK-119) — a DEFENDER-targeting deferred-detonation applier, classified here
  // like `doom` so skillAilment recognizes it and the tactical policy treats it as "deals damage
  // (deferred)". Posture-B: priced above the pool, so never chosen in-sim.
  'doom-percent',
  'shield',
  // Barrier / shield-percent (TASK-131) — a SELF-targeting maxHp-fraction absorb buff, classified here
  // like `shield`/empower so skillAilment recognizes it and routes it to the CASTER. Posture-B: its
  // skill (`barrier`@92) is priced above the pool, so it is never chosen in-sim.
  'shield-percent',
  'empower',
  'empower-percent',
  // Fortify (TASK-108) — a SELF-targeting DEF-up buff, classified here like shield/empower so
  // skillAilment recognizes it and routes it to the CASTER. Posture-B: never chosen in-sim.
  'fortify',
  // Brace (TASK-109) — a SELF-targeting damage-taken-DOWN buff, classified here like
  // shield/empower/fortify so skillAilment recognizes it and routes it to the CASTER. Posture-B.
  'brace',
  // Bulwark (TASK-110) — a SELF-targeting percentage damage-taken-DOWN buff, classified here like
  // shield/empower/fortify/brace so skillAilment recognizes it and routes it to the CASTER. Posture-B.
  'brace-percent',
  // Aegis (TASK-111) — a SELF-targeting percentage DEF-up buff, classified here like
  // shield/empower/fortify/brace so skillAilment recognizes it and routes it to the CASTER. Posture-B.
  'fortify-percent',
  // Hasten (TASK-112) — a SELF-targeting flat SPD-up buff, classified here like
  // shield/empower/fortify/brace so skillAilment recognizes it and routes it to the CASTER. Posture-B.
  'hasten',
  // Rush (TASK-113) — a SELF-targeting percentage SPD-up buff, classified here like
  // hasten/fortify-percent so skillAilment recognizes it and routes it to the CASTER. Posture-B.
  'hasten-percent',
  // Hobble (TASK-114) — a FOE-targeting flat SPD-DOWN debuff, classified here like weaken/enfeeble so
  // skillAilment recognizes it and routes it to the DEFENDER (it is NOT on skillAilment's self list).
  // Posture-B: never chosen in-sim.
  'hobble',
  // Cripple (TASK-115) — the percentage SPD-DOWN foe-debuff; added so skillAilment recognizes it and
  // routes it to the DEFENDER (it is NOT on skillAilment's self list). Posture-B: never chosen in-sim.
  'hobble-percent',
  'retaliate',
  'stun',
  'freeze',
  'sleep',
]);
/**
 * The DETERMINISTIC tactical RANK of each ailment kind for {@link chooseSkill}'s
 * rule 1 (LOWER = preferred first). The turn-suppressing CONTROL ailments rank
 * highest because locking the foe out of its action is the biggest swing — and it is
 * what carries the marginally-winnable numemon fight (GUARDRAIL 1). `freeze` (a
 * MULTI-turn lock) outranks the single-turn `stun`. Below control come the offensive
 * DEBUFFS (weaken lowers foe DEF → our hits land harder; enfeeble lowers foe ATK →
 * its hits land softer), then the DoTs (burn > poison > bleed by per-turn bite). The
 * self-buffs (shield/empower) are NOT ranked here — they route through rule 2. This
 * fixed order (with a cheaper-cost tiebreak) is what deterministically ROTATES the
 * stranded mid-tier skills into a single shipped fight without RNG.
 */
const AILMENT_TACTICAL_PRIORITY: Readonly<Record<StatusAilment['kind'], number>> = {
  freeze: 0,
  stun: 1,
  weaken: 2,
  enfeeble: 3,
  vulnerable: 4,
  doom: 5,
  // Doom-Percent (TASK-119) — the fractional deferred-detonation twin of `doom`; classified as a
  // deferred-damage tactical like `doom`. This entry exists only to keep the Record total over
  // every StatusAilment kind — Posture-B (its skill is priced above the pool), so it is never
  // actually selected in-sim; the value is inert (mirrors `doom`'s deferred-damage class).
  'doom-percent': 5,
  corrode: 6,
  // Corrode-Percent (TASK-123) — mirrors `corrode`'s DoT-class rank (6). This entry exists only to keep
  // the Record total over every StatusAilment kind — Posture-B (its skill is priced above the pool), so it
  // is never actually selected in-sim; the value is inert.
  'corrode-percent': 6,
  bleed: 7,
  // Bleed-Percent (TASK-122) — DoT class alongside `bleed`; inert value since its skill is Posture-B
  // (never selected in-sim). Mirrors `bleed`'s DoT-class priority.
  'bleed-percent': 7,
  burn: 8,
  // Burn-Percent (TASK-120) — the fractional DoT twin of `burn`; classified as a DoT tactical like
  // `burn`. This entry exists only to keep the Record total over every StatusAilment kind — Posture-B
  // (its skill is priced above the pool), so it is never actually selected in-sim; the value mirrors
  // `burn`'s DoT class.
  'burn-percent': 8,
  // Wither-Percent (TASK-132) — DoT class; inert value since its skill is Posture-B (never selected
  // in-sim), it only keeps this exhaustive Record total over every StatusAilment kind.
  'wither-percent': 8,
  poison: 9,
  // Poison-Percent (TASK-121) — DoT class; inert value since its skill is Posture-B (never selected).
  'poison-percent': 9,
  sleep: 10,
  shield: 11,
  // Barrier / shield-percent (TASK-131) is a SELF-buff (the fractional twin of `shield`) — like
  // shield/empower it is never picked by chooseSkill's rule-1 defender-tactical pass (self-buffs route
  // through the Rule-1b self-buff opener); this entry exists only to keep the Record total over every
  // StatusAilment kind. Value mirrors `shield`'s. Posture-B (its skill @92 is above-pool, never in-sim).
  'shield-percent': 11,
  empower: 12,
  // Retaliate (TASK-69) is a SELF-buff — like shield/empower it is never picked by
  // chooseSkill's rule-1 defender-tactical pass (it routes through the Rule-1b self-buff
  // opener); this entry exists only to keep the Record total over every StatusAilment kind.
  // (TASK-75 promoted Counter Stance IN-pool at cost 30, so it now surfaces via the Rule-1b
  // opener when energy permits — but still never through THIS defender-tactical rank.)
  retaliate: 13,
  // Thorn Mirror (TASK-99) is a SELF-buff (the fractional MIRROR of retaliate) — never
  // picked by chooseSkill's rule-1 defender-tactical pass; this entry exists only to keep
  // the Record total over every StatusAilment kind. Its skill is above-pool (Posture-B).
  'retaliate-percent': 14,
  // Crumble (TASK-100) is a DEFENDER-targeting DEBUFF (the fractional MIRROR of weaken) —
  // like weaken it COULD route through rule-1, but its skill is above-pool @67 (Posture-B),
  // so it is never affordable and never picked inside simulateBattle. This entry keeps the
  // Record total over every StatusAilment kind; ranked just below weaken's DEF-debuff family.
  'weaken-percent': 15,
  // Sunder (TASK-101) is a DEFENDER-targeting DEBUFF (the fractional MIRROR of enfeeble, the
  // ATK-side twin of Crumble) — like enfeeble it COULD route through rule-1, but its skill is
  // above-pool @68 (Posture-B), so it is never affordable and never picked inside
  // simulateBattle. This entry keeps the Record total over every StatusAilment kind; ranked
  // just below Crumble's stat-mod family.
  'enfeeble-percent': 16,
  // Reinforce (TASK-102) is a SELF-buff (the fractional MIRROR of empower, the ATK-BONUS twin of
  // Sunder's ATK-reduction) — like empower/shield/retaliate it is NEVER picked by chooseSkill's
  // rule-1 defender-tactical pass (it routes through the Rule-1b self-buff opener); this entry exists
  // only to keep the Record total over every StatusAilment kind. Its skill is above-pool @69 (Posture-B).
  'empower-percent': 17,
  // Rupture (TASK-103) is a DEFENDER-targeting DEBUFF (the fractional MIRROR of vulnerable, the
  // damage-taken twin) — like vulnerable it COULD route through rule-1, but its skill is above-pool
  // @70 (Posture-B), so it is never affordable and never picked inside simulateBattle. This entry
  // keeps the Record total over every StatusAilment kind; ranked just below Reinforce.
  'vulnerable-percent': 18,
  // Fortify (TASK-108) is a SELF-buff (the DEF-up self-buff, the DEF-axis twin of empower and the
  // self-buff mirror of weaken) — like shield/empower/retaliate it is NEVER picked by chooseSkill's
  // rule-1 defender-tactical pass (it routes through the Rule-1b self-buff opener); this entry exists
  // only to keep the Record total over every StatusAilment kind. Its skill is above-pool @74 (Posture-B).
  fortify: 19,
  // Brace (TASK-109) is a SELF-buff (the damage-taken-DOWN self-buff, the POSITIVE MIRROR of
  // vulnerable at the damage-application seam) — like shield/empower/fortify/retaliate it is NEVER
  // picked by chooseSkill's rule-1 defender-tactical pass (it routes through the Rule-1b self-buff
  // opener); this entry exists only to keep the Record total over every StatusAilment kind. Its skill
  // is above-pool @75 (Posture-B).
  brace: 20,
  // Bulwark (TASK-110) is a SELF-buff (the PERCENTAGE damage-taken-DOWN self-buff, the fractional MIRROR
  // of brace and the DOWN-side percent twin of vulnerable-percent at the damage-application seam) — like
  // shield/empower/fortify/brace/retaliate it is NEVER picked by chooseSkill's rule-1 defender-tactical
  // pass (it routes through the Rule-1b self-buff opener); this entry exists only to keep the Record total
  // over every StatusAilment kind. Its skill is above-pool @76 (Posture-B).
  'brace-percent': 21,
  // Aegis (TASK-111) is a SELF-buff (the PERCENTAGE DEF-UP self-buff, the fractional MIRROR of fortify
  // and the DEF-UP percent twin of the DEBUFF weaken-percent at the DEF-mitigation seam) — like
  // shield/empower/fortify/brace/retaliate it is NEVER picked by chooseSkill's rule-1 defender-tactical
  // pass (it routes through the Rule-1b self-buff opener); this entry exists only to keep the Record total
  // over every StatusAilment kind. Its skill is above-pool @77 (Posture-B).
  'fortify-percent': 22,
  // Hasten (TASK-112) — the flat SPD-up self-buff; a NEW distinct rank after fortify-percent:22. Like the
  // other self-buffs it never surfaces via this tactical-priority pass (it routes through the Rule-1b
  // self-buff opener); this entry exists only to keep the Record total over every StatusAilment kind. Its
  // skill is above-pool @78 (Posture-B).
  hasten: 23,
  // Rush (TASK-113) — the percentage SPD-up self-buff; a NEW distinct rank after hasten:23. Like the
  // other self-buffs its rank is Posture-B inert (never fires in-sim), kept distinct for the ordering.
  'hasten-percent': 24,
  // Hobble (TASK-114) — the FLAT SPD-DOWN foe-debuff; a NEW distinct rank after hasten-percent:24. Like
  // weaken/enfeeble it COULD route through rule-1, but its skill is above-pool @80 (Posture-B), so it is
  // never affordable and never picked inside simulateBattle. This entry keeps the Record total over
  // every StatusAilment kind; ranked just below the SPD-up self-buff family.
  hobble: 25,
  // Cripple (TASK-115) — the PERCENTAGE SPD-DOWN foe-debuff; a NEW distinct rank after hobble:25. Like
  // hobble/weaken-percent it COULD route through rule-1, but its skill is above-pool @81 (Posture-B), so
  // it is never affordable and never picked inside simulateBattle. This entry keeps the Record total over
  // every StatusAilment kind; ranked just below the flat SPD-down `hobble`.
  'hobble-percent': 26,
};

/**
 * Which ailment kind (if any) a skill APPLIES, and WHOSE statuses it lands on. The
 * SELF-targeting buffs (`shield`, `empower`) land on the CASTER; every other ailment
 * arm (DoTs, debuffs, control) lands on the DEFENDER. `undefined` for a pure
 * damage/multihit skill (no ailment to redundancy-check). PURE (a lookup over the
 * skill's static effects).
 */
function skillAilment(
  skill: Skill,
): { kind: StatusAilment['kind']; target: 'self' | 'defender' } | undefined {
  for (const effect of skill.effects) {
    if (AILMENT_EFFECT_KINDS.has(effect.kind as StatusAilment['kind'])) {
      const kind = effect.kind as StatusAilment['kind'];
      const target: 'self' | 'defender' =
        kind === 'shield' ||
        kind === 'shield-percent' ||
        kind === 'empower' ||
        kind === 'empower-percent' ||
        kind === 'retaliate' ||
        kind === 'fortify' ||
        kind === 'brace' ||
        kind === 'brace-percent' ||
        kind === 'fortify-percent' ||
        kind === 'hasten-percent'
          ? 'self'
          : 'defender';
      return { kind, target };
    }
  }
  return undefined;
}

/**
 * Does a skill land at least one direct HP strike (a `damage` or `multihit` arm) — OR
 * apply a DEFERRED-damage curse (`doom`) that WILL deal a burst when its fuse expires?
 * TASK-66: doom-curse is NON-damaging on its cast turn but is NOT a zero-sum control
 * lock (unlike the pure-control Lullaby Hex's sleep) — its Doom curse detonates for
 * damage a few turns later, so it counts as a damaging tactical here. This is what lets
 * {@link chooseSkill}'s rule 1 rotate Doom Curse onto the foe (surfacing it in a shipped
 * fight, present ≠ observable) WITHOUT re-classifying it as a pure-control skill that
 * could stall the fight toward MAX_ROUNDS (a doom only ever SHORTENS a fight).
 */
function skillDealsDamage(skill: Skill): boolean {
  return skill.effects.some(
    (e) => e.kind === 'damage' || e.kind === 'multihit' || e.kind === 'doom',
  );
}

/**
 * TASK-64 (R-17c, 13th wave) — the DETERMINISTIC TACTICAL skill-selection policy that
 * REPLACES the naive greedy "most-expensive-affordable" {@link selectSkill} INSIDE the
 * shipped fight, so the mid-tier tactical skills (Fire Breath / Focus / Enfeeble
 * Strike / Shock Strike / Frost Bite …) that the greedy sawtooth stranded finally get
 * CAST and are SEEN on screen. It is a PURE function of `me`/`them` fight-local state
 * (energy + active statuses) and stays RNG-FREE, DETERMINISTIC, and TOTAL (0 energy →
 * `attack`, which costs 0). No new mechanic, no HP path — this only chooses WHICH
 * affordable skill fires.
 *
 * THE POLICY (a fixed preference over the currently-AFFORDABLE skills, deterministic):
 *
 *   1. A DAMAGING tactical skill (a `[damage, <ailment>]` composite — Shock Strike /
 *      Frost Bite / Fire Breath / Enfeeble Strike / Armor Break / Bleed Strike / Poison
 *      Sting) whose ailment is NOT already active on the DEFENDER *and* has NOT yet been
 *      inflicted this fight (the `inflicted` set), evaluated in a fixed TACTICAL
 *      PRIORITY (control ailments first — see {@link AILMENT_TACTICAL_PRIORITY}). This
 *      ROTATES the whole stranded mid-tier arsenal onto the foe, one guaranteed cast
 *      each, WITHOUT ever spending a zero-damage turn (GUARDRAIL 3) and leading with the
 *      turn-suppressing control lock that carries the win (GUARDRAIL 1).
 *   2. Once the arsenal is exhausted, the STRONGEST affordable PURE-damage skill
 *      (cost-descending → Double Strike, the burst multi-hit — else the free Attack
 *      while energy is below Double Strike's cost, which both deals damage AND lets the
 *      pool climb back up to re-afford Double Strike). This SURFACES Double Strike after
 *      the rotation and maximizes HP progress against a fully-afflicted foe.
 *   3. A SELF-buff not already active on the caster (Focus/Empower, Guard/Shield) —
 *      only reached when no pure-damage skill is affordable (a defensive fallback).
 *   4. Re-apply the highest-priority FRESH (expired) offensive ailment (the freeze↔stun
 *      control rotation) — also a fallback, only when no pure-damage skill is affordable.
 *   5. `attack` (cost 0 → always affordable → the function is TOTAL).
 *
 * Rules 3–4 are in practice unreachable (the free Attack makes rule 2 always succeed);
 * they are kept for completeness/determinism. The pure-control, NON-damaging Lullaby
 * Hex (`[sleep]`, no damage arm) is INTENTIONALLY never preferred (it deals no damage),
 * so it can never dominate a fight into a MAX_ROUNDS stall (the TASK-60/61 pure-control
 * starvation hazard); the shipped fights resolve well clear of the round cap.
 */
export function chooseSkill(me: SideState, them: SideState): Skill {
  const affordable = COMBATANT_SKILLS.filter((s) => s.energyCost <= me.energy);

  // Rule 1 — a DAMAGING tactical skill applying a FRESH ailment (one not already on
  // the defender). Ordered by a fixed TACTICAL PRIORITY over the ailment KIND (see
  // {@link AILMENT_TACTICAL_PRIORITY}): the turn-suppressing CONTROL ailments
  // (freeze/stun) rank HIGHEST because locking the foe out of its action is what makes
  // the marginally-winnable numemon fight winnable (GUARDRAIL 1 — the control lock is
  // the win engine); the DoTs / debuffs rank below, and among equal priority the
  // CHEAPER skill wins so the AI can afford to STACK more distinct ailments per turn.
  // This deterministic ordering rotates ALL the stranded mid-tiers (Frost Bite /
  // Shock Strike / Enfeeble Strike / Fire Breath / Armor Break / Bleed Strike / Poison
  // Sting) into one shipped fight. Every rule-1 pick deals damage, so HP keeps falling
  // (GUARDRAIL 3 — no zero-damage stall toward MAX_ROUNDS).
  const damagingTactical = affordable
    .filter((skill) => {
      if (!skillDealsDamage(skill)) return false;
      const ailment = skillAilment(skill);
      return ailment !== undefined && ailment.target === 'defender';
    })
    .sort((a, b) => {
      const pa = AILMENT_TACTICAL_PRIORITY[skillAilment(a)!.kind];
      const pb = AILMENT_TACTICAL_PRIORITY[skillAilment(b)!.kind];
      return pa !== pb ? pa - pb : a.energyCost - b.energyCost;
    });
  const notActive = (skill: Skill) =>
    !them.statuses.some((s) => s.kind === skillAilment(skill)!.kind);

  // Rule 1a — FIRST rotate the arsenal: among the fresh (not-currently-active)
  // damaging tactical skills, prefer one whose ailment this side has NOT yet inflicted
  // this fight. Evaluated priority-first (control ailments before debuffs/DoTs), so the
  // opener still LEADS with the turn-suppressing lock (freeze) that carries the win —
  // but every distinct mid-tier skill gets its ONE guaranteed cast before any ailment
  // is re-applied, so ALL of them surface (present ≠ observable, the whole point).
  const freshUnseen = damagingTactical.find(
    (skill) => notActive(skill) && !me.inflicted.has(skillAilment(skill)!.kind),
  );
  if (freshUnseen !== undefined) return freshUnseen;

  // Rule 1b — a ONE-TIME SELF-BUFF OPENER (TASK-74, the 3rd OBSERVABLE PROMOTION).
  // Placed AHEAD of the Rule-2 damage hammer but AFTER the Rule-1 fresh-ailment rotation:
  // among affordable NON-damaging SELF-targeting buff skills (Focus/Empower, Guard/Shield —
  // `skillAilment(skill).target === 'self'` on a skill with NO damage arm), cast the FIRST
  // one not currently active on the caster AND not yet cast THIS fight. This is what finally
  // makes the SELF-BUFF family a real /battle player SEES: `focus` (Empower) and `guard`
  // (Shield) are in-pool and affordable but the greedy Rule 2 (free Attack always satisfies
  // it first) meant the old Rule 3 self-buff branch was UNREACHABLE, so they NEVER cast.
  //
  // WHY between Rule 1 and Rule 2 (not opener-FIRST): the Rule-1 fresh-ailment rotation MUST
  // still run FIRST — its turn-suppressing control lock (freeze) is the win engine of the
  // marginally-winnable numemon fight (GUARDRAIL 1), and it is what surfaces the whole
  // stranded mid-tier arsenal. So the self-buff fires only AFTER the arsenal is spent, in
  // the late hammer phase. In the shipped numemon WIN this means Focus takes the SINGLE
  // post-arsenal hammer slot that TASK-73 gave to Energy Siphon — the deliberate, bounded
  // perturbation this wave scopes (Siphon stays fully wired + unit-proven + still the pick
  // whenever the pool sits at its cost band; it simply no longer fires in THIS fixture, the
  // same DISPLACEMENT chain TASK-72→73 established). numemon's hp is nudged 230→222 so the
  // Focus turn still resolves to a clean WIN (player HP > 0, clear of MAX_ROUNDS).
  //
  // WHY the SAME `me.inflicted`-guard idiom Rule 1a uses (the anti-stall safeguard): a
  // self-buff deals ZERO damage, so casting it EVERY turn would starve the fight toward
  // MAX_ROUNDS (the TASK-60 pure-control hazard). The one-time-per-buff guard
  // (`!me.inflicted.has(...)` — a self-buff cast records its kind into `me.inflicted` at the
  // self-target apply branch, exactly like an offensive ailment) caps the extra non-damage
  // turns at a small constant (≤ 2: one Focus + one Guard), then the buff falls through to
  // the hammer. HP stays MONOTONICALLY NON-INCREASING (a buff writes a stat-modifier / shield
  // buffer, NEVER HP up — categorically NOT the A-42-deferred Heal/HoT family), and the pick
  // is a deterministic fixed-priority (COMBATANT_SKILLS order), no RNG introduced.
  const freshSelfBuffOpener = affordable.find((skill) => {
    if (skillDealsDamage(skill)) return false;
    const ailment = skillAilment(skill);
    if (ailment === undefined || ailment.target !== 'self') return false;
    return !me.statuses.some((s) => s.kind === ailment.kind) && !me.inflicted.has(ailment.kind);
  });
  if (freshSelfBuffOpener !== undefined) return freshSelfBuffOpener;

  // Rule 2 — once every distinct offensive ailment has been inflicted, HAMMER with the
  // strongest affordable PURE-damage skill (cost-descending → Double Strike, the burst
  // multi-hit — else the free Attack while energy is below Double Strike's cost, which
  // both makes HP progress AND lets the pool climb back up to afford Double Strike). This
  // is what SURFACES Double Strike in a resolved fight: it is reached only AFTER the
  // tactical rotation, so it never robs the mid-tiers of their casts, and it maximizes HP
  // progress once the foe is fully afflicted (GUARDRAIL 3 — always damage, never a stall).
  const strongestDamage = affordable.find(
    (skill) => skillDealsDamage(skill) && skillAilment(skill) === undefined,
  );
  if (strongestDamage !== undefined) return strongestDamage;

  // Rule 3 — a SELF-buff not already active on the caster (Focus/Empower, Guard/Shield).
  // Only reached if NO pure-damage skill is affordable (impossible while Attack is free),
  // so in practice this is a defensive fallback kept for determinism/completeness.
  const freshSelfBuff = affordable.find((skill) => {
    const ailment = skillAilment(skill);
    if (ailment === undefined || ailment.target !== 'self') return false;
    return !me.statuses.some((s) => s.kind === ailment.kind);
  });
  if (freshSelfBuff !== undefined) return freshSelfBuff;

  // Rule 4 — re-apply the highest-priority FRESH (expired) offensive ailment (the
  // freeze↔stun control rotation). Also only reached when no pure-damage skill is
  // affordable; kept for completeness/determinism.
  const freshDamagingTactical = damagingTactical.find(notActive);
  if (freshDamagingTactical !== undefined) return freshDamagingTactical;

  // Rule 5 — the free Attack (always affordable → TOTAL).
  return SKILLS.attack;
}

/**
 * TASK-144 (R-22 slice 5) — a MATCHUP-AWARE enemy chooser. The telegraphed enemy
 * (TASK-142) previews the pure {@link chooseSkill} cascade, which reads only the two
 * {@link SideState}s (energy + active statuses) and is BLIND to the type/element
 * MATCHUP even though {@link resolveAttack} already scales damage by the
 * Vaccine>Virus>Data attribute triangle ({@link typeMultiplier}, ×1.5/×0.75) and the
 * Fire>Nature>Water>Electric element cycle ({@link elementMultiplier}, ×1.25/×0.8).
 * This chooser makes the previewed enemy PRESS a matchup advantage: when the attacker
 * (`meC`) is type/element-ADVANTAGED over the defender (`themC`) — the product of the
 * two multipliers is `> 1.0` — it favours its strongest affordable PURE-damage skill
 * (the "hammer", the SAME selection {@link chooseSkill}'s Rule 2 computes) to maximize
 * HP progress while the multiplier is in its favour. When NEUTRAL or DISADVANTAGED
 * (product `≤ 1.0`) it delegates VERBATIM to {@link chooseSkill} — the proven
 * control/stall cascade, byte-identical fallback.
 *
 * WHY a NEW function, not a change to {@link chooseSkill}: the auto-resolve
 * {@link simulateBattle} + the entire pinned `battle.spec.ts` (WIN/LOSS fixtures,
 * the Frost-Bite-opener arsenal rotation, the determinism guard) pin `chooseSkill`'s
 * output BYTE-for-byte, and both drivers pass the SAME seam into
 * {@link resolveActorTurn}. Swapping a matchup heuristic INTO `chooseSkill` would
 * perturb every fixture (invariant 5). So this is add-only: `chooseSkill` /
 * `selectSkill` / `resolveActorTurn` / `simulateBattle` stay byte-unchanged; ONLY the
 * interactive enemy call sites opt into this chooser (via a closure that captures the
 * two {@link Combatant}s the seam type does not carry).
 *
 * PURE + DETERMINISTIC + RNG-FREE (`Math.random` count STAYS 0 — this reads only
 * stats/statuses; a crit/evade/flee roll would re-open the deferred A-53 substrate).
 * TOTAL: the advantaged branch falls back to {@link chooseSkill} if no pure-damage
 * skill is affordable (impossible while the free Attack exists, but kept for
 * completeness), so it always returns a Skill.
 *
 * @param me   the ATTACKER's fight-local {@link SideState} (energy + statuses).
 * @param them the DEFENDER's fight-local {@link SideState}.
 * @param meC   the ATTACKER's server-authoritative {@link Combatant} (carries type/element).
 * @param themC the DEFENDER's server-authoritative {@link Combatant} (carries type/element).
 */
export function chooseSkillMatchup(
  me: SideState,
  them: SideState,
  meC: Combatant,
  themC: Combatant,
): Skill {
  // The attacker→defender matchup multiplier — REUSE the single-sourced damage-engine
  // helpers (A-36 #3 / L-16: never re-derive the affinity tables). Product > 1.0 means
  // the attacker is net-advantaged (either axis wins and the other does not fully cancel
  // it, e.g. type ×1.5 or element ×1.25).
  const matchup =
    typeMultiplier(meC.type, themC.type) * elementMultiplier(meC.element, themC.element);

  if (matchup > 1.0) {
    // ADVANTAGED — press it: cast the strongest affordable PURE-damage skill (the same
    // cost-descending "hammer" {@link chooseSkill}'s Rule 2 picks — Double Strike while
    // affordable, else the free Attack that both deals damage and lets the pool re-climb).
    // This is what a player reading "Enemy intends: <big hammer>" now understands: the
    // enemy is capitalizing on its type/element edge, not rotating a control ailment.
    const affordable = COMBATANT_SKILLS.filter((s) => s.energyCost <= me.energy);
    const hammer = affordable.find(
      (skill) => skillDealsDamage(skill) && skillAilment(skill) === undefined,
    );
    if (hammer !== undefined) return hammer;
    // No pure-damage skill affordable (unreachable while Attack is free) — fall through
    // to the proven cascade so the function stays TOTAL and deterministic.
  }

  // NEUTRAL or DISADVANTAGED (or the advantaged hammer was somehow unaffordable) —
  // delegate VERBATIM to the proven control/stall cascade. Byte-identical to
  // chooseSkill on the same inputs (the acceptance `toEqual` fallback proof).
  return chooseSkill(me, them);
}

/**
 * TASK-162 (R-22 slice 23) — a SMARTER, FINISHER-PREFERRING enemy chooser. The
 * matchup-aware {@link chooseSkillMatchup} presses a type/element advantage (TASK-144)
 * but has NO notion of "the defender is one hit from dead → finish them": it plays the
 * same matchup skill even when an available skill would kill this turn. This wrapper
 * gives the interactive enemy that killer instinct — when the DEFENDER (`them`) is in
 * KILL RANGE (an affordable offensive skill's DETERMINISTIC damage this turn is ≥ its
 * current HP), it returns that lethal FINISHER; otherwise it DELEGATES VERBATIM to
 * {@link chooseSkillMatchup} so every existing matchup behaviour is preserved.
 *
 * WHY a NEW function WRAPPING {@link chooseSkillMatchup}, not an edit to it (invariant 5):
 * the auto-resolve {@link simulateBattle}/{@link simulateBattleAtb} inject the flat
 * {@link chooseSkill} and the whole pinned `battle.spec` suite pins its output
 * byte-for-byte; {@link chooseSkillMatchup} itself is byte-frozen and reused by the
 * telegraph. ONLY the interactive enemy `selectSkillFor` seam opts into this finisher —
 * the auto paths stay untouched, so all ~637 fixtures + the PvE/PvP/explore e2es stay
 * green with NO re-pin (the invariant-5 byte-proof). Revert = re-point the interactive
 * enemy seam back to {@link chooseSkillMatchup} (two-way door, zero migration).
 *
 * PURE + DETERMINISTIC + RNG-FREE (the engine's executable `Math.random` count STAYS 0 —
 * the finisher READS stats/statuses; a crit/evade/flee roll would re-open the RNG
 * substrate). A-42 HELD: it only CHOOSES among the EXISTING HP-monotone skills — no new
 * mechanic/arm/heal is added (I-10's mechanic treadmill stays STOPPED). TOTAL: with no
 * lethal skill it falls through to {@link chooseSkillMatchup}, which always returns a Skill.
 *
 * The per-skill damage ESTIMATE reuses the SAME single-sourced damage helpers the strike
 * itself runs — {@link resolveAttack} (the type/element/DEF/weaken math) folded through
 * {@link amplifyForVulnerable} (the defender's vulnerable amp), times the skill's
 * strike count — WITHOUT re-deriving any formula (A-36 #3 / L-16). It reads the SAME
 * fixed `weaken` DEF-reduction and `empower` ATK-bonus {@link resolveDamageStrike} reads,
 * so at DEFAULT_RNG (no crit) the estimate EQUALS the strike's pre-shield `raw`; the
 * estimate is subtracted by the defender's active flat `shield` buffer (the finisher
 * must break through the shield to land the kill). Because the auto paths never call
 * this, its estimate never touches a pinned fixture.
 *
 * @param me   the ATTACKER's fight-local {@link SideState} (energy + statuses).
 * @param them the DEFENDER's fight-local {@link SideState}.
 * @param meC   the ATTACKER's server-authoritative {@link Combatant} (carries atk/type/element).
 * @param themC the DEFENDER's server-authoritative {@link Combatant} (carries def/type/element).
 */
export function chooseSkillFinisher(
  me: SideState,
  them: SideState,
  meC: Combatant,
  themC: Combatant,
): Skill {
  // The DEFENDER's active flat shield buffer (if any) — a finisher must chew through it
  // before the strike reaches HP, exactly as resolveDamageStrike's absorb does. Only the
  // flat `shield` is subtracted here (the common case); the estimate stays a deterministic
  // pre-strike prediction, not a re-implementation of the full multi-hit absorb loop.
  const shield = them.statuses.find((s) => s.kind === 'shield');
  const shieldBuffer = shield?.kind === 'shield' ? shield.absorbRemaining : 0;

  // The fixed ATK/DEF stat-modifiers resolveDamageStrike folds in — read them the SAME way
  // so the estimate matches the actual pre-crit strike (weaken lowers the foe's DEF → our
  // hits land harder; empower raises our ATK; enfeeble lowers it). We fold the FIXED arms
  // (the ones present in shipped fights); the percent arms only ever change the magnitude,
  // never whether a monotone finisher exists, so the fixed read is a faithful estimate.
  const foeWeaken = them.statuses.find((s) => s.kind === 'weaken');
  const defReduction = foeWeaken?.kind === 'weaken' ? foeWeaken.defReduction : 0;
  const myEmpower = me.statuses.find((s) => s.kind === 'empower');
  const atkBonus = myEmpower?.kind === 'empower' ? myEmpower.atkBonus : 0;
  const myEnfeeble = me.statuses.find((s) => s.kind === 'enfeeble');
  const atkReduction = myEnfeeble?.kind === 'enfeeble' ? myEnfeeble.atkReduction : 0;

  // The per-strike pre-shield damage this attacker would deal to `them` — the SAME
  // resolveAttack → amplifyForVulnerable pipeline resolveDamageStrike runs for `raw`.
  const perStrike = amplifyForVulnerable(
    resolveAttack(meC, themC, defReduction, atkBonus - atkReduction),
    them.statuses,
  );

  // For each AFFORDABLE offensive skill compute its total damage to `them` this turn
  // (a `multihit` lands `hits` strikes; a plain `damage` arm is one) MINUS the shield
  // buffer, then keep the LETHAL ones (damage ≥ current HP). Evaluated in COMBATANT_SKILLS
  // order so the tie-break is deterministic: among skills that all kill, prefer the one
  // dealing the MOST damage (surest kill through any absorb), ties broken by catalog order.
  let bestKill: Skill | undefined;
  let bestKillDamage = -1;
  for (const skill of COMBATANT_SKILLS) {
    if (skill.energyCost > me.energy) continue;
    // Only skills with an IMMEDIATE HP strike this turn can finish — a `damage` or
    // `multihit` arm. A pure `doom` (deferred-burst curse, `skillDealsDamage` true but
    // NO this-turn HP) can never land the kill THIS turn, so it is excluded here.
    const dealsNow = skill.effects.some((e) => e.kind === 'damage' || e.kind === 'multihit');
    if (!dealsNow) continue;
    const multihit = skill.effects.find((e) => e.kind === 'multihit');
    const strikes = multihit?.kind === 'multihit' ? multihit.hits : 1;
    const damage = perStrike * strikes - shieldBuffer;
    if (damage >= them.hp && damage > bestKillDamage) {
      bestKillDamage = damage;
      bestKill = skill;
    }
  }
  if (bestKill !== undefined) return bestKill;

  // NOT in kill range — delegate VERBATIM to the proven matchup chooser (byte-identical to
  // chooseSkillMatchup on the same inputs, the acceptance-`toEqual` delegation proof).
  return chooseSkillMatchup(me, them, meC, themC);
}

/**
 * TASK-163 (R-22 slice 24) — a DEFENSIVE enemy chooser, the DIRECT MIRROR of the
 * finisher {@link chooseSkillFinisher}. That wrapper reads only `them.hp` to press a
 * KILL when the DEFENDER is cornered, but the enemy AI has NO notion of ITS OWN danger:
 * when the enemy (`me`) is one hit from dead it still plays its finisher/matchup offense
 * and trades blows into its own death. This wrapper gives the interactive enemy a survival
 * instinct — when `me` is in KILL RANGE (the strongest thing `them` could do to `me` this
 * turn is ≥ `me.hp`) AND an affordable defensive `guard`/Shield is available AND `me` is
 * not already shielded, it returns that {@link SKILLS.guard} to mitigate the incoming
 * strike; otherwise it DELEGATES VERBATIM to {@link chooseSkillFinisher} so every existing
 * finisher/matchup offensive behaviour is preserved when the enemy is NOT cornered.
 *
 * WHY a NEW function WRAPPING {@link chooseSkillFinisher}, not an edit to it (invariant 5):
 * the auto-resolve {@link simulateBattle}/{@link simulateBattleAtb} inject the flat
 * {@link chooseSkill} and the whole pinned `battle.spec` suite pins its output
 * byte-for-byte; {@link chooseSkillFinisher} itself is byte-frozen and reused elsewhere.
 * ONLY the interactive enemy `selectSkillFor` seam opts into this defensive wrapper — the
 * auto paths stay untouched, so all ~637 fixtures + the PvE/PvP/explore e2es stay green
 * with NO re-pin (the invariant-5 byte-proof). Revert = re-point the interactive enemy
 * seam back to {@link chooseSkillFinisher} (two-way door, zero migration). The delegation
 * chain is Defensive → Finisher → Matchup → chooseSkill.
 *
 * PURE + DETERMINISTIC + RNG-FREE (the engine's executable `Math.random` count STAYS 0 —
 * the defensive pick READS stats/statuses). A-42 HELD: it only CHOOSES among the EXISTING
 * HP-monotone skills — a shield MITIGATES incoming damage, it never raises HP; no new
 * mechanic/arm/heal is added (I-10's mechanic treadmill stays STOPPED). TOTAL: whenever
 * it does not shield it falls through to {@link chooseSkillFinisher}, which always returns
 * a Skill.
 *
 * The incoming-damage ESTIMATE is the MIRROR of the finisher's: it reuses the SAME
 * {@link resolveAttack} → {@link amplifyForVulnerable} pipeline, but in the INBOUND
 * direction — the attacker is `them` (`themC`), the defender is `me` (`meC`) — so it reads
 * `them`'s empower/enfeeble ATK-mods, `me`'s weaken DEF-mod, and folds `me`'s OWN active
 * flat `shield` buffer (the strike must chew through the shield already up). Because the
 * auto paths never call this, its estimate never touches a pinned fixture.
 *
 * @param me   the ENEMY's fight-local {@link SideState} (energy + statuses) — the side we defend.
 * @param them the PLAYER's fight-local {@link SideState} — the incoming attacker.
 * @param meC   the ENEMY's server-authoritative {@link Combatant} (carries def/type/element).
 * @param themC the PLAYER's server-authoritative {@link Combatant} (carries atk/type/element).
 */
export function chooseSkillDefensive(
  me: SideState,
  them: SideState,
  meC: Combatant,
  themC: Combatant,
): Skill {
  // `me`'s OWN active flat shield buffer (if any) — an incoming strike must chew through it
  // before it reaches `me`'s HP, exactly as the finisher folds the DEFENDER's shield. This
  // buffer both lowers the estimated incoming damage AND, when present, means `me` is
  // already shielded (so casting Guard again is redundant — delegate to the finisher).
  const myShield = me.statuses.find((s) => s.kind === 'shield');
  const myShieldBuffer = myShield?.kind === 'shield' ? myShield.absorbRemaining : 0;

  // The fixed ATK/DEF stat-modifiers resolveDamageStrike folds in, read in the MIRROR
  // direction: `me`'s weaken lowers OUR DEF → their hits land harder; `them`'s empower
  // raises THEIR ATK; `them`'s enfeeble lowers it. Same faithful fixed-arm read as the
  // finisher, just with the attacker/defender sides swapped.
  const myWeaken = me.statuses.find((s) => s.kind === 'weaken');
  const defReduction = myWeaken?.kind === 'weaken' ? myWeaken.defReduction : 0;
  const foeEmpower = them.statuses.find((s) => s.kind === 'empower');
  const atkBonus = foeEmpower?.kind === 'empower' ? foeEmpower.atkBonus : 0;
  const foeEnfeeble = them.statuses.find((s) => s.kind === 'enfeeble');
  const atkReduction = foeEnfeeble?.kind === 'enfeeble' ? foeEnfeeble.atkReduction : 0;

  // The per-strike pre-shield damage `them` would deal to `me` — the SAME resolveAttack →
  // amplifyForVulnerable pipeline resolveDamageStrike runs, with `themC` as the attacker
  // and `meC` as the defender (the mirror of the finisher).
  const perStrike = amplifyForVulnerable(
    resolveAttack(themC, meC, defReduction, atkBonus - atkReduction),
    me.statuses,
  );

  // The player's WORST-case incoming damage to `me` this turn: over every skill THEY could
  // afford (from THEIR energy) that lands an immediate HP strike, the most-damaging one,
  // MINUS `me`'s own flat shield buffer. Deterministic COMBATANT_SKILLS-order scan.
  let worstIncoming = 0;
  for (const skill of COMBATANT_SKILLS) {
    if (skill.energyCost > them.energy) continue;
    const dealsNow = skill.effects.some((e) => e.kind === 'damage' || e.kind === 'multihit');
    if (!dealsNow) continue;
    const multihit = skill.effects.find((e) => e.kind === 'multihit');
    const strikes = multihit?.kind === 'multihit' ? multihit.hits : 1;
    const damage = perStrike * strikes - myShieldBuffer;
    if (damage > worstIncoming) worstIncoming = damage;
  }

  // Defend ONLY when cornered — the incoming strike would kill `me` this turn (kill range,
  // the mirror of the finisher's `damage >= them.hp` test) — AND an affordable Guard is
  // available AND `me` is not already shielded (a fresh shield would be redundant). All
  // three must hold, else delegate: a defensive pick that cannot change the outcome is not
  // worth burning `me`'s offensive turn.
  const inKillRange = worstIncoming >= me.hp;
  const guard = SKILLS.guard;
  const canGuard = guard.energyCost <= me.energy;
  const alreadyShielded = myShieldBuffer > 0;
  if (inKillRange && canGuard && !alreadyShielded) return guard;

  // NOT cornered (or cannot/should not shield) — delegate VERBATIM to the finisher, which
  // itself delegates to the matchup chooser when there is no kill. Preserves ALL existing
  // offensive behaviour (the acceptance-`toEqual` delegation proof).
  return chooseSkillFinisher(me, them, meC, themC);
}

/**
 * TASK-164 (R-22 slice 25) — an ENERGY-BANKING / setup-then-burst enemy chooser, the
 * THIRD composing wrapper in the delegation chain and the FIRST to plan across TURNS.
 * Every prior chooser is single-turn-reactive: {@link chooseSkill} / {@link chooseSkillMatchup}
 * / {@link chooseSkillFinisher} / {@link chooseSkillDefensive} all spend the best skill
 * AFFORDABLE THIS TURN and never hold back to charge toward a bigger play. This wrapper
 * gives the interactive enemy a notion of TEMPO: when the enemy (`me`)'s most-damaging
 * OFFENSIVE burst skill is UNAFFORDABLE this turn but would become affordable NEXT turn
 * after the standard per-turn energy gain ({@link energyAtTurnStart}), AND that burst
 * meaningfully OUT-VALUES the best-affordable-now skill, AND neither defence nor a finish
 * is the right play this turn, it plays the CHEAPEST productive holding action now — the
 * cheapest affordable offensive skill, else an unheld `guard`/Shield hold — to BANK energy
 * toward the burst. Then next turn, once the burst is affordable, the ordinary chooser
 * unleashes it. Otherwise it DELEGATES VERBATIM to {@link chooseSkillDefensive}.
 *
 * PRECEDENCE (the composition stays honest): defence and finishing ALWAYS dominate banking.
 * We FIRST compute {@link chooseSkillDefensive}'s pick and bank ONLY if that pick is the
 * ordinary matchup/best-affordable offense (i.e. neither the defensive Guard nor the
 * finisher's lethal skill fired). This gives the precedence FOR FREE with zero duplicated
 * logic — when the enemy is cornered (Guard) or can finish (a lethal pick) the delegated
 * pick is NOT the ordinary offense, so banking never pre-empts it. The delegation chain is
 * now Banking → Defensive → Finisher → Matchup → chooseSkill.
 *
 * WHY a NEW function WRAPPING {@link chooseSkillDefensive}, not an edit to it (invariant 5):
 * the auto-resolve {@link simulateBattle}/{@link simulateBattleAtb} inject the flat
 * {@link chooseSkill} and the pinned `battle.spec` suite pins its output byte-for-byte;
 * every sibling selector is byte-frozen and reused. ONLY the interactive enemy
 * `selectSkillFor` seam opts into this banking wrapper — the auto paths stay untouched, so
 * all ~637 fixtures + the PvE/PvP/explore e2es stay green with NO re-pin (the invariant-5
 * byte-proof). Revert = re-point the interactive enemy seam back to
 * {@link chooseSkillDefensive} (two-way door, zero migration).
 *
 * PURE + DETERMINISTIC + RNG-FREE (the engine's executable `Math.random` count STAYS 0 —
 * the banking pick READS energy/damage/statuses). A-42 HELD: it only CHOOSES among the
 * EXISTING HP-monotone skills — a cheap offensive hold or Guard MITIGATES, it never raises
 * HP; no new mechanic/arm/heal is added (I-10's mechanic treadmill stays STOPPED). TOTAL:
 * whenever banking is not worthwhile it falls through to {@link chooseSkillDefensive}, which
 * always returns a Skill.
 *
 * The burst-vs-now damage ESTIMATE reuses the SAME {@link resolveAttack} →
 * {@link amplifyForVulnerable} pipeline the finisher runs, in the OFFENSIVE direction
 * (`meC` attacker, `themC` defender), folding `them`'s flat shield + the fixed weaken /
 * empower / enfeeble arms exactly as {@link chooseSkillFinisher} does (`×hits` for a
 * multihit) — never re-deriving a rule (A-36 #3 / L-16).
 *
 * @param me   the ENEMY's fight-local {@link SideState} (energy + statuses) — the side we plan for.
 * @param them the PLAYER's fight-local {@link SideState} — the target of the burst.
 * @param meC   the ENEMY's server-authoritative {@link Combatant} (carries atk/type/element).
 * @param themC the PLAYER's server-authoritative {@link Combatant} (carries def/type/element).
 */
export function chooseSkillBanking(
  me: SideState,
  them: SideState,
  meC: Combatant,
  themC: Combatant,
): Skill {
  // PRECEDENCE FIRST: what would the reactive chain (defence → finisher → matchup) play?
  // If that is NOT the ordinary best-affordable offense — i.e. it is the defensive Guard
  // (enemy cornered) or a lethal finisher pick (player in kill range) — banking must NOT
  // pre-empt it, so we return the delegated pick unchanged. Computing it once here also
  // gives us the "best-affordable-now" baseline for the out-value comparison below.
  const reactivePick = chooseSkillDefensive(me, them, meC, themC);

  // Estimate `me`'s per-strike pre-shield damage to `them` — the SAME resolveAttack →
  // amplifyForVulnerable pipeline the finisher runs, in the offensive direction. Fold the
  // DEFENDER's flat shield + the fixed weaken (their DEF ↓ → our hits ↑) / empower (our
  // ATK ↑) / enfeeble (our ATK ↓) arms exactly as chooseSkillFinisher does.
  const foeShield = them.statuses.find((s) => s.kind === 'shield');
  const shieldBuffer = foeShield?.kind === 'shield' ? foeShield.absorbRemaining : 0;
  const foeWeaken = them.statuses.find((s) => s.kind === 'weaken');
  const defReduction = foeWeaken?.kind === 'weaken' ? foeWeaken.defReduction : 0;
  const myEmpower = me.statuses.find((s) => s.kind === 'empower');
  const atkBonus = myEmpower?.kind === 'empower' ? myEmpower.atkBonus : 0;
  const myEnfeeble = me.statuses.find((s) => s.kind === 'enfeeble');
  const atkReduction = myEnfeeble?.kind === 'enfeeble' ? myEnfeeble.atkReduction : 0;
  const perStrike = amplifyForVulnerable(
    resolveAttack(meC, themC, defReduction, atkBonus - atkReduction),
    them.statuses,
  );

  // The estimated this-turn damage to `them` of an offensive skill (0 for a skill with no
  // immediate HP strike, e.g. a pure self-buff/DoT-applier — those are never a "burst").
  const damageOf = (skill: Skill): number => {
    const dealsNow = skill.effects.some((e) => e.kind === 'damage' || e.kind === 'multihit');
    if (!dealsNow) return 0;
    const multihit = skill.effects.find((e) => e.kind === 'multihit');
    const strikes = multihit?.kind === 'multihit' ? multihit.hits : 1;
    return perStrike * strikes - shieldBuffer;
  };

  // The enemy's most-damaging OFFENSIVE BURST over the WHOLE catalog — the strongest
  // this-turn strike it could EVER land (regardless of current affordability). Deterministic
  // COMBATANT_SKILLS-order scan (first max wins the tie → catalog order).
  let burst: Skill | undefined;
  let burstDamage = -1;
  for (const skill of COMBATANT_SKILLS) {
    const damage = damageOf(skill);
    if (damage > burstDamage) {
      burstDamage = damage;
      burst = skill;
    }
  }

  // The banking triggers — ALL must hold:
  //  (a) a real burst exists and is UNAFFORDABLE this turn (`energyCost > me.energy`);
  //  (b) it becomes AFFORDABLE next turn after the standard per-turn energy gain — so the
  //      hold actually PAYS OFF next turn, not "unaffordable forever" (the pointless-hold guard);
  //  (c) the burst meaningfully OUT-VALUES the best-affordable-now offensive pick — the
  //      reactive chain's damage — by a margin, so trading THIS turn for it is worthwhile;
  //  (d) the reactive chain chose the ORDINARY offense — NOT the defensive Guard (enemy
  //      cornered) and NOT an already-lethal finisher pick (player in kill range). Defence and
  //      finishing ALWAYS dominate banking: burning a turn to bank when we could win/survive NOW
  //      is never right. Detecting a lethal reactive pick by its estimated damage (`>= them.hp`)
  //      covers the finisher precisely without duplicating its logic.
  const nowDamage = damageOf(reactivePick);
  const reactiveIsLethal = nowDamage >= them.hp && nowDamage > 0;
  const bankable =
    burst !== undefined &&
    burst.energyCost > me.energy &&
    burst.energyCost <= energyAtTurnStart(me.energy) &&
    // A meaningful margin (≥ 25% more this-turn damage) — a tunable heuristic threshold; a
    // trivial edge is not worth burning a turn. `nowDamage` may be 0 (the reactive pick is a
    // non-damaging buff) in which case any positive burst clears the bar.
    burstDamage >= nowDamage * 1.25 &&
    reactivePick.id !== SKILLS.guard.id &&
    !reactiveIsLethal;

  if (bankable) {
    // Play the CHEAPEST productive holding action now to bank toward the burst without
    // wasting the turn: the cheapest affordable OFFENSIVE skill (still deals damage → HP
    // keeps falling), else an unheld `guard`/Shield hold (a productive mitigation), else —
    // as a total fallback — the reactive pick. The hold is strictly cheaper than the burst
    // (it is affordable now while the burst is not), so energy nets UP toward the burst.
    let hold: Skill | undefined;
    let holdCost = Infinity;
    for (const skill of COMBATANT_SKILLS) {
      if (skill.energyCost > me.energy) continue;
      if (skill.id === burst!.id) continue;
      const dealsNow = skill.effects.some((e) => e.kind === 'damage' || e.kind === 'multihit');
      if (!dealsNow) continue;
      if (skill.energyCost < holdCost) {
        holdCost = skill.energyCost;
        hold = skill;
      }
    }
    if (hold !== undefined) return hold;
    const guard = SKILLS.guard;
    const alreadyShielded = me.statuses.some((s) => s.kind === 'shield');
    if (guard.energyCost <= me.energy && !alreadyShielded) return guard;
  }

  // Banking not worthwhile (unaffordable-forever, no meaningful upside, or defence/finishing
  // should fire) — return the reactive pick VERBATIM (the acceptance-`toEqual` delegation
  // proof; identical to chooseSkillDefensive on the same inputs).
  return reactivePick;
}

/**
 * The player-selectable enemy DIFFICULTY (TASK-165, R-22 slice 26). A knob over enemy-AI
 * SMARTNESS, NOT a new mechanic/status (I-10's treadmill stays STOPPED) — it selects WHICH
 * already-existing byte-frozen selector the interactive enemy seam injects.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * The 4-arg enemy-selector shape shared by the whole delegation chain
 * (`chooseSkill` (wrapped) → chooseSkillMatchup → chooseSkillFinisher → chooseSkillDefensive
 * → chooseSkillBanking). All carry the two `SideState`s + the two `Combatant`s; the flat
 * `chooseSkill` reads only the first two and IGNORES the trailing pair (harmless, keeps the
 * signature uniform so a single `enemyChooser(...)` call site works for every difficulty).
 */
export type EnemyChooser = (
  me: SideState,
  them: SideState,
  meC: Combatant,
  themC: Combatant,
) => Skill;

/**
 * Map a {@link Difficulty} to an EXISTING enemy selector (TASK-165, R-22 slice 26) — a pure
 * DETERMINISTIC dispatch over the byte-frozen selector chain (NO `rng`/`Math.random`; the
 * engine's executable `Math.random` count STAYS 0). It MUTATES/RE-ORDERS nothing:
 *   - `'easy'` → the FLAT `chooseSkill` (wrapped to the 4-arg shape — it ignores `meC`/`themC`):
 *     no finisher/defensive/banking smarts, so the enemy trades into its own death and never
 *     presses a kill — a genuinely dumber opponent.
 *   - `'normal'` → `chooseSkillFinisher` (TASK-166, R-22 slice 27): presses a LETHAL skill when
 *     the PLAYER is in kill range (the slice-23 finisher smarts) but does NOT play the
 *     guard-when-cornered (slice 24) or energy-banking setup-then-burst (slice 25) that make
 *     `'hard'` so resilient — a genuinely-distinct MIDDLE opponent filling the cliff between
 *     `'easy'` (never presses a kill) and `'hard'` (finishes + guards + banks).
 *   - `'hard'` (default) → the full `chooseSkillBanking` delegation chain the enemy plays today.
 * This is the "middle tier is a trivial add-only case" move (L-63): one more literal → one more
 * ALREADY-EXISTING chooser, mutating/re-ordering NO selector — a pure DISPATCH over the frozen
 * chain. An unrecognized value falls through to the `'hard'` default (back-compat: a pre-TASK-166
 * carried state resumes byte-identically).
 */
export function chooserForDifficulty(difficulty: Difficulty): EnemyChooser {
  if (difficulty === 'easy') {
    return (me, them, _meC, _themC) => chooseSkill(me, them);
  }
  if (difficulty === 'normal') {
    return chooseSkillFinisher;
  }
  return chooseSkillBanking;
}

/**
 * The hard cap on rounds — a termination guard so an unwinnable stalemate (two
 * high-DEF, low-ATK combatants each chipping the minimum 1 per hit) can never loop
 * forever. In practice the ≥1 damage floor means a fight always decides well before
 * this; if the cap IS hit, the higher-remaining-HP side is declared the winner
 * (player wins a tie — see {@link simulateBattle}).
 */
export const MAX_ROUNDS = 50;

/**
 * Mutable per-side fight-local combat state inside {@link simulateBattle} (seeded,
 * never persisted): running `hp`, `energy`, and the generalized `statuses` collection.
 */
export interface SideState {
  hp: number;
  energy: number;
  statuses: StatusAilment[];
  /**
   * TASK-64: the set of ailment kinds THIS side has already INFLICTED on the foe (or
   * raised on itself) at least once THIS fight — fight-local scratch, never persisted,
   * never on the wire. {@link chooseSkill}'s rule 1 prefers a fresh tactical skill
   * whose ailment has NOT yet been inflicted this fight, so the AI ROTATES through the
   * full mid-tier arsenal (Frost Bite → Shock Strike → Enfeeble → Armor Break → Fire
   * Breath → …) casting each DISTINCT skill at least once before it starts re-applying
   * the highest-priority (turn-suppressing control) ailments as they expire. This is
   * what surfaces the previously-stranded skills in ONE shipped fight while keeping the
   * control lock that carries the win (GUARDRAIL 1). Purely a selection hint — it feeds
   * no HP path, so HP stays monotonically non-increasing.
   */
  inflicted: Set<StatusAilment['kind']>;
  /**
   * TASK-148 (R-22 slice 9): a REAL carried ATB accumulator. UNLIKE the display-only
   * {@link SerializedSideState.effectiveSpd} (injected post-serialize, never read back),
   * this is a live mutable field that ROUND-TRIPS through serialize/deserialize and GROWS
   * by `effectiveSpd` each INTERACTIVE turn (accrued in `DigimonService.battleTurn`). The
   * web `/battle` HUD renders it as a per-side bar that fills across turns (fill =
   * `atb ÷ ATB_THRESHOLD`, capped 100%). DELIBERATELY read by NO turn-order rule this slice
   * — `resolveTurnOrder`/`effectiveSpd`/`simulateBattle` stay byte-unchanged (invariant 5);
   * `simulateBattle` seeds it via `createFightState` but never reads/mutates it, so its
   * log/outcome are byte-identical. Turn-order AUTHORITY (threshold-consumption / double
   * turn) is a distinct heavier later wave, deliberately deferred.
   */
  atb: number;
}

/**
 * A serializable mid-fight snapshot (TASK-140, R-22). Both {@link SideState}s + the
 * scalar `round` + the resolved outcome (`decided`), everything {@link simulateBattle}
 * carries between turns. Live in-engine `FightState.inflicted` stays a `Set`; the API
 * edge serializes it to a `string[]` (see {@link SerializedFightState}) so the CLIENT
 * can carry the snapshot between interactive turns with NO server session store
 * (A-123). The stats (`maxHp`/`atk`/`def`/`spd`) are NOT here — they are the immutable
 * server-authoritative {@link Combatant}s rebuilt each turn, never trusted from the wire.
 */
export interface FightState {
  player: SideState;
  enemy: SideState;
  /**
   * TASK-272 (R-44c — team-battle interactive DRIVE): the ordered PLAYER PARTY's live
   * per-member `SideState`s, in party-slot order (≤3). ADDITIVE-OPTIONAL — present ONLY
   * when a party of >1 members is set; the FRONT/active living member is ALSO mirrored into
   * the scalar `player` field above so every pre-slice single reader (serialize, the
   * telegraph/menu/effSpd helpers, `simulateBattle`, `resolveActorTurn`) stays byte-unaffected.
   * When ABSENT (or length-1) the interactive drive is EXACTLY today's single-`player` fight
   * byte-for-byte (invariant 5 — the length-1 identity anchor). The enemy stays single (`enemy`
   * above); multi-enemy is child R-44a. The per-step drive swaps each living member's `SideState`
   * into the `player` slot before reusing the byte-frozen `resolveActorTurn` VERBATIM (the same
   * scratch-swap `simulatePartyBattle` uses). Read by NO auto-path rule — `simulateBattle` never
   * sets/reads it, so the auto path is byte-frozen.
   */
   players?: SideState[];
   /**
    * TASK-273 (R-44a — multi-enemy encounter groups): the ordered ENEMY GROUP's live per-member
    * `SideState`s, in group order (≤2). ADDITIVE-OPTIONAL — present ONLY when a group of >1 enemies
    * is fielded; the FRONT/active living enemy is ALSO mirrored into the scalar `enemy` field above
    * so every pre-slice single reader (serialize, the telegraph/menu/effSpd helpers, `simulateBattle`,
    * `resolveActorTurn`) stays byte-unaffected. When ABSENT (or length-1) the fight is EXACTLY today's
    * single-`enemy` fight byte-for-byte (invariant 5 — the length-1 identity anchor). This is the
    * SYMMETRIC mirror of {@link FightState.players}: the per-step drive swaps each acting/targeted
    * enemy's `SideState` into the `enemy` slot before reusing the byte-frozen `resolveActorTurn`
    * VERBATIM (the same scratch-swap the player-side drive uses). Read by NO auto-path rule —
    * `simulateBattle` never sets/reads it, so the auto path is byte-frozen.
    */
   enemies?: SideState[];
   round: number;
  /**
   * The resolved outcome, or `null` while the fight continues. `'win' | 'loss'`
   * are the only values ever produced by the pure engine (`simulateBattle` /
   * `resolveActorTurn`). `'fled'` is a purely ADDITIVE arm (TASK-143, R-22 slice
   * 4) produced ONLY by the interactive `DigimonService.battleTurn` flee branch —
   * NO `simulateBattle` logic assigns it — so the auto-resolve engine is
   * behaviourally BYTE-UNCHANGED (the union widens; the logic does not).
   */
  decided: 'win' | 'loss' | 'fled' | null;
  /**
   * The player-selected enemy DIFFICULTY (TASK-165, R-22 slice 26) — chooses WHICH existing
   * enemy selector the interactive seam injects (`'easy'` → flat `chooseSkill`, `'hard'` → the
   * full banking chain). Optional/additive: absent → the `'hard'` default (today's behaviour),
   * so a pre-slice carried snapshot resumes byte-identically. Read by NO auto-path rule
   * (`simulateBattle` never sets/reads it) → invariant 5 held; the auto path stays byte-frozen.
   */
  difficulty?: Difficulty;
  /**
   * TASK-168 (R-22 slice 29): the wild-enemy STRENGTH SCALE (>= 1) applied ONCE to the enemy
   * `Combatant`'s stat block at the interactive rebuild seam (`scaleEnemy`) — a dangerous biome
   * opens the fight with a tougher foe. Carried so a continuing turn rebuilds the SAME scaled
   * foe. Optional/additive: absent → the `1` identity (today's baseline block), so a pre-slice
   * carried snapshot resumes byte-identically. Read by NO auto-path rule (`simulateBattle` never
   * sets/reads it; the AUTO paths pass no scale) → invariant 5 held, the auto path byte-frozen.
   */
  enemyScale?: number;
}

/**
 * The wire form of {@link FightState}: `inflicted` flattened `Set → string[]`. This is
 * the ONLY non-JSON-serializable field; everything else round-trips as-is. Declared
 * here (and byte-mirrored on the web side) so the interactive turn route can accept a
 * client-carried snapshot (D-8 #1). It carries NO stats — those are re-derived
 * server-side each turn (invariant 5 / server-authoritative).
 */
export interface SerializedSideState {
  hp: number;
  energy: number;
  statuses: StatusAilment[];
  inflicted: string[];
  /**
   * DISPLAY-ONLY (TASK-147 / A-130 #1): the effective SPD `resolveTurnOrder` used for
   * THIS turn (`effectiveSpd(combatant, statuses)`). Optional because `serializeSideState`
   * sees only the stat-less {@link SideState} and CANNOT compute it — it is threaded in one
   * level up in {@link serializeFightState}. It is NEVER read back into a combat rule
   * (the deserializer ignores it), so turn-order LOGIC stays byte-unchanged (invariant 5).
   * Absent on any snapshot serialized without the pair (backward-compatible).
   */
  effectiveSpd?: number;
  /**
   * TASK-148 (R-22 slice 9): the CARRIED ATB accumulator (see {@link SideState.atb}). A
   * REQUIRED carried field on the round-tripped state going forward. The deserializer
   * defaults an ABSENT `atb` → `0` so an in-flight PRE-slice client snapshot still resumes
   * (backward-compat). Read by NO combat rule; the web gauge divides it by
   * {@link ATB_THRESHOLD} and caps the FILL at 100%.
   */
  atb: number;
  /**
   * DISPLAY-ONLY (TASK-149 / R-22 slice 10): `true` when THIS side crossed
   * {@link ATB_THRESHOLD} and CONSUMED it to take ONE extra action at the interactive seam
   * this turn. Like {@link SerializedSideState.effectiveSpd} it is a display flag threaded in
   * {@link serializeFightState} (the service knows it consumed) and NEVER read back — the
   * deserializer ignores it, so combat LOGIC + `simulateBattle` stay byte-unchanged
   * (invariant 5). Absent (→ falsy) on any snapshot serialized without it (backward-compat).
   * Counting log entries per actor is UNRELIABLE for this (a DoT/status tick logs an entry
   * attributed to a side without being an ACTION), so the authoritative signal is this flag.
   */
  extraActed?: boolean;
  /**
   * DISPLAY-ONLY (TASK-150 / R-22 slice 11): the COUNT of extra (bonus) actions THIS side took
   * from its banked ATB at the interactive seam this turn (`0` when none; capped at
   * {@link MAX_ATB_BONUS_ACTIONS}). Widens {@link SerializedSideState.extraActed} from a boolean
   * ("took ≥1 bonus action") to the magnitude, so the HUD can read "ATB FULL — extra action ×N!".
   * Threaded in {@link serializeFightState} like `extraActed`/`effectiveSpd` and NEVER read back
   * (the deserializer ignores it) → combat LOGIC + `simulateBattle` stay byte-unchanged
   * (invariant 5). Absent on any snapshot serialized without it (backward-compat degrades to the
   * `extraActed` boolean marker).
   */
  bonusActions?: number;
}
export interface SerializedFightState {
  player: SerializedSideState;
  enemy: SerializedSideState;
  round: number;
  /** See {@link FightState.decided} — `'fled'` is the TASK-143 additive flee arm. */
  decided: 'win' | 'loss' | 'fled' | null;
  /**
   * TASK-165 (R-22 slice 26): the carried player-selected enemy DIFFICULTY. A TOP-LEVEL peer
   * of `round`/`decided` (NOT a side field — so `deserializeFightState` picks it back up;
   * `deserializeSideState` drops unknown side fields). Optional/additive — absent on any
   * pre-slice snapshot → the `'hard'` default. Byte-mirrored on the web wire type (D-8 #1).
   */
  difficulty?: Difficulty;
  /**
   * TASK-168 (R-22 slice 29): the carried wild-enemy STRENGTH SCALE. A TOP-LEVEL peer of
   * `round`/`decided`/`difficulty` (NOT a side field — so `deserializeFightState` picks it back
   * up). Optional/additive — absent on any pre-slice snapshot → the `1` identity read-back.
   * Byte-mirrored on the web wire type (D-8 #1).
   */
  enemyScale?: number;
  /**
   * TASK-272 (R-44c — team-battle interactive DRIVE): the wire form of {@link FightState.players}
   * — each party member's live {@link SerializedSideState}, in party-slot order. A TOP-LEVEL peer
   * of `round`/`decided` (NOT a side field, so `deserializeFightState` picks it back up). Present
   * ONLY when a party of >1 members is set; OMITTED otherwise → pre-slice single readers are
   * byte-unaffected (the length-1 identity anchor). The scalar `player` above stays populated with
   * the FRONT/active member. Byte-mirrored on the web wire type (D-8 #1).
   */
   players?: SerializedSideState[];
   /**
    * TASK-273 (R-44a — multi-enemy encounter groups): the wire form of {@link FightState.enemies} —
    * each enemy group member's live {@link SerializedSideState}, in group order. A TOP-LEVEL peer of
    * `round`/`decided` (NOT a side field, so `deserializeFightState` picks it back up). Present ONLY
    * when a group of >1 enemies is fielded; OMITTED otherwise → pre-slice single readers are
    * byte-unaffected (the length-1 identity anchor). The scalar `enemy` above stays populated with the
    * FRONT/active enemy. Byte-mirrored on the web wire type (D-8 #1).
    */
   enemies?: SerializedSideState[];
 }

/** Flatten a live {@link SideState} to its wire form (`inflicted` Set → array). */
function serializeSideState(side: SideState): SerializedSideState {
  return {
    hp: side.hp,
    energy: side.energy,
    statuses: side.statuses,
    inflicted: [...side.inflicted],
    atb: side.atb,
  };
}

/**
 * Flatten a live {@link FightState} to its wire form. `effSpd` (optional, TASK-147) is
 * the pair of effective SPDs the service ALREADY computed this turn for `resolveTurnOrder`;
 * when passed it is threaded onto each side's display-only `effectiveSpd` (A-130 #1 — no new
 * computation, pure plumbing). Omitted → both sides' `effectiveSpd` stay `undefined`, keeping
 * every pre-slice caller byte-compatible.
 */
export function serializeFightState(
  state: FightState,
  effSpd?: { player: number; enemy: number },
  extraActed?: { player: boolean; enemy: boolean },
  bonusActions?: { player: number; enemy: number },
): SerializedFightState {
  const wire: SerializedFightState = {
    player: serializeSideState(state.player),
    enemy: serializeSideState(state.enemy),
    round: state.round,
    decided: state.decided,
  };
  // TASK-165 (R-22 slice 26): carry the active enemy DIFFICULTY back onto the wire so it
  // survives the client round-trip (guarded like the other optionals — absent → 'hard' on
  // read-back). No auto-path caller ever sets it, so simulateBattle stays byte-unchanged.
  if (state.difficulty !== undefined) {
    wire.difficulty = state.difficulty;
  }
  // TASK-168 (R-22 slice 29): carry the active enemy STRENGTH SCALE back onto the wire so a
  // continuing turn rebuilds the SAME scaled foe (guarded like the other optionals — absent →
  // the `1` identity on read-back). No auto-path caller sets it, so simulateBattle is unchanged.
  if (state.enemyScale !== undefined) {
    wire.enemyScale = state.enemyScale;
  }
  // TASK-272 (R-44c): carry the whole party's per-member SideStates back onto the wire so a
  // continuing turn resumes each member's live hp/energy/statuses. Guarded like the other
  // optionals — OMITTED when no party (>1) is set, so a single-member fight's wire is
  // byte-identical to today's (the length-1 identity anchor). No auto-path caller sets it.
   if (state.players !== undefined) {
     wire.players = state.players.map((member) => serializeSideState(member));
   }
   // TASK-273 (R-44a): carry the whole enemy group's per-member SideStates back onto the wire so a
   // continuing turn resumes each enemy's live hp/energy/statuses. Guarded like `players` — OMITTED
   // when no group (>1) is fielded, so a single-enemy fight's wire is byte-identical to today's (the
   // length-1 identity anchor). No auto-path caller sets it.
   if (state.enemies !== undefined) {
     wire.enemies = state.enemies.map((member) => serializeSideState(member));
   }
  if (effSpd) {
    wire.player.effectiveSpd = effSpd.player;
    wire.enemy.effectiveSpd = effSpd.enemy;
  }
  // TASK-149: thread the display-only "took an ATB bonus action this turn" flags (the
  // service knows which sides consumed the threshold). Never read back (deserializer ignores
  // it) → combat logic + simulateBattle stay byte-unchanged. Omitted → both stay undefined.
  if (extraActed) {
    wire.player.extraActed = extraActed.player;
    wire.enemy.extraActed = extraActed.enemy;
  }
  // TASK-150: thread the display-only per-side COUNT of bonus actions taken (the magnitude of
  // the ATB payoff — how many thresholds the side drained this turn). Never read back (the
  // deserializer ignores it) → combat logic + simulateBattle stay byte-unchanged. Omitted →
  // both stay undefined (HUD degrades to the extraActed boolean marker).
  if (bonusActions) {
    wire.player.bonusActions = bonusActions.player;
    wire.enemy.bonusActions = bonusActions.enemy;
  }
  return wire;
}

/** Rehydrate a wire {@link SerializedSideState} into a live {@link SideState}. */
function deserializeSideState(side: SerializedSideState): SideState {
  return {
    hp: side.hp,
    energy: side.energy,
    statuses: side.statuses,
    inflicted: new Set(side.inflicted as StatusAilment['kind'][]),
    // TASK-148: default an ABSENT `atb` → 0 so a pre-slice in-flight snapshot resumes.
    atb: side.atb ?? 0,
  };
}

/** Rehydrate a wire {@link SerializedFightState} into a live {@link FightState}. */
export function deserializeFightState(state: SerializedFightState): FightState {
  return {
    player: deserializeSideState(state.player),
    enemy: deserializeSideState(state.enemy),
    round: state.round,
    decided: state.decided,
    // TASK-165: default an ABSENT `difficulty` → 'hard' so a pre-slice carried snapshot (and
    // any state serialized without a difficulty) resumes as the full banking chain = today's
    // behaviour (the whole back-compat story — no migration/version flag).
    difficulty: state.difficulty ?? 'hard',
    // TASK-168: default an ABSENT `enemyScale` → 1 (the identity, `scaleEnemy` returns the
    // roster block verbatim) so a pre-slice carried snapshot resumes byte-identically — the
    // whole back-compat story (no migration/version flag).
    enemyScale: state.enemyScale ?? 1,
    // TASK-272 (R-44c): rehydrate the whole party's per-member SideStates when carried; OMITTED
    // (→ undefined) on a single-member/pre-slice snapshot so the interactive drive collapses to
    // today's single-`player` fight byte-for-byte (the length-1 identity anchor).
     ...(state.players !== undefined
       ? { players: state.players.map((member) => deserializeSideState(member)) }
       : {}),
     // TASK-273 (R-44a): rehydrate the whole enemy group's per-member SideStates when carried;
     // OMITTED (→ undefined) on a single-enemy/pre-slice snapshot so the fight collapses to today's
     // single-`enemy` fight byte-for-byte (the length-1 identity anchor).
     ...(state.enemies !== undefined
       ? { enemies: state.enemies.map((member) => deserializeSideState(member)) }
       : {}),
   };
}

/**
 * Seed a fresh {@link FightState} for a new fight (TASK-140). Same initial seeding
 * {@link simulateBattle} uses inline — both sides at full HP, `MAX_ENERGY`, no
 * statuses, nothing inflicted, `round: 1`, undecided.
 */
export function createFightState(
  player: Combatant,
  enemy: Combatant,
  difficulty: Difficulty = 'hard',
  // TASK-168 (R-22 slice 29): the wild-enemy STRENGTH SCALE to CARRY (the enemy block passed in
  // is ALREADY scaled by the caller via `scaleEnemy` before seeding — this only records the
  // factor so a continuing turn rebuilds the same scaled foe). Appended AFTER `difficulty` with
  // a back-compat default of `1` so every current caller (auto paths, all fixtures) is unchanged.
  enemyScale: number = 1,
): FightState {
  return {
    player: {
      hp: player.hp,
      energy: MAX_ENERGY,
      statuses: [],
      inflicted: new Set<StatusAilment['kind']>(),
      atb: 0,
    },
    enemy: {
      hp: enemy.hp,
      energy: MAX_ENERGY,
      statuses: [],
      inflicted: new Set<StatusAilment['kind']>(),
      atb: 0,
    },
    round: 1,
    decided: null,
    // TASK-165: seed the active enemy DIFFICULTY from the opening request (defaults to 'hard'
    // — today's full-banking enemy — so every pre-slice caller is byte-unchanged).
    difficulty,
    // TASK-168: record the enemy STRENGTH SCALE so a continuing turn rebuilds the same scaled
    // foe (defaults to 1 = the baseline block, so every pre-slice caller is byte-unchanged).
    enemyScale,
  };
}

/**
 * TASK-272 (R-44c — team-battle interactive DRIVE): seed a fresh interactive {@link FightState}
 * whose PLAYER side is an ordered party of ≤3 members (vs the single enemy). The FRONT member is
 * ALSO mirrored into the scalar `player` field (the identity anchor every pre-slice single reader
 * uses). For a length-1 party this is EXACTLY {@link createFightState} byte-for-byte — same seed,
 * `players` holding the one member which IS `player` — so the single-member interactive path is
 * unchanged (invariant 5). The per-member seeds mirror `createFightState`/`simulatePartyBattle`
 * (full HP, `MAX_ENERGY`, no statuses/inflicted, `atb: 0`).
 */
 export function createPartyFightState(
   party: Combatant[],
   enemy: Combatant,
   difficulty: Difficulty = 'hard',
   enemyScale: number = 1,
   // TASK-273 (R-44a — multi-enemy encounter groups): the ordered ENEMY GROUP (≤2) the fight faces.
   // ADDITIVE/trailing — absent (or length ≤1) keeps the single-`enemy` seed byte-for-byte (the
   // length-1 identity anchor), so every existing caller/fixture is unchanged. When >1, the FRONT
   // enemy is ALSO mirrored into the scalar `enemy` slot (same reference held in `enemies[0]`), so
   // every pre-slice single reader sees the active enemy. The `enemy` Combatant passed in MUST be the
   // FRONT enemy's stat block (the caller scales/builds it), mirroring the player-side `party[0]`.
   enemyGroup?: Combatant[],
 ): FightState {
   const members: SideState[] = party.map((member) => ({
     hp: member.hp,
     energy: MAX_ENERGY,
     statuses: [],
     inflicted: new Set<StatusAilment['kind']>(),
     atb: 0,
   }));
   // Symmetric enemy-group seed: build a live SideState per enemy member. A single/absent group
   // collapses to just the scalar `enemy` (no `enemies` field) — the identity path.
   const enemyMembers: SideState[] | undefined =
     enemyGroup !== undefined && enemyGroup.length > 1
       ? enemyGroup.map((member) => ({
           hp: member.hp,
           energy: MAX_ENERGY,
           statuses: [] as StatusAilment[],
           inflicted: new Set<StatusAilment['kind']>(),
           atb: 0,
         }))
       : undefined;
   return {
     // The scalar `player` IS the front member's SideState (same reference held in `players[0]`),
     // so every pre-slice single reader (serialize/menu/telegraph/effSpd) sees the active member.
     player: members[0],
     // The scalar `enemy` IS the FRONT enemy's SideState (same reference held in `enemies[0]` when a
     // group is set) — the identity anchor every pre-slice single reader uses.
     enemy: enemyMembers !== undefined
       ? enemyMembers[0]
       : {
           hp: enemy.hp,
           energy: MAX_ENERGY,
           statuses: [],
           inflicted: new Set<StatusAilment['kind']>(),
           atb: 0,
         },
     round: 1,
     decided: null,
     difficulty,
     enemyScale,
     players: members,
     ...(enemyMembers !== undefined ? { enemies: enemyMembers } : {}),
   };
 }

/**
 * TASK-272 (R-44c — team-battle interactive DRIVE): resolve ONE interactive party EXCHANGE — the
 * multi-member per-STEP analogue of the service's single-`player` exchange loop, built ON the
 * byte-frozen {@link resolveActorTurn} via the SAME scratch-`FightState`/`SideState`-swap
 * {@link simulatePartyBattle} uses. One request drives ONE exchange: the SPECIFIED acting member
 * (`actingSlot`, default the front living member) casts `chosenForActing`; every OTHER living
 * member casts the server-authoritative default `selectDefault`; the enemy replies targeting the
 * FRONT living member. Members act in deterministic SPD-desc order (players-before-enemy then
 * party-slot tie-break, NO RNG). The fight ends when ALL members are down (loss) or the enemy is
 * down (win). MUTATES `state.players`/`state.enemy`/`state.round`/`state.decided` and APPENDS to
 * `turns`; keeps `state.player` pointed at the current front living member (the identity anchor).
 *
 * The length-1 (single-member) path is byte-identical to today's single-`player` exchange: the
 * lone member IS `player`, ranks in the same 2-element order, is always the front target, and the
 * termination reduces to `enemy.hp<=0`/`player.hp<=0` — so every pinned fixture stays green with
 * NO re-pin. RNG-free (`Math.random` STAYS 0); A-42 held (every HP write inside `resolveActorTurn`
 * clamps `max(0,…)`, no heal introduced). The enemy stays single (multi-enemy is child R-44a);
 * target selection is deterministic front-living (menu-picked target is child R-44b).
 */
 export function resolveInteractivePartyExchange(
   state: FightState,
   party: Combatant[],
   enemy: Combatant,
   actingSlot: number,
   chosenForActing: Skill,
   selectDefault: (me: SideState, them: SideState, combatant: Combatant) => Skill,
   enemySelect: (me: SideState, them: SideState) => Skill,
   turns: TurnLogEntry[],
   rng: Rng = DEFAULT_RNG,
   // TASK-273 (R-44a — multi-enemy encounter groups): the ordered ENEMY GROUP's Combatant stat
   // blocks (≤2), in group order — the SYMMETRIC mirror of `party`. ADDITIVE/trailing — absent (or
   // length ≤1) keeps the single-`enemy` drive byte-for-byte (the length-1 identity anchor), so
   // every existing caller/fixture is unchanged. When >1, `enemy` above MUST be `enemyGroup[0]` (the
   // front enemy) and `state.enemies` MUST hold each member's live SideState. Each living enemy acts
   // (targeting the front-living player member) and can BE targeted (the player hits the front-living
   // enemy); the enemy side loses only when ALL enemies are down.
    enemyGroup?: Combatant[],
    // TASK-274 (R-44b first slice — per-member PICKED enemy target): the 0-based living-enemy index
    // the ACTING player member (`actingSlot`) targets THIS turn. ADDITIVE/trailing — absent/undefined
    // (or invalid: out-of-range / dead / negative) falls back to `frontLivingEnemy()` verbatim (the
    // TASK-273 behaviour = the invariant-5 identity anchor), so every existing caller/fixture is
    // byte-unchanged. Only the acting player member honours it; every other member + every enemy turn
    // still target the deterministic front-living foe. Server-validated upstream, never trusted raw.
    targetEnemyIdx?: number,
  ): void {
   const members = state.players ?? [state.player];
   // The enemy side is a LIST when a group (>1) is fielded, else the single scalar `enemy` state.
   const enemyStates = state.enemies ?? [state.enemy];
   const enemyCombatants = enemyGroup !== undefined && enemyGroup.length > 1 ? enemyGroup : [enemy];

   const livingPlayerIdx = (): number[] =>
     members.map((s, i) => (s.hp > 0 ? i : -1)).filter((i) => i >= 0);
   const frontLiving = (): number => {
     const alive = livingPlayerIdx();
     return alive.length > 0 ? alive[0] : -1;
   };
   const allPlayersDown = (): boolean => members.every((s) => s.hp <= 0);
   const livingEnemyIdx = (): number[] =>
     enemyStates.map((s, i) => (s.hp > 0 ? i : -1)).filter((i) => i >= 0);
   // The FRONT living enemy — lowest group index still alive (the deterministic player-target rule,
   // the symmetric mirror of `frontLiving`). For a length-1 group this is always index 0.
   const frontLivingEnemy = (): number => {
     const alive = livingEnemyIdx();
     return alive.length > 0 ? alive[0] : -1;
   };
   const allEnemiesDown = (): boolean => enemyStates.every((s) => s.hp <= 0);
   // Keep the scalar mirrors pointed at the current front living member/enemy (identity anchors), so
   // every pre-slice single reader (serialize/menu/telegraph) sees the active fighter on each side.
   const syncFront = (): void => {
     const front = frontLiving();
     if (front >= 0) state.player = members[front];
     const frontE = frontLivingEnemy();
     if (frontE >= 0) state.enemy = enemyStates[frontE];
   };

   // Build this exchange's interleaved action queue: every LIVING player member + every LIVING enemy,
   // ranked by effective SPD desc; ties → players before enemies, then slot order (deterministic, NO
   // RNG — identical to simulatePartyBattle's per-round ordering). For a length-1 party + length-1
   // enemy this is the same 2-element [player, enemy]/[enemy, player] order resolveTurnOrder produces.
   type Actor = { side: 'player'; idx: number } | { side: 'enemy'; idx: number };
   const queue: Actor[] = [
     ...livingPlayerIdx().map((idx) => ({ side: 'player' as const, idx })),
     ...livingEnemyIdx().map((idx) => ({ side: 'enemy' as const, idx })),
   ];
   const spdOf = (a: Actor): number =>
     a.side === 'enemy'
       ? effectiveSpd(enemyCombatants[a.idx], enemyStates[a.idx].statuses)
       : effectiveSpd(party[a.idx], members[a.idx].statuses);
   const rankOf = (a: Actor): number =>
     a.side === 'player' ? a.idx : party.length + 1 + a.idx;
   queue.sort((a, b) => {
     const ds = spdOf(b) - spdOf(a);
     if (ds !== 0) return ds;
     return rankOf(a) - rankOf(b);
   });

   for (const actor of queue) {
     if (state.decided !== null) break;
     if (actor.side === 'player' && members[actor.idx].hp <= 0) continue;
     if (actor.side === 'enemy' && enemyStates[actor.idx].hp <= 0) continue;

      if (actor.side === 'player') {
        // The acting player member targets the front living enemy by default (deterministic), UNLESS a
        // valid picked target is supplied for THIS acting member (TASK-274). Swap that enemy's live
        // SideState + stats into the scratch `enemy` slot.
        let targetE = frontLivingEnemy();
        // Honour the per-member picked target ONLY for the ACTING member, and ONLY when it is a number
        // in range of `enemyStates` pointing at a LIVING enemy; otherwise front-living fallback verbatim
        // (the identity anchor — an absent/invalid pick reproduces TASK-273 byte-for-byte).
        if (
          actor.idx === actingSlot &&
          typeof targetEnemyIdx === 'number' &&
          Number.isInteger(targetEnemyIdx) &&
          targetEnemyIdx >= 0 &&
          targetEnemyIdx < enemyStates.length &&
          enemyStates[targetEnemyIdx].hp > 0
        ) {
          targetE = targetEnemyIdx;
        }
        if (targetE < 0) {
         state.decided = 'win';
         break;
       }
       const me = members[actor.idx];
       const work: FightState = {
         player: me,
         enemy: enemyStates[targetE],
         round: state.round,
         decided: null,
       };
       const combatant = { player: party[actor.idx], enemy: enemyCombatants[targetE] };
       // The specified acting member casts the player's pick; every OTHER living member casts the
       // server-authoritative default (the same `chooseSkill` the enemy/timeout paths use).
       const select: (m: SideState, t: SideState) => Skill =
         actor.idx === actingSlot
           ? () => chosenForActing
           : (m, t) => selectDefault(m, t, party[actor.idx]);
       const res = resolveActorTurn(work, 'player', combatant, select, turns, rng);
       if (res.decided === 'win' && allEnemiesDown()) state.decided = 'win';
       else if (res.decided === 'loss' && allPlayersDown()) state.decided = 'loss';
     } else {
       // The acting enemy targets the FRONT living player member. Swap that member's live SideState +
       // stats into the scratch `player` slot; the acting enemy is itself the `enemy` side.
       const target = frontLiving();
       if (target < 0) {
         state.decided = 'loss';
         break;
       }
       const me = members[target];
       const work: FightState = {
         player: me,
         enemy: enemyStates[actor.idx],
         round: state.round,
         decided: null,
       };
       const combatant = { player: party[target], enemy: enemyCombatants[actor.idx] };
       const res = resolveActorTurn(work, 'enemy', combatant, enemySelect, turns, rng);
       if (res.decided === 'win' && allEnemiesDown()) state.decided = 'win';
       else if (res.decided === 'loss' && allPlayersDown()) state.decided = 'loss';
     }

     if (state.decided === null && allPlayersDown()) state.decided = 'loss';
     if (state.decided === null && allEnemiesDown()) state.decided = 'win';
     syncFront();
   }

   if (state.decided === null) state.round += 1;
   syncFront();
 }

/**
 * Resolve ONE discrete damage STRIKE from `attacker` into `defender` — the shared
 * damage-application core (TASK-58) used identically by BOTH the single-hit `damage`
 * effect and each strike of a `multihit`. PURE-ish: it MUTATES the defender's
 * fight-local `them.hp` and its active shield pool (the mutable scratch statuses),
 * exactly as the inline single-hit path did before, then returns the HP `overflow`
 * dealt + any shield `statusEvents`. Factoring this out is what guarantees a
 * multi-hit's strikes behave BYTE-IDENTICALLY to a single `damage` hit (same
 * resolveAttack → shield-absorb-before-HP → monotonic `max(0, hp − dmg)` write), so
 * shield/overflow/Weaken/Empower behaviour stays regression-safe and HP stays
 * monotonically non-increasing (every strike only ever SUBTRACTS HP).
 */
function resolveDamageStrike(
  me: SideState,
  them: SideState,
  attacker: Combatant,
  defender: Combatant,
  rng: Rng = DEFAULT_RNG,
): { overflow: number; statusEvents: string[]; crit: boolean; evaded: boolean } {
  const statusEvents: string[] = [];
  // Read the defender's active WEAKEN (if any) so a weakened target takes more damage
  // (TASK-54); read the ATTACKER's own active EMPOWER so an empowered attacker hits
  // harder (TASK-56). Each strike reads them LIVE, so a multi-hit into a weakened
  // defender / while empowered deals the buffed damage on every strike.
  const foeWeaken = them.statuses.find((s) => s.kind === 'weaken');
  const defReduction = foeWeaken?.kind === 'weaken' ? foeWeaken.defReduction : 0;
  // Crumble / weaken-percent (TASK-100) — the fractional MIRROR of the FIXED weaken read
  // above (which stays BYTE-UNCHANGED). If the defender carries a `weaken-percent` arm, ADD
  // floor(def * defReductionRatio) of its CURRENT def to the effective-DEF reduction. It is
  // ADDITIVE with the fixed weaken (they never co-occur in-sim under Posture-B; if both were
  // present the two reductions sum). resolveAttack clamps effectiveDef at MIN_EFFECTIVE_DEF,
  // so even a large percent reduction can never invert floor(def/2) — HP-monotone (A-42).
  const foeWeakenPercent = them.statuses.find((s) => s.kind === 'weaken-percent');
  // Fortify (TASK-108) — the DEF-up SELF-BUFF on the DEFENDER (`them`), the exact SELF-BUFF MIRROR of
  // the DEF-DOWN `weaken` read above (and the DEF-axis twin of empower on the attacker side below). A
  // def-BONUS is a NEGATIVE reduction: SUBTRACT its `defBonus` from netDefReduction, so resolveAttack
  // computes def − (netDefReduction − defBonus) = def + defBonus — a fortified defender takes LESS
  // damage. resolveAttack clamps effectiveDef at MIN_EFFECTIVE_DEF and floors damage at ≥1, and a
  // def-BONUS only RAISES effectiveDef, so it can never invert the mitigation term — HP-monotone
  // (A-42). When no fortify is present (every existing fight state) the term is 0 → byte-identical.
  const themFortify = them.statuses.find((s) => s.kind === 'fortify');
  const fortifyDefBonus = themFortify?.kind === 'fortify' ? themFortify.defBonus : 0;
  // Aegis / fortify-percent (TASK-111) — the PERCENTAGE DEF-UP SELF-BUFF on the DEFENDER (`them`), the
  // fractional MIRROR of the FLAT `fortify` read above and the DEF-UP percent twin of the DEBUFF
  // `weaken-percent` read above (both of which stay BYTE-UNCHANGED). Like fortify, a def-BONUS is a
  // NEGATIVE reduction: SUBTRACT floor(def × defBonusRatio) — the SAME floor(def × ratio) transform
  // weaken-percent ADDS, but with opposite sign — so resolveAttack computes a HIGHER effective DEF and
  // the strike deals proportionally LESS. resolveAttack clamps effectiveDef at MIN_EFFECTIVE_DEF and
  // floors damage at ≥1, and a def-BONUS only RAISES effectiveDef, so it can never invert the mitigation
  // term — HP-monotone (A-42). When no fortify-percent is present (every existing fight state) the term
  // is 0 → byte-identical (invariant 5).
  const themFortifyPercent = them.statuses.find((s) => s.kind === 'fortify-percent');
  const fortifyPercentDefBonus =
    themFortifyPercent?.kind === 'fortify-percent'
      ? Math.floor(defender.def * themFortifyPercent.defBonusRatio)
      : 0;
  const netDefReduction =
    (foeWeakenPercent?.kind === 'weaken-percent'
      ? defReduction + Math.floor(defender.def * foeWeakenPercent.defReductionRatio)
      : defReduction) -
    fortifyDefBonus -
    fortifyPercentDefBonus;
  const myEmpower = me.statuses.find((s) => s.kind === 'empower');
  const fixedAtkBonus = myEmpower?.kind === 'empower' ? myEmpower.atkBonus : 0;
  // Reinforce / empower-percent (TASK-102) — the fractional MIRROR of the FIXED empower read above
  // (which stays BYTE-UNCHANGED), the ATK-BONUS (self-buff) twin of the enfeeble-percent seam. If the
  // ATTACKER carries an `empower-percent` arm, ADD floor(attacker.atk * atkBonusRatio) of its CURRENT
  // atk to the effective-ATK bonus. It is ADDITIVE with the fixed empower (they never co-occur in-sim
  // under Posture-B; if both were present the two bonuses sum). resolveAttack floors damage at ≥1, so
  // the larger bonus can never produce invalid damage. An ATK-bonus self-buff removes NO HP — it only
  // sharpens the caster's hits, so HP stays monotone (A-42). When no empower-percent is present (every
  // existing fight state) the added term is 0 → byte-identical.
  const myEmpowerPercent = me.statuses.find((s) => s.kind === 'empower-percent');
  const atkBonus =
    myEmpowerPercent?.kind === 'empower-percent'
      ? fixedAtkBonus + Math.floor(attacker.atk * myEmpowerPercent.atkBonusRatio)
      : fixedAtkBonus;
  // Read the ATTACKER's own active ENFEEBLE (TASK-63) — the OFFENSIVE-ATK mirror of
  // Weaken: an enfeebled attacker's outgoing damage is CUT. The net ATK modifier
  // (empower bonus MINUS enfeeble reduction) is threaded into the SAME 4th positional
  // arg resolveAttack already takes; resolveAttack clamps the net at MIN_EFFECTIVE_ATK
  // so a large reduction can never invert the ATK term. When no enfeeble is present
  // (every existing fight state) atkReduction is 0 → the term is byte-identical.
  const myEnfeeble = me.statuses.find((s) => s.kind === 'enfeeble');
  const fixedAtkReduction = myEnfeeble?.kind === 'enfeeble' ? myEnfeeble.atkReduction : 0;
  // Sunder / enfeeble-percent (TASK-101) — the fractional MIRROR of the FIXED enfeeble read
  // above (which stays BYTE-UNCHANGED), the ATK-side twin of the weaken-percent seam. If the
  // ATTACKER carries an `enfeeble-percent` arm, ADD floor(attacker.atk * atkReductionRatio) of
  // its CURRENT atk to the effective-ATK reduction. It is ADDITIVE with the fixed enfeeble (they
  // never co-occur in-sim under Posture-B; if both were present the two reductions sum).
  // resolveAttack clamps the net ATK modifier at MIN_EFFECTIVE_ATK and floors damage at ≥1, so
  // even a large percent reduction can never invert the ATK term — HP-monotone (A-42). When no
  // enfeeble-percent is present (every existing fight state) the added term is 0 → byte-identical.
  const myEnfeeblePercent = me.statuses.find((s) => s.kind === 'enfeeble-percent');
  const atkReduction =
    myEnfeeblePercent?.kind === 'enfeeble-percent'
      ? fixedAtkReduction + Math.floor(attacker.atk * myEnfeeblePercent.atkReductionRatio)
      : fixedAtkReduction;
  const base = resolveAttack(attacker, defender, netDefReduction, atkBonus - atkReduction);
  // Read the DEFENDER's active VULNERABLE (TASK-65) and AMPLIFY the base strike by it
  // (the damage-AMP inverse of the Weaken/Enfeeble mitigation debuffs — a vulnerable
  // defender takes MORE damage on EVERY incoming strike). Applied HERE, AFTER the
  // type/element/DEF math in resolveAttack and BEFORE the shield-absorb, via the pure
  // exported {@link amplifyForVulnerable}. When no vulnerable is present (every existing
  // fight state) it is the identity → `raw` is byte-identical to before (invariant 5).
  const raw = amplifyForVulnerable(base, them.statuses);
  // TASK-159 (R-22 slice 20): the CRITICAL-HIT roll — the SECOND injected-RNG consumer.
  // A crit MULTIPLIES the finalized pre-shield strike by CRIT_MULT. Applied HERE, AFTER
  // amplifyForVulnerable so vulnerable + crit COMPOSE predictably, and BEFORE the
  // shield-absorb so a crit chews through more of the shield too. The roll consumes the
  // INJECTED `rng` (default DEFAULT_RNG = () => 0, whose critRoll is FALSE) so the auto
  // path (simulateBattle/simulateBattleAtb) and the production interactive callsite NEVER
  // crit — every pinned fixture stays byte-identical (invariant 5). A crit only ever
  // INCREASES damage (CRIT_MULT >= 1) → HP stays monotonically non-increasing (A-42 HELD).
  const crit = critRoll(rng);
  // TASK-160 (R-22 slice 21): the EVADE / MISS roll — the THIRD injected-RNG consumer,
  // crit's direct MIRROR-IMAGE on THIS same seam (crit multiplies damage UP; evade
  // zeroes it DOWN). The roll consumes the SAME already-threaded INJECTED `rng` (default
  // DEFAULT_RNG = () => 0, whose evadeRoll is FALSE) so the auto path
  // (simulateBattle/simulateBattleAtb) and the production interactive callsite NEVER
  // evade — every pinned fixture stays byte-identical (invariant 5). An evade DOMINATES
  // crit (a miss is a miss regardless of crit): when `evaded`, the finalized pre-shield
  // strike is forced to 0, so `overflow === 0` at the HP-write below and `them.hp` is
  // untouched — and the downstream overflow-keyed hooks (wake, reflect) no-op naturally,
  // NO new branch needed. An evade only ever DECREASES damage to 0 → HP stays
  // monotonically non-increasing (A-42 HELD even more strongly than crit).
  const evaded = evadeRoll(rng);
  const critRaw = evaded ? 0 : crit ? Math.floor(raw * CRIT_MULT) : raw;
  // Drain the defender's active SHIELD before HP (TASK-55): only the OVERFLOW reaches
  // HP. `raw` is already ≥1-floored, so a fully-absorbed strike yields overflow 0 and
  // removes NO HP (the floor is NOT re-applied to the overflow → HP stays monotone).
  // TASK-131 — GENERALIZED to EITHER shield-family arm: a flat `shield` OR a maxHp-fraction
  // `shield-percent` (whichever the defender carries) drains through the SAME seam. The `shield`-first
  // preference keeps the existing flat-shield path byte-identical when only a flat shield is present.
  const foeShield = them.statuses.find((s) => s.kind === 'shield' || s.kind === 'shield-percent');
  const isShield = foeShield?.kind === 'shield' || foeShield?.kind === 'shield-percent';
  const { absorbed, overflow, shieldBroke } = absorbWithShield(
    critRaw,
    isShield ? foeShield : undefined,
  );
  if (isShield && foeShield !== undefined && absorbed > 0) {
    foeShield.absorbRemaining -= absorbed;
    if (shieldBroke) {
      them.statuses = them.statuses.filter((s) => s.kind !== foeShield.kind);
      statusEvents.push(`${defender.name}'s shield breaks`);
    } else {
      statusEvents.push(`${defender.name}'s shield absorbs ${absorbed}`);
    }
  }
  them.hp = Math.max(0, them.hp - overflow);
  // TASK-60: WAKE-ON-DAMAGE — the INTERRUPTIBLE early clear (the genuinely NEW shape),
  // via the shared pure {@link wakeSleeperOnDamage} helper. A strike that deals HP
  // damage (overflow > 0) to a SLEEPING defender REMOVES its `sleep` arm before its
  // natural expiry and notes it against THIS striker's turn entry (the wake is caused
  // by the incoming hit, so it rides the ATTACKER's turn, NOT the sleeper's own
  // skipped-turn entry). Done in the ONE shared damage/HP-write site so EVERY damage
  // path (single hit, each multi-hit strike, a composite's damage half) wakes a sleeper
  // uniformly; a fully-absorbed / non-damaging strike (overflow 0) does NOT wake it (HP
  // stays monotone — the wake only removes the ailment, never adds HP). A-48.
  const wake = wakeSleeperOnDamage(them.statuses, overflow);
  if (wake.woke) {
    them.statuses = wake.statuses;
    statusEvents.push(`${defender.name} is jolted awake`);
  }
  // TASK-69: REACTIVE RETALIATE (Thorns) — the FIRST on-being-hit payoff, at the ONE
  // shared HP-write site (alongside the Sleep wake hook), via the pure
  // {@link reflectRetaliation} helper. If the DEFENDER (`them`) carries an active
  // `retaliate` AND this strike dealt REAL HP damage (overflow > 0), the ATTACKER (`me`)
  // takes the FIXED reflectDamage — routed through the SAME `hp = max(0, hp − X)` write
  // path (≥ 0 floor), so HP stays monotonically non-increasing (A-42; it only ever
  // SUBTRACTS the attacker's HP, never heals). Placed at the shared site so EVERY damage
  // path (single hit / each multi-hit strike / a composite's damage half) reflects
  // uniformly; a fully-absorbed / non-damaging strike (overflow 0, e.g. behind a Shield)
  // triggers NO reflect. The note rides THIS striker's turn entry (the reflect is caused
  // by the incoming hit, so it belongs to the attacker's action, like the wake note).
  const { reflect } = reflectRetaliation(them.statuses, overflow);
  if (reflect > 0) {
    me.hp = Math.max(0, me.hp - reflect);
    statusEvents.push(`${defender.name} retaliates for ${reflect}`);
  }
  return { overflow, statusEvents, crit, evaded };
}

/**
 * Simulate the WHOLE encounter deterministically and return the player-perspective
 * outcome + the ordered turn log. PURE (no I/O, no RNG): given the same two
 * combatants it always returns the same result, which is what makes the e2e exact.
 *
 * Each round both sides act in SPD order (higher `spd` first; a tie → the player
 * acts first, a small deterministic edge to the human). On its turn a combatant:
 *  1. REGENs {@link ENERGY_REGEN_PER_TURN} energy (clamped to {@link MAX_ENERGY}).
 *  2. Ticks EVERY active ailment (Burn, Poison — TASK-53) in {@link AILMENT_TICK_ORDER},
 *     each a {@link BURN_DAMAGE_PER_TURN}/{@link POISON_DAMAGE_PER_TURN} tick recorded
 *     as its own log entry; a tick that drops the side to ≤ 0 ENDS the fight (the
 *     afflicted side loses / the other side wins) before it can act.
 *  3. SELECTS a skill by {@link selectSkill} (Fire Breath if affordable, else the
 *     cheaper Poison Sting, else Attack), SPENDS its energy, and applies each composite effect in order — a
 *     Damage effect deals {@link resolveAttack} damage, a Burn effect applies/
 *     refreshes Burn on the defender. The action is one {@link TurnLogEntry}
 *     carrying `skill` (the name) + any `statusEvents`.
 *  If the action drops the defender to ≤ 0 we STOP immediately (no dead-man's
 *  retaliation). Rounds repeat until one side is down or {@link MAX_ROUNDS}; on the
 *  cap, higher remaining HP wins (player wins ties).
 *
 * ENERGY, BURN and SKILL state are all FIGHT-LOCAL here — nothing persists.
 * `playerHpRemaining` is clamped ≥ 0 so the wire never shows negative HP.
 */
export function simulateBattle(player: Combatant, enemy: Combatant): BattleResult {
  // Per-side mutable fight-local state (seeded, never persisted). `statuses` is the
  // generalized ailment collection (TASK-53) — replaces the single `burn` field;
  // at most one entry per kind (re-apply refreshes in place).
  const state: FightState = {
    player: {
      hp: player.hp,
      energy: MAX_ENERGY,
      statuses: [] as StatusAilment[],
      inflicted: new Set<StatusAilment['kind']>(),
      // TASK-148: seeded 0 to satisfy SideState. simulateBattle never reads/mutates `atb`,
      // so its log/outcome/win-loss stay byte-identical (invariant 5) — the accumulator is
      // grown ONLY on the interactive path (digimon.service.battleTurn).
      atb: 0,
    },
    enemy: {
      hp: enemy.hp,
      energy: MAX_ENERGY,
      statuses: [] as StatusAilment[],
      inflicted: new Set<StatusAilment['kind']>(),
      atb: 0,
    },
    round: 1,
    decided: null,
  };
  const combatant = { player, enemy };
  const turns: TurnLogEntry[] = [];

  let round = 1;
  let decided: 'win' | 'loss' | null = null;

  for (; round <= MAX_ROUNDS && decided === null; round += 1) {
    // Per-round action order by EFFECTIVE SPD (ties favour the player), recomputed at the TOP of each
    // round from the pure effectiveSpd read helper (TASK-116, R-17c wave 65) — the FIRST true
    // turn-order-re-ordering consumption of the SPD stat-mod axis. This CONSUMES the four shipped SPD
    // arms (hasten/hasten-percent/hobble/hobble-percent) at the turn-order seam for the first time
    // (A-99 is now satisfied): a side carrying hobble/hobble-percent can LOSE the initiative it held by
    // raw spd, and hasten/hasten-percent can GAIN it. The recompute is at ROUND TOP ONLY — NOT
    // per-action, NOT mid-round (that is the A-99/TASK-60/L-22 hazard, a separate deferred wave).
    // Because ALL SPD skills are above-pool (Posture-B, never cast in-sim), the shipped fights carry
    // ZERO SPD statuses every round, so effectiveSpd(c, c.statuses) === c.spd and this per-round order
    // equals the old once-before-loop raw-spd order EXACTLY → shipped fights + log stay byte-identical.
    //
    // TASK-118 (R-17c wave 67) — WIRE the per-action DOUBLE-TURN (TASK-117's resolveActionSequence)
    // into the round-top order behind a Posture-B-safe SPD-STATUS gate. When either side currently
    // carries an SPD status (hasSpdStatus), the order source becomes the 2-OR-3-element action
    // SEQUENCE (a fast-enough SPD-buffed side gets [fast, slow, fast] — a SECOND action, observable
    // in the log); otherwise it stays the plain 2-element resolveTurnOrder order, BYTE-IDENTICAL to
    // before. The gate keys on SPD-status PRESENCE, not raw spd, so it is ALWAYS FALSE in the shipped
    // fights (they never accumulate an SPD status — the above-pool pricing) → shipped WIN/LOSS fights
    // + logs + HP-monotonicity (A-42) + determinism stay byte-identical BY CONSTRUCTION, NOT by stat
    // coincidence. The actor loop below is UNCHANGED — it already iterates whatever `order` it is
    // handed; the double-turn is realized purely by `order` being a 3-element array this round. The
    // mid-sequence per-action KO guard (`them.hp <= 0` → break) and death-by-tick guard both break the
    // WHOLE actor loop, so a KO'd side never takes its second entry (A-42 termination safe: an extra
    // action is HP-REDUCING only, bounded by MAX_ROUNDS + the HP tie-break).
    const pEff = effectiveSpd(player, state.player.statuses);
    const eEff = effectiveSpd(enemy, state.enemy.statuses);
    const order: ('player' | 'enemy')[] =
      hasSpdStatus(state.player.statuses) || hasSpdStatus(state.enemy.statuses)
        ? resolveActionSequence(pEff, eEff)
        : resolveTurnOrder(pEff, eEff);
    for (const actor of order) {
      state.round = round;
      const outcome = resolveActorTurn(state, actor, combatant, chooseSkill, turns);
      if (outcome.decided !== null) {
        decided = outcome.decided;
      }
      if (outcome.ended) break;
    }
  }

  // If the round cap was reached with neither side down, decide by remaining HP —
  // the player wins a tie (the same deterministic tie-break as action order).
  const outcome: 'win' | 'loss' = decided ?? (state.player.hp >= state.enemy.hp ? 'win' : 'loss');

  return { outcome, turns, playerHpRemaining: Math.max(0, state.player.hp) };
}

/**
 * TASK-271 (R-44 slice, FIRST multi-combatant change) — the PLAYER-side-as-a-LIST sibling of
 * {@link simulateBattle}. Models the player side as an ORDERED party of ≤N members (each with its
 * own live {@link SideState}: hp/energy/statuses/inflicted/atb), the ENEMY side staying a SINGLE
 * combatant (multi-enemy is the carved-off child R-44a). PURE + RNG-free (the engine's executable
 * `Math.random` count STAYS 0), the server twin of the pure world engine.
 *
 * The turn order interleaves initiative across ALL living player members + the enemy, ranked by
 * {@link effectiveSpd} (ties → players before the enemy, then by party-slot order — a pure
 * deterministic tie-break, NO RNG). On a player member's turn it targets the single enemy; on the
 * enemy's turn it targets the FRONT living player member (lowest party index still alive — a pure
 * rule). The player side LOSES only when EVERY member's hp<=0; the enemy loses when its single
 * member's hp<=0. The round cap tie-break compares the surviving aggregate (sum of living player hp
 * vs enemy hp), which for a length-1 party reduces to `state.player.hp >= state.enemy.hp`.
 *
 * IDENTITY (load-bearing, invariant 5): a length-1 player party MUST resolve BYTE-IDENTICALLY to
 * today's 1v1 {@link simulateBattle} — the initiative order (a single-member + enemy ranking is the
 * same 2-element `resolveTurnOrder` order), the foe resolution (the sole member is always the front
 * living target), every damage number, every status tick, the decided outcome. That is the whole
 * reversibility proof: this is an ADD-ONLY new export; `simulateBattle`/`resolveActorTurn` and the
 * ~646 pinned `battle.spec` fixtures + all api e2es + auto/PvP paths stay green with NO re-pin.
 *
 * The mechanism REUSES the byte-frozen {@link resolveActorTurn} seam VERBATIM: a scratch
 * {@link FightState} (`work`) whose `player`/`enemy` are swapped to the ACTING/TARGETED member's
 * `SideState` (and `combatant.player`/`.enemy` to that member's stats) before each `resolveActorTurn`
 * call. Because `resolveActorTurn` only ever addresses `state.player`/`state.enemy`, swapping the
 * active member in is transparent to it — no engine edit. A-42 held per member (every HP write inside
 * `resolveActorTurn` stays `max(0, …)`; NO heal introduced); `round <= MAX_ROUNDS`.
 */
 export interface PartyBattleResult {
   outcome: 'win' | 'loss';
   turns: TurnLogEntry[];
   /** Each party member's running HP when the fight ended (clamped ≥ 0), in party-slot order. */
   playerHpRemaining: number[];
   /**
    * TASK-273 (R-44a): each ENEMY group member's running HP when the fight ended (clamped ≥ 0), in
    * group order — the symmetric mirror of `playerHpRemaining`. For a single/absent enemy group this
    * is a length-1 list holding the scalar enemy's remaining hp.
    */
   enemyHpRemaining: number[];
 }

 export function simulatePartyBattle(
   players: Combatant[],
   enemy: Combatant,
   // TASK-273 (R-44a — multi-enemy encounter groups): the ordered ENEMY GROUP (≤2). ADDITIVE/trailing
   // — absent (or length ≤1) keeps the single-`enemy` fight byte-for-byte (the length-1 identity
   // anchor), so every existing caller/fixture is unchanged. When >1, `enemy` MUST be `enemyGroup[0]`.
   enemyGroup?: Combatant[],
 ): PartyBattleResult {
   // A length-1 party is the identity path: one member, ranked against the enemy, is exactly today's
   // 1v1 order/target/termination (proven byte-identical by the shared resolveActorTurn seam).
   const party = players.length > 0 ? players : [players[0]].filter(Boolean);
   const enemyParty = enemyGroup !== undefined && enemyGroup.length > 1 ? enemyGroup : [enemy];
   const memberStates: SideState[] = party.map((p) => ({
     hp: p.hp,
     energy: MAX_ENERGY,
     statuses: [] as StatusAilment[],
     inflicted: new Set<StatusAilment['kind']>(),
     atb: 0,
   }));
   const enemyStates: SideState[] = enemyParty.map((e) => ({
     hp: e.hp,
     energy: MAX_ENERGY,
     statuses: [] as StatusAilment[],
     inflicted: new Set<StatusAilment['kind']>(),
     atb: 0,
   }));
   const turns: TurnLogEntry[] = [];

   const livingPlayerIdx = (): number[] =>
     memberStates.map((s, i) => (s.hp > 0 ? i : -1)).filter((i) => i >= 0);
   // The FRONT living player member — lowest party index still alive (deterministic target rule).
   const frontLiving = (): number => {
     const alive = livingPlayerIdx();
     return alive.length > 0 ? alive[0] : -1;
   };
   const allPlayersDown = (): boolean => memberStates.every((s) => s.hp <= 0);
   const livingEnemyIdx = (): number[] =>
     enemyStates.map((s, i) => (s.hp > 0 ? i : -1)).filter((i) => i >= 0);
   // The FRONT living enemy — lowest group index still alive (the player's deterministic target).
   const frontLivingEnemy = (): number => {
     const alive = livingEnemyIdx();
     return alive.length > 0 ? alive[0] : -1;
   };
   const allEnemiesDown = (): boolean => enemyStates.every((s) => s.hp <= 0);

   let round = 1;
   let decided: 'win' | 'loss' | null = null;

   for (; round <= MAX_ROUNDS && decided === null; round += 1) {
     // Build this round's interleaved action queue: every LIVING player member + every LIVING enemy,
     // ranked by effective SPD (desc). Ties → players before enemies, then by slot order. A queue
     // entry is a specific player member OR a specific enemy — a pure deterministic ordering, NO RNG.
     type Actor = { side: 'player'; idx: number } | { side: 'enemy'; idx: number };
     const queue: Actor[] = [
       ...livingPlayerIdx().map((idx) => ({ side: 'player' as const, idx })),
       ...livingEnemyIdx().map((idx) => ({ side: 'enemy' as const, idx })),
     ];
     // Stable sort by effective SPD desc; tie-break keeps players ahead of enemies and preserves slot
     // order within a side (a small deterministic edge to the human, mirroring resolveTurnOrder's
     // player-first `>=`). For a length-1 party + length-1 enemy this is exactly the 2-element
     // [player, enemy]/[enemy, player] order resolveTurnOrder produces (byte-identical initiative).
     const spdOf = (a: Actor): number =>
       a.side === 'enemy'
         ? effectiveSpd(enemyParty[a.idx], enemyStates[a.idx].statuses)
         : effectiveSpd(party[a.idx], memberStates[a.idx].statuses);
     const rankOf = (a: Actor): number =>
       a.side === 'player' ? a.idx : party.length + 1 + a.idx;
     queue.sort((a, b) => {
       const ds = spdOf(b) - spdOf(a);
       if (ds !== 0) return ds;
       return rankOf(a) - rankOf(b);
     });

     for (const actor of queue) {
       if (decided !== null) break;
       // Skip a member that died earlier this round (its slot was queued while alive).
       if (actor.side === 'player' && memberStates[actor.idx].hp <= 0) continue;
       if (actor.side === 'enemy' && enemyStates[actor.idx].hp <= 0) continue;

       if (actor.side === 'player') {
         // The acting player member targets the FRONT living enemy. Swap both live SideStates + stats
         // into the scratch FightState, then reuse resolveActorTurn VERBATIM.
         const targetE = frontLivingEnemy();
         if (targetE < 0) {
           decided = 'win';
           break;
         }
         const work: FightState = {
           player: memberStates[actor.idx],
           enemy: enemyStates[targetE],
           round,
           decided: null,
         };
         const combatant = { player: party[actor.idx], enemy: enemyParty[targetE] };
         const res = resolveActorTurn(work, 'player', combatant, chooseSkill, turns);
         // resolveActorTurn decides 'loss' when the PLAYER member's hp<=0 (from a reflect/retaliate),
         // 'win' when the targeted enemy's hp<=0. A member/enemy dying ends the fight only when its
         // whole side is down.
         if (res.decided === 'win' && allEnemiesDown()) decided = 'win';
         else if (res.decided === 'loss' && allPlayersDown()) decided = 'loss';
       } else {
         // The acting enemy targets the FRONT living player member (lowest living party index).
         const target = frontLiving();
         if (target < 0) {
           decided = 'loss';
           break;
         }
         const work: FightState = {
           player: memberStates[target],
           enemy: enemyStates[actor.idx],
           round,
           decided: null,
         };
         const combatant = { player: party[target], enemy: enemyParty[actor.idx] };
         const res = resolveActorTurn(work, 'enemy', combatant, chooseSkill, turns);
         if (res.decided === 'loss' && allPlayersDown()) decided = 'loss';
         else if (res.decided === 'win' && allEnemiesDown()) decided = 'win';
       }

       if (decided === null && allPlayersDown()) decided = 'loss';
       if (decided === null && allEnemiesDown()) decided = 'win';
     }
   }

   // Round-cap tie-break: surviving aggregate — sum of living player hp vs sum of living enemy hp. The
   // player wins a tie (the same deterministic edge as the action order). For a length-1 party + a
   // length-1 enemy this reduces to `state.player.hp >= state.enemy.hp` byte-for-byte (identity with
   // simulateBattle's tie-break).
   const playerAggregate = memberStates.reduce((sum, s) => sum + Math.max(0, s.hp), 0);
   const enemyAggregate = enemyStates.reduce((sum, s) => sum + Math.max(0, s.hp), 0);
   const outcome: 'win' | 'loss' =
     decided ?? (playerAggregate >= enemyAggregate ? 'win' : 'loss');

   return {
     outcome,
     turns,
     playerHpRemaining: memberStates.map((s) => Math.max(0, s.hp)),
     enemyHpRemaining: enemyStates.map((s) => Math.max(0, s.hp)),
   };
 }

/**
 * TASK-155 (R-22 slice 16) — the ATB-honoring sibling of {@link simulateBattle}: the AUTO
 * whole-fight driver that CLOSES the auto-vs-interactive ATB divergence (present ≠ observable,
 * L-17). `simulateBattle` orders each round purely by effective SPD and NEVER reads `atb` (it
 * seeds `atb:0` and leaves it untouched, by explicit design) — so a Digimon that BANKS ATB lands
 * its capped mini-combo bonus action on the INTERACTIVE `battleTurn` path but NOT when the fight
 * AUTO-resolves. This driver mirrors the interactive accumulate/consume pattern
 * (`digimon.service.battleTurn`, lines 742-829) inside a pure whole-fight loop, so the SAME
 * encounter resolves the SAME way on both paths.
 *
 * ADD-ONLY / invariant 5: `simulateBattle` + its ~637 pinned `battle.spec` fixtures + MAX_ROUNDS +
 * the win/loss tuning stay BYTE-UNCHANGED (the frozen-old-fn posture of TASK-58's
 * `resolveDamageStrike`). This is a NEW export; the ONE auto-resolve route (`digimon.service.ts`
 * PvE `battle`) re-points to it. PvP + explore/wild-encounter callsites STAY on `simulateBattle`
 * (their own Elo/encounter fixture churn — a carved follow-on wave, A-138).
 *
 * The divergence-close is SMALLEST-INCREMENT (A-138 #3): ATB grants a capped EXTRA action, it does
 * NOT re-derive who-goes-first — the base round order stays the EXISTING effective-SPD order
 * (`resolveTurnOrder`/`resolveActionSequence`, byte-identical to `simulateBattle`). REUSES the
 * byte-frozen pure `resolveActorTurn` + `effectiveSpd` + `ATB_THRESHOLD` + `MAX_ATB_BONUS_ACTIONS`
 * + `chooseSkill`; adds NO new mechanic/status/skill/RNG (I-10 upheld; `Math.random` count STAYS 0).
 * A-42: an ATB bonus action is HP-REDUCING only, bounded per side per round by
 * `MAX_ATB_BONUS_ACTIONS` and per fight by MAX_ROUNDS + the HP tie-break — the SAME termination
 * argument the interactive drain-loop already carries.
 */
export function simulateBattleAtb(player: Combatant, enemy: Combatant): BattleResult {
  // Per-side mutable fight-local state — identical seeding to simulateBattle, EXCEPT the round loop
  // below GROWS + CONSUMES `atb` (simulateBattle leaves it 0). Nothing persists.
  const state: FightState = {
    player: {
      hp: player.hp,
      energy: MAX_ENERGY,
      statuses: [] as StatusAilment[],
      inflicted: new Set<StatusAilment['kind']>(),
      atb: 0,
    },
    enemy: {
      hp: enemy.hp,
      energy: MAX_ENERGY,
      statuses: [] as StatusAilment[],
      inflicted: new Set<StatusAilment['kind']>(),
      atb: 0,
    },
    round: 1,
    decided: null,
  };
  const combatant = { player, enemy };
  const turns: TurnLogEntry[] = [];

  let round = 1;
  let decided: 'win' | 'loss' | null = null;

  for (; round <= MAX_ROUNDS && decided === null; round += 1) {
    // Base round order — the EXACT effective-SPD order simulateBattle uses (single-sourced through
    // the SAME pure reads + the SAME SPD-status gate), so a fight with NO banked ATB is
    // byte-identical to simulateBattle. ATB adds a capped EXTRA action AFTER this order; it does NOT
    // re-derive who-goes-first (A-138 #3, the smallest increment).
    const pEff = effectiveSpd(player, state.player.statuses);
    const eEff = effectiveSpd(enemy, state.enemy.statuses);

    // GROW the carried ATB accumulator by each side's effective SPD this round, BEFORE the actor
    // loop resolves — the SAME `+= effectiveSpd` the interactive seam does
    // (digimon.service.ts:750-751). Pure integer addition, no roll (Math.random count stays 0).
    state.player.atb += pEff;
    state.enemy.atb += eEff;

    const order: ('player' | 'enemy')[] =
      hasSpdStatus(state.player.statuses) || hasSpdStatus(state.enemy.statuses)
        ? resolveActionSequence(pEff, eEff)
        : resolveTurnOrder(pEff, eEff);
    for (const actor of order) {
      state.round = round;
      const outcome = resolveActorTurn(state, actor, combatant, chooseSkill, turns);
      if (outcome.decided !== null) {
        decided = outcome.decided;
      }
      if (outcome.ended) break;
    }

    // AFTER the normal exchange, cash out each side's banked ATB into a capped mini-combo — the
    // EXACT capped-drain loop the interactive path runs (digimon.service.ts:807-828): same
    // constants, same drain arithmetic, same SPD `order` (faster full side strikes its bonus
    // first), same `chooseSkill` seam, same `decided !== null` short-circuit. A KO in the normal
    // exchange OR in any bonus action ENDS the fight — no bonus strike lands after a decided fight,
    // and we break the whole round loop so a KO'd side never takes a further action (A-42).
    if (decided === null) {
      const bonusActions = { player: 0, enemy: 0 };
      for (const actor of order) {
        if (decided !== null) break;
        while (
          decided === null &&
          state[actor].atb >= ATB_THRESHOLD &&
          bonusActions[actor] < MAX_ATB_BONUS_ACTIONS
        ) {
          state[actor].atb -= ATB_THRESHOLD;
          bonusActions[actor] += 1;
          state.round = round;
          const res = resolveActorTurn(state, actor, combatant, chooseSkill, turns);
          if (res.decided !== null) {
            decided = res.decided;
          }
          if (res.ended) break;
        }
      }
    }
  }

  // Same win/loss tie-break + clamped playerHpRemaining as simulateBattle (player wins ties).
  const outcome: 'win' | 'loss' = decided ?? (state.player.hp >= state.enemy.hp ? 'win' : 'loss');

  return { outcome, turns, playerHpRemaining: Math.max(0, state.player.hp) };
}

/**
 * TASK-181 (R-23a1, slice 42) — resolve a WHOLE PvP duel by looping the SHARED per-turn
 * `resolveActorTurn` seam, the SAME machinery the interactive `battleTurn` route drives one
 * turn at a time. This unifies PvP onto the ONE shared per-turn engine (R-23's second outcome
 * half: PvE AND PvP on the same lower rules) by giving `PvpService.challenge` a driver it can
 * re-point to, off its former second whole-fight code path.
 *
 * This slice is DELIBERATELY byte-equivalent to {@link simulateBattleAtb}: it reuses the
 * IDENTICAL round-loop structure (same `MAX_ROUNDS`, same `effectiveSpd`/`ATB_THRESHOLD`/
 * `MAX_ATB_BONUS_ACTIONS` reads, same base SPD order via `resolveActionSequence`/
 * `resolveTurnOrder`, same capped ATB bonus-drain loop, same win/loss tie-break + clamped
 * `playerHpRemaining`) and injects FLAT `chooseSkill` for BOTH sides — the `'easy'`-equivalent
 * parity path (A-163). So `simulatePvpDuel(a, b)` is deep-equal to `simulateBattleAtb(a, b)`
 * for the same rosters (the deep-equal oracle IS the invariant-5 proof), and every pinned PvP
 * fixture stays green with NO re-pin. The difficulty-aware banking opponent AI is the NEXT
 * slice — a one-line swap of the injected enemy chooser to `chooserForDifficulty(...)`; the
 * separate injected seam per side is why that swap will touch ONLY this function.
 *
 * PURE + RNG-free (uses the default `DEFAULT_RNG` seam like `simulateBattleAtb`; adds NO new
 * mechanic/status/skill/RNG — I-10's treadmill stays STOPPED, `Math.random` count STAYS 0).
 * A-42: every action is HP-reducing only, bounded by `MAX_ROUNDS` + the HP tie-break — the same
 * termination argument the sibling ATB driver carries.
 */
export function simulatePvpDuel(player: Combatant, enemy: Combatant): BattleResult {
  // Per-side mutable fight-local state — identical seeding to simulateBattleAtb (which itself
  // seeds identically to simulateBattle, growing + consuming `atb` in the loop below). Nothing
  // persists; the caller reads only the returned BattleResult.
  const state: FightState = {
    player: {
      hp: player.hp,
      energy: MAX_ENERGY,
      statuses: [] as StatusAilment[],
      inflicted: new Set<StatusAilment['kind']>(),
      atb: 0,
    },
    enemy: {
      hp: enemy.hp,
      energy: MAX_ENERGY,
      statuses: [] as StatusAilment[],
      inflicted: new Set<StatusAilment['kind']>(),
      atb: 0,
    },
    round: 1,
    decided: null,
  };
  const combatant = { player, enemy };
  const turns: TurnLogEntry[] = [];

  // The injected per-side choosers — the shared-seam levers this driver exists to own. FLAT
  // `chooseSkill` for BOTH this slice (byte-parity with simulateBattleAtb). Next slice swaps
  // `enemyChooser` to `chooserForDifficulty(...)` — nothing else moves.
  const playerChooser = chooseSkill;
  const enemyChooser = chooseSkill;

  let round = 1;
  let decided: 'win' | 'loss' | null = null;

  for (; round <= MAX_ROUNDS && decided === null; round += 1) {
    // Base round order — the EXACT effective-SPD order simulateBattleAtb/simulateBattle use
    // (single-sourced through the SAME pure reads + the SAME SPD-status gate).
    const pEff = effectiveSpd(player, state.player.statuses);
    const eEff = effectiveSpd(enemy, state.enemy.statuses);

    // GROW the carried ATB accumulator by each side's effective SPD this round, BEFORE the actor
    // loop resolves — the SAME `+= effectiveSpd` the ATB/interactive seam does. Pure integer add.
    state.player.atb += pEff;
    state.enemy.atb += eEff;

    const order: ('player' | 'enemy')[] =
      hasSpdStatus(state.player.statuses) || hasSpdStatus(state.enemy.statuses)
        ? resolveActionSequence(pEff, eEff)
        : resolveTurnOrder(pEff, eEff);
    for (const actor of order) {
      state.round = round;
      const chooser = actor === 'player' ? playerChooser : enemyChooser;
      const outcome = resolveActorTurn(state, actor, combatant, chooser, turns);
      if (outcome.decided !== null) {
        decided = outcome.decided;
      }
      if (outcome.ended) break;
    }

    // AFTER the normal exchange, cash out each side's banked ATB into a capped mini-combo — the
    // EXACT capped-drain loop simulateBattleAtb runs: same constants, same drain arithmetic, same
    // SPD `order`, same per-side chooser, same `decided !== null` short-circuit.
    if (decided === null) {
      const bonusActions = { player: 0, enemy: 0 };
      for (const actor of order) {
        if (decided !== null) break;
        while (
          decided === null &&
          state[actor].atb >= ATB_THRESHOLD &&
          bonusActions[actor] < MAX_ATB_BONUS_ACTIONS
        ) {
          state[actor].atb -= ATB_THRESHOLD;
          bonusActions[actor] += 1;
          state.round = round;
          const chooser = actor === 'player' ? playerChooser : enemyChooser;
          const res = resolveActorTurn(state, actor, combatant, chooser, turns);
          if (res.decided !== null) {
            decided = res.decided;
          }
          if (res.ended) break;
        }
      }
    }
  }

  // Same win/loss tie-break + clamped playerHpRemaining as simulateBattleAtb (player wins ties).
  const outcome: 'win' | 'loss' = decided ?? (state.player.hp >= state.enemy.hp ? 'win' : 'loss');

  return { outcome, turns, playerHpRemaining: Math.max(0, state.player.hp) };
}

/**
 * Resolve ONE actor's whole turn (TASK-140, R-22) — the extracted, PURE per-actor body
 * of {@link simulateBattle}, re-expressed as a reusable function so the SAME rules drive
 * BOTH the deterministic auto-driver (which feeds it {@link chooseSkill}'s output) AND
 * the interactive turn route (which feeds it the PLAYER's chosen skill). It mutates the
 * passed `state` (both sides' hp/energy/statuses/inflicted) and APPENDS to `turns` in
 * place, exactly as the inline loop body did, so re-expressing `simulateBattle` over it
 * keeps every shipped fight's turn log / outcome / `playerHpRemaining` BYTE-IDENTICAL.
 *
 * The `chooseSkill` seam is INJECTED (`selectSkillFor`), so the caller decides the skill:
 * the auto-driver passes {@link chooseSkill} verbatim; an interactive caller passes
 * `() => playerChoice` for the player's turn and {@link chooseSkill} for the enemy's.
 *
 * Two loop-control signals the inline body used (`break`/`continue`) are RETURNED, not
 * thrown: `ended:true` = the caller must `break` the round loop (a death-by-tick or a KO
 * this turn — `decided` carries the win/loss), `ended:false` = continue (a normal turn OR
 * a stun-skipped turn). `decided` is `null` on an undecided turn. Preserves the loop's
 * HP-monotone + `round <= MAX_ROUNDS` guarantees (A-42): every HP write is `max(0, …)`.
 */
export function resolveActorTurn(
  state: FightState,
  actor: 'player' | 'enemy',
  combatant: { player: Combatant; enemy: Combatant },
  selectSkillFor: (me: SideState, them: SideState) => Skill,
  turns: TurnLogEntry[],
  rng: Rng = DEFAULT_RNG,
): { decided: 'win' | 'loss' | null; ended: boolean } {
  const round = state.round;
  let decided: 'win' | 'loss' | null = null;
  {
    {
      const foe: 'player' | 'enemy' = actor === 'player' ? 'enemy' : 'player';
      const me = state[actor];
      const them = state[foe];

      // 1. Energy regen at the start of the actor's own turn.
      me.energy = Math.min(MAX_ENERGY, me.energy + ENERGY_REGEN_PER_TURN);

      // 2. Tick EVERY active ailment (TASK-53 generalized the Burn-only tick; TASK-54
      //    added the WEAKEN stat-modifier), in the fixed AILMENT_TICK_ORDER, each a
      //    distinct log entry. A DoT tick (Burn/Poison) subtracts HP and can KILL —
      //    ending the fight before the afflicted side acts. A WEAKEN tick removes NO
      //    HP (HP stays monotonically non-increasing): it only decrements duration and
      //    logs a note ("… DEF is lowered" while active / "Weaken wore off …" on
      //    expiry). Burn/Poison are preserved EXACTLY as the DoT case of this loop.
      let killedByTick = false;
      // TASK-57: did an active STUN suppress THIS actor's action this turn? Ticked +
      // checked at the top of the actor's own turn (see the stun branch below); if set,
      // the skill-select + effect step is SKIPPED entirely for this turn.
      let stunnedThisTurn = false;
      for (const kind of AILMENT_TICK_ORDER) {
        const ailment = me.statuses.find((s) => s.kind === kind);
        if (ailment === undefined) continue;

        if (ailment.kind === 'weaken') {
          // A stat-modifier tick: NO HP change. Decrement, drop-on-expiry, and log
          // the appropriate note. Its damage-side payoff is applied in resolveAttack.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Weaken wore off ${combatant[actor].name}`
            : `${combatant[actor].name}'s DEF is lowered`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Weaken; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'weaken-percent') {
          // Crumble tick (TASK-100) — the fractional MIRROR of the Weaken tick above: a
          // stat-modifier tick with NO HP change (HP stays monotonically non-increasing,
          // A-42). Decrement, drop-on-expiry, and log the note. Its damage-side payoff — a
          // FRACTION of the target's CURRENT def cut — is applied at the resolveDamageStrike
          // weaken seam. Like Weaken it is the FOE's applied debuff, so log it against `foe`.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Crumble wore off ${combatant[actor].name}`
            : `${combatant[actor].name}'s DEF is crumbling`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Crumble; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'enfeeble') {
          // A stat-modifier tick (TASK-63) — the OFFENSIVE-ATK mirror of the Weaken
          // tick above: NO HP change (HP stays monotonically non-increasing, A-52).
          // Decrement, drop-on-expiry, and log the note. Its damage-side payoff — the
          // enfeebled attacker's CUT ATK — is applied in resolveDamageStrike when THIS
          // side attacks. Enfeeble is the FOE's applied debuff (cast onto this actor by
          // the opponent), so — like Weaken — log it against `foe`.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Enfeeble wore off ${combatant[actor].name}`
            : `${combatant[actor].name}'s ATK is lowered`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Enfeeble; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'enfeeble-percent') {
          // Sunder tick (TASK-101) — the fractional MIRROR of the Enfeeble tick above (the
          // ATK-side twin of the Crumble tick): a stat-modifier tick with NO HP change (HP
          // stays monotonically non-increasing, A-42). Decrement, drop-on-expiry, and log the
          // note. Its damage-side payoff — a FRACTION of the target's CURRENT atk cut — is
          // applied at the resolveDamageStrike enfeeble seam when THIS side attacks. Like
          // Enfeeble it is the FOE's applied debuff, so log it against `foe`.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Sunder wore off ${combatant[actor].name}`
            : `${combatant[actor].name}'s ATK is sundering`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Sunder; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'vulnerable') {
          // A stat-modifier tick (TASK-65) — the damage-AMP inverse of the Weaken/
          // Enfeeble ticks above: NO HP change (HP stays monotonically non-increasing,
          // A-54). Decrement, drop-on-expiry, and log the note. Its damage-side payoff —
          // the vulnerable defender's AMPLIFIED incoming damage — is applied in
          // resolveDamageStrike when THIS side is STRUCK. Vulnerable is the FOE's applied
          // debuff (cast onto this actor by the opponent), so — like Weaken/Enfeeble —
          // log it against `foe`.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Vulnerable wore off ${combatant[actor].name}`
            : `${combatant[actor].name} is exposed and takes extra damage`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Vulnerable; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'vulnerable-percent') {
          // Rupture tick (TASK-103) — the fractional MIRROR of the Vulnerable tick above (the
          // damage-taken twin): a stat-modifier tick with NO HP change (HP stays monotonically
          // non-increasing, A-42). Decrement, drop-on-expiry, and log the note. Its damage-side
          // payoff — the ruptured defender's AMPLIFIED incoming damage — is applied at the
          // amplifyForVulnerable seam when THIS side is STRUCK. Like Vulnerable it is the FOE's
          // applied debuff, so log it against `foe`.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Rupture wore off ${combatant[actor].name}`
            : `${combatant[actor].name} is ruptured and takes extra damage`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Rupture; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'doom') {
          // The DEFERRED / SCHEDULED-damage tick (TASK-66) — the genuinely NEW shape.
          // UNLIKE a DoT it deals NO per-turn damage: while the fuse is still burning it
          // only COUNTS DOWN + logs "the Doom counts down" (HP unchanged — monotonically
          // non-increasing on the intermediate turns). On the turn the counter reaches 0
          // it DETONATES a single FIXED `detonationDamage` burst on the afflicted side,
          // routed through the SAME `hp = max(0, hp − X)` write path the DoT ticks use
          // (respecting the ≥ 0 floor), then EXPIRES (it does not linger or re-detonate).
          // A detonation that drops the side to ≤ 0 ENDS the fight before it can act, so
          // it is handled with the killedByTick machinery like a lethal DoT tick.
          ailment.turnsRemaining -= 1;
          const detonated = ailment.turnsRemaining <= 0;
          if (detonated) {
            const burst = ailment.detonationDamage;
            me.hp = Math.max(0, me.hp - burst);
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
            turns.push({
              round,
              actor: foe, // the curse is the FOE's applied Doom detonating; log against them
              damage: burst,
              defenderHpAfter: me.hp,
              statusEvents: [`Doom detonates for ${burst} on ${combatant[actor].name}`],
            });
            if (me.hp <= 0) {
              decided = actor === 'player' ? 'loss' : 'win';
              killedByTick = true;
              break;
            }
          } else {
            turns.push({
              round,
              actor: foe, // the FOE's applied Doom is ticking down; log against them
              damage: 0, // no damage until it detonates
              defenderHpAfter: me.hp, // unchanged — HP stays non-increasing until detonation
              statusEvents: [
                `Doom counts down on ${combatant[actor].name} (${ailment.turnsRemaining})`,
              ],
            });
          }
          continue;
        }

        if (ailment.kind === 'doom-percent') {
          // Doom-Percent (TASK-119) — the FRACTIONAL twin of the `doom` tick above. IDENTICAL shape:
          // while the fuse burns it deals NO per-turn damage, only COUNTS DOWN + logs (HP unchanged,
          // monotonically non-increasing on the intermediate turns). On the turn the counter reaches
          // 0 it DETONATES a burst of `floor(hp × detonationRatio)` of the bearer's CURRENT HP —
          // reading ONLY the existing `hp` (NO `maxHp`) — routed through the SAME `hp = max(0, hp − X)`
          // write path (respecting the ≥ 0 floor), then EXPIRES. A detonation that drops the side to
          // ≤ 0 ENDS the fight before it can act, handled with killedByTick like a lethal doom tick.
          ailment.turnsRemaining -= 1;
          const detonated = ailment.turnsRemaining <= 0;
          if (detonated) {
            // floor(hp × ratio) of CURRENT hp — deterministic, no RNG, no maxHp. The `floor` keeps
            // the burst an integer; `Math.max(0, …)` keeps HP ≥ 0 (A-42 monotone).
            const burst = Math.floor(me.hp * ailment.detonationRatio);
            me.hp = Math.max(0, me.hp - burst);
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
            turns.push({
              round,
              actor: foe, // the curse is the FOE's applied Doom-Percent detonating; log against them
              damage: burst,
              defenderHpAfter: me.hp,
              statusEvents: [`Doom-Percent detonates for ${burst} on ${combatant[actor].name}`],
            });
            if (me.hp <= 0) {
              decided = actor === 'player' ? 'loss' : 'win';
              killedByTick = true;
              break;
            }
          } else {
            turns.push({
              round,
              actor: foe, // the FOE's applied Doom-Percent is ticking down; log against them
              damage: 0, // no damage until it detonates
              defenderHpAfter: me.hp, // unchanged — HP stays non-increasing until detonation
              statusEvents: [
                `Doom-Percent counts down on ${combatant[actor].name} (${ailment.turnsRemaining})`,
              ],
            });
          }
          continue;
        }

        if (ailment.kind === 'shield') {
          // A damage-absorbing buffer tick (TASK-55): NO HP change. Decrement,
          // drop-on-expiry, and log the appropriate note. Its payoff — draining
          // incoming damage before HP — is applied when THIS side is struck (see the
          // damage effect below), keeping HP monotonically non-increasing (A-43). A
          // shield is SELF-raised, so log it as the shielded side's OWN action.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s shield fades`
            : `${combatant[actor].name}'s shield holds (${ailment.absorbRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the shielded side's own status note
            damage: 0, // a shield deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'shield-percent') {
          // Barrier tick (TASK-131) — the FRACTIONAL twin of the shield tick above: NO HP change.
          // Decrement, drop-on-expiry, log the note. Its payoff — draining incoming damage before HP —
          // is applied when THIS side is struck (the maxHp-fraction absorb pool, drained through the same
          // generalized absorbWithShield seam), keeping HP monotonically non-increasing (A-42). A Barrier
          // is SELF-raised, so log it as the barriered side's OWN action, mirroring the shield tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s barrier fades`
            : `${combatant[actor].name}'s barrier holds (${ailment.absorbRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the barriered side's own status note
            damage: 0, // a barrier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'empower') {
          // An ATK-buff tick (TASK-56): NO HP change — a buff never heals (HP stays
          // monotonically non-increasing, A-44). Decrement, drop-on-expiry, and log
          // the appropriate note. Its payoff — raising the empowered side's damage —
          // is applied in resolveAttack when THIS side attacks (see the damage effect
          // below). Empower is SELF-raised, so log it as the empowered side's OWN
          // action, mirroring the shield tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s empower fades`
            : `${combatant[actor].name}'s empower holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the empowered side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'fortify') {
          // A DEF-up self-buff tick (TASK-108) — the DEF-axis twin of the Empower tick above and the
          // self-buff mirror of weaken: NO HP change (a buff never heals — HP stays monotonically
          // non-increasing, A-42). Decrement, drop-on-expiry, and log the note. Its payoff — RAISING
          // the fortified side's effective DEF so incoming strikes deal LESS damage — is applied at the
          // resolveDamageStrike netDefReduction seam when THIS side is ATTACKED. Fortify is SELF-raised,
          // so log it as the fortified side's OWN action, mirroring the shield/empower tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s fortify fades`
            : `${combatant[actor].name}'s fortify holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the fortified side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'brace') {
          // A damage-taken-DOWN self-buff tick (TASK-109) — the POSITIVE MIRROR of the (defender)
          // Vulnerable amp and the damage-application-seam twin of the Fortify tick above: NO HP change
          // (a buff never heals — HP stays monotonically non-increasing, A-42). Decrement,
          // drop-on-expiry, and log the note. Its payoff — REDUCING the braced side's incoming damage at
          // the amplifyForVulnerable seam so strikes deal LESS damage — is applied when THIS side is
          // ATTACKED. Brace is SELF-raised, so log it as the braced side's OWN action, mirroring the
          // shield/empower/fortify tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s brace fades`
            : `${combatant[actor].name}'s brace holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the braced side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'brace-percent') {
          // A percentage damage-taken-DOWN self-buff tick (TASK-110) — the fractional MIRROR of the
          // (self) Brace tick and the DOWN-side percent twin of the (defender) Rupture amp: NO HP change
          // (a buff never heals — HP stays monotonically non-increasing, A-42). Decrement,
          // drop-on-expiry, and log the note. Its payoff — REDUCING the bulwarked side's incoming damage
          // by a FRACTION at the amplifyForVulnerable seam so strikes deal LESS damage — is applied when
          // THIS side is ATTACKED. Bulwark is SELF-raised, so log it as the bulwarked side's OWN action,
          // mirroring the brace/shield/empower/fortify tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s bulwark fades`
            : `${combatant[actor].name}'s bulwark holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the bulwarked side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'fortify-percent') {
          // A percentage DEF-up self-buff tick (TASK-111) — the fractional MIRROR of the (self) Fortify
          // tick above and the DEF-UP percent twin of the (defender) Crumble/weaken-percent debuff: NO HP
          // change (a buff never heals — HP stays monotonically non-increasing, A-42). Decrement,
          // drop-on-expiry, and log the note. Its payoff — RAISING the aegis'd side's effective DEF by a
          // FRACTION at the netDefReduction seam so incoming strikes deal LESS damage — is applied when
          // THIS side is ATTACKED. Aegis is SELF-raised, so log it as the aegis'd side's OWN action,
          // mirroring the fortify/brace/shield/empower tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s aegis fades`
            : `${combatant[actor].name}'s aegis holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the aegis'd side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'hasten') {
          // A flat SPD-up self-buff tick (TASK-112) — the SPD-axis twin of the (self) Fortify/Empower
          // ticks above: NO HP change (a buff never heals — HP stays monotonically non-increasing, A-42).
          // Decrement, drop-on-expiry, and log the note. Its payoff — RAISING the hastened side's
          // effective SPD by a FLAT `spdBonus` — lives in the pure effectiveSpd read helper (NOT wired
          // into the turn-order line this slice, A-99), not here. Quicken is SELF-raised, so log it as the
          // hastened side's OWN action, mirroring the fortify/empower/brace/shield tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s quickness fades`
            : `${combatant[actor].name}'s quickness holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the hastened side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'hasten-percent') {
          // A percentage SPD-up self-buff tick (TASK-113) — the fractional MIRROR of the (self) Hasten
          // tick above and the SPD-axis mirror of the fortify-percent/empower-percent ticks: NO HP change
          // (a buff never heals — HP stays monotonically non-increasing, A-42). Decrement, drop-on-expiry,
          // and log the note. Its payoff — RAISING the rushed side's effective SPD by floor(spd × ratio) —
          // lives in the pure effectiveSpd read helper (NOT wired into the turn-order line, A-99), not here.
          // Rush is SELF-raised, so log it as the rushed side's OWN action, mirroring the hasten tick.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s rush fades`
            : `${combatant[actor].name}'s rush holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the rushed side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'hobble') {
          // A flat SPD-DOWN debuff tick (TASK-114) — the SPD-axis mirror of the (foe) Weaken/Enfeeble
          // debuff ticks above: NO HP change (a stat-mod debuff removes no HP — HP stays monotonically
          // non-increasing, A-42). Decrement, drop-on-expiry, and log the note. Its payoff — LOWERING the
          // hobbled side's effective SPD by a FLAT `spdReduction` — lives in the pure effectiveSpd read
          // helper (spd - spdReduction, floored at MIN_EFFECTIVE_SPD; NOT wired into the turn-order line
          // this slice, A-99), not here. Hobble is the FOE's applied debuff (cast onto this actor by the
          // opponent), so — like Weaken/Enfeeble — log it against `foe`.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Hobble wore off ${combatant[actor].name}`
            : `${combatant[actor].name}'s SPD is lowered`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Hobble; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'hobble-percent') {
          // A PERCENTAGE SPD-DOWN debuff tick (TASK-115) — the percentage twin of the flat Hobble tick
          // above and the SPD-axis mirror of the (foe) weaken-percent/enfeeble-percent debuff ticks: NO
          // HP change (a stat-mod debuff removes no HP — HP stays monotonically non-increasing, A-42).
          // Decrement, drop-on-expiry, and log the note. Its payoff — LOWERING the crippled side's
          // effective SPD by floor(spd × spdReductionRatio) — lives in the pure effectiveSpd read helper
          // (spd - floor(spd × ratio), floored at MIN_EFFECTIVE_SPD; NOT wired into the turn-order line
          // this slice, A-99), not here. Cripple is the FOE's applied debuff (cast onto this actor by the
          // opponent), so — like hobble/weaken-percent — log it against `foe`.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `Cripple wore off ${combatant[actor].name}`
            : `${combatant[actor].name}'s SPD is lowered`;
          turns.push({
            round,
            actor: foe, // the debuff is the FOE's applied Cripple; log it against them
            damage: 0, // a stat-modifier deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'empower-percent') {
          // Reinforce tick (TASK-102) — the fractional MIRROR of the Empower tick above (the
          // ATK-BONUS twin of the Sunder tick): a stat-modifier self-buff tick with NO HP change
          // (HP stays monotonically non-increasing, A-42). Decrement, drop-on-expiry, and log the
          // note. Its damage-side payoff — a FRACTION of the caster's CURRENT atk ADDED as ATK bonus
          // — is applied at the resolveDamageStrike empower seam when THIS side attacks. Like Empower
          // it is SELF-raised, so log it as the reinforced side's OWN action.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s reinforcement fades`
            : `${combatant[actor].name}'s reinforcement holds (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the reinforced side's own status note
            damage: 0, // a buff deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'retaliate') {
          // The FIRST reactive/on-being-hit self-buff tick (TASK-69): NO HP change — its
          // tick ONLY counts down + logs (HP stays monotonically non-increasing, A-42).
          // Its PAYOFF (reflecting damage back at a striker) lives in a DIFFERENT place —
          // the shared resolveDamageStrike hit site — per "a stat-modifier's tick and its
          // payoff live in two different places". Retaliate is SELF-raised, so log it as
          // the retaliating side's OWN status note, mirroring the shield/empower ticks.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s counter stance fades`
            : `${combatant[actor].name} holds a counter stance (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the retaliating side's own status note
            damage: 0, // a reactive buff deals no direct damage on its tick
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'retaliate-percent') {
          // Thorn Mirror tick (TASK-99) — the fractional MIRROR of the retaliate tick: NO
          // HP change — its tick ONLY counts down + logs (HP stays monotonically
          // non-increasing, A-42). Its PAYOFF (reflecting a FRACTION of the incoming
          // overflow back at a striker) lives in the shared resolveDamageStrike hit site
          // (see reflectRetaliation). Self-raised, so log it as the mirroring side's OWN note.
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = expired
            ? `${combatant[actor].name}'s thorn mirror fades`
            : `${combatant[actor].name} holds a thorn mirror (${ailment.turnsRemaining})`;
          turns.push({
            round,
            actor, // a self-buff — log it as the mirroring side's own status note
            damage: 0, // a reactive buff deals no direct damage on its tick
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: [note],
          });
          continue;
        }

        if (ailment.kind === 'stun') {
          // A CONTROL ailment tick (TASK-57): NO HP change — a stun removes and adds no
          // HP, so HP stays monotonically non-increasing (A-45). Its ONE tick-and-check
          // placement: because an active stun is present at the TOP of this actor's own
          // turn, it SUPPRESSES this actor's action step this turn (flag it here; the
          // action step below is skipped). Then decrement + drop-on-expiry so the actor
          // loses exactly STUN_DURATION of its OWN action turns. Log "cannot act" while
          // it suppressed the turn / "shakes off the stun" on expiry.
          stunnedThisTurn = true;
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = `${combatant[actor].name} is stunned and cannot act`;
          const events = expired ? [note, `${combatant[actor].name} shakes off the stun`] : [note];
          turns.push({
            round,
            actor, // the afflicted side loses ITS OWN turn — log against that side
            damage: 0, // a control ailment deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: events,
          });
          continue;
        }

        if (ailment.kind === 'freeze') {
          // The SECOND control ailment tick (TASK-59) — the MULTI-TURN action lock. It
          // reuses the SAME `stunnedThisTurn` skip-turn substrate Stun introduced: no HP
          // change (a freeze removes and adds no HP — HP stays monotonically
          // non-increasing, A-47), and because an active freeze is present at the TOP of
          // this actor's own turn it SUPPRESSES this actor's action step this turn (flag
          // it here; the action step below is skipped). Then decrement + drop-on-expiry so
          // the actor loses exactly FREEZE_DURATION of its OWN action turns — for
          // FREEZE_DURATION > 1 that is SEVERAL consecutive suppressed turns, each its own
          // "frozen and cannot act" line. Log "cannot act" while it suppressed the turn /
          // "thaws out" on the FINAL (expiring) locked turn.
          stunnedThisTurn = true;
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = `${combatant[actor].name} is frozen and cannot act`;
          const events = expired ? [note, `${combatant[actor].name} thaws out`] : [note];
          turns.push({
            round,
            actor, // the afflicted side loses ITS OWN turn — log against that side
            damage: 0, // a control ailment deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: events,
          });
          continue;
        }

        if (ailment.kind === 'sleep') {
          // The THIRD control ailment tick (TASK-60) — the INTERRUPTIBLE multi-turn
          // action lock. It REUSES the SAME `stunnedThisTurn` skip-turn substrate
          // Stun/Freeze use (NO third skip variable): no HP change (a sleep removes and
          // adds no HP — HP stays monotonically non-increasing, A-48), and because an
          // active sleep is present at the TOP of this actor's own turn it SUPPRESSES
          // this actor's action step this turn (flag it here; the action step below is
          // skipped). Then decrement + drop-on-expiry so the actor loses up to
          // SLEEP_DURATION of its OWN action turns UNLESS woken early by a damage hit
          // (the wake hook in resolveDamageStrike removes the arm mid-fight, so the
          // sleeper reaches its next turn WITHOUT this branch firing and acts normally).
          // Log "fast asleep" while it suppressed the turn / "wakes up" on NATURAL
          // expiry (distinct from the striker-side "jolted awake" early-wake note).
          stunnedThisTurn = true;
          ailment.turnsRemaining -= 1;
          const expired = ailment.turnsRemaining <= 0;
          if (expired) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          const note = `${combatant[actor].name} is fast asleep`;
          const events = expired ? [note, `${combatant[actor].name} wakes up`] : [note];
          turns.push({
            round,
            actor, // the afflicted side loses ITS OWN turn — log against that side
            damage: 0, // a control ailment deals no direct damage
            defenderHpAfter: me.hp, // unchanged — HP stays non-increasing
            statusEvents: events,
          });
          continue;
        }

        if (ailment.kind === 'wither-percent') {
          // Wither-Percent (TASK-132) — the FIRST maxHp-fraction DoT tick. Its per-turn amount was
          // MATERIALIZED at apply time as `floor(bearer.maxHp × ratio)` and stored as the FLAT
          // `damagePerTurn`, so this tick is a byte-identical subtract of that FIXED amount (mirroring
          // the flat burn/poison/bleed tick below) — it needs NO `maxHp` read here. The DISTINGUISHING
          // property vs every current-hp percent DoT: the amount is CONSTANT every turn even as `hp`
          // drops (a relentless, non-slowing attrition; a current-hp DoT's tick SHRINKS). Routed through
          // the SAME monotone `hp = max(0, hp − X)` write path (≥ 0 floor), so HP stays MONOTONICALLY
          // NON-INCREASING (A-42). No RNG (deterministic). A lethal tick ENDS the fight via killedByTick
          // exactly like a flat DoT. The amount dealt is logged each tick so a /battle player SEES it.
          const dealt = ailment.damagePerTurn;
          me.hp = Math.max(0, me.hp - dealt);
          const witherNote = `Wither deals ${dealt} to ${combatant[actor].name}`;
          ailment.turnsRemaining -= 1;
          if (ailment.turnsRemaining <= 0) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          turns.push({
            round,
            actor: foe, // the tick is the FOE's applied DoT paying off; log it against them
            damage: dealt,
            defenderHpAfter: me.hp,
            statusEvents: [witherNote],
          });
          if (me.hp <= 0) {
            decided = actor === 'player' ? 'loss' : 'win';
            killedByTick = true;
            break;
          }
          continue;
        }

        if (ailment.kind === 'burn-percent') {
          // Burn-Percent (TASK-120) — the FRACTIONAL DoT tick, the percent-of-CURRENT-HP twin of the
          // flat Burn/Poison/Bleed tick below. Instead of subtracting a FIXED `damagePerTurn` it
          // subtracts `floor(hp × damagePerTurnRatio)` of the bearer's CURRENT HP (reading ONLY `hp`,
          // NO `maxHp`; `floor` keeps the tick an integer), routed through the SAME monotone
          // `hp = max(0, hp − X)` write path (≥ 0 floor) — so HP stays MONOTONICALLY NON-INCREASING
          // (A-42). No RNG (deterministic). A lethal tick ENDS the fight via killedByTick exactly like
          // a flat DoT. The amount just dealt is logged each tick so a /battle player SEES it.
          const dealt = Math.floor(me.hp * ailment.damagePerTurnRatio);
          me.hp = Math.max(0, me.hp - dealt);
          const smolderNote = `Smolder deals ${dealt} to ${combatant[actor].name}`;
          ailment.turnsRemaining -= 1;
          if (ailment.turnsRemaining <= 0) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          turns.push({
            round,
            actor: foe, // the tick is the FOE's applied DoT paying off; log it against them
            damage: dealt,
            defenderHpAfter: me.hp,
            statusEvents: [smolderNote],
          });
          if (me.hp <= 0) {
            decided = actor === 'player' ? 'loss' : 'win';
            killedByTick = true;
            break;
          }
          continue;
        }

        if (ailment.kind === 'poison-percent') {
          // Poison-Percent (TASK-121) — the FRACTIONAL DoT tick, the percent-of-CURRENT-HP twin of the
          // flat Poison tick, mirroring `burn-percent`. Subtracts `floor(hp × damagePerTurnRatio)` of
          // the bearer's CURRENT HP (reading ONLY `hp`, NO `maxHp`; `floor` keeps it an integer),
          // routed through the SAME monotone `hp = max(0, hp − X)` write path (≥ 0 floor) — HP stays
          // MONOTONICALLY NON-INCREASING (A-42). No RNG. A lethal tick ENDS the fight via killedByTick.
          const dealt = Math.floor(me.hp * ailment.damagePerTurnRatio);
          me.hp = Math.max(0, me.hp - dealt);
          const toxinNote = `Toxin deals ${dealt} to ${combatant[actor].name}`;
          ailment.turnsRemaining -= 1;
          if (ailment.turnsRemaining <= 0) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          turns.push({
            round,
            actor: foe, // the tick is the FOE's applied DoT paying off; log it against them
            damage: dealt,
            defenderHpAfter: me.hp,
            statusEvents: [toxinNote],
          });
          if (me.hp <= 0) {
            decided = actor === 'player' ? 'loss' : 'win';
            killedByTick = true;
            break;
          }
          continue;
        }

        if (ailment.kind === 'bleed-percent') {
          // Bleed-Percent (TASK-122) — the FRACTIONAL DoT tick, the percent-of-CURRENT-HP twin of the
          // flat Bleed tick, mirroring `poison-percent`/`burn-percent`. Subtracts
          // `floor(hp × damagePerTurnRatio)` of the bearer's CURRENT HP (reading ONLY `hp`, NO `maxHp`;
          // `floor` keeps it an integer), routed through the SAME monotone `hp = max(0, hp − X)` write
          // path (≥ 0 floor) — HP stays MONOTONICALLY NON-INCREASING (A-42). No RNG. A lethal tick ENDS
          // the fight via killedByTick.
          const dealt = Math.floor(me.hp * ailment.damagePerTurnRatio);
          me.hp = Math.max(0, me.hp - dealt);
          const hemorrhageNote = `Hemorrhage deals ${dealt} to ${combatant[actor].name}`;
          ailment.turnsRemaining -= 1;
          if (ailment.turnsRemaining <= 0) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          turns.push({
            round,
            actor: foe, // the tick is the FOE's applied DoT paying off; log it against them
            damage: dealt,
            defenderHpAfter: me.hp,
            statusEvents: [hemorrhageNote],
          });
          if (me.hp <= 0) {
            decided = actor === 'player' ? 'loss' : 'win';
            killedByTick = true;
            break;
          }
          continue;
        }

        if (ailment.kind === 'corrode') {
          // The ESCALATING / RAMPING DoT tick (TASK-67) — the genuinely NEW shape. Like
          // a flat DoT it SUBTRACTS the CURRENT `damagePerTurn` HP (routed through the
          // SAME `hp = max(0, hp − X)` write path, ≥ 0 floor; a lethal tick ENDS the fight
          // via killedByTick just like Burn/Poison/Bleed), so HP stays MONOTONICALLY
          // NON-INCREASING (GUARDRAIL 2). The ONLY new behaviour vs a flat DoT: AFTER
          // dealing this tick it GROWS `damagePerTurn` by its `ramp` step, so the NEXT
          // tick bites harder — 2 → 4 → 6 → 8 over CORRODE_DURATION turns. The amount just
          // dealt is logged each tick, so a /battle player SEES it escalate turn over turn.
          const dealt = ailment.damagePerTurn;
          me.hp = Math.max(0, me.hp - dealt);
          const corrodeNote = `Corrode deals ${dealt} to ${combatant[actor].name}`;
          // Ramp UP for the next tick, then decrement the fuse + drop-on-expiry.
          ailment.damagePerTurn += ailment.ramp;
          ailment.turnsRemaining -= 1;
          if (ailment.turnsRemaining <= 0) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          turns.push({
            round,
            actor: foe, // the tick is the FOE's applied DoT paying off; log it against them
            damage: dealt,
            defenderHpAfter: me.hp,
            statusEvents: [corrodeNote],
          });
          if (me.hp <= 0) {
            decided = actor === 'player' ? 'loss' : 'win';
            killedByTick = true;
            break;
          }
          continue;
        }

        if (ailment.kind === 'corrode-percent') {
          // The fractional-RAMP DoT tick (TASK-123) — the DoT family's FOURTH & FINAL `-percent` twin,
          // the genuinely-new COMBINATION: percent-of-CURRENT-HP (like `bleed-percent`) whose RATIO itself
          // GROWS each tick (like `corrode`). SUBTRACT `floor(hp × damagePerTurnRatio)` of the bearer's
          // CURRENT HP (reading ONLY `hp`, NO `maxHp`), routed through the SAME monotone `hp = max(0, hp − X)`
          // write path (≥ 0 floor; a lethal tick ENDS the fight via killedByTick) — HP stays MONOTONICALLY
          // NON-INCREASING (A-42), no RNG. The ONLY new behaviour vs a fixed-ratio percent DoT: AFTER dealing
          // this tick it GROWS `damagePerTurnRatio` by its `rampRatio` step (the ratio-growth mirror of
          // `corrode`'s `damagePerTurn += ramp`), so the NEXT tick's ratio bites harder — 0.05 → 0.10 → 0.15
          // → 0.20 over CORRODE_DURATION turns. The amount just dealt is logged each tick.
          const dealt = Math.floor(me.hp * ailment.damagePerTurnRatio);
          me.hp = Math.max(0, me.hp - dealt);
          const necrosisNote = `Necrosis deals ${dealt} to ${combatant[actor].name}`;
          // Ramp the RATIO up for the next tick, then decrement the fuse + drop-on-expiry.
          ailment.damagePerTurnRatio += ailment.rampRatio;
          ailment.turnsRemaining -= 1;
          if (ailment.turnsRemaining <= 0) {
            me.statuses = me.statuses.filter((s) => s.kind !== kind);
          }
          turns.push({
            round,
            actor: foe, // the tick is the FOE's applied DoT paying off; log it against them
            damage: dealt,
            defenderHpAfter: me.hp,
            statusEvents: [necrosisNote],
          });
          if (me.hp <= 0) {
            decided = actor === 'player' ? 'loss' : 'win';
            killedByTick = true;
            break;
          }
          continue;
        }

        // A damage-over-time tick (Burn/Poison): subtract HP, and a lethal tick ends
        // the fight (the afflicted side goes down without acting).
        me.hp = Math.max(0, me.hp - ailment.damagePerTurn);
        const tickNote = `${AILMENT_LABEL[kind]} deals ${ailment.damagePerTurn} to ${combatant[actor].name}`;
        ailment.turnsRemaining -= 1;
        if (ailment.turnsRemaining <= 0) {
          me.statuses = me.statuses.filter((s) => s.kind !== kind);
        }
        turns.push({
          round,
          actor: foe, // the tick is the FOE's applied DoT paying off; log it against them
          damage: ailment.damagePerTurn,
          defenderHpAfter: me.hp,
          statusEvents: [tickNote],
        });
        if (me.hp <= 0) {
          decided = actor === 'player' ? 'loss' : 'win';
          killedByTick = true;
          break;
        }
      }
      if (killedByTick) return { decided, ended: true };

      // TASK-57: a stun present at the top of this turn suppresses the whole action
      // step — the actor forgoes its skill-select + effect application this turn (it
      // deals no damage), then the fight continues to the next actor. HP is untouched
      // by a skipped turn (monotonically non-increasing).
      if (stunnedThisTurn) return { decided, ended: false };

      // 3. Select + cast a skill; spend energy; apply composite effects in order.
      // TASK-64: the DETERMINISTIC TACTICAL policy (was the naive greedy selectSkill)
      // — it reads the defender's/own active statuses so it rotates through the
      // stranded mid-tier tactical skills instead of spamming the cheapest damage.
      const skill = selectSkillFor(me, them);
      me.energy -= skill.energyCost;

      let damage = 0;
      // TASK-159 (R-22 slice 20): did the primary `damage` strike CRIT this turn? Tracked
      // so the summary entry carries the additive optional `crit?` flag. Only the single
      // `damage` effect feeds the summary; the multihit path sets `crit` per-strike inline.
      let critThisTurn = false;
      // TASK-160 (R-22 slice 21): did the primary `damage` strike MISS this turn? Tracked
      // so the summary entry carries the additive optional `evaded?` flag, mirroring `crit`.
      let evadedThisTurn = false;
      // TASK-161 (R-22 slice 22): did an OFFENSIVE status this turn get RESISTED by
      // the defender (fail to land)? Tracked so the summary entry carries the additive
      // optional `resisted?` flag, mirroring `crit`/`evaded`. At `DEFAULT_RNG` (the
      // auto/production path) `statusResists(() => 0)` is FALSE, so this never flips
      // and the status always lands — the pre-resist contract byte-preserved.
      let resistedThisTurn = false;
      const statusEvents: string[] = [];
      // TASK-58: a `multihit` effect emits its OWN per-strike TurnLogEntry (so the
      // player SEES each hit land). When it does, we suppress the trailing summary
      // entry for a PURE multi-hit skill (double-strike has only the multihit effect),
      // since the strikes are already fully logged — avoiding a redundant 0-damage
      // duplicate. A composite skill mixing multihit with other effects would still
      // fall through to the summary for those; today none exists.
      let multiHitEmitted = false;
      for (const effect of skill.effects) {
        if (effect.kind === 'damage') {
          // A single strike through the shared damage core (TASK-58 refactor): reads
          // the live Weaken/Empower modifiers and drains any active shield before HP.
          const strike = resolveDamageStrike(me, them, combatant[actor], combatant[foe], rng);
          damage = strike.overflow;
          if (strike.crit) critThisTurn = true;
          if (strike.evaded) evadedThisTurn = true;
          statusEvents.push(...strike.statusEvents);
        } else if (effect.kind === 'execute') {
          // TASK-126: EXECUTE FINISHER — the FIRST mechanic the `maxHp` substrate unlocks. Deal the
          // normal strike through the SHARED core (reads live Weaken/Empower, drains any shield),
          // then — reading the defender's hp AFTER the strike against its (unmutated) `maxHp` — add
          // `bonusDamage` iff the foe is now at/below `floor(maxHp × hpThresholdRatio)` (the pure
          // {@link executeBonus} percent-of-MAX read). Bonus is subtracted through the SAME monotone
          // `hp = max(0, hp − X)` write as the strike, so HP stays monotonically non-increasing
          // (A-42 — execute only ever DEALS more, never heals). Priced Posture-B (87 > MAX_ENERGY),
          // so this branch never runs inside the shipped fights — proven in isolation via the direct
          // {@link executeBonus} apply units + the selectSkill(87) boundary. The '<name> is executed'
          // note rides the EXISTING optional statusEvents? field, so NO wire change (invariant 5).
          const strike = resolveDamageStrike(me, them, combatant[actor], combatant[foe]);
          statusEvents.push(...strike.statusEvents);
          const bonus = executeBonus(
            them.hp,
            combatant[foe].maxHp,
            effect.bonusDamage,
            effect.hpThresholdRatio,
          );
          if (bonus > 0) {
            them.hp = Math.max(0, them.hp - bonus);
            statusEvents.push(`${combatant[foe].name} is executed for ${bonus}`);
          }
          damage = strike.overflow + bonus;
        } else if (effect.kind === 'guillotine') {
          // TASK-127: GUILLOTINE FINISHER — the FIRST max-HP-FRACTION burst. Deal the normal strike
          // through the SHARED core (reads live Weaken/Empower, drains any shield), then — reading
          // the defender's hp AFTER the strike against its (unmutated) `maxHp` — add a bonus SIZED as
          // `floor(maxHp × bonusRatio)` iff the foe is now at/below `floor(maxHp × hpThresholdRatio)`
          // (the pure {@link guillotineBonus} percent-of-MAX read; the FIRST time `maxHp` SIZES a
          // damage number, vs execute's FIXED bonus). Bonus is subtracted through the SAME monotone
          // `hp = max(0, hp − X)` write as the strike, so HP stays monotonically non-increasing
          // (A-42 — guillotine only ever DEALS more, never heals). Priced Posture-B (88 > MAX_ENERGY),
          // so this branch never runs inside the shipped fights — proven in isolation via the direct
          // {@link guillotineBonus} apply units + the selectSkill(88) boundary. The '<name> is
          // guillotined' note rides the EXISTING optional statusEvents? field, so NO wire change
          // (invariant 5).
          const strike = resolveDamageStrike(me, them, combatant[actor], combatant[foe]);
          statusEvents.push(...strike.statusEvents);
          const bonus = guillotineBonus(
            them.hp,
            combatant[foe].maxHp,
            effect.bonusRatio,
            effect.hpThresholdRatio,
          );
          if (bonus > 0) {
            them.hp = Math.max(0, them.hp - bonus);
            statusEvents.push(`${combatant[foe].name} is guillotined for ${bonus}`);
          }
          damage = strike.overflow + bonus;
        } else if (effect.kind === 'rampage') {
          // TASK-128: RAMPAGE FINISHER — the FIRST MISSING-HP-FRACTION burst. Deal the normal strike
          // through the SHARED core (reads live Weaken/Empower, drains any shield), then — reading
          // the defender's hp AFTER the strike against its (unmutated) `maxHp` — add a bonus SIZED as
          // `floor(max(0, maxHp − hp) × bonusRatio)` UNCONDITIONALLY (the pure {@link rampageBonus}
          // missing-HP read; the FIRST time MISSING HP SIZES a damage number, vs guillotine's
          // fraction-of-MAX behind a threshold). The bonus is naturally 0 at full HP and grows as the
          // foe is worn down. Subtracted through the SAME monotone `hp = max(0, hp − X)` write as the
          // strike, so HP stays monotonically non-increasing (A-42 — rampage only ever DEALS more,
          // never heals). Priced Posture-B (89 > MAX_ENERGY), so this branch never runs inside the
          // shipped fights — proven in isolation via the direct {@link rampageBonus} apply units + the
          // selectSkill(89) boundary. The '<name> rampages for <n>' note rides the EXISTING optional
          // statusEvents? field, so NO wire change (invariant 5).
          const strike = resolveDamageStrike(me, them, combatant[actor], combatant[foe]);
          statusEvents.push(...strike.statusEvents);
          const bonus = rampageBonus(them.hp, combatant[foe].maxHp, effect.bonusRatio);
          if (bonus > 0) {
            them.hp = Math.max(0, them.hp - bonus);
            statusEvents.push(`${combatant[foe].name} rampaged for ${bonus}`);
          }
          damage = strike.overflow + bonus;
        } else if (effect.kind === 'bravado') {
          // TASK-129: BRAVADO FINISHER — the FIRST ATTACKER-OWN-maxHp-FRACTION burst. Deal the normal
          // strike through the SHARED core (reads live Weaken/Empower, drains any shield), then add a
          // bonus SIZED as `floor(attackerMaxHp × bonusRatio)` UNCONDITIONALLY (the pure
          // {@link bravadoBonus} attacker-own read; the FIRST time the engine sizes a bonus off the
          // CASTER's OWN frame — execute/guillotine/rampage all read the DEFENDER). The attacker's
          // `maxHp` is read from `combatant[actor]`, the SAME Combatant ALREADY passed to the shared
          // {@link resolveDamageStrike} seam — NO new param, NO signature change. Subtracted through
          // the SAME monotone `hp = max(0, hp − X)` write as the strike, so HP stays monotonically
          // non-increasing (A-42 — bravado only ever DEALS more, never heals). Priced Posture-B
          // (90 > MAX_ENERGY), so this branch never runs inside the shipped fights — proven in
          // isolation via the direct {@link bravadoBonus} apply units + the selectSkill(90) boundary.
          // The '<name> is struck for <n>' note rides the EXISTING optional statusEvents? field, so
          // NO wire change (invariant 5).
          const strike = resolveDamageStrike(me, them, combatant[actor], combatant[foe]);
          statusEvents.push(...strike.statusEvents);
          const bonus = bravadoBonus(combatant[actor].maxHp, effect.bonusRatio);
          if (bonus > 0) {
            them.hp = Math.max(0, them.hp - bonus);
            statusEvents.push(`${combatant[actor].name} strikes with bravado for ${bonus}`);
          }
          damage = strike.overflow + bonus;
        } else if (effect.kind === 'last-stand') {
          // TASK-130: LAST-STAND FINISHER — the FIRST ATTACKER-OWN-MISSING-HP-FRACTION burst,
          // completing the 2×2 maxHp-frame matrix. Deal the normal strike through the SHARED core
          // (reads live Weaken/Empower, drains any shield), then add a bonus SIZED as
          // `floor(max(0, attackerMaxHp − attackerHp) × bonusRatio)` UNCONDITIONALLY (the pure
          // {@link lastStandBonus} attacker-own-MISSING read; bravado reads the attacker's MAX,
          // rampage reads the DEFENDER's missing — this reads the CASTER's OWN missing HP, the SMT
          // "vengeance-of-the-wounded" idiom, harder-hitting the more worn-down the caster). Both the
          // attacker's `hp` AND `maxHp` are read from `combatant[actor]`, the SAME Combatant ALREADY
          // passed to the shared {@link resolveDamageStrike} seam — NO new param, NO signature change.
          // Subtracted through the SAME monotone `hp = max(0, hp − X)` write as the strike, so HP
          // stays monotonically non-increasing (A-42 — last-stand only ever DEALS more, never heals).
          // Priced Posture-B (91 > MAX_ENERGY), so this branch never runs inside the shipped fights —
          // proven in isolation via the direct {@link lastStandBonus} apply units + the
          // selectSkill(91) boundary. The '<name> makes a last stand for <n>' note rides the EXISTING
          // optional statusEvents? field, so NO wire change (invariant 5).
          const strike = resolveDamageStrike(me, them, combatant[actor], combatant[foe]);
          statusEvents.push(...strike.statusEvents);
          const bonus = lastStandBonus(
            combatant[actor].hp,
            combatant[actor].maxHp,
            effect.bonusRatio,
          );
          if (bonus > 0) {
            them.hp = Math.max(0, them.hp - bonus);
            statusEvents.push(`${combatant[actor].name} makes a last stand for ${bonus}`);
          }
          damage = strike.overflow + bonus;
        } else if (effect.kind === 'multihit') {
          // A MULTI-HIT (TASK-58): land `hits` DISCRETE strikes in this ONE action,
          // each its OWN log entry so the player SEES every hit. Each strike routes
          // through the SAME shared core as the single `damage` effect (so it reads the
          // live Weaken/Empower and consults the shield IN TURN — the shield depletes
          // strike-by-strike). HP stays monotonically non-increasing (every strike only
          // subtracts). Stop early if a strike drops the foe to ≤ 0 (no dead-man's
          // strikes past a KO).
          for (let hit = 0; hit < effect.hits; hit += 1) {
            const strike = resolveDamageStrike(me, them, combatant[actor], combatant[foe], rng);
            multiHitEmitted = true;
            const strikeNote = `${skill.name} hit ${hit + 1} of ${effect.hits}`;
            turns.push({
              round,
              actor,
              damage: strike.overflow,
              defenderHpAfter: them.hp,
              skill: skill.name,
              statusEvents: [strikeNote, ...strike.statusEvents],
              ...(strike.crit ? { crit: true } : {}),
              ...(strike.evaded ? { evaded: true } : {}),
            });
            if (them.hp <= 0) break;
          }
        } else if (effect.kind === 'cleanse') {
          // TASK-76: PURIFY — the FIRST status-REMOVAL effect. STRIP the CASTER's (`me`)
          // OWN harmful arms (DoTs / stat-downs / control locks) via the pure
          // {@link clearDebuffs}, LEAVING the caster's self-buffs intact (A-65). It writes
          // NO HP — only trims the status array — so HP stays monotonically non-increasing
          // (A-42). SELF-targeting like shield/empower/retaliate. It resolves ON CAST (does
          // not linger), so no AILMENT tick/spec slot. Priced above the pool (Posture-B),
          // so this branch never runs inside the shipped fights — proven in isolation. The
          // '<name> is Purified' note makes the removal observable in the log (the cast +
          // note ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          me.statuses = clearDebuffs(me.statuses);
          statusEvents.push(`${combatant[actor].name} is Purified`);
        } else if (effect.kind === 'dispel') {
          // TASK-77: PURGE — the SECOND status-REMOVAL effect and the HOSTILE inverse of
          // Purify. STRIP the FOE's (`them`) SELF-BUFFS (empower/shield/retaliate) via the
          // pure {@link stripBuffs}, LEAVING the foe's harmful arms (DoTs/stat-downs/control
          // locks) intact (A-66 — stripping a foe's DoT would HELP it). UNLIKE the
          // self-targeting cleanse, it targets the OPPONENT, so it routes through this
          // hostile/opponent branch. It writes NO HP — only trims the foe's status array —
          // so HP stays monotonically non-increasing (A-42). It resolves ON CAST (does not
          // linger), so no AILMENT tick/spec slot. Priced above the pool (Posture-B), so this
          // branch never runs inside the shipped fights — proven in isolation. The
          // '<foe> is Purged' note makes the removal observable in the log (the cast + note
          // ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          them.statuses = stripBuffs(them.statuses);
          statusEvents.push(`${combatant[foe].name} is Purged`);
        } else if (effect.kind === 'purloin') {
          // TASK-78: SPELLTHIEF — the THIRD status-REMOVAL effect and the FIRST
          // strip-and-TRANSFER. COMPOSE the two existing primitives via the pure
          // {@link stealBuffs}: STRIP the FOE's (`them`) SELF-BUFFS (empower/shield/retaliate)
          // via {@link stripBuffs}, LEAVING its harmful arms intact (A-66), AND — ONLY when a
          // strip actually occurred (the foe HAD a self-buff) — GRANT the CASTER (`me`) a FIXED
          // `empower` self-buff (the genuine, conditional steal; no free buff when there was
          // nothing to steal). Touches BOTH combatants' status arrays but writes NO HP — only
          // trims/appends the status arrays — so HP stays monotonically non-increasing (A-42).
          // It resolves ON CAST (does not linger), so no AILMENT tick/spec slot. Priced above
          // the pool (Posture-B), so this branch never runs inside the shipped fights — proven
          // in isolation. The notes make the steal observable in the log (the cast + notes ride
          // the EXISTING optional skill?/statusEvents? fields — no wire change).
          const steal = stealBuffs(me.statuses, them.statuses);
          me.statuses = steal.caster;
          them.statuses = steal.foe;
          if (steal.stole) {
            me.inflicted.add('empower'); // TASK-64: the granted self-buff was cast this fight
            statusEvents.push(`${combatant[actor].name} steals a buff from ${combatant[foe].name}`);
          } else {
            statusEvents.push(
              `${combatant[actor].name} finds nothing to steal from ${combatant[foe].name}`,
            );
          }
        } else if (effect.kind === 'reclaim') {
          // TASK-80: BACKFIRE — the FIFTH status-REMOVAL effect and the FIRST
          // PAYLOAD-PRESERVING self→foe DEBUFF TRANSFER (the A-68 refinement of Scapegoat).
          // FIRST CAPTURE the DISTINCT harmful debuff KINDS the CASTER (`me`) carries that
          // WILL be cleared — those in {@link CLEANSABLE_DEBUFF_KINDS} (reused verbatim, NOT a
          // hand-rolled set) — THEN clear them off the caster via the pure {@link clearDebuffs}
          // (verbatim — leaving the caster's self-buffs intact, A-65); THEN for EACH captured
          // kind INFLICT that SAME kind on the FOE (`them`) via the EXISTING {@link applyAilment}
          // builder (a payload-PRESERVING clone — the exact kinds, distinguishing Reclaim from
          // Displace's fixed `weaken`). `applyAilment` refreshes-not-stacks, so re-applying a
          // kind the foe already carries just refreshes it (at most one arm per kind). A
          // debuff-free caster clears nothing AND inflicts nothing (a GENUINE conditional
          // transfer, not an unconditional foe-debuff). Touches BOTH combatants' status arrays
          // but writes NO HP — only trims the caster's array + appends to the foe's — so HP
          // stays monotonically non-increasing (A-42). It resolves ON CAST (does not linger),
          // so no AILMENT tick/spec slot; the cloned kinds it inflicts ARE lingering foe
          // debuffs, but each reuses its existing arm/tick (untouched). Priced above the pool
          // (Posture-B), so this branch never runs inside the shipped fights — proven in
          // isolation. The notes make the transfer observable in the log (the cast + notes ride
          // the EXISTING optional skill?/statusEvents? fields — no wire change).
          const clonedKinds = [
            ...new Set(
              me.statuses.filter((s) => CLEANSABLE_DEBUFF_KINDS.has(s.kind)).map((s) => s.kind),
            ),
          ];
          me.statuses = clearDebuffs(me.statuses);
          if (clonedKinds.length > 0) {
            for (const kind of clonedKinds) {
              them.statuses = applyAilment(them.statuses, kind);
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} backfires ${clonedKinds.join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to reclaim`);
          }
        } else if (effect.kind === 'reclaim-stats') {
          // TASK-84: REBOUND-SNAP — the NINTH status-REMOVAL effect and the SECOND
          // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. FIRST CAPTURE the caster's (`me`) OWN
          // debuff ARMS whose kind is in the SUBSET {@link REBOUND_SNAP_KINDS} (the STAT-MODS
          // weaken/enfeeble/vulnerable — reused verbatim, NOT a hand-rolled set) with their
          // EXACT current turnsRemaining + magnitude fields (defReduction/atkReduction/
          // damageTakenBonus/etc.); THEN clear ONLY those subset kinds off the caster via the
          // pure {@link clearKinds}(me.statuses, REBOUND_SNAP_KINDS) — the caster KEEPS its DoTs
          // (burn/poison/bleed/corrode), control-locks (stun/freeze/sleep), doom AND its
          // self-buffs (empower/shield/retaliate). THIS partial clear over a DISJOINT subset
          // (vs Rebound-Split's DoT subset) IS the observable difference from Rebound-Split.
          // THEN — ONLY when at least one subset arm was captured — FULL-duration DEEP-COPY each
          // captured arm onto the FOE (`them`) via a per-arm `{ ...arm }` spread (exactly like
          // Rebound-Split, NO duration change — the KIND SELECTION is the new axis, not the
          // duration), de-duped by kind: any existing foe arm of a transferred kind is DROPPED
          // and REPLACED (refresh-not-stack; the caster carries at most one arm per kind so the
          // transferred set is itself unique). A caster carrying NONE of the subset kinds (even
          // if it carries other debuffs like burn) clears nothing AND moves nothing (a GENUINE
          // subset transfer). Touches BOTH combatants' status arrays but writes NO HP — the
          // moved arms are STAT-MODS (pure modifiers that never tick HP) — so HP stays
          // monotonically non-increasing (A-42), with ZERO MAX_ROUNDS concern even in principle.
          // It resolves ON CAST (does not linger), so no AILMENT tick/spec slot; the moved arms
          // ARE lingering foe stat-mod debuffs, but each reuses its existing arm (untouched).
          // Priced above the pool (Posture-B), so this branch never runs inside the shipped
          // fights — proven in isolation. The notes make the transfer observable in the log (the
          // cast + notes ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_SNAP_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_SNAP_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-cripple') {
          // TASK-88: REBOUND-CRIPPLE — the THIRTEENTH status-REMOVAL effect and the SECOND
          // MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. FIRST CAPTURE
          // the caster's (`me`) OWN debuff ARMS whose kind is in the SUBSET
          // {@link REBOUND_CRIPPLE_KINDS} (the UNION of the stat-mods AND the control-locks =
          // REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS — reused verbatim, NOT a hand-rolled set)
          // with their EXACT current turnsRemaining (+ magnitude for the stat-mod arms); THEN
          // clear ONLY those subset kinds off the caster via the pure
          // {@link clearKinds}(me.statuses, REBOUND_CRIPPLE_KINDS) — the caster KEEPS its DoTs
          // (burn/poison/bleed/corrode), its `doom` AND its self-buffs (empower/shield/retaliate).
          // THIS partial clear over the UNION of TWO disjoint families (leaving the DoTs AND
          // `doom` behind) IS the observable difference — it is the COMPLEMENTARY 2-of-4 pair to
          // Rebound-Blight (which moved the DoTs+locks); the two overlap ONLY on the control-locks.
          // THEN — ONLY when at least one subset arm was captured — FULL-duration DEEP-COPY each
          // captured arm onto the FOE (`them`) via a `{ ...arm }` spread (exactly like
          // Rebound-Snap/Lock/Blight, NO duration change — each stat-mod's turnsRemaining+magnitude
          // and each lock's turnsRemaining are preserved; the KIND SELECTION is the axis, not the
          // duration), de-duped by kind: any existing foe arm of a transferred kind is DROPPED and
          // REPLACED (refresh-not-stack; the caster carries at most one arm per kind so the
          // transferred set is itself unique). A caster carrying NONE of the subset kinds (even if
          // it carries other debuffs like burn/doom) clears nothing AND moves nothing (a GENUINE
          // subset transfer). Touches BOTH combatants' status arrays but writes NO HP at cast —
          // and NEITHER moved family ticks HP (stat-mods only scale damage, control-locks only
          // skip turns), so unlike Blight there is not even a deferred DoT to reason about, and in
          // Posture-B it never fires in-sim — so HP stays monotonically non-increasing (A-42). It
          // resolves ON CAST (does not linger), so no AILMENT tick/spec slot; the moved arms ARE
          // lingering foe debuffs, but reuse their existing arm/tick seams (untouched). Priced
          // above the pool (Posture-B), so this branch never runs inside the shipped fights —
          // proven in isolation. The notes make the transfer observable in the log (the cast +
          // notes ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_CRIPPLE_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_CRIPPLE_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-snaplockdoom') {
          // TASK-96: REBOUND-SNAPLOCKDOOM — the TWENTY-FIRST status-REMOVAL effect and the FOURTH and
          // LAST 3-of-4 MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the THIRD 3-of-4 union
          // that INCLUDES `doom`), CLOSING the 3-of-4 selectivity axis. FIRST CAPTURE the caster's
          // (`me`) OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_SNAPLOCKDOOM_KINDS} (the
          // UNION of the STAT-MODS, CONTROL-LOCKS AND `doom` = REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS
          // ∪ REBOUND_DOOM_KINDS = "everything but the DoTs" — reused verbatim, NOT a hand-rolled set)
          // with their EXACT current state (+ magnitude for the stat-mod arms, + turnsRemaining for
          // the control-lock arms, + detonationDamage for the `doom` arm); THEN clear ONLY those
          // subset kinds off the caster via the pure {@link clearKinds}(me.statuses,
          // REBOUND_SNAPLOCKDOOM_KINDS) — the caster KEEPS ONLY its DoT arms (burn/poison/bleed/
          // corrode) AND its self-buffs (empower/shield/retaliate). THIS partial clear over the UNION
          // of THREE disjoint families (leaving ONLY the DoTs behind) IS the observable difference —
          // it is the FOURTH and LAST 3-family (3-of-4) kind-set (Snaplockdoom = Snap ∪ Lock ∪ Doom;
          // a strict SUPERSET of Cripple/Snapdoom/Doomlock; the ONLY 3-of-4 triple that EXCLUDES the
          // DoTs), CLOSING the 3-of-4 depth. THEN — ONLY when at least one subset arm was captured —
          // FULL-duration DEEP-COPY each captured arm onto the FOE (`them`) via a `{ ...arm }` spread
          // (exactly like Rebound-Split/…/Purge/Seardoom/Blightdoom, NO duration change — each
          // stat-mod's magnitude, each control-lock's turnsRemaining and the `doom` arm's
          // detonationDamage+turnsRemaining are preserved; the KIND SELECTION is the axis, not the
          // duration), de-duped by kind: any existing foe arm of a transferred kind is DROPPED and
          // REPLACED (refresh-not-stack; the caster carries at most one arm per kind so the
          // transferred set is itself unique). A caster carrying NONE of the subset kinds (e.g. only a
          // `burn` + a self-buff) clears nothing AND moves nothing (a GENUINE subset transfer).
          // Touches BOTH combatants' status arrays but writes NO HP at cast — the moved `doom`
          // detonates LATER via its EXISTING delayed-kill seam on the FOE (deferred foe HP loss, still
          // non-increasing, exactly as Doomburn/Doomlock/Seardoom/Blightdoom) and the moved
          // control-locks change only the foe's skip payoff via their EXISTING seams — so HP stays
          // monotonically non-increasing (A-42), and in Posture-B this branch never fires in-sim. It
          // resolves ON CAST (does not linger), so no AILMENT tick/spec slot; the moved arms ARE
          // lingering foe debuffs, but reuse their existing arm/tick seams (untouched). Priced above
          // the pool (Posture-B), so this branch never runs inside the shipped fights — proven in
          // isolation. The notes make the transfer observable in the log (the cast + notes ride the
          // EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_SNAPLOCKDOOM_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_SNAPLOCKDOOM_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-blightdoom') {
          // TASK-95: REBOUND-BLIGHTDOOM — the TWENTIETH status-REMOVAL effect and the THIRD 3-of-4
          // MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the SECOND 3-of-4 union that
          // INCLUDES `doom`), ADVANCING the 3-of-4 selectivity DEPTH. FIRST CAPTURE the caster's
          // (`me`) OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_BLIGHTDOOM_KINDS} (the
          // UNION of the DoTs, CONTROL-LOCKS AND `doom` = REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS ∪
          // REBOUND_DOOM_KINDS = "everything but the STAT-MODS" — reused verbatim, NOT a hand-rolled
          // set) with their EXACT current turnsRemaining (+ damagePerTurn for the DoT arms, +
          // turnsRemaining for the control-lock arms, + detonationDamage for the `doom` arm); THEN
          // clear ONLY those subset kinds off the caster via the pure {@link clearKinds}(me.statuses,
          // REBOUND_BLIGHTDOOM_KINDS) — the caster KEEPS ONLY its stat-mod arms (weaken/enfeeble/
          // vulnerable) AND its self-buffs (empower/shield/retaliate). THIS partial clear over the
          // UNION of THREE disjoint families (leaving ONLY the stat-mods behind) IS the observable
          // difference — it is the THIRD 3-family (3-of-4) kind-set (Blightdoom = Split ∪ Lock ∪ Doom;
          // a strict SUPERSET of Blight/Doomburn/Doomlock; the MIRROR of Seardoom across the
          // stat-mod/control-lock swap — Blightdoom has the locks and not the stat-mods, Seardoom has
          // the stat-mods and not the locks), ADVANCING the 3-of-4 depth. THEN — ONLY when at least
          // one subset arm was captured — FULL-duration DEEP-COPY each captured arm onto the FOE
          // (`them`) via a `{ ...arm }` spread (exactly like Rebound-Split/…/Doomlock/Purge/Seardoom,
          // NO duration change — each DoT's turnsRemaining+damagePerTurn, each control-lock's
          // turnsRemaining and the `doom` arm's detonationDamage+turnsRemaining are preserved; the
          // KIND SELECTION is the axis, not the duration), de-duped by kind: any existing foe arm of a
          // transferred kind is DROPPED and REPLACED (refresh-not-stack; the caster carries at most one
          // arm per kind so the transferred set is itself unique). A caster carrying NONE of the subset
          // kinds (e.g. only a `weaken` + a self-buff) clears nothing AND moves nothing (a GENUINE
          // subset transfer). Touches BOTH combatants' status arrays but writes NO HP at cast — the
          // moved DoTs tick LATER via the EXISTING monotone `Math.max(0, hp − X)` seam on the FOE, the
          // moved `doom` detonates via its EXISTING delayed-kill seam (deferred foe HP loss, still
          // non-increasing, exactly as Doomburn/Doomlock/Seardoom) and the moved control-locks change
          // only the foe's skip payoff via their EXISTING seams — so HP stays monotonically
          // non-increasing (A-42), and in Posture-B this branch never fires in-sim. It resolves ON CAST
          // (does not linger), so no AILMENT tick/spec slot; the moved arms ARE lingering foe debuffs,
          // but reuse their existing arm/tick seams (untouched). Priced above the pool (Posture-B), so
          // this branch never runs inside the shipped fights — proven in isolation. The notes make the
          // transfer observable in the log (the cast + notes ride the EXISTING optional
          // skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_BLIGHTDOOM_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_BLIGHTDOOM_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-seardoom') {
          // TASK-94: REBOUND-SEARDOOM — the NINETEENTH status-REMOVAL effect and the SECOND 3-of-4
          // MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER (the FIRST 3-of-4 union that
          // INCLUDES `doom`), ADVANCING the 3-of-4 selectivity DEPTH. FIRST CAPTURE the caster's
          // (`me`) OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_SEARDOOM_KINDS} (the
          // UNION of the DoTs, STAT-MODS AND `doom` = REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪
          // REBOUND_DOOM_KINDS = "everything but the CONTROL-LOCKS" — reused verbatim, NOT a
          // hand-rolled set) with their EXACT current turnsRemaining (+ damagePerTurn for the DoT
          // arms, + magnitude for the stat-mod arms, + detonationDamage for the `doom` arm); THEN
          // clear ONLY those subset kinds off the caster via the pure {@link clearKinds}(me.statuses,
          // REBOUND_SEARDOOM_KINDS) — the caster KEEPS ONLY its control-lock arms (stun/freeze/sleep)
          // AND its self-buffs (empower/shield/retaliate). THIS partial clear over the UNION of THREE
          // disjoint families (leaving ONLY the control-locks behind) IS the observable difference —
          // it is the SECOND 3-family (3-of-4) kind-set (Seardoom = Split ∪ Snap ∪ Doom; a strict
          // SUPERSET of Sear/Doomburn/Snapdoom; the MIRROR of Purge across the doom/control-lock
          // swap — Seardoom has `doom` and not the locks, Purge has the locks and not `doom`),
          // ADVANCING the 3-of-4 depth. THEN — ONLY when at least one subset arm was captured —
          // FULL-duration DEEP-COPY each captured arm onto the FOE (`them`) via a `{ ...arm }` spread
          // (exactly like Rebound-Split/…/Doomlock/Purge, NO duration change — each DoT's
          // turnsRemaining+damagePerTurn, each stat-mod's turnsRemaining+magnitude and the `doom`
          // arm's detonationDamage+turnsRemaining are preserved; the KIND SELECTION is the axis, not
          // the duration), de-duped by kind: any existing foe arm of a transferred kind is DROPPED
          // and REPLACED (refresh-not-stack; the caster carries at most one arm per kind so the
          // transferred set is itself unique). A caster carrying NONE of the subset kinds (e.g. only
          // a `stun` + a self-buff) clears nothing AND moves nothing (a GENUINE subset transfer).
          // Touches BOTH combatants' status arrays but writes NO HP at cast — the moved DoTs tick
          // LATER via the EXISTING monotone `Math.max(0, hp − X)` seam on the FOE, the moved `doom`
          // detonates via its EXISTING delayed-kill seam (deferred foe HP loss, still non-increasing,
          // exactly as Doomburn/Purge) and the moved stat-mods change only the foe's damage payoff
          // via their EXISTING seams — so HP stays monotonically non-increasing (A-42), and in
          // Posture-B this branch never fires in-sim. It resolves ON CAST (does not linger), so no
          // AILMENT tick/spec slot; the moved arms ARE lingering foe debuffs, but reuse their
          // existing arm/tick seams (untouched). Priced above the pool (Posture-B), so this branch
          // never runs inside the shipped fights — proven in isolation. The notes make the transfer
          // observable in the log (the cast + notes ride the EXISTING optional skill?/statusEvents?
          // fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_SEARDOOM_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_SEARDOOM_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-purge') {
          // TASK-93: REBOUND-PURGE — the EIGHTEENTH status-REMOVAL effect and the FIRST 3-of-4
          // MULTI-FAMILY SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, OPENING the 3-of-4 selectivity
          // DEPTH. FIRST CAPTURE the caster's (`me`) OWN debuff ARMS whose kind is in the SUBSET
          // {@link REBOUND_PURGE_KINDS} (the UNION of the DoTs, STAT-MODS AND CONTROL-LOCKS =
          // REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS ∪ REBOUND_LOCK_KINDS = "everything but `doom`"
          // — reused verbatim, NOT a hand-rolled set) with their EXACT current turnsRemaining (+
          // damagePerTurn for the DoT arms, + magnitude for the stat-mod arms); THEN clear ONLY
          // those subset kinds off the caster via the pure {@link clearKinds}(me.statuses,
          // REBOUND_PURGE_KINDS) — the caster KEEPS ONLY its `doom` arm AND its self-buffs
          // (empower/shield/retaliate). THIS partial clear over the UNION of THREE disjoint families
          // (leaving ONLY `doom` behind) IS the observable difference — it is the FIRST 3-family
          // (3-of-4) kind-set (Purge = Split ∪ Snap ∪ Lock; a strict SUPERSET of every singleton and
          // of the three `doom`-excluding 2-of-4 unions Blight/Cripple/Sear; DISTINCT from Sear
          // which is strictly SMALLER — Sear EXCLUDES the control-locks), OPENING the 3-of-4 depth after
          // the six 2-of-4 unions closed. THEN — ONLY when at least one subset arm was captured —
          // FULL-duration DEEP-COPY each captured arm onto the FOE (`them`) via a `{ ...arm }` spread
          // (exactly like Rebound-Split/Snap/Lock/Blight/Cripple/Sear/Doomburn/Snapdoom/Doomlock, NO
          // duration change — each DoT's turnsRemaining+damagePerTurn, each stat-mod's
          // turnsRemaining+magnitude and each control-lock's turnsRemaining are preserved; the KIND
          // SELECTION is the axis, not the duration), de-duped by kind: any existing foe arm of a
          // transferred kind is DROPPED and REPLACED (refresh-not-stack; the caster carries at most
          // one arm per kind so the transferred set is itself unique). A caster carrying NONE of the
          // subset kinds (e.g. only a `doom` + a self-buff) clears nothing AND moves nothing (a
          // GENUINE subset transfer). Touches BOTH combatants' status arrays but writes NO HP at cast
          // — the moved DoTs tick LATER via the EXISTING monotone `Math.max(0, hp − X)` seam on the
          // FOE (deferred foe HP loss, still non-increasing, exactly as Doomburn/Blight) and the
          // moved stat-mods/control-locks change only the foe's damage/skip payoff via their EXISTING
          // seams — so HP stays monotonically non-increasing (A-42), and in Posture-B this branch
          // never fires in-sim. It resolves ON CAST (does not linger), so no AILMENT tick/spec slot;
          // the moved arms ARE lingering foe debuffs, but reuse their existing arm/tick seams
          // (untouched). Priced above the pool (Posture-B), so this branch never runs inside the
          // shipped fights — proven in isolation. The notes make the transfer observable in the log
          // (the cast + notes ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_PURGE_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_PURGE_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-doomlock') {
          // TASK-92: REBOUND-DOOMLOCK — the SEVENTEENTH status-REMOVAL effect and the SIXTH (and
          // FINAL) MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the THIRD
          // (and last) union CONTAINING `doom`. FIRST CAPTURE the caster's (`me`) OWN debuff ARMS
          // whose kind is in the SUBSET {@link REBOUND_DOOMLOCK_KINDS} (the UNION of the
          // CONTROL-LOCKS AND `doom` = REBOUND_LOCK_KINDS ∪ REBOUND_DOOM_KINDS — reused verbatim,
          // NOT a hand-rolled set) with their EXACT current turnsRemaining (the timer for each
          // control-lock arm and for the `doom` arm); THEN clear ONLY those subset kinds off the
          // caster via the pure {@link clearKinds}(me.statuses, REBOUND_DOOMLOCK_KINDS) — the caster
          // KEEPS its DoTs (burn/poison/bleed/corrode), its stat-mods (weaken/enfeeble/vulnerable)
          // AND its self-buffs (empower/shield/retaliate). THIS partial clear over the UNION of TWO
          // disjoint families (leaving the DoTs AND stat-mods behind) IS the observable difference —
          // it is the THIRD union CONTAINING `doom` (Doomlock = Lock ∪ Doom; distinct from Doomburn
          // = Split ∪ Doom and Snapdoom = Snap ∪ Doom which share only `doom`, from Blight which
          // moved DoTs+locks and Cripple which moved stat-mods+locks — Doomlock shares only the locks
          // with Blight/Cripple and shares only `doom` with Doomburn/Snapdoom), CLOSING all six
          // 2-of-4 unions. THEN — ONLY when at least one subset arm was captured — FULL-duration
          // DEEP-COPY each captured arm onto the FOE (`them`) via a `{ ...arm }` spread (exactly like
          // Rebound-Split/Snap/Blight/Cripple/Sear/Doomburn/Snapdoom, NO duration change — each
          // control-lock's turnsRemaining and the `doom` arm's turnsRemaining are preserved; the KIND
          // SELECTION is the axis, not the duration), de-duped by kind: any existing foe arm of a
          // transferred kind is DROPPED and REPLACED (refresh-not-stack; the caster carries at most
          // one arm per kind so the transferred set is itself unique). A caster carrying NONE of the
          // subset kinds (even if it carries other debuffs like burn/weaken) clears nothing AND moves
          // nothing (a GENUINE subset transfer). Touches BOTH combatants' status arrays but writes NO
          // HP at cast — the moved control-locks change only the foe's skip/timing payoff via their
          // EXISTING seams and the moved `doom` fires via its EXISTING delayed-kill seam (deferred
          // foe HP loss, still non-increasing, exactly as Doomburn/Snapdoom) — so HP stays
          // monotonically non-increasing (A-42), and in Posture-B this branch never fires in-sim. It
          // resolves ON CAST (does not linger), so no AILMENT tick/spec slot; the moved arms ARE
          // lingering foe debuffs, but reuse their existing arm/tick seams (untouched). Priced above
          // the pool (Posture-B), so this branch never runs inside the shipped fights — proven in
          // isolation. The notes make the transfer observable in the log (the cast + notes ride the
          // EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_DOOMLOCK_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_DOOMLOCK_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-snapdoom') {
          // TASK-91: REBOUND-SNAPDOOM — the SIXTEENTH status-REMOVAL effect and the FIFTH
          // MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the SECOND union
          // CONTAINING `doom`. FIRST CAPTURE the caster's (`me`) OWN debuff ARMS whose kind is in
          // the SUBSET {@link REBOUND_SNAPDOOM_KINDS} (the UNION of the STAT-MODS AND `doom` =
          // REBOUND_SNAP_KINDS ∪ REBOUND_DOOM_KINDS — reused verbatim, NOT a hand-rolled set) with
          // their EXACT current turnsRemaining (+ magnitude for the stat-mod arms, the timer for the
          // `doom` arm); THEN clear ONLY those subset kinds off the caster via the pure
          // {@link clearKinds}(me.statuses, REBOUND_SNAPDOOM_KINDS) — the caster KEEPS its DoTs
          // (burn/poison/bleed/corrode), its control-locks (stun/freeze/sleep) AND its self-buffs
          // (empower/shield/retaliate). THIS partial clear over the UNION of TWO disjoint families
          // (leaving the DoTs AND control-locks behind) IS the observable difference — it is the
          // SECOND union CONTAINING `doom` (Snapdoom = Snap ∪ Doom; distinct from Doomburn = Split ∪
          // Doom which shares only `doom`, from Blight which moved DoTs+locks, Cripple which moved
          // stat-mods+locks AND Sear which moved DoTs+stat-mods — Snapdoom shares only the stat-mods
          // with Cripple/Sear and shares only `doom` with Doomburn). THEN — ONLY when at least one
          // subset arm was captured — FULL-duration DEEP-COPY each captured arm onto the FOE (`them`)
          // via a `{ ...arm }` spread (exactly like Rebound-Split/Snap/Blight/Cripple/Sear/Doomburn,
          // NO duration change — each stat-mod's turnsRemaining+magnitude and the `doom` arm's
          // turnsRemaining are preserved; the KIND SELECTION is the axis, not the duration), de-duped
          // by kind: any existing foe arm of a transferred kind is DROPPED and REPLACED
          // (refresh-not-stack; the caster carries at most one arm per kind so the transferred set is
          // itself unique). A caster carrying NONE of the subset kinds (even if it carries other
          // debuffs like burn/stun) clears nothing AND moves nothing (a GENUINE subset transfer).
          // Touches BOTH combatants' status arrays but writes NO HP at cast — the moved stat-mods
          // change only the foe's damage-side payoff via their EXISTING seams and the moved `doom`
          // fires via its EXISTING delayed-kill seam (deferred foe HP loss, still non-increasing,
          // exactly as Doomburn) — so HP stays monotonically non-increasing (A-42), and in Posture-B
          // this branch never fires in-sim. It resolves ON CAST (does not linger), so no AILMENT
          // tick/spec slot; the moved arms ARE lingering foe debuffs, but reuse their existing
          // arm/tick seams (untouched). Priced above the pool (Posture-B), so this branch never runs
          // inside the shipped fights — proven in isolation. The notes make the transfer observable
          // in the log (the cast + notes ride the EXISTING optional skill?/statusEvents? fields — no
          // wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_SNAPDOOM_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_SNAPDOOM_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-doomburn') {
          // TASK-90: REBOUND-DOOMBURN — the FIFTEENTH status-REMOVAL effect and the FOURTH
          // MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER, the FIRST union
          // CONTAINING `doom`. FIRST CAPTURE the caster's (`me`) OWN debuff ARMS whose kind is in
          // the SUBSET {@link REBOUND_DOOMBURN_KINDS} (the UNION of the DoTs AND `doom` =
          // REBOUND_SPLIT_KINDS ∪ REBOUND_DOOM_KINDS — reused verbatim, NOT a hand-rolled set) with
          // their EXACT current turnsRemaining (+ damagePerTurn/ramp for the DoT arms, the timer for
          // the `doom` arm); THEN clear ONLY those subset kinds off the caster via the pure
          // {@link clearKinds}(me.statuses, REBOUND_DOOMBURN_KINDS) — the caster KEEPS its stat-mods
          // (weaken/enfeeble/vulnerable), its control-locks (stun/freeze/sleep) AND its self-buffs
          // (empower/shield/retaliate). THIS partial clear over the UNION of TWO disjoint families
          // (leaving the stat-mods AND control-locks behind) IS the observable difference — it is
          // the FIRST union CONTAINING `doom` (Doomburn = Split ∪ Doom; distinct from Blight which
          // moved DoTs+locks, Cripple which moved stat-mods+locks AND Sear which moved DoTs+stat-mods
          // — Doomburn shares only the DoTs with Blight/Sear and shares nothing with Cripple).
          // THEN — ONLY when at least one subset arm was captured — FULL-duration DEEP-COPY each
          // captured arm onto the FOE (`them`) via a `{ ...arm }` spread (exactly like Rebound-Split/
          // Snap/Blight/Cripple/Sear, NO duration change — each DoT's turnsRemaining+damagePerTurn+
          // ramp and the `doom` arm's turnsRemaining are preserved; the KIND SELECTION is the axis,
          // not the duration), de-duped by kind: any existing foe arm of a transferred kind is
          // DROPPED and REPLACED (refresh-not-stack; the caster carries at most one arm per kind so
          // the transferred set is itself unique). A caster carrying NONE of the subset kinds (even
          // if it carries other debuffs like weaken/stun) clears nothing AND moves nothing (a GENUINE
          // subset transfer). Touches BOTH combatants' status arrays but writes NO HP at cast — the
          // moved DoTs tick LATER on the FOE via the EXISTING monotone DoT seam and the moved `doom`
          // fires via its EXISTING delayed-kill seam (deferred foe HP loss, still non-increasing,
          // exactly as Blight) — so HP stays monotonically non-increasing (A-42), and in Posture-B
          // this branch never fires in-sim. It resolves ON CAST (does not linger), so no AILMENT
          // tick/spec slot; the moved arms ARE lingering foe debuffs, but reuse their existing
          // arm/tick seams (untouched). Priced above the pool (Posture-B), so this branch never runs
          // inside the shipped fights — proven in isolation. The notes make the transfer observable
          // in the log (the cast + notes ride the EXISTING optional skill?/statusEvents? fields — no
          // wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_DOOMBURN_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_DOOMBURN_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-sear') {
          // TASK-89: REBOUND-SEAR — the FOURTEENTH status-REMOVAL effect and the THIRD
          // MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. FIRST CAPTURE
          // the caster's (`me`) OWN debuff ARMS whose kind is in the SUBSET
          // {@link REBOUND_SEAR_KINDS} (the UNION of the DoTs AND the stat-mods =
          // REBOUND_SPLIT_KINDS ∪ REBOUND_SNAP_KINDS — reused verbatim, NOT a hand-rolled set)
          // with their EXACT current turnsRemaining (+ damagePerTurn/ramp for the DoT arms,
          // + magnitude for the stat-mod arms); THEN clear ONLY those subset kinds off the caster
          // via the pure {@link clearKinds}(me.statuses, REBOUND_SEAR_KINDS) — the caster KEEPS
          // its control-locks (stun/freeze/sleep), its `doom` AND its self-buffs
          // (empower/shield/retaliate). THIS partial clear over the UNION of TWO disjoint families
          // (leaving the control-locks AND `doom` behind) IS the observable difference — it is the
          // FIRST union NOT containing the control-locks (Sear = Split ∪ Snap; distinct from Blight
          // which moved DoTs+locks AND from Cripple which moved stat-mods+locks — Sear shares the
          // DoTs with Blight and the stat-mods with Cripple but neither's locks). THEN — ONLY when
          // at least one subset arm was captured — FULL-duration DEEP-COPY each captured arm onto
          // the FOE (`them`) via a `{ ...arm }` spread (exactly like Rebound-Split/Snap/Blight/
          // Cripple, NO duration change — each DoT's turnsRemaining+damagePerTurn+ramp and each
          // stat-mod's turnsRemaining+magnitude are preserved; the KIND SELECTION is the axis, not
          // the duration), de-duped by kind: any existing foe arm of a transferred kind is DROPPED
          // and REPLACED (refresh-not-stack; the caster carries at most one arm per kind so the
          // transferred set is itself unique). A caster carrying NONE of the subset kinds (even if
          // it carries other debuffs like stun/doom) clears nothing AND moves nothing (a GENUINE
          // subset transfer). Touches BOTH combatants' status arrays but writes NO HP at cast — the
          // moved DoTs tick LATER on the FOE via the EXISTING monotone DoT seam (deferred foe HP
          // loss, still non-increasing, exactly as Blight) and the moved stat-mods only scale
          // damage — so HP stays monotonically non-increasing (A-42), and in Posture-B this branch
          // never fires in-sim. It resolves ON CAST (does not linger), so no AILMENT tick/spec slot;
          // the moved arms ARE lingering foe debuffs, but reuse their existing arm/tick seams
          // (untouched). Priced above the pool (Posture-B), so this branch never runs inside the
          // shipped fights — proven in isolation. The notes make the transfer observable in the log
          // (the cast + notes ride the EXISTING optional skill?/statusEvents? fields — no wire
          // change).
          const capturedArms = me.statuses.filter((s) => REBOUND_SEAR_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_SEAR_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-blight') {
          // TASK-87: REBOUND-BLIGHT — the TWELFTH status-REMOVAL effect and the FIRST
          // MULTI-FAMILY (PAIR/UNION) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. FIRST CAPTURE
          // the caster's (`me`) OWN debuff ARMS whose kind is in the SUBSET
          // {@link REBOUND_BLIGHT_KINDS} (the UNION of the DoTs AND the control-locks =
          // REBOUND_SPLIT_KINDS ∪ REBOUND_LOCK_KINDS — reused verbatim, NOT a hand-rolled set)
          // with their EXACT current turnsRemaining (+ damagePerTurn/ramp for the DoT arms);
          // THEN clear ONLY those subset kinds off the caster via the pure
          // {@link clearKinds}(me.statuses, REBOUND_BLIGHT_KINDS) — the caster KEEPS its
          // stat-mods (weaken/enfeeble/vulnerable), its `doom` AND its self-buffs
          // (empower/shield/retaliate). THIS partial clear over the UNION of TWO disjoint
          // families (leaving the stat-mods AND `doom` behind) IS the observable difference —
          // it moves MORE THAN one family but LESS than the whole set, OPENING the union axis
          // and PROVING clearKinds handles a non-singleton multi-family set. THEN — ONLY when at
          // least one subset arm was captured — FULL-duration DEEP-COPY each captured arm onto
          // the FOE (`them`) via a `{ ...arm }` spread (exactly like Rebound-Split/Snap/Lock/Doom,
          // NO duration change — each DoT's turnsRemaining+damagePerTurn+ramp and each lock's
          // turnsRemaining are preserved; the KIND SELECTION is the new axis, not the duration),
          // de-duped by kind: any existing foe arm of a transferred kind is DROPPED and REPLACED
          // (refresh-not-stack; the caster carries at most one arm per kind so the transferred
          // set is itself unique). A caster carrying NONE of the subset kinds (even if it carries
          // other debuffs like weaken/doom) clears nothing AND moves nothing (a GENUINE subset
          // transfer). Touches BOTH combatants' status arrays but writes NO HP at cast — the
          // moved DoTs detonate LATER via the EXISTING monotone `Math.max(0, hp - damagePerTurn)`
          // seam, the moved locks write no HP, and in Posture-B it never fires in-sim — so HP
          // stays monotonically non-increasing (A-42). It resolves ON CAST (does not linger), so
          // no AILMENT tick/spec slot; the moved arms ARE lingering foe debuffs, but reuse their
          // existing arm/tick seams (untouched). Priced above the pool (Posture-B), so this branch
          // never runs inside the shipped fights — proven in isolation. The notes make the
          // transfer observable in the log (the cast + notes ride the EXISTING optional
          // skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_BLIGHT_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_BLIGHT_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-doom') {
          // TASK-86: REBOUND-DOOM — the ELEVENTH status-REMOVAL effect and the FOURTH (and
          // final) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. FIRST CAPTURE the caster's (`me`)
          // OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_DOOM_KINDS} (the single
          // deferred `doom` — reused verbatim, NOT a hand-rolled set) with their EXACT current
          // turnsRemaining + detonationDamage; THEN clear ONLY that subset kind off the caster
          // via the pure {@link clearKinds}(me.statuses, REBOUND_DOOM_KINDS) — the caster KEEPS
          // its DoTs (burn/poison/bleed/corrode), stat-mods (weaken/enfeeble/vulnerable),
          // control-locks (stun/freeze/sleep) AND its self-buffs (empower/shield/retaliate).
          // THIS partial clear over a subset DISJOINT from all three other subsets IS the
          // observable difference — the four subsets partition the FULL cleansable set, CLOSING
          // the axis. THEN — ONLY when the `doom` arm was captured — FULL-duration DEEP-COPY it
          // onto the FOE (`them`) via a `{ ...arm }` spread (exactly like Rebound-Split/Snap/Lock,
          // NO duration change — the flat `doom` arm's turnsRemaining AND detonationDamage are
          // preserved; the KIND SELECTION is the new axis, not the duration), de-duped by kind:
          // any existing foe `doom` arm is DROPPED and REPLACED (refresh-not-stack; the caster
          // carries at most one arm per kind so the transferred set is itself unique). A caster
          // carrying NO `doom` arm (even if it carries other debuffs like burn/weaken/stun)
          // clears nothing AND moves nothing (a GENUINE subset transfer). Touches BOTH
          // combatants' status arrays but writes NO HP at cast — the moved `doom` detonates
          // LATER via the EXISTING monotone `Math.max(0, hp - burst)` seam, and in Posture-B it
          // never fires in-sim — so HP stays monotonically non-increasing (A-42). It resolves ON
          // CAST (does not linger), so no AILMENT tick/spec slot; the moved arm IS a lingering
          // foe `doom` debuff, but reuses its existing arm/detonation seam (untouched). Priced
          // above the pool (Posture-B), so this branch never runs inside the shipped fights —
          // proven in isolation. The notes make the transfer observable in the log (the cast +
          // notes ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_DOOM_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_DOOM_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-locks') {
          // TASK-85: REBOUND-LOCK — the TENTH status-REMOVAL effect and the THIRD (and final
          // natural) SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. FIRST CAPTURE the caster's (`me`)
          // OWN debuff ARMS whose kind is in the SUBSET {@link REBOUND_LOCK_KINDS} (the
          // CONTROL-LOCKS stun/freeze/sleep — reused verbatim, NOT a hand-rolled set) with their
          // EXACT current turnsRemaining; THEN clear ONLY those subset kinds off the caster via
          // the pure {@link clearKinds}(me.statuses, REBOUND_LOCK_KINDS) — the caster KEEPS its
          // DoTs (burn/poison/bleed/corrode), stat-mods (weaken/enfeeble/vulnerable), doom AND
          // its self-buffs (empower/shield/retaliate). THIS partial clear over a subset DISJOINT
          // from BOTH Rebound-Split's DoT subset AND Rebound-Snap's stat-mod subset IS the
          // observable difference — the three subsets partition the harmful non-doom families.
          // THEN — ONLY when at least one subset arm was captured — FULL-duration DEEP-COPY each
          // captured arm onto the FOE (`them`) via a per-arm `{ ...arm }` spread (exactly like
          // Rebound-Split/Rebound-Snap, NO duration change — the KIND SELECTION is the new axis,
          // not the duration), de-duped by kind: any existing foe arm of a transferred kind is
          // DROPPED and REPLACED (refresh-not-stack; the caster carries at most one arm per kind
          // so the transferred set is itself unique). A caster carrying NONE of the subset kinds
          // (even if it carries other debuffs like burn/weaken) clears nothing AND moves nothing
          // (a GENUINE subset transfer). Touches BOTH combatants' status arrays but writes NO HP
          // — the moved arms are CONTROL-LOCKS (turn-skip modifiers that never tick HP) — so HP
          // stays monotonically non-increasing (A-42), with ZERO MAX_ROUNDS concern even in
          // principle. It resolves ON CAST (does not linger), so no AILMENT tick/spec slot; the
          // moved arms ARE lingering foe control-lock debuffs, but each reuses its existing arm
          // (untouched). Priced above the pool (Posture-B), so this branch never runs inside the
          // shipped fights — proven in isolation. The notes make the transfer observable in the
          // log (the cast + notes ride the EXISTING optional skill?/statusEvents? fields — no
          // wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_LOCK_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_LOCK_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} snaps its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to snap`);
          }
        } else if (effect.kind === 'reclaim-subset') {
          // TASK-83: REBOUND-SPLIT — the EIGHTH status-REMOVAL effect and the FIRST
          // SUBSET-OF-KINDS self→foe DEBUFF TRANSFER. FIRST CAPTURE the caster's (`me`) OWN
          // debuff ARMS whose kind is in the SUBSET {@link REBOUND_SPLIT_KINDS} (the DoTs
          // burn/poison/bleed/corrode — reused verbatim, NOT a hand-rolled set) with their
          // EXACT current turnsRemaining/damagePerTurn/ramp; THEN clear ONLY those subset kinds
          // off the caster via the pure {@link clearKinds}(me.statuses, REBOUND_SPLIT_KINDS) —
          // the caster KEEPS its non-subset debuffs (weaken/enfeeble/vulnerable/doom/stun/
          // freeze/sleep) AND its self-buffs (empower/shield/retaliate). THIS partial clear
          // (vs clearDebuffs's full clear) IS the observable difference from Rebound. THEN —
          // ONLY when at least one subset arm was captured — FULL-duration DEEP-COPY each
          // captured arm onto the FOE (`them`) via a per-arm `{ ...arm }` spread (exactly like
          // Rebound/`reclaim-deep`, NO duration change — the KIND SELECTION is the new axis,
          // not the duration), de-duped by kind: any existing foe arm of a transferred kind is
          // DROPPED and REPLACED (refresh-not-stack; the caster carries at most one arm per
          // kind so the transferred set is itself unique). A caster carrying NONE of the subset
          // kinds (even if it carries other debuffs) clears nothing AND moves nothing (a
          // GENUINE subset transfer, not an unconditional foe-debuff). Touches BOTH combatants'
          // status arrays but writes NO HP — only trims the caster's subset arms + appends
          // full-duration deep-copied arms to the foe's — so HP stays monotonically
          // non-increasing (A-42); transferring fewer/equal DoTs never LENGTHENS the fight. It
          // resolves ON CAST (does not linger), so no AILMENT tick/spec slot; the moved arms
          // ARE lingering foe debuffs, but each reuses its existing arm/tick (untouched). Priced
          // above the pool (Posture-B), so this branch never runs inside the shipped fights —
          // proven in isolation. The notes make the transfer observable in the log (the cast +
          // notes ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => REBOUND_SPLIT_KINDS.has(s.kind));
          me.statuses = clearKinds(me.statuses, REBOUND_SPLIT_KINDS);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} splits its ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to split`);
          }
        } else if (effect.kind === 'reclaim-partial') {
          // TASK-82: REBOUND-LITE — the SEVENTH status-REMOVAL effect and the FIRST
          // PERCENTAGE/PARTIAL-DURATION self→foe DEBUFF TRANSFER (the A-70 refinement of
          // Rebound). FIRST CAPTURE the caster's (`me`) OWN harmful debuff ARMS — those whose
          // kind is in {@link CLEANSABLE_DEBUFF_KINDS} (reused verbatim, NOT a hand-rolled set) —
          // with their EXACT current turnsRemaining/damagePerTurn/ramp; THEN clear them off the
          // caster via the pure {@link clearDebuffs} (verbatim — leaving the caster's self-buffs
          // intact, A-65); THEN — ONLY when at least one arm was captured — DEEP-COPY each
          // captured arm onto the FOE (`them`) via a per-arm
          // `{ ...arm, turnsRemaining: max(1, ceil(turnsRemaining * REBOUND_PARTIAL_RATIO)) }`
          // spread (a full deep copy of these flat primitive-only arms with the duration HALVED),
          // de-duped by kind: any existing foe arm of a transferred kind is DROPPED and REPLACED
          // by the transferred deep-copy (refresh-not-stack, matching applyAilment's contract;
          // the caster carries at most one arm per kind so the transferred set is itself already
          // unique). Unlike `reclaim-deep` (which moves each arm at its FULL current
          // turnsRemaining), Rebound-Lite HALVES the remaining duration (a `burn`@4 arrives at
          // turnsRemaining:2; a `burn`@1 stays 1 by the max(1,…) floor) while PRESERVING
          // damagePerTurn/ramp. THIS halved-remaining-turns IS the new mechanic. A debuff-free
          // caster clears nothing AND moves nothing (a GENUINE conditional transfer). Touches
          // BOTH combatants' status arrays but writes NO HP — only trims the caster's array +
          // appends duration-halved deep-copied arms to the foe's — so HP stays monotonically
          // non-increasing (A-42); halving a foe DoT only ever SHORTENS the fight. It resolves ON
          // CAST (does not linger), so no AILMENT tick/spec slot; the moved arms ARE lingering foe
          // debuffs, but each reuses its existing arm/tick (untouched). Priced above the pool
          // (Posture-B), so this branch never runs inside the shipped fights — proven in
          // isolation. The notes make the transfer observable in the log (the cast + notes ride
          // the EXISTING optional skill?/statusEvents? fields — no wire change).
          const capturedArms = me.statuses.filter((s) => CLEANSABLE_DEBUFF_KINDS.has(s.kind));
          me.statuses = clearDebuffs(me.statuses);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({
                ...a,
                turnsRemaining: Math.max(1, Math.ceil(a.turnsRemaining * REBOUND_PARTIAL_RATIO)),
              })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} rebounds a weakened ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to rebound`);
          }
        } else if (effect.kind === 'reclaim-deep') {
          // TASK-81: REBOUND — the SIXTH status-REMOVAL effect and the FIRST RAW ARM-BY-ARM
          // DEEP-COPY self→foe DEBUFF TRANSFER (the A-69 refinement of Backfire). FIRST CAPTURE
          // the caster's (`me`) OWN harmful debuff ARMS — those whose kind is in
          // {@link CLEANSABLE_DEBUFF_KINDS} (reused verbatim, NOT a hand-rolled set) — with their
          // EXACT current turnsRemaining/damagePerTurn/ramp; THEN clear them off the caster via
          // the pure {@link clearDebuffs} (verbatim — leaving the caster's self-buffs intact,
          // A-65); THEN — ONLY when at least one arm was captured — DEEP-COPY each captured arm
          // onto the FOE (`them`) via a per-arm `{ ...arm }` spread (a full deep copy of these
          // flat primitive-only arms), de-duped by kind: any existing foe arm of a transferred
          // kind is DROPPED and REPLACED by the transferred deep-copy (refresh-not-stack, matching
          // applyAilment's contract; the caster carries at most one arm per kind so the
          // transferred set is itself already unique). Unlike `reclaim` (which re-brews each kind
          // fresh at its canonical AILMENT_SPEC via applyAilment), Rebound PRESERVES each arm's
          // remaining state — a `burn` at turnsRemaining:1 arrives at turnsRemaining:1, a climbed
          // `corrode` arrives at its climbed damage. THIS preserved-remaining-state IS the new
          // mechanic. A debuff-free caster clears nothing AND moves nothing (a GENUINE conditional
          // transfer). Touches BOTH combatants' status arrays but writes NO HP — only trims the
          // caster's array + appends deep-copied arms to the foe's — so HP stays monotonically
          // non-increasing (A-42). It resolves ON CAST (does not linger), so no AILMENT tick/spec
          // slot; the moved arms ARE lingering foe debuffs, but each reuses its existing arm/tick
          // (untouched). Priced above the pool (Posture-B), so this branch never runs inside the
          // shipped fights — proven in isolation. The notes make the transfer observable in the
          // log (the cast + notes ride the EXISTING optional skill?/statusEvents? fields — no wire
          // change).
          const capturedArms = me.statuses.filter((s) => CLEANSABLE_DEBUFF_KINDS.has(s.kind));
          me.statuses = clearDebuffs(me.statuses);
          if (capturedArms.length > 0) {
            const transferredKinds = new Set(capturedArms.map((a) => a.kind));
            them.statuses = [
              ...them.statuses.filter((s) => !transferredKinds.has(s.kind)),
              ...capturedArms.map((a) => ({ ...a })),
            ];
            for (const kind of transferredKinds) {
              me.inflicted.add(kind); // TASK-64: the transferred debuff was cast this fight
            }
            statusEvents.push(
              `${combatant[actor].name} rebounds ${[...transferredKinds].join(', ')} onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to rebound`);
          }
        } else if (effect.kind === 'displace') {
          // TASK-79: SCAPEGOAT — the FOURTH status-REMOVAL effect and the FIRST self→foe
          // DEBUFF TRANSFER (the MIRROR of Spellthief). FIRST CLEAR the CASTER's (`me`) OWN
          // harmful debuffs (DoTs / stat-downs / control locks) via the pure
          // {@link clearDebuffs}/{@link CLEANSABLE_DEBUFF_KINDS} (verbatim — leaving the
          // caster's self-buffs intact, A-65); THEN — ONLY when a clear actually occurred
          // (the cleared array is SHORTER, i.e. the caster HAD a harmful debuff) — INFLICT a
          // FIXED `weaken` (DEF-down) on the FOE (`them`) via the EXISTING `weaken`
          // {@link applyAilment} builder, exactly as the `weaken`/armor-break effect does. A
          // debuff-free caster clears nothing AND inflicts nothing (a GENUINE conditional
          // transfer, not an unconditional foe-debuff). Touches BOTH combatants' status arrays
          // but writes NO HP — only trims the caster's array + appends to the foe's — so HP
          // stays monotonically non-increasing (A-42). It resolves ON CAST (does not linger),
          // so no AILMENT tick/spec slot; the `weaken` it inflicts IS a lingering foe debuff,
          // but that reuses the existing `weaken` arm/tick (untouched). Priced above the pool
          // (Posture-B), so this branch never runs inside the shipped fights — proven in
          // isolation. The notes make the transfer observable in the log (the cast + notes ride
          // the EXISTING optional skill?/statusEvents? fields — no wire change).
          const cleared = clearDebuffs(me.statuses);
          const displaced = cleared.length < me.statuses.length;
          me.statuses = cleared;
          if (displaced) {
            them.statuses = applyAilment(them.statuses, 'weaken');
            me.inflicted.add('weaken'); // TASK-64: the inflicted debuff was cast this fight
            statusEvents.push(
              `${combatant[actor].name} displaces its ailments onto ${combatant[foe].name}`,
            );
          } else {
            statusEvents.push(`${combatant[actor].name} has nothing to displace`);
          }
        } else if (effect.kind === 'swap-atk') {
          // TASK-104: CHAOS SHIFT — the FIRST stat-VALUE SWAP, opening a genuinely-NEW *shape*
          // axis (transfer of raw STAT VALUES, distinct from the transfer of status ARRAYS by
          // the cleanse/dispel/purloin/displace/reclaim family). EXCHANGE the two combatants'
          // raw `atk` values in place — mirror the `displace`/`purloin` opponent-touching
          // immediate-resolve shape, but touch the raw stat scalar (`atk`) rather than the
          // status arrays. It writes NO HP — only swaps two scalars — so HP stays monotonically
          // non-increasing (A-42). It resolves ON CAST (does not linger), so no AILMENT
          // tick/spec slot, no new StatusAilment arm. NO current-stat FLOOR / lookup is needed
          // (a pure exchange, not a reduction). Priced above the pool (Posture-B), so this
          // branch never runs inside the shipped fights — proven in isolation. The raw `atk`
          // that resolveDamageStrike reads lives on the `combatant[actor]`/`combatant[foe]`
          // Combatant records (NOT the SideState `me`/`them`, which carry only
          // hp/energy/statuses/inflicted), so the swap exchanges THOSE — and every LATER strike
          // this fight reads the exchanged values. The note makes the swap observable in the log
          // (the cast + note ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          const exchanged = swapAtk(combatant[actor], combatant[foe]);
          combatant[actor].atk = exchanged.casterAtk;
          combatant[foe].atk = exchanged.foeAtk;
          statusEvents.push(`${combatant[actor].name} swaps power with ${combatant[foe].name}`);
        } else if (effect.kind === 'swap-def') {
          // TASK-105: CHAOS WARP — the SECOND stat-VALUE SWAP and the defensive twin of Chaos
          // Shift/`swap-atk`, ADVANCING the stat-VALUE-transfer *shape* axis. EXCHANGE the two
          // combatants' raw `def` values in place — structurally IDENTICAL to the `swap-atk`
          // branch above, but on the raw `def` scalar (no new substrate; `Combatant` already
          // carries `def`). It writes NO HP — only swaps two scalars — so HP stays monotonically
          // non-increasing (A-42). It resolves ON CAST (does not linger), so no AILMENT tick/spec
          // slot, no new StatusAilment arm. NO current-stat FLOOR / lookup is needed (a pure
          // exchange, not a reduction). Priced above the pool (Posture-B), so this branch never
          // runs inside the shipped fights — proven in isolation. The raw `def` that
          // resolveDamageStrike reads for mitigation lives on the `combatant[actor]`/`combatant[foe]`
          // Combatant records (NOT the SideState `me`/`them`), so the swap exchanges THOSE — and
          // every LATER strike this fight reads the exchanged values. The note makes the swap
          // observable in the log (the cast + note ride the EXISTING optional skill?/statusEvents?
          // fields — no wire change).
          const exchanged = swapDef(combatant[actor], combatant[foe]);
          combatant[actor].def = exchanged.casterDef;
          combatant[foe].def = exchanged.foeDef;
          statusEvents.push(`${combatant[actor].name} swaps defense with ${combatant[foe].name}`);
        } else if (effect.kind === 'swap-spd') {
          // TASK-106: CHAOS CYCLONE — the THIRD stat-VALUE SWAP and the speed twin of Chaos
          // Shift/`swap-atk` + Chaos Warp/`swap-def`, COMPLETING the per-scalar atk→def→spd swap
          // trio. EXCHANGE the two combatants' raw `spd` values in place — structurally IDENTICAL
          // to the `swap-def` branch above, but on the raw `spd` scalar (no new substrate;
          // `Combatant` already carries `spd`). It writes NO HP — only swaps two scalars — so HP
          // stays monotonically non-increasing (A-42). It resolves ON CAST (does not linger), so no
          // AILMENT tick/spec slot, no new StatusAilment arm. NO current-stat FLOOR / lookup is
          // needed (a pure exchange, not a reduction). Priced above the pool (Posture-B), so this
          // branch never runs inside the shipped fights — proven in isolation. The raw `spd` that
          // the initiative order reads lives on the `combatant[actor]`/`combatant[foe]` Combatant
          // records (NOT the SideState `me`/`them`), so the swap exchanges THOSE. The note makes the
          // swap observable in the log (the cast + note ride the EXISTING optional
          // skill?/statusEvents? fields — no wire change).
          const exchanged = swapSpd(combatant[actor], combatant[foe]);
          combatant[actor].spd = exchanged.casterSpd;
          combatant[foe].spd = exchanged.foeSpd;
          statusEvents.push(`${combatant[actor].name} swaps speed with ${combatant[foe].name}`);
        } else if (effect.kind === 'swap-all') {
          // TASK-107: CHAOS NEXUS — the FULL three-stat SWAP that EXCHANGES `atk` + `def` + `spd`
          // TOGETHER in a single cast, EXHAUSTING the stat-value-swap shape family the per-scalar
          // swap-atk/swap-def/swap-spd trio opened. It COMPOSES the three shipped pure helpers
          // (swapAtk/swapDef/swapSpd) via `swapAllStats` — it re-derives NO exchange math. All
          // three exchanges are COMPUTED FROM THE ORIGINAL values FIRST (one `swapAllStats` call),
          // THEN written back, so no assignment perturbs a later read. It writes NO HP — only swaps
          // the three scalar pairs — so HP stays monotonically non-increasing (A-42). It resolves
          // ON CAST (does not linger), so no AILMENT tick/spec slot, no new StatusAilment arm. NO
          // current-stat FLOOR / lookup is needed (a pure exchange, not a reduction). Priced above
          // the pool (Posture-B), so this branch never runs inside the shipped fights — proven in
          // isolation. The raw scalars the initiative order + every later strike read live on the
          // `combatant[actor]`/`combatant[foe]` Combatant records (NOT the SideState `me`/`them`),
          // so the swap exchanges THOSE. The note makes the swap observable in the log (the cast +
          // note ride the EXISTING optional skill?/statusEvents? fields — no wire change).
          const exchangedAll = swapAllStats(combatant[actor], combatant[foe]);
          combatant[actor].atk = exchangedAll.casterAtk;
          combatant[foe].atk = exchangedAll.foeAtk;
          combatant[actor].def = exchangedAll.casterDef;
          combatant[foe].def = exchangedAll.foeDef;
          combatant[actor].spd = exchangedAll.casterSpd;
          combatant[foe].spd = exchangedAll.foeSpd;
          statusEvents.push(`${combatant[actor].name} swaps all stats with ${combatant[foe].name}`);
        } else if (effect.kind === 'shield-percent') {
          // Barrier (TASK-131) — a SELF-targeting maxHp-fraction ABSORB BUFF (the FRACTIONAL twin of
          // Shield, the LAST buff family to gain a `-percent` mirror). Raise/refresh the `shield-percent`
          // status on the ACTOR's OWN statuses via the SAME applyAilment self-apply path shield/empower
          // use — but SIZED from the CASTER's OWN maxHp: `floor(combatant[actor].maxHp × ratio)`, passed
          // as the bearerMaxHp arg (the ONLY kind that needs it). Its absorb payoff is drained at the
          // generalized absorbWithShield seam when this side is ATTACKED. Writes NO HP (A-42). Priced
          // above-pool (Posture-B @92), so this branch never runs in-sim.
          me.statuses = applyAilment(me.statuses, 'shield-percent', combatant[actor].maxHp);
          me.inflicted.add('shield-percent');
          statusEvents.push(`${combatant[actor].name} raises a barrier`);
        } else if (
          effect.kind === 'shield' ||
          effect.kind === 'empower' ||
          effect.kind === 'empower-percent' ||
          effect.kind === 'retaliate'
        ) {
          // A SELF-targeting effect (TASK-55 Shield, TASK-56 Empower, TASK-69
          // Retaliate): raise/refresh the status on the ACTOR's OWN statuses (not the
          // defender's) — Shield a defensive buffer, Empower an ATK buff, Retaliate the
          // reactive Thorns reflect. All route through this same self-target branch (the
          // machinery generalizes — pure addition of the `retaliate` kind, no new move).
          me.statuses = applyAilment(me.statuses, effect.kind);
          me.inflicted.add(effect.kind); // TASK-64: mark this ailment cast this fight
          statusEvents.push(`${combatant[actor].name} is ${AILMENT_APPLIED_LABEL[effect.kind]}`);
        } else if (effect.kind === 'fortify') {
          // Fortify (TASK-108) — a SELF-targeting DEF-up BUFF (the DEF-axis twin of Empower/Focus,
          // the self-buff mirror of weaken). Raise/refresh the `fortify` status on the ACTOR's OWN
          // statuses via the SAME applyAilment self-apply path shield/empower use. Its DEF-raising
          // payoff is read at the resolveDamageStrike netDefReduction seam when this side is ATTACKED.
          // Writes NO HP (A-42). Priced above-pool (Posture-B), so this branch never runs in-sim.
          me.statuses = applyAilment(me.statuses, 'fortify');
          me.inflicted.add('fortify');
          statusEvents.push(`${combatant[actor].name} fortifies its defense`);
        } else if (effect.kind === 'brace') {
          // Brace (TASK-109) — a SELF-targeting damage-taken-DOWN BUFF (the POSITIVE MIRROR of
          // vulnerable at the damage-application seam, distinct from Fortify at the DEF-mitigation
          // seam). Grant/refresh the `brace` status on the ACTOR's OWN statuses via the SAME
          // applyAilment self-apply path shield/empower/fortify use. Its damage-reducing payoff is read
          // at the amplifyForVulnerable seam when this side is ATTACKED. Writes NO HP (A-42). Priced
          // above-pool (Posture-B), so this branch never runs in-sim.
          me.statuses = applyAilment(me.statuses, 'brace');
          me.inflicted.add('brace');
          statusEvents.push(`${combatant[actor].name} braces for impact`);
        } else if (effect.kind === 'brace-percent') {
          // Bulwark (TASK-110) — a SELF-targeting PERCENTAGE damage-taken-DOWN BUFF (the fractional
          // MIRROR of brace and the DOWN-side percent twin of vulnerable-percent at the damage-application
          // seam). Grant/refresh the `brace-percent` status on the ACTOR's OWN statuses via the SAME
          // applyAilment self-apply path shield/empower/fortify/brace use. Its damage-reducing payoff is
          // read at the amplifyForVulnerable seam when this side is ATTACKED. Writes NO HP (A-42). Priced
          // above-pool (Posture-B), so this branch never runs in-sim.
          me.statuses = applyAilment(me.statuses, 'brace-percent');
          me.inflicted.add('brace-percent');
          statusEvents.push(`${combatant[actor].name} raises a bulwark`);
        } else if (effect.kind === 'fortify-percent') {
          // Aegis (TASK-111) — a SELF-targeting PERCENTAGE DEF-up BUFF (the fractional MIRROR of
          // fortify and the DEF-UP percent twin of the DEBUFF weaken-percent at the DEF-mitigation seam).
          // Grant/refresh the `fortify-percent` status on the ACTOR's OWN statuses via the SAME
          // applyAilment self-apply path shield/empower/fortify/brace use. Its DEF-raising payoff is read
          // at the resolveDamageStrike netDefReduction seam when this side is ATTACKED — floor(def ×
          // defBonusRatio) SUBTRACTED from the reduction. Writes NO HP (A-42). Priced above-pool
          // (Posture-B), so this branch never runs in-sim.
          me.statuses = applyAilment(me.statuses, 'fortify-percent');
          me.inflicted.add('fortify-percent');
          statusEvents.push(`${combatant[actor].name} raises an aegis`);
        } else if (effect.kind === 'hasten') {
          // Quicken (TASK-112) — a SELF-targeting FLAT SPD-up BUFF (the SPD-axis twin of the DEF-up
          // fortify and the ATK-up empower). Grant/refresh the `hasten` status on the ACTOR's OWN
          // statuses via the SAME applyAilment self-apply path shield/empower/fortify/brace use. Its
          // SPD-raising payoff is read by the pure effectiveSpd helper (spd + spdBonus) — DELIBERATELY
          // NOT wired into the once-computed turn-order line this slice (A-99). Writes NO HP (A-42).
          // Priced above-pool (Posture-B), so this branch never runs in-sim.
          me.statuses = applyAilment(me.statuses, 'hasten');
          me.inflicted.add('hasten');
          statusEvents.push(`${combatant[actor].name} quickens`);
        } else if (effect.kind === 'hasten-percent') {
          // Rush (TASK-113) — a SELF-targeting PERCENTAGE SPD-up BUFF (the percent-UP twin of the flat
          // hasten and the SPD-axis mirror of the DEF-up fortify-percent / ATK-up empower-percent).
          // Grant/refresh the `hasten-percent` status on the ACTOR's OWN statuses via the SAME
          // applyAilment self-apply path hasten/fortify-percent use. Its SPD-raising payoff is read by
          // the pure effectiveSpd helper (spd + floor(spd × ratio)) — DELIBERATELY NOT wired into the
          // once-computed turn-order line (A-99 unchanged). Writes NO HP (A-42). Priced above-pool
          // (Posture-B), so this branch never runs in-sim.
          me.statuses = applyAilment(me.statuses, 'hasten-percent');
          me.inflicted.add('hasten-percent');
          statusEvents.push(`${combatant[actor].name} rushes`);
        } else if (effect.kind === 'reflect-percent') {
          // Thorn Mirror (TASK-99) — a SELF-targeting BUFF whose effect kind
          // (`reflect-percent`) differs in NAME from the StatusAilment arm it grants
          // (`retaliate-percent`), so it maps explicitly here rather than reusing the
          // same-name self-branch above. It GRANTS the CASTER the `retaliate-percent` arm
          // via the SAME applyAilment self-apply path retaliate uses — the fractional MIRROR
          // of Counter Stance. Priced above-pool (Posture-B), so never fires in-sim.
          me.statuses = applyAilment(me.statuses, 'retaliate-percent');
          me.inflicted.add('retaliate-percent');
          statusEvents.push(
            `${combatant[actor].name} is ${AILMENT_APPLIED_LABEL['retaliate-percent']}`,
          );
        } else if (effect.kind === 'sap') {
          // TASK-70: ENERGY DRAIN / Sap — the FIRST resource-interference effect. Remove
          // a FIXED SAP_ENERGY_AMOUNT from the DEFENDER's in-combat `energy` pool (the
          // resource that gates their next-turn skill selection), floored at 0 via the
          // pure {@link drainEnergy} helper. It writes ONLY the non-HP energy resource,
          // so HP stays monotonically non-increasing (A-42) — the composite's `damage`
          // arm (which ran earlier in this same `for` loop) is the sole HP write, through
          // the shared monotone resolveDamageStrike. A foe already at 0 energy drains
          // NOTHING (the floor holds; `drained` is 0 so the note reflects the truth). The
          // note rides THIS turn's summary entry alongside the damage half.
          const { newEnergy, drained } = drainEnergy(them.energy, SAP_ENERGY_AMOUNT);
          them.energy = newEnergy;
          statusEvents.push(`${combatant[foe].name}'s energy is drained by ${drained}`);
        } else if (effect.kind === 'sap-percent') {
          // TASK-97: ENERGY REND / sap-percent — the FIRST fractional-MAGNITUDE
          // resource-interference effect and the percentage MIRROR of `sap`. Remove a
          // FRACTION (SAP_PERCENT_RATIO = 0.5, floored) of the DEFENDER's CURRENT
          // in-combat `energy` pool via the pure {@link drainEnergyPercent} helper, instead
          // of the FIXED SAP_ENERGY_AMOUNT. It writes ONLY the non-HP energy resource, so HP
          // stays monotonically non-increasing (A-42) — the composite's `damage` arm (which
          // ran earlier in this same `for` loop) is the sole HP write, through the shared
          // monotone resolveDamageStrike. A foe already at 0 energy drains NOTHING
          // (floor(0 * 0.5) = 0 so the note reflects the truth). The note rides THIS turn's
          // summary entry alongside the damage half (exactly like `sap`).
          const { newEnergy, drained } = drainEnergyPercent(them.energy, SAP_PERCENT_RATIO);
          them.energy = newEnergy;
          statusEvents.push(`${combatant[foe].name}'s energy is rent by ${drained}`);
        } else if (effect.kind === 'leech') {
          // TASK-71: ENERGY LEECH / Siphon — the SECOND resource-interference effect and
          // the exact MIRROR of `sap`. CREDIT a FIXED LEECH_ENERGY_AMOUNT to the ATTACKER's
          // (`me`) OWN in-combat `energy` pool — the resource that gates their next-turn
          // skill selection — capped at MAX_ENERGY via the pure {@link leechEnergy} helper.
          // It writes ONLY the non-HP energy resource, so HP stays monotonically
          // non-increasing (A-42) — the composite's `damage` arm (which ran earlier in this
          // same `for` loop) is the sole HP write, through the shared monotone
          // resolveDamageStrike. An attacker already at MAX_ENERGY gains NOTHING (the cap
          // holds; `gained` is 0 so the note reflects the truth). The note rides THIS turn's
          // summary entry alongside the damage half.
          const { newEnergy, gained } = leechEnergy(me.energy, LEECH_ENERGY_AMOUNT);
          me.energy = newEnergy;
          statusEvents.push(`${combatant[actor].name} siphons ${gained} energy`);
        } else if (effect.kind === 'leech-percent') {
          // TASK-98: ENERGY SURGE / leech-percent — the SECOND fractional-MAGNITUDE
          // resource-interference effect and the percentage MIRROR of `leech` (the CREDIT
          // twin of `sap-percent`). CREDIT a FRACTION (LEECH_PERCENT_RATIO = 0.5, floored)
          // of the ATTACKER's (`me`) OWN CURRENT in-combat `energy` pool instead of the
          // FIXED LEECH_ENERGY_AMOUNT — capped at MAX_ENERGY via the pure
          // {@link restoreEnergyPercent} helper. It writes ONLY the non-HP energy resource,
          // so HP stays monotonically non-increasing (A-42) — the composite's `damage` arm
          // (which ran earlier in this same `for` loop) is the sole HP write, through the
          // shared monotone resolveDamageStrike. An attacker already at MAX_ENERGY gains
          // NOTHING (the cap holds; `gained` is 0 so the note reflects the truth). The note
          // rides THIS turn's summary entry alongside the damage half, exactly like `leech`.
          const { newEnergy, gained } = restoreEnergyPercent(me.energy, LEECH_PERCENT_RATIO);
          me.energy = newEnergy;
          statusEvents.push(`${combatant[actor].name} surges ${gained} energy`);
        } else if (effect.kind === 'rot-when-weak') {
          // Rot-When-Weak (TASK-133) — the FIRST THRESHOLD-GATED inflictor. GATE the apply on the
          // DEFENDER's HP using the SAME percent-of-MAX read `execute`/`guillotine` use for a BURST:
          // compute `threshold = floor(them.maxHp × hpThresholdRatio)`. IF the foe is at/below it
          // (`them.hp <= threshold` — inclusive, prey-on-the-wounded), inflict the `wither-percent`
          // DoT off the foe's OWN maxHp (REUSE the TASK-132 apply path + its `bearerMaxHp` arg — the
          // materialized per-turn amount is `floor(them.maxHp × WITHER_PERCENT_DAMAGE_RATIO)`, no new
          // tick machinery). ELSE resolve as a NO-OP status attempt (a note rides the EXISTING
          // optional `statusEvents?` — no wire change). Writes NO HP here either way (A-42 — the DoT's
          // subtractive tick is the sole HP write); priced above-pool (Posture-B @94) so this branch
          // never runs in-sim and the shipped fights stay byte-identical.
          const target = combatant[foe];
          const threshold = Math.floor(target.maxHp * effect.hpThresholdRatio);
          if (them.hp <= threshold) {
            them.statuses = applyAilment(them.statuses, 'wither-percent', target.maxHp);
            me.inflicted.add('wither-percent');
            statusEvents.push(`${target.name} is ${AILMENT_APPLIED_LABEL['wither-percent']}`);
          } else {
            statusEvents.push(`${target.name} is too healthy to rot`);
          }
        } else if (effect.kind === 'weaken-when-weak') {
          // Weaken-When-Weak (TASK-134) — the FIRST THRESHOLD-GATED STAT-MOD inflictor. GATE the apply
          // on the DEFENDER's HP using the SAME percent-of-MAX read `rot-when-weak`/`execute`/
          // `guillotine` use: compute `threshold = floor(them.maxHp × hpThresholdRatio)`. IF the foe is
          // at/below it (`them.hp <= threshold` — inclusive, cripple-the-wounded), inflict the EXISTING
          // `weaken` DEF-reduction status (REUSE the `weaken` applyAilment branch — it materializes
          // `{kind:'weaken', turnsRemaining: WEAKEN_DURATION, defReduction: WEAKEN_DEF_REDUCTION}`; NO
          // new spec/tick machinery). ELSE resolve as a NO-OP status attempt (a note rides the EXISTING
          // optional `statusEvents?` — no wire change). Writes NO HP here either way, and the applied
          // DEF debuff's tick also writes NO HP (A-42 — a stat-mod, not a DoT), so it carries ZERO
          // MAX_ROUNDS hazard. Priced above-pool (Posture-B @95) so this branch never runs in-sim and
          // the shipped fights stay byte-identical.
          const target = combatant[foe];
          const threshold = Math.floor(target.maxHp * effect.hpThresholdRatio);
          if (them.hp <= threshold) {
            them.statuses = applyAilment(them.statuses, 'weaken');
            me.inflicted.add('weaken');
            statusEvents.push(`${target.name} is ${AILMENT_APPLIED_LABEL['weaken']}`);
          } else {
            statusEvents.push(`${target.name} is too healthy to weaken`);
          }
        } else if (effect.kind === 'weaken-when-strong') {
          // Weaken-When-Strong (TASK-135) — the FIRST `>=` HIGH-hp gate. GATE the apply on the DEFENDER's
          // HP using the SAME percent-of-MAX read `weaken-when-weak`/`rot-when-weak`/`execute`/`guillotine`
          // use, but with the operator FLIPPED `<=` → `>=`: compute `threshold = floor(them.maxHp ×
          // hpThresholdRatio)`. IF the foe is at/above it (`them.hp >= threshold` — inclusive,
          // punish-the-healthy — the mirror image of weaken-when-weak's `<=`), inflict the EXISTING
          // `weaken` DEF-reduction status (REUSE the `weaken` applyAilment branch — it materializes
          // `{kind:'weaken', turnsRemaining: WEAKEN_DURATION, defReduction: WEAKEN_DEF_REDUCTION}`; NO new
          // spec/tick machinery). ELSE resolve as a NO-OP status attempt (a note rides the EXISTING
          // optional `statusEvents?` — no wire change). Writes NO HP here either way, and the applied DEF
          // debuff's tick also writes NO HP (A-42 — a stat-mod, not a DoT), so it carries ZERO MAX_ROUNDS
          // hazard. Priced above-pool (Posture-B @96) so this branch never runs in-sim and the shipped
          // fights stay byte-identical.
          const target = combatant[foe];
          const threshold = Math.floor(target.maxHp * effect.hpThresholdRatio);
          if (them.hp >= threshold) {
            them.statuses = applyAilment(them.statuses, 'weaken');
            me.inflicted.add('weaken');
            statusEvents.push(`${target.name} is ${AILMENT_APPLIED_LABEL['weaken']}`);
          } else {
            statusEvents.push(`${target.name} is too weak to bother weakening`);
          }
        } else if (effect.kind === 'enfeeble-when-weak') {
          // Enfeeble-When-Weak (TASK-136) — the SECOND stat-mod FAMILY's FIRST threshold-gated inflictor.
          // GATE the apply on the DEFENDER's HP using the SAME `<=` percent-of-MAX read `weaken-when-weak`/
          // `rot-when-weak`/`execute`/`guillotine` use: compute `threshold = floor(them.maxHp ×
          // hpThresholdRatio)`. IF the foe is at/below it (`them.hp <= threshold` — inclusive,
          // cripple-the-wounded), inflict the EXISTING `enfeeble` ATK-reduction status (REUSE the `enfeeble`
          // applyAilment branch — it materializes `{kind:'enfeeble', turnsRemaining: ENFEEBLE_DURATION,
          // atkReduction: ENFEEBLE_ATK_REDUCTION}`; NO new spec/tick machinery). ELSE resolve as a NO-OP
          // status attempt (a note rides the EXISTING optional `statusEvents?` — no wire change). Where
          // TASK-134/135 gated the DEF-down `weaken` family, this gates the ATK-down `enfeeble` family —
          // the axis of novelty is the apply-family, not the predicate. Writes NO HP here either way, and
          // the applied ATK debuff's tick also writes NO HP (A-42 — a stat-mod, not a DoT), so it carries
          // ZERO MAX_ROUNDS hazard. Priced above-pool (Posture-B @97) so this branch never runs in-sim and
          // the shipped fights stay byte-identical.
          const target = combatant[foe];
          const threshold = Math.floor(target.maxHp * effect.hpThresholdRatio);
          if (them.hp <= threshold) {
            them.statuses = applyAilment(them.statuses, 'enfeeble');
            me.inflicted.add('enfeeble');
            statusEvents.push(`${target.name} is ${AILMENT_APPLIED_LABEL['enfeeble']}`);
          } else {
            statusEvents.push(`${target.name} is too healthy to enfeeble`);
          }
        } else if (effect.kind === 'enfeeble-when-strong') {
          // Enfeeble-When-Strong (TASK-137) — CLOSES the `enfeeble` ATK-down family's SECOND predicate
          // DIRECTION. GATE the apply on the DEFENDER's HP using the SAME `>=` percent-of-MAX read
          // `weaken-when-strong` uses: compute `threshold = floor(them.maxHp × hpThresholdRatio)`. IF the
          // foe is at/above it (`them.hp >= threshold` — inclusive, punish-the-healthy — the mirror image
          // of enfeeble-when-weak's `<=`), inflict the EXISTING `enfeeble` ATK-reduction status (REUSE the
          // `enfeeble` applyAilment branch — it materializes `{kind:'enfeeble', turnsRemaining:
          // ENFEEBLE_DURATION, atkReduction: ENFEEBLE_ATK_REDUCTION}`; NO new spec/tick machinery). ELSE
          // resolve as a NO-OP status attempt (a note rides the EXISTING optional `statusEvents?` — no wire
          // change). Where TASK-136 gates the SAME `enfeeble` family on a `<=` LOW-hp foe, the axis of
          // novelty here is the flipped `>=` HIGH-hp direction (mirroring TASK-135's `>=` gate on
          // `weaken`). Writes NO HP here either way, and the applied ATK debuff's tick also writes NO HP
          // (A-42 — a stat-mod, not a DoT), so it carries ZERO MAX_ROUNDS hazard. Priced above-pool
          // (Posture-B @98) so this branch never runs in-sim and the shipped fights stay byte-identical.
          const target = combatant[foe];
          const threshold = Math.floor(target.maxHp * effect.hpThresholdRatio);
          if (them.hp >= threshold) {
            them.statuses = applyAilment(them.statuses, 'enfeeble');
            me.inflicted.add('enfeeble');
            statusEvents.push(`${target.name} is ${AILMENT_APPLIED_LABEL['enfeeble']}`);
          } else {
            statusEvents.push(`${target.name} is too wounded to bother enfeebling`);
          }
        } else if (effect.kind === 'vulnerable-when-strong') {
          // Vulnerable-When-Strong (TASK-139) — CLOSES the THIRD stat-mod family (`vulnerable`
          // damage-taken-UP) across BOTH predicate directions. GATE the apply on the DEFENDER's HP using the
          // SAME `>=` percent-of-MAX read `weaken-when-strong`/`enfeeble-when-strong` use: compute
          // `threshold = floor(them.maxHp × hpThresholdRatio)`. IF the foe is at/above it (`them.hp >=
          // threshold` — inclusive, punish-the-healthy — the mirror image of vulnerable-when-weak's `<=`),
          // inflict the EXISTING `vulnerable` damage-taken-UP status (REUSE the `vulnerable` applyAilment
          // branch — it materializes `{kind:'vulnerable', turnsRemaining: VULNERABLE_DURATION,
          // damageTakenBonus: VULNERABLE_DAMAGE_TAKEN_BONUS}`; NO new spec/tick machinery). ELSE resolve as a
          // NO-OP status attempt (a note rides the EXISTING optional `statusEvents?` — no wire change). Where
          // TASK-138 gates the SAME `vulnerable` family on a `<=` LOW-hp foe, the axis of novelty here is the
          // flipped `>=` HIGH-hp direction at the distinct 0.60 band (mirroring TASK-135's `>=` on `weaken`
          // and TASK-137's on `enfeeble`). Writes NO HP here either way, and the applied damage-taken-UP
          // debuff's tick also writes NO HP (A-42 — a stat-mod, not a DoT); a damage-taken-UP debuff can only
          // make the fight FASTER, so it carries ZERO MAX_ROUNDS hazard. Priced above-pool (Posture-B @100)
          // so this branch never runs in-sim and the shipped fights stay byte-identical.
          const target = combatant[foe];
          const threshold = Math.floor(target.maxHp * effect.hpThresholdRatio);
          if (them.hp >= threshold) {
            them.statuses = applyAilment(them.statuses, 'vulnerable');
            me.inflicted.add('vulnerable');
            statusEvents.push(`${target.name} is ${AILMENT_APPLIED_LABEL['vulnerable']}`);
          } else {
            statusEvents.push(`${target.name} is too wounded to bother exposing`);
          }
        } else if (effect.kind === 'vulnerable-when-weak') {
          // Vulnerable-When-Weak (TASK-138) — the THIRD stat-mod FAMILY's FIRST threshold-gated inflictor.
          // GATE the apply on the DEFENDER's HP using the SAME `<=` percent-of-MAX read `weaken-when-weak`/
          // `enfeeble-when-weak`/`rot-when-weak`/`execute` use: compute `threshold = floor(them.maxHp ×
          // hpThresholdRatio)`. IF the foe is at/below it (`them.hp <= threshold` — inclusive,
          // expose-the-wounded), inflict the EXISTING `vulnerable` damage-taken-UP status (REUSE the
          // `vulnerable` applyAilment branch — it materializes `{kind:'vulnerable', turnsRemaining:
          // VULNERABLE_DURATION, damageTakenBonus: VULNERABLE_DAMAGE_TAKEN_BONUS}`; NO new spec/tick
          // machinery). ELSE resolve as a NO-OP status attempt (a note rides the EXISTING optional
          // `statusEvents?` — no wire change). Where TASK-134/135 gated the DEF-down `weaken` and TASK-136/137
          // the ATK-down `enfeeble`, this gates the damage-taken-UP `vulnerable` family — the axis of novelty
          // is the apply-family (a fundamentally different effect KIND that SCALES incoming damage), opening
          // the third family's first cell. Writes NO HP here either way, and the applied damage-taken-UP
          // debuff's tick also writes NO HP (A-42 — a stat-mod, not a DoT); a damage-taken-UP debuff can only
          // make the fight FASTER, so it carries ZERO MAX_ROUNDS hazard. Priced above-pool (Posture-B @99) so
          // this branch never runs in-sim and the shipped fights stay byte-identical.
          const target = combatant[foe];
          const threshold = Math.floor(target.maxHp * effect.hpThresholdRatio);
          if (them.hp <= threshold) {
            them.statuses = applyAilment(them.statuses, 'vulnerable');
            me.inflicted.add('vulnerable');
            statusEvents.push(`${target.name} is ${AILMENT_APPLIED_LABEL['vulnerable']}`);
          } else {
            statusEvents.push(`${target.name} is too healthy to expose`);
          }
        } else if (effect.kind === 'wither-percent') {
          // Wither-Percent (TASK-132) — a DEFENDER-targeting maxHp-fraction DoT (the FIRST DoT sized off
          // the target's `maxHp`, not its CURRENT `hp`). Unlike the other percent-DoT inflictors — which
          // route through the generic offensive `else` below with NO maxHp arg — its per-turn amount is
          // MATERIALIZED at apply as `floor(them.maxHp × ratio)`, so it needs the DEFENDER's maxHp here.
          // It reuses the SAME applyAilment `bearerMaxHp` arg shield-percent uses, passing `them.maxHp`
          // (the bearer of the DoT is the DEFENDER). Priced above-pool (Posture-B @93), so this branch
          // never runs in-sim; writes NO HP here (A-42 — the HP loss is the later tick).
          them.statuses = applyAilment(them.statuses, 'wither-percent', combatant[foe].maxHp);
          me.inflicted.add('wither-percent');
          statusEvents.push(`${combatant[foe].name} is ${AILMENT_APPLIED_LABEL['wither-percent']}`);
        } else {
          // Apply / refresh an OFFENSIVE ailment on the defender (at most one per
          // kind; a re-apply overwrites in place — the deliberate no-stack refresh).
          //
          // TASK-161 (R-22 slice 22): the RESIST ROLL. The defender may SHRUG OFF the
          // incoming offensive status — `statusResists(rng)` gates the landing using the
          // `rng` already threaded onto `resolveActorTurn` (NO new param/seam). When it
          // fires, we SKIP `applyAilment` + `me.inflicted.add(...)` (the status does NOT
          // land) and push a "resists" note instead. Because the auto/production paths
          // pass NO `rng` (default `DEFAULT_RNG = () => 0`, and `statusResists(() => 0)`
          // is FALSE), the status ALWAYS lands there — behavior byte-preserved, every
          // pinned fixture green with no re-pin (invariant-5 byte-proof). A-42 HELD: a
          // resist only REMOVES a would-be DoT/debuff, so HP stays monotone.
          if (statusResists(rng)) {
            resistedThisTurn = true;
            statusEvents.push(
              `${combatant[foe].name} resists ${AILMENT_APPLIED_LABEL[effect.kind]}`,
            );
          } else {
            them.statuses = applyAilment(them.statuses, effect.kind);
            me.inflicted.add(effect.kind); // TASK-64: mark this ailment cast this fight
            statusEvents.push(`${combatant[foe].name} is ${AILMENT_APPLIED_LABEL[effect.kind]}`);
          }
        }
      }

      // TASK-58: a PURE multi-hit skill already logged each strike as its own entry,
      // so suppress the trailing summary (it would be a redundant 0-damage duplicate).
      // Any other skill (single damage / self-buff / offensive ailment) still emits the
      // one summary entry carrying its accumulated damage + statusEvents, byte-unchanged.
      if (!(multiHitEmitted && damage === 0 && statusEvents.length === 0)) {
        turns.push({
          round,
          actor,
          damage,
          defenderHpAfter: them.hp,
          skill: skill.name,
          ...(statusEvents.length > 0 ? { statusEvents } : {}),
          ...(critThisTurn ? { crit: true } : {}),
          ...(evadedThisTurn ? { evaded: true } : {}),
          ...(resistedThisTurn ? { resisted: true } : {}),
        });
      }

      if (them.hp <= 0) {
        decided = actor === 'player' ? 'win' : 'loss';
        return { decided, ended: true };
      }
    }
  }

  return { decided, ended: false };
}

/**
 * The fixed XP a player's Digimon earns for WINNING a battle (TASK-32, R-7). A flat
 * reward (no scaling this slice), granted through the SAME leveling rule `train`
 * uses (see {@link applyBattleReward} in training.ts) so battle is a real
 * progression sink with no divergent math. Chosen at 40 — larger than one train
 * click (25) so a win is a meaningful reward, and enough to LEVEL a level-1 starter
 * (threshold 20) so the "win → get stronger" success path is observable + e2e-exact.
 * FREE: a win moves no spendable value, so no ResourceBalance/AuditLog (invariant 3
 * untriggered; L-12).
 */
export const BATTLE_XP_REWARD = 40;

/**
 * DANGER-SCALED WIN REWARD (TASK-171, R-22 slice 32). Scales a win's flat XP grant
 * by the encounter's danger scalar so a deadlier fight pays proportionally more
 * progression — the risk ↔ reward link matching the three danger axes now carried on
 * `enemyScale` (biome L-66 × distance L-67 × player-level L-68). Deterministic
 * (`Math.round(base * scale)`, NO Math.random). Mirrors the {@link scaleEnemy}
 * identity-guard idiom: at `scale === 1` it returns `baseReward` VERBATIM, so the
 * auto `battle(...)` / PvP / explore paths (which resolve at scale 1 and pass no
 * `enemyScale`) grant the flat 40 XP byte-identically → every pinned battle.spec
 * fixture + the whole-fight/PvP/explore controller e2es stay green with NO re-pin
 * (the free invariant-5 proof). For `scale >= 1` (the `enemyScale` invariant) every
 * result is an integer `>= baseReward`, so a harder win never pays LESS. FREE XP:
 * this only scales the {@link BATTLE_XP_REWARD} arithmetic — it moves no spendable
 * value, so no ResourceBalance/AuditLog (invariant 3 stays untriggered).
 */
export function scaledBattleReward(baseReward: number, scale: number): number {
  if (scale === 1) {
    return baseReward;
  }
  return Math.round(baseReward * scale);
}

/**
 * DANGER-SCALED LOOT DROP (TASK-173, R-22 slice 34) — the resource the drop credits.
 * A free-form `resource` string (exactly like the shop/collect economy), so crediting
 * it needs NO schema migration: `ResourceBalance`/`AuditLog` already store any string.
 */
export const BATTLE_LOOT_RESOURCE = 'DigiCredits';

/**
 * DANGER-SCALED LOOT DROP (TASK-173, R-22 slice 34) — the base spendable credit a wild
 * interactive win pays. Deliberately small (a fight is a frequent event); scaled up by
 * the encounter's danger scalar via {@link battleLootAmount}. Exported so the wire/tests
 * reference the constant, never a magic number.
 */
export const BATTLE_LOOT_REWARD = 5;

/**
 * DANGER-SCALED LOOT DROP (TASK-173, R-22 slice 34). The FIRST danger → ECONOMIC-reward
 * link: a wild interactive win now credits a SPENDABLE, audited resource (not more free
 * XP). The drop is GUARANTEED on a win — only its SIZE scales with the encounter danger
 * scalar (biome L-66 × distance L-67 × player-level L-68, carried on `enemyScale`) — so
 * it is RNG-free/deterministic (`Math.round(base * scale)`, NO Math.random; no injected-
 * rng seam, no I-10 roll). Mirrors {@link scaledBattleReward}'s identity-guard idiom: at
 * `scale === 1` it returns `BATTLE_LOOT_REWARD` VERBATIM. For `scale >= 1` (the `enemyScale`
 * invariant) every result is an integer `>= BATTLE_LOOT_REWARD` and monotone non-decreasing,
 * so a deadlier win never pays LESS loot. This is NOT a combat rule — it touches only the
 * resource balance, never HP/turn-order (A-42 held); I-10's mechanic treadmill stays STOPPED.
 */
export function battleLootAmount(scale: number): number {
  if (scale === 1) {
    return BATTLE_LOOT_REWARD;
  }
  return Math.round(BATTLE_LOOT_REWARD * scale);
}

/** A fixed PvE enemy — a {@link Combatant} plus a stable `id` used to select it. */
export type Enemy = Combatant & { id: string };

/**
 * The fixed PvE enemy roster (TASK-32, R-7) — hand-tuned so a starter-level Digimon
 * (e.g. Agumon 50/14/10/8, Vaccine/Fire) can plausibly WIN one and LOSE another, so
 * BOTH outcomes are observable in the running slice AND deterministically
 * e2e-assertable:
 *
 *  - `numemon` — a weak Virus/Neutral chump: Agumon (Vaccine) has the type advantage
 *    (Vaccine > Virus, ×1.5) and its low stats mean the starter wins comfortably.
 *  - `kuwagamon` — a tough Free/Nature bruiser: `Free` is off the triangle (neutral),
 *    Fire > Nature gives Agumon an element edge but Kuwagamon's high HP/ATK/DEF and
 *    superior SPD (acts first) overwhelm the level-1 starter → a loss.
 *
 * No AI, no movesets — each enemy is a static stat block selected by `id`.
 */
export const ENEMY_ROSTER: readonly Enemy[] = [
  {
    id: 'numemon',
    name: 'Numemon',
    type: 'Virus',
    element: 'Neutral',
    // hp raised 30→60 (TASK-51), 60→100 (TASK-56), 100→140 (TASK-57), 140→180
    // (TASK-58), then 180→220 (TASK-65): the Vulnerable damage-AMP (+25% on every
    // strike the AI marks onto numemon) ends the winnable fight a couple rounds early —
    // so numemon is made tankier again to keep the fight long enough for the surfacing
    // Bleed to visibly tick over ≥2 of the foe's turns AND Double Strike to land its
    // two hits (the shipped pacing). TASK-67 raised it 220→230: the ESCALATING Corrode
    // (which the AI now casts and which ends the fight faster the longer it ramps) was
    // squeezing the previously-surfacing Bleed down to a single tick — the tankier
    // numemon keeps the fight long enough for BOTH the growing Corrode (≥2 ticks,
    // visibly escalating) AND the flat Bleed (≥2 ticks) to surface, plus Double Strike's
    // two hits. Agumon still resolves this to a comfortable WIN (player HP to spare), so
    // only the pacing changed — the shipped outcome holds.
    // TASK-74 nudged it 230→222: the new one-time SELF-BUFF OPENER (chooseSkill Rule 1b)
    // makes the player spend its SINGLE post-arsenal hammer turn on Focus (a 0-damage buff
    // that TASK-73 gave to Energy Siphon) — that lost ~6 damage on the decisive turn flips
    // the razor-thin 230-hp fight to a loss, so numemon is trimmed a hair so the DoT stack
    // still finishes it while Agumon survives (player HP > 0, well clear of MAX_ROUNDS). A
    // bounded, deliberate perturbation — Focus is now SEEN in the shipped WIN.
    hp: 222,
    // TASK-126: maxHp = starting hp (the `maxHp` substrate — a combatant's FULL HP, never mutated
    // by the round loop). Kept in lock-step with the tuned `hp` above.
    maxHp: 222,
    atk: 8,
    def: 4,
    spd: 5,
  },
  {
    id: 'kuwagamon',
    name: 'Kuwagamon',
    type: 'Free',
    element: 'Nature',
    hp: 222,
    // TASK-126: maxHp = starting hp (the `maxHp` substrate — never mutated by the round loop).
    maxHp: 222,
    atk: 28,
    def: 18,
    spd: 20,
  },
  // TASK-254 (R-29 wild-wiring follow-on) — the Tamers trio (Guilmon/Renamon/Terriermon),
  // seeded as level-1 Rookie STARTERS in TASK-250, now ALSO appear as WILD ENEMIES so a
  // player walking the Overworld can roll & fight them (SPAWN_TABLES wires each into a
  // biome affine to its element — Fire→mountain, Neutral/Data→forest, Nature→swamp). PURE
  // additive DATA: three static stat blocks over the existing `Enemy` shape — the pure
  // engine (simulateBattle/resolveActorTurn/chooseSkill/every turn-order & damage rule) is
  // BYTE-UNCHANGED (engine Math.random STAYS 0). Stats sit in the wild-foe HP band (the
  // shipped wild foes are 222 hp) so an early fight paces reasonably — a wild trio member is
  // tougher than the collectible level-1 starter. `type`/`element` are valid members of the
  // existing Combatant unions (numemon uses the same set), so NO type change (invariant 5).
  // maxHp === hp (the TASK-126 substrate rule).
  {
    id: 'guilmon',
    name: 'Guilmon',
    type: 'Virus',
    element: 'Fire',
    hp: 200,
    maxHp: 200,
    atk: 18,
    def: 12,
    spd: 11,
  },
  {
    id: 'renamon',
    name: 'Renamon',
    type: 'Data',
    element: 'Neutral',
    hp: 190,
    maxHp: 190,
    atk: 16,
    def: 11,
    spd: 16,
  },
  {
    id: 'terriermon',
    name: 'Terriermon',
    type: 'Vaccine',
    element: 'Nature',
    hp: 205,
    maxHp: 205,
    atk: 14,
    def: 13,
    spd: 11,
  },
  // TASK-310 (R-19 / R-17c-R-8 enemy-side carved child) — the FIRST higher-tier wild
  // enemy: Greymon, Agumon's canonical Champion evolution (name/casing transcribed from
  // evolution.ts's `into: { name: 'Greymon', … }`, D-8 #1 — NEVER invented). Until now the
  // entire enemy roster was Rookie/Champion-cap (kuwagamon hp222/atk28/def18/spd20 was the
  // ceiling), so a player exploring never faced anything above a Champion. This breaks that
  // shape: a genuine Champion-strong/Ultimate-class stat block strictly ABOVE the prior cap
  // (hp 260 / atk 34 / def 24 / spd 22 — a tougher foe on every axis) so the FIRST time a
  // player rolls it (mountain, Fire-affine — see SPAWN_TABLES) they meet a real step up in
  // difficulty. PURE additive DATA: one static stat block over the existing `Enemy` shape —
  // the pure engine (simulateBattle/resolveActorTurn/chooseSkill/findEnemy/scaleEnemy/every
  // turn-order & damage rule) is BYTE-UNCHANGED (engine Math.random STAYS 0). The ~646
  // battle.spec fixtures pin SPECIFIC named matchups (Agumon vs numemon, agumon vs
  // kuwagamon), NOT roster length — so this UN-REFERENCED append leaves every pinned fixture
  // byte-identical with NO re-pin. `type`/`element` are plain strings on Combatant (numemon
  // uses the same set), so NO type change (invariant 5). maxHp === hp (the TASK-126 substrate
  // rule). Two-way door: dropping this element makes Greymon un-spawnable again.
  {
    id: 'greymon',
    name: 'Greymon',
    type: 'Vaccine',
    element: 'Fire',
    hp: 260,
    maxHp: 260,
    atk: 34,
    def: 24,
    spd: 22,
  },
  // TASK-311 (D-655 / A-293) — the SECOND enemy-side slice, a BATCH per the L-220 sterile-clone
  // watch: the FIRST two Ultimate-class wild foes. MetalGreymon (Greymon's canonical Fire
  // Ultimate) + MegaSeadramon (a canonical Water sea-serpent Ultimate). Both names are
  // transcribed VERBATIM from the evolution.ts into.name pool (D-8 #1, :541/:588) — NEVER
  // invented. Wired into desert (Fire) / snow (Water) which today field only Numemon, so a
  // player exploring those biomes now meets a real higher-tier foe stepping STRICTLY above
  // Greymon (hp260/atk34/def24/spd22) on every axis. PURE additive DATA over the existing
  // `Enemy` shape — the pure engine (simulateBattle/resolveActorTurn/chooseSkill/findEnemy/
  // scaleEnemy/every turn-order & damage rule) is BYTE-UNCHANGED (engine Math.random STAYS 0).
  // The ~646 battle.spec fixtures pin SPECIFIC named matchups, NOT roster length — so this
  // UN-REFERENCED append leaves every pinned fixture byte-identical with NO re-pin.
  // type/element are plain strings on Combatant (Fire/Water are in ELEMENT_BEATS), so NO type
  // change (invariant 5). maxHp === hp (the TASK-126 substrate rule). Two-way door: dropping
  // these elements makes both species un-spawnable again.
  {
    id: 'metalgreymon',
    name: 'MetalGreymon',
    type: 'Vaccine',
    element: 'Fire',
    hp: 300,
    maxHp: 300,
    atk: 40,
    def: 28,
    spd: 24,
  },
  {
    id: 'megaseadramon',
    name: 'MegaSeadramon',
    type: 'Data',
    element: 'Water',
    hp: 320,
    maxHp: 320,
    atk: 38,
    def: 30,
    spd: 26,
  },
] as const;

/**
 * Resolve a fixed enemy by its stable `id`, or `undefined` for an unknown id (the
 * service turns that into a clean 404/422 BEFORE any write — no partial battle).
 */
export function findEnemy(id: string): Enemy | undefined {
  return ENEMY_ROSTER.find((enemy) => enemy.id === id);
}

/**
 * TASK-168 (R-22 slice 29): return a COPY of a wild {@link Enemy} whose offensive/defensive
 * stat block is multiplied by `scale` (a biome-derived STRENGTH factor >= 1 — see
 * `enemyScaleForBiome` in the world domain), so a fight in a dangerous biome opens against a
 * visibly TOUGHER foe (more HP, a harder hit). PURE + RNG-free (the engine's executable
 * `Math.random` count STAYS 0). Applied ONCE, before the fight, at the INTERACTIVE rebuild
 * seam ONLY — the AUTO/PvP/explore paths pass no scale and never call it.
 *
 * IDENTITY GUARD (the invariant-5 spine): `scale === 1` returns the roster block VERBATIM
 * (the same object), so a safe-biome / no-scale fight is byte-identical to today. Non-identity
 * scales grow `hp`/`maxHp`/`atk`/`def` by `Math.round(stat * scale)` — `maxHp` kept in
 * lock-step with `hp` (a fresh foe starts at full HP). Because `scale >= 1`, the foe only ever
 * gets TOUGHER (A-42: the enemy stat block is INPUT, computed once BEFORE the round loop; the
 * loop still only DECREASES HP — a bigger START is NOT a mid-fight heal). `name`/`type`/
 * `element`/`spd`/`id` are unchanged (scaling raw power, not identity or turn order).
 */
export function scaleEnemy(enemy: Enemy, scale: number): Enemy {
  if (scale === 1) {
    return enemy;
  }
  const hp = Math.round(enemy.hp * scale);
  return {
    ...enemy,
    hp,
    maxHp: hp,
    atk: Math.round(enemy.atk * scale),
    def: Math.round(enemy.def * scale),
  };
}
