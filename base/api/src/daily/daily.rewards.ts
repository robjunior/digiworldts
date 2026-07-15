/**
 * Pure daily-reward rules (TASK-235, R-40) — the framework-free, DB-free core of the
 * daily-reward claim loop, unit-tested in plain Vitest (mirroring the pure `world.ts` /
 * `battle.ts` doctrine: rules live in a pure module, the service only wires them to the
 * datastore). NO NestJS, NO Prisma, NO IO here.
 */

/** One entry in the fixed 7-day reward cycle. */
export interface DailyReward {
  /** A `ResourceBalance`-bankable resource string (see the A-217 note below). */
  resource: string;
  /** How much of it the day grants (always > 0). */
  amount: number;
}

/**
 * The fixed 7-day daily-reward table (TASK-235, R-40 — A-217).
 *
 * I-26's intended cycle names Meat → common Digitama → 10 Potions → DigiCredits →
 * Energy Potions → DigiCredits → rare Digitama. But only **Meat** and **DigiCredits**
 * have an existing spendable home (`ResourceBalance`, the resource strings already in
 * use). Per R-40's card and A-217, THIS slice grants ONLY currently-bankable resources
 * so EVERY day credits real spendable value a player can actually use today — the
 * not-yet-modeled item grants (Digitama / Potions / Energy Potions) are a carved
 * follow-on that swaps them in once those items are modeled. So the non-bankable days
 * are mapped to a bankable resource for now, preserving the shape (7 escalating days,
 * a bigger day-7 payout) while keeping every grant real.
 *
 * The per-day amounts are the builder's reasonable call (documented here): a small
 * daily trickle of Meat/DigiCredits that escalates across the week, with the day-7
 * "rare" slot the largest DigiCredits payout — so the streak visibly rewards
 * consecutive days. `DAILY_REWARDS[newDay - 1]` is granted on a claim (newDay is 1..7).
 */
export const DAILY_REWARDS: readonly DailyReward[] = [
  { resource: 'Meat', amount: 5 }, // day 1 (was: Meat) — a small starter of food
  { resource: 'DigiCredits', amount: 20 }, // day 2 (was: common Digitama) → currency for now
  { resource: 'Meat', amount: 10 }, // day 3 (was: 10 Potions) → Meat for now
  { resource: 'DigiCredits', amount: 40 }, // day 4 (was: DigiCredits)
  { resource: 'Meat', amount: 20 }, // day 5 (was: Energy Potions) → Meat for now
  { resource: 'DigiCredits', amount: 60 }, // day 6 (was: DigiCredits)
  { resource: 'DigiCredits', amount: 120 }, // day 7 (was: rare Digitama) → the big weekly payout
] as const;

/** The number of days in one reward cycle (the streak wraps after this). */
export const DAILY_CYCLE_LENGTH = DAILY_REWARDS.length;

/**
 * Advance the streak to the NEXT day in the fixed cycle: `(currentDay % 7) + 1`.
 *
 * Total and never-throws over the whole domain (0 = never claimed → 1; 1..6 → +1;
 * 7 → wraps back to 1; any larger/negative value is folded by `%` too, so a corrupt
 * stored value can never crash a claim). Pure.
 */
export function advanceStreak(currentDay: number): number {
  // Guard against a negative modulo result (JS `%` keeps the sign of the dividend):
  // a well-formed 0..7 stays in range; a defensive normalization keeps it total.
  const wrapped = ((Math.trunc(currentDay) % DAILY_CYCLE_LENGTH) + DAILY_CYCLE_LENGTH) % DAILY_CYCLE_LENGTH;
  return wrapped + 1;
}

/**
 * The UTC calendar-day key (`YYYY-MM-DD`) of an instant — the once-per-day gate uses a
 * CALENDAR-DAY boundary (not a rolling 24h window) so it matches the player's
 * "new day = new claim" mental model (A-217). Pure.
 */
export function utcDayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * True iff `lastClaimedAt` falls on the SAME UTC calendar day as `now` — i.e. the
 * player has ALREADY claimed today and a second claim must be refused. NULL/undefined
 * (never claimed) → false. Pure.
 */
export function claimedOnSameDay(lastClaimedAt: Date | null | undefined, now: Date): boolean {
  if (lastClaimedAt === null || lastClaimedAt === undefined) {
    return false;
  }
  return utcDayKey(lastClaimedAt) === utcDayKey(now);
}
