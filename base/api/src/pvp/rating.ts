/**
 * The PURE Elo rating rule (TASK-36, R-12) — the deterministic, I/O-free ranked-PvP
 * rating math, mirroring the pure combat core {@link simulateBattle} (battle.ts) and
 * {@link applyTraining} (training.ts): all the rating numbers live here so
 * {@link PvpService.challenge} stays a thin transaction wrapper that resolves the two
 * players, runs the sim, and PERSISTS the rating move this module computes.
 *
 * WHY a pure module (no Prisma, no I/O, no RNG): a rating move is a total function of
 * the two current ratings + who won, so it is exactly unit-testable in isolation AND
 * the e2e can assert an EXACT rating delta without seeding randomness. This is the
 * standard Elo step used unchanged by every later R-12 slice (matchmaking, seasons).
 */

/**
 * The Elo K-factor — the maximum rating a single match can swing. A fixed 32 (the
 * conventional chess K for provisional/casual play): large enough that a rating moves
 * VISIBLY on the first ranked fight (the observable-value point of this slice), small
 * enough that a single upset does not wildly distort the ladder. No per-player K
 * scaling this slice (a provisional-games / rating-tier K is a carved R-12 child).
 */
export const ELO_K = 32;

/**
 * The result of one Elo step: both players' NEW ratings after the match. `a` is the
 * first argument's (the challenger's) new rating; `b` is the second's (the
 * opponent's). Kept as a tiny record — the service applies each to the right row.
 */
export interface EloResult {
  a: number;
  b: number;
}

/**
 * Player A's EXPECTED score against player B given their ratings — the standard Elo
 * logistic: `1 / (1 + 10^((ratingB − ratingA) / 400))`. A value in (0, 1): 0.5 for
 * equal ratings, higher when A is favoured. PURE + deterministic. B's expected score
 * is `1 − expected(ratingA, ratingB)` (the two always sum to 1), so one function
 * fully determines both sides (no mis-transcription — the same one-map discipline the
 * combat multipliers use).
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * Apply ONE Elo step and return BOTH players' new ratings. PURE + DETERMINISTIC:
 * given the same two ratings and the same `aWon`, always the same result — which is
 * what makes the e2e assert an EXACT symmetric move.
 *
 *   scoreA   = aWon ? 1 : 0            (a match is win/loss, no draws in this combat)
 *   newA     = round(ratingA + K·(scoreA   − expected(A, B)))
 *   newB     = round(ratingB + K·((1−scoreA) − expected(B, A)))
 *
 * The move is SYMMETRIC (zero-sum): what the winner gains the loser loses (up to
 * rounding), because the score deltas are `(1 − eA)` and `(0 − eB) = −(1 − eA)` (as
 * `eA + eB = 1`). Ratings are CLAMPED at ≥ 0 so a long losing streak can never drive a
 * rating negative (the wire/ladder never shows a sub-zero rating). Rounded to a whole
 * unit — `mmr` is a whole-unit `Int` column (the house numeric idiom).
 */
export function elo(ratingA: number, ratingB: number, aWon: boolean): EloResult {
  const scoreA = aWon ? 1 : 0;
  const scoreB = 1 - scoreA;
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);
  const newA = Math.max(0, Math.round(ratingA + ELO_K * (scoreA - expectedA)));
  const newB = Math.max(0, Math.round(ratingB + ELO_K * (scoreB - expectedB)));
  return { a: newA, b: newB };
}
