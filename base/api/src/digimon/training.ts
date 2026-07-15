/**
 * The PURE leveling/training rules (TASK-29, R-6) — the single source of the
 * progression math, mirroring the pure {@link resolveEvolution} (evolution.ts) that
 * keeps the evolve numbers out of the service.
 *
 * WHY a pure module (no Prisma, no I/O): {@link DigimonService.train} applies the
 * ABSOLUTE result of {@link applyTraining} with a single `update` — exactly the way
 * `evolve` applies `resolveEvolution`'s absolute `into` — so the service stays a thin
 * transaction wrapper and the whole leveling curve is unit-testable in isolation and
 * asserted exactly in the e2e (train.controller.spec.ts) without booting anything.
 *
 * SCOPE (A-19): this slice is a DISCRETE per-click train action, NOT a real-time
 * timer/scheduler — each `POST /digimon/:id/train` grants a FIXED XP amount; crossing
 * the per-level threshold levels up with a flat stat gain. Continuous/offline accrual
 * and EV/affinity are deferred to R-6 child slices. Training grants XP for FREE (no
 * resource cost), so invariant 3 is NOT triggered here (XP is domain progression, not
 * a spendable economic resource — no ResourceBalance, no AuditLog row). A future
 * training-COST child slice would trigger invariant 3 and reuse the L-13 DEBIT template.
 */

/**
 * The XP granted by ONE train action. Deliberately CHOSEN together with
 * {@link xpForLevel} so a freshly seeded level-1 starter (threshold 20) LEVELS UP on
 * the FIRST train click (25 ≥ 20) — the SUCCESS path (level rises, a stat rises) is
 * observable in the running slice AND provable in the e2e without dozens of calls
 * (the A-12 "affordable/observable-today" principle applied to progression).
 */
export const TRAIN_XP_PER_ACTION = 25;

/**
 * The XP threshold to advance FROM `level` to `level + 1` — a simple monotonic curve
 * (`level * 20`): level 1→2 needs 20, 2→3 needs 40, and so on, so each level is a
 * little harder than the last. Kept SMALL on purpose (see {@link TRAIN_XP_PER_ACTION})
 * so leveling is demonstrable within one-to-a-few clicks. This threshold is ALSO
 * returned on the wire as `OwnedDigimon.xpToNext` (via the service) so the UI renders
 * the "xp / xpToNext" denominator WITHOUT mirroring this curve client-side (no drift —
 * D-8 #1). `level` is always ≥ 1 (schema default), so this is always ≥ 20.
 */
export function xpForLevel(level: number): number {
  return level * 20;
}

/**
 * The flat per-level stat gain applied each time a Digimon levels up via training.
 * Small bumps (the "see it get stronger" payoff) — HP moves most, SPD least, echoing
 * the stat spread. Applied ONCE per level gained, so a multi-level train action (an
 * XP grant large enough to cross several thresholds at once) applies it repeatedly.
 */
export const STAT_GAIN_PER_LEVEL = { hp: 5, atk: 2, def: 2, spd: 1 } as const;

/**
 * The typed FIRE DATA granted by ONE train action (TASK-30, R-16). Training is the
 * (only, this slice) source of Fire Data — no new plumbing — so accumulating enough
 * to unlock the variant branch (Agumon → Meramon, threshold 60 in evolution.ts) takes
 * a handful of train clicks (60 / 10 = 6). Chosen small and reachable so the "steer
 * where it evolves by what you accumulate" success path is demonstrable today
 * (the A-12 observable-today principle applied to Data). Like XP, this grant is FREE —
 * Fire Data is domain progression, NOT a spendable economic resource, so no
 * ResourceBalance/AuditLog is touched (invariant 3 untriggered; L-12 — the ledger is
 * for value-moving mutations only). Only the priced VARIANT evolve moves value.
 */
export const TRAIN_DATA_FIRE_PER_ACTION = 10;

/**
 * The pure XP/level/stat fields the canonical level-up rule {@link applyXpGain}
 * reads and returns — the {@link TrainableStats} progression MINUS `dataFire` (which
 * the leveling math never touches; callers thread it through themselves). Shared by
 * both training and the battle win reward so there is ONE level-up curve (D-8 #1).
 */
