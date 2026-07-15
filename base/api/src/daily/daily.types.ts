import type { DailyReward } from './daily.rewards';

/**
 * Public wire contracts for the `/daily` API (TASK-235, R-40). The SPA keeps a LOCAL
 * mirror of these (D-8 house rule — no cross-workspace import); add fields, never break
 * a released one (invariant 5).
 */

/**
 * `GET /daily` response — the signed-in player's current streak state, enough for the
 * follow-on Dashboard widget to render received-vs-mystery days.
 */
export interface DailyState {
  /** The last-claimed day in the cycle: 0 = never claimed, 1..7 otherwise. */
  streakDay: number;
  /** Whether the player has already claimed on the current UTC calendar day. */
  claimedToday: boolean;
  /** The day that the NEXT claim would grant (1..7) — `advanceStreak(streakDay)`. */
  nextDay: number;
  /** The full fixed 7-day reward table (so the widget can render every day). */
  rewards: readonly DailyReward[];
}

/**
 * `POST /daily/claim` response — the state AFTER a successful claim, plus the reward
 * that was just granted.
 */
export interface DailyClaimResult extends DailyState {
  /** The reward credited by this claim (`DAILY_REWARDS[streakDay - 1]`). */
  granted: DailyReward;
}
