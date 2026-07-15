/**
 * Public shapes of the `/api/admin/*` responses (TASK-34, R-14).
 *
 * The FIRST admin-tier API contract. Like the other feature `*.types.ts`, these are
 * explicit exported interfaces the controller returns and a later admin SPA screen
 * (TASK-35) keeps a LOCAL mirror of. Additive under invariant 5: fields may be ADDED
 * in later R-14 slices (adjust/ban/distribute), never break a released one.
 */

/**
 * `POST /api/admin/grant` success body (HTTP 200) — the result of crediting a
 * target player's spendable balance.
 *
 * Returns just enough for the admin UI to confirm the grant landed: the target
 * (echoed back), the resource credited, and the target's NEW balance for that
 * resource (the post-credit `amountAfter`). Deliberately minimal — it exposes only
 * the target's balance for the resource just moved, never the acting admin's
 * internals or the raw ledger row (the audit row is server-internal).
 */
export interface GrantResult {
  targetEmail: string;
  resource: string;
  balance: number;
}