export interface LevelableStats {
  level: number;
  xp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

/** The mutable progression fields {@link applyTraining} reads and returns. */
export interface TrainableStats extends LevelableStats {
  /**
   * Accumulated typed Fire Data (TASK-30, R-16). Incremented by
   * {@link TRAIN_DATA_FIRE_PER_ACTION} each train action; the leveling/stat math is
   * completely INDEPENDENT of it (Data only gates the variant evolution branch, it
   * does not feed leveling), so the XP/level/stat logic below is byte-unchanged.
   */
  dataFire: number;
}

/**
 * Apply ONE train action to a Digimon's current progression, returning the new
 * ABSOLUTE state (the service writes these values directly with a single `update`,
 * exactly like `evolve` writes `resolveEvolution`'s absolute `into` — no read-add in
 * the service, so the math lives here and only here).
 *
 * Steps:
 *  1. Grant {@link TRAIN_XP_PER_ACTION} XP.
 *  2. WHILE the accumulated `xp` covers the current level's threshold
 *     ({@link xpForLevel}), consume that threshold, tick `level` up by one, and add
 *     {@link STAT_GAIN_PER_LEVEL} to each stat. The loop handles a single action that
 *     crosses MULTIPLE levels at once, and the remainder carries into the next level.
 *
 * PURE: it mutates only a local copy and returns a fresh object — no shared state, no
 * I/O. There is no max-level cap in this slice (deliberately omitted — a cap is an
 * easy additive follow-up; the curve grows so the grind self-limits in practice).
 */
export function applyTraining(current: TrainableStats): TrainableStats {
  // Grant the fixed train XP through the SINGLE canonical level-up rule
  // (applyXpGain), then accrue Fire Data. Fire Data accrues additively each action,
  // INDEPENDENT of the XP/level math (TASK-30, R-16) — it only gates the variant
  // evolution branch, never feeds leveling — so the leveling logic is byte-unchanged
  // from TASK-29. Still FREE (no economy): both XP and Data are domain progression.
  const leveled = applyXpGain(current, TRAIN_XP_PER_ACTION);
  return { ...leveled, dataFire: current.dataFire + TRAIN_DATA_FIRE_PER_ACTION };
}

/**
 * The SINGLE canonical threshold-carry level-up rule (TASK-32 extracted this from
 * {@link applyTraining} so battle and training share ONE curve — no drift, D-8 #1).
 * Grants `xp` experience to `current`, then WHILE the accumulated XP covers the
 * current level's threshold ({@link xpForLevel}), consumes it, ticks `level` up, and
 * adds {@link STAT_GAIN_PER_LEVEL} to each stat. Handles a grant large enough to
 * cross MULTIPLE levels at once; the remainder carries into the next level.
 *
 * PURE: mutates only a local copy and returns a fresh {@link LevelableStats}
 * (`dataFire`-free — this rule is only ever the XP/level/stat math; callers thread
 * `dataFire` through themselves). `xpForLevel` grows with `level`, so the loop always
 * terminates. No max-level cap this slice (deliberately — an easy additive follow-up).
 */
export function applyXpGain(current: LevelableStats, xpGain: number): LevelableStats {
  let { level, xp, hp, atk, def, spd } = current;

  xp += xpGain;

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
    hp += STAT_GAIN_PER_LEVEL.hp;
    atk += STAT_GAIN_PER_LEVEL.atk;
    def += STAT_GAIN_PER_LEVEL.def;
    spd += STAT_GAIN_PER_LEVEL.spd;
  }

  return { level, xp, hp, atk, def, spd };
}

