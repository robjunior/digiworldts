import type { User } from '@prisma/client';

/**
 * Public shapes of the `/api/social` API (TASK-44, R-11) — the social friends slice.
 *
 * The house feature-contract idiom (P-1, the analogue of `market.types.ts` /
 * `pvp.types.ts`): the response shapes live here as explicit exported interfaces, and a
 * pure projector maps a persisted counterpart `User` → the leak-safe view. TASK-45's
 * `/friends` SPA will keep a LOCAL mirror of these (no cross-workspace import — D-8 #1).
 * Per invariant 5 fields may be ADDED later but an existing one must not change meaning.
 *
 * INVARIANT 2 (leak-safe projection) is the load-bearing rule here: an edge is between
 * two players but the view a caller sees describes the OTHER player (the counterpart),
 * so it must NEVER carry the counterpart's private identity. `FriendView` exposes ONLY
 * a non-identifying `displayName` (the counterpart's email LOCAL PART, mirroring the
 * market/pvp idiom) and an `online` boolean — never the counterpart's `id`, full email,
 * or `passwordHash`. `id` is the FRIENDSHIP EDGE's id (what the addressee POSTs to
 * `/accept`), NOT the counterpart's user id — so it leaks nothing about the other
 * account. The projector below enforces that guarantee structurally (it reads only the
 * whitelisted fields, so a future column on `User` cannot accidentally leak through).
 */

/**
 * ONLINE window (TASK-44) — a counterpart counts as `online` when they were seen
 * (`lastSeenAt`) within the last 5 minutes. Every authed screen stamps `lastSeenAt` on
 * boot / periodically via `GET /api/auth/me`, so a currently-active player refreshes
 * inside this window; a player who closed the tab falls out of it. A const so the window
 * is a single source of truth (and trivially tunable).
 */
export const ONLINE_WINDOW_MS = 5 * 60_000;

/**
 * One friend (or incoming requester) as returned to the caller.
 *
 * `id` is the FRIENDSHIP EDGE's cuid (the addressee POSTs `/api/social/friends/<id>/accept`
 * for a pending one). `displayName` is the counterpart's email LOCAL PART only (invariant
 * 2 — never the counterpart's id/email). `online` is derived from the counterpart's
 * `lastSeenAt` vs {@link ONLINE_WINDOW_MS}.
 */
export interface FriendView {
  /** The friendship EDGE's id (never the counterpart's user id) — invariant 2. */
  id: string;
  /** The counterpart's email LOCAL PART only — never their id/email (invariant 2). */
  displayName: string;
  /** True when the counterpart was seen within {@link ONLINE_WINDOW_MS}. */
  online: boolean;
}

/** The `GET /api/social/friends` response: accepted friends + incoming pending requests. */
export interface FriendsResponse {
  friends: FriendView[];
  incoming: FriendView[];
}

/**
 * The email's LOCAL PART (everything before the first `@`) — the non-identifying display
 * name (invariant 2). Identical to the market/pvp modules' `localPart`; kept local so
 * this module has no cross-feature coupling. Falls back to the whole string only if
 * there is no `@` (a malformed stored email, which registration prevents).
 */
function localPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

/**
 * True when `counterpart` counts as online: they have a `lastSeenAt` AND it is within
 * {@link ONLINE_WINDOW_MS} of `now`. A NULL `lastSeenAt` (never seen since the R-11
 * column was added) is `false` — a pure, no-I/O derivation. `now` is injected so a
 * caller can snapshot a single instant across a whole list (and so a test is
 * deterministic).
 */
export function isOnline(counterpart: User, now: number): boolean {
  return (
    counterpart.lastSeenAt !== null && now - counterpart.lastSeenAt.getTime() < ONLINE_WINDOW_MS
  );
}

/**
 * Project a friendship edge (identified by `edgeId`) + the COUNTERPART `User` → the
 * leak-safe {@link FriendView}. This is where invariant 2 is enforced structurally:
 * only whitelisted, non-identifying fields cross the wire (the counterpart's identity is
 * reduced to a display name + an online boolean; `edgeId` is the EDGE's id, not the
 * counterpart's). A pure function — no I/O; `now` is the caller's single instant snapshot.
 */
export function toFriendView(edgeId: string, counterpart: User, now: number): FriendView {
  return {
    id: edgeId,
    displayName: localPart(counterpart.email),
    online: isOnline(counterpart, now),
  };
}
