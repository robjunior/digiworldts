import type { BattleTurnView } from '../digimon/digimon.types';
import type { TurnLogEntry } from '../digimon/battle';

/**
 * Public shapes of the `/api/pvp/*` responses (TASK-36, R-12) — the FIRST ranked-PvP
 * API contract. Like the other feature `*.types.ts`, these are explicit exported
 * interfaces the controller returns and a later PvP SPA screen (TASK-37) keeps a
 * LOCAL mirror of (never a cross-workspace import — the D-8 house rule). Additive
 * under invariant 5: fields may be ADDED in later R-12 slices (matchmaking, a
 * leaderboard, seasons), never break a released one.
 *
 * `TurnLogEntry` is REUSED (imported) from the pure combat core (battle.ts) rather
 * than restated: the PvP fight is resolved by the SAME `simulateBattle`, so its turn
 * log is byte-identical to the PvE one — one type, no divergence (D-8 #1). The SPA
 * mirror still restates it locally per the cross-workspace rule.
 */

/**
 * One challengeable opponent on `GET /api/pvp/opponents` — the MINIMAL public
 * projection of another player. Deliberately leaks NOTHING private (invariant 2): a
 * caller sees only a display name (the email's local part, before `@` — never the
 * full email), the opponent's rating, and their champion's name. NO email,
 * passwordHash, balance, resource, or account internals are ever projected here.
 */
export interface OpponentView {
  /** The opponent's user id — the `opponentId` a challenge POSTs. */
  userId: string;
  /** A non-identifying display name: the email's local part (before `@`). */
  displayName: string;
  /** The opponent's current ranked rating (MMR). */
  mmr: number;
  /** The name of the opponent's highest-level owned Digimon (their "champion"). */
  championName: string;
}

/** A player's rating before/after a ranked match — one side of the Elo move. */
export interface RatingMove {
  mmrBefore: number;
  mmrAfter: number;
}

/**
 * `POST /api/pvp/challenge` success body (HTTP 200) — the result of ONE ranked match
 * from the CHALLENGER's perspective.
 *
 * Returns the deterministic outcome + the full turn log (the same shape a PvE battle
 * returns, so a UI can replay it identically), plus BOTH players' rating moves so the
 * challenger sees their rating change AND the opponent's. The opponent side carries a
 * `displayName` (never the email) so the UI can name whom they fought without a
 * second lookup — no private opponent data beyond that.
 */
export interface PvpOutcomeView {
  /** Win/loss from the CHALLENGER's perspective (simulateBattle's first-arg view). */
  outcome: 'win' | 'loss';
  /** The ordered turn-by-turn log of the resolved fight. */
  turns: TurnLogEntry[];
  /** The challenger's rating before → after the Elo move. */
  challenger: RatingMove;
  /** The opponent's non-identifying name + their rating before → after. */
  opponent: RatingMove & { displayName: string };
}

/**
 * `POST /api/pvp/challenge/turn` success body (HTTP 200) — the INTERACTIVE per-turn
 * PvP contract (TASK-182, R-23a2 slice 43). A PvP duel is now driven turn-by-turn
 * through the SAME shared `battleTurn`/`resolveActorTurn` engine PvE uses, the
 * opponent entering as the injected `foe` — so a PvE fight and a PvP fight are the
 * SAME interactive combat UI (R-23's second outcome half).
 *
 * It REUSES the PvE {@link BattleTurnView} verbatim (`carried state`, this exchange's
 * `entries`, the `outcome`, the next-turn `playerSkills` menu, the `enemy` = the
 * opponent's champion, the telegraph/HUD fields) — the client renders the SAME live
 * HUD/menu with no divergence (D-8 #1). It ADDS the two rating moves, present ONLY on
 * the ENDING turn (when `battle.outcome !== null`), when the Elo `$transaction` fires
 * exactly ONCE. Mid-fight turns carry `null` for both (MMR is unmoved — invariant 3
 * stays untriggered). Additive under invariant 5 — a client on the whole-duel shape is
 * unaffected; the whole-duel `challenge`/{@link PvpOutcomeView} route stays intact.
 */
/**
 * TASK-200 (R-25a-follow3 slice 59) — ONE live match in the lobby list. The public
 * projection of an IN-PROGRESS duel: its ephemeral `matchId` plus the two participants,
 * each as `{ userId, displayName }` where `displayName` is the SERVER-resolved email
 * local-part (via the gateway's owner-scoped `displayNameFor`, NEVER a client field —
 * invariant 2). Deliberately leaks NOTHING private: no fight state, no socketId, no
 * email/balance/account internals — only WHO is dueling whom right now (public activity).
 *
 * Carried on the NEW additive `list_matches` ack and the `matches_changed` broadcast; a
 * client on any existing PvP contract is unaffected (invariant 5 — additive sibling type).
 */
export interface LiveMatchSummary {
  /** The ephemeral id of the in-progress match (minted on `accept`). */
  matchId: string;
  /** The challenger side — verified userId + server-resolved non-identifying display name. */
  challenger: { userId: string; displayName: string };
  /** The opponent side — verified userId + server-resolved non-identifying display name. */
  opponent: { userId: string; displayName: string };
}

export interface PvpTurnView {
  /** The shared interactive-turn result — the SAME shape a PvE `/battle/turn` returns. */
  battle: BattleTurnView;
  /**
   * The challenger's rating before → after — non-null ONLY on the ending turn (the
   * Elo move fired). `null` while the duel continues.
   */
  challenger: RatingMove | null;
  /**
   * The opponent's non-identifying name + rating before → after — non-null ONLY on the
   * ending turn. `null` while the duel continues.
   */
  opponent: (RatingMove & { displayName: string }) | null;
}