/**
 * DURATION-BASED training tuning (TASK-189, R-26 slice 48). Training now accrues over
 * ELAPSED REAL TIME: `collectTraining` reads the server-stored `trainingStartedAt`,
 * computes `elapsedMs`, and grants XP that SCALES with it — so a digimon left training
 * longer yields a measurably greater gain than a short session.
 *
 * `TRAIN_XP_PER_HOUR` is the linear rate (XP per elapsed hour). RETUNED "fair but tough"
 * (TASK-196, R-26a slice 55, I-14): ~4 XP/elapsed hour so a full 24h day banks only ~96
 * XP and the L1→2 gate (`xpForLevel(1)` = 20 XP) takes ~5 elapsed hours — meaningful
 * levels now accrue over DAYS-TO-WEEKS, not minutes (with `xpForLevel = level*20` each
 * higher level costs proportionally more elapsed time → the "tough" long tail). Slice 54
 * couples level → an evolution stat bonus, so this slow ramp is also a fair power ramp.
 * `TRAIN_MIN_XP` is the FLOOR so a near-instant collect still grants a minimal amount
 * (never zero for a real session — a Start→Collect always progresses; deliberately kept).
 * `TRAIN_XP_CAP` is the CAP so an idle-for-days session cannot dump an unbounded grant —
 * RETUNED to 1000 (≈10 elapsed days at the new rate), letting a ~1–2-week unclaimed
 * session bank meaningful progress in one collect while still hard-bounding a months-idle
 * runaway accrual. All three are named constants → trivially re-tuned later, zero migration.
 */
export const TRAIN_XP_PER_HOUR = 4;
export const TRAIN_MIN_XP = 1;
export const TRAIN_XP_CAP = 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The elapsed-time XP grant (TASK-189, R-26 slice 48) — the pure scaling rule the
 * duration-based `collectTraining` seam applies. Returns the XP to grant for
 * `elapsedMs` of elapsed training, as a MONOTONE NON-DECREASING function: more elapsed
 * ⇒ a gain `>=` a shorter one (the load-bearing property the acceptance unit asserts
 * strictly across two durations). It is a linear ramp
 * ({@link TRAIN_XP_PER_HOUR}/hour) clamped between a {@link TRAIN_MIN_XP} FLOOR (so a
 * near-zero elapsed still pays a minimal grant) and a {@link TRAIN_XP_CAP} CEILING (so
 * an arbitrarily long idle session cannot dump unbounded XP).
 *
 * PURE + DETERMINISTIC: the ONLY input is the caller-supplied `elapsedMs` (the service
 * computes it from the server-stored `trainingStartedAt` — invariant 1, never trusted
 * from the client) — NO `Math.random`, NO `Date.now()` inside, so the engine's
 * executable `Math.random` count STAYS 0 and the rule is unit-testable in isolation. A
 * negative `elapsedMs` (a clock skew / mis-seed) clamps up to the floor.
 */
export function timedTrainingXp(elapsedMs: number): number {
  const rawXp = (Math.max(0, elapsedMs) / MS_PER_HOUR) * TRAIN_XP_PER_HOUR;
  // Clamp to [floor, cap]. Monotone non-decreasing in elapsedMs: the raw term only
  // grows with elapsed, and clamping preserves order.
  return Math.min(TRAIN_XP_CAP, Math.max(TRAIN_MIN_XP, Math.round(rawXp)));
}

/**
 * Apply a DURATION-BASED training session to a Digimon's current progression (TASK-189,
 * R-26 slice 48), returning the new ABSOLUTE state — the elapsed-time twin of
 * {@link applyTraining}. Where `applyTraining` grants a FLAT {@link TRAIN_XP_PER_ACTION}
 * per click, this grants {@link timedTrainingXp}(elapsedMs) XP through the SAME single
 * canonical level-up rule ({@link applyXpGain}), so a longer session levels/strengthens
 * MORE — the R-26 "train longer, gain more" payoff. Fire Data accrues the same fixed
 * {@link TRAIN_DATA_FIRE_PER_ACTION} per collect (independent of the XP/level math).
 *
 * PURE: mutates only a local copy; the elapsed is passed in (computed server-side), so
 * NO clock/RNG here. Still FREE (no economy — invariant 3 untriggered): XP/level/stats
 * are domain progression, never a spendable `ResourceBalance`.
 */
export function applyTimedTraining(
  current: TrainableStats,
  elapsedMs: number,
): TrainableStats {
  const leveled = applyXpGain(current, timedTrainingXp(elapsedMs));
  return { ...leveled, dataFire: current.dataFire + TRAIN_DATA_FIRE_PER_ACTION };
}

/**
 * The fraction of {@link STAT_GAIN_PER_LEVEL} awarded, per trained level above the
 * base, as the EVOLUTION training bonus (TASK-195, R-26a slice 54). Chosen "fair but
 * tough" (A-177): half of a normal level's stat gain per trained level, so training
 * genuinely pays off at evolve time without eclipsing the evolved form's own catalog
 * stats. A named constant → trivially re-tuned later with zero migration.
 */
export const EVOLUTION_TRAINING_BONUS_FRACTION = 0.5;

/**
 * The training-derived stat bonus a Digimon carries INTO evolution (TASK-195, R-26a
 * slice 54) — the "trained evolves stronger" rule. Today `evolve` overwrites a
 * creature's stats with the target form's ABSOLUTE catalog values, discarding all the
 * training work: a trained level-50 Agumon and an untrained level-1 Agumon become the
 * IDENTICAL Greymon. This maps the pre-evolution `level` (already grown by training,
 * and already in scope inside the evolve `$transaction`) to a small per-stat bonus that
 * the service ADDS on top of the absolute `into` stats — so a trained creature evolves
 * measurably stronger.
 *
 * LOAD-BEARING IDENTITY (invariant-5 byte-proof): at the base level (`level <= 1`, an
 * untrained fresh creature) the bonus is EXACTLY `{ hp: 0, atk: 0, def: 0, spd: 0 }`, so
 * an untrained evolve writes the verbatim catalog `into` stats — byte-identical to the
 * R-8/TASK-188 evolve behaviour. Every existing evolve fixture asserts a BASE-level
 * creature, so this identity keeps them green with NO re-pin.
 *
 * MONOTONE NON-DECREASING in `level`: `levelsAboveBase = max(0, level - 1)` scaled by a
 * fraction ({@link EVOLUTION_TRAINING_BONUS_FRACTION}) of {@link STAT_GAIN_PER_LEVEL},
 * floored to whole stat points (`Math.floor` — stats are integers), so a higher level
 * yields a `>=` bonus on each stat and a well-trained level (20/50) yields a strictly
 * positive bonus. PURE + DETERMINISTIC + RNG-free (the ONLY input is `level`; NO
 * `Math.random`, NO clock — the engine's executable `Math.random` count STAYS 0).
 */
export function evolutionTrainingBonus(
  level: number,
): { hp: number; atk: number; def: number; spd: number } {
  const levelsAboveBase = Math.max(0, level - 1);
  const scale = levelsAboveBase * EVOLUTION_TRAINING_BONUS_FRACTION;
  return {
    hp: Math.floor(STAT_GAIN_PER_LEVEL.hp * scale),
    atk: Math.floor(STAT_GAIN_PER_LEVEL.atk * scale),
    def: Math.floor(STAT_GAIN_PER_LEVEL.def * scale),
    spd: Math.floor(STAT_GAIN_PER_LEVEL.spd * scale),
  };
}

/**
 * Grant a WIN's battle reward XP (TASK-32, R-7) through the EXACT SAME level-up rule
 * training uses ({@link applyXpGain}), so a battle win and a train click level up by
 * one canonical curve — there is no divergent battle-only progression math. Threads
 * `dataFire` through UNCHANGED (a battle grants no Fire Data — only training does).
 * FREE, like training (no ResourceBalance/AuditLog — invariant 3 untriggered; L-12).
 */
export function applyBattleReward(current: TrainableStats, xp: number): TrainableStats {
  const leveled = applyXpGain(current, xp);
  return { ...leveled, dataFire: current.dataFire };
}

/**
 * The XP a Digimon LOSES on a PvE map/wild battle loss (TASK-249, R-31e) — HALF the
 * {@link BATTLE_XP_REWARD} win, so a loss costs the equivalent of half a win's progress:
 * a clean, legible constant that gives losing a real, felt consequence.
 *
 * This moves the player's OWN progress only (their Digimon's XP toward the next level) —
 * NOT a spendable resource. So invariant 3 here is about the AUDIT TRAIL (a persisted
 * player-state mutation records its before→after), NOT a `ResourceBalance` debit.
 *
 * NOTE (TASK-267, R-31e): this is now the LEVEL-1 FLOOR of {@link lossPenaltyFor} — the
 * baseline anchor. A level-1 loss still loses exactly this many XP byte-for-byte; higher
 * levels lose MORE (see {@link lossPenaltyFor}).
 */
export const BATTLE_LOSS_XP_PENALTY = 20;

/**
 * Extra XP a loss costs PER LEVEL above 1 (TASK-267, R-31e; RETUNED steeper TASK-276). Bumped
 * 5 -> 8 so the on-loss toll climbs more sharply per level — a lvl-10 loss now bleeds
 * 20 + 9*8 = 92 XP (vs 65 under step 5) — making the roguelike sting bite harder as the player
 * levels, without ever fading. A small legible integer; retune here alone (with the cap below)
 * if the curve needs to be steeper/flatter. This step is LINEAR: keeping the shape
 * linear-with-a-cap preserves the fixed-step assertion in training.spec.ts.
 */
export const PER_LEVEL_LOSS_STEP = 8;

/**
 * The CAP (roguelike ceiling) on the level-scaled on-loss XP penalty (TASK-276, R-31e). The
 * linear per-level toll stops climbing here, so a defeat with a VERY high-level Digimon is
 * punishing but not catastrophic. Chosen at 250 so the cap first BINDS around level ~30
 * (20 + 29*8 = 252 -> clamped to 250), keeping the ceiling player-felt while leaving every
 * low/mid-level training.spec.ts equality (which probes uncapped levels 1..10) green with NO
 * re-pin — `Math.min` stays monotone non-decreasing so the monotone loop to level 40 holds.
 */
export const MAX_LOSS_XP_PENALTY = 250;

/**
 * The LEVEL-SCALED on-loss XP penalty (TASK-267, R-31e — the "meaningful chunk" of R-31e's
 * roguelike on-loss penalty). Grows the flat {@link BATTLE_LOSS_XP_PENALTY} baseline by
 * {@link PER_LEVEL_LOSS_STEP} for each level above 1, so the sting keeps pace with the
 * growing next-level XP curve instead of fading as the player levels.
 *
 * At `level <= 1` it returns EXACTLY {@link BATTLE_LOSS_XP_PENALTY} (the byte-identical
 * baseline anchor — invariant-5 proof that today's lvl-1 loss is unchanged). Monotone
 * non-decreasing in level, CAPPED at {@link MAX_LOSS_XP_PENALTY} (TASK-276 — a roguelike
 * ceiling so a very-high-level defeat is punishing but not catastrophic). PURE, never throws —
 * the caller's {@link applyLossPenalty} floors xp at 0, so no clamping is needed here.
 */
export function lossPenaltyFor(level: number): number {
  return Math.min(
    MAX_LOSS_XP_PENALTY,
    BATTLE_LOSS_XP_PENALTY + Math.max(0, level - 1) * PER_LEVEL_LOSS_STEP,
  );
}

/**
 * Apply a PvE loss XP penalty (TASK-249, R-31e) — the mirror of {@link applyBattleReward}.
 *
 * A loss BLEEDS XP toward the next level but is monotonic-safe: it CLAMPS `xp` at 0 (never
 * negative) and leaves `level` + every stat field (hp/atk/def/spd) UNCHANGED — a loss NEVER
 * de-levels or drops a stat. Keeping the change to xp-only avoids the win/loss balance churn a
 * level-drop would cause (A-42 in spirit) and keeps the mutation trivially reversible. PURE:
 * reads/returns a fresh {@link LevelableStats}; never throws — a negative/over-large penalty
 * just floors xp at 0.
 */
export function applyLossPenalty(current: LevelableStats, penalty: number): LevelableStats {
  return { ...current, level: current.level, xp: Math.max(0, current.xp - penalty) };
}
