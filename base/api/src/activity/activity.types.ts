/**
 * Public wire contracts for the `/activity` API (TASK-248, R-31 — the SIXTH & LAST
 * dual-sidebar rail). The SPA keeps a LOCAL mirror of these (D-8 house rule — no
 * cross-workspace import); add fields, never break a released one (invariant 5).
 *
 * Every field MIRRORS the `AuditLog` model (schema.prisma) VERBATIM (verified against
 * the schema before writing — D-8 #1): `action`/`entity`/`entityId` plain strings,
 * `resource` NULLABLE (not every audited action is resource-denominated),
 * `amountBefore`/`amountAfter` the Int before→after halves of invariant 3, `createdAt`
 * serialized to an ISO string on the wire. There is deliberately NO `metadata`/`amount`
 * field — the ledger stores the two balance halves, not a single delta.
 */

/** One audited action in the player's activity feed — a projected `AuditLog` row. */
export interface ActivityEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  resource: string | null;
  amountBefore: number;
  amountAfter: number;
  /** ISO-8601 string (the datastore `DateTime` serialized via `.toISOString()`). */
  createdAt: string;
}

/**
 * `GET /activity` response — the signed-in player's most recent audited actions,
 * newest first (capped server-side). READ-ONLY: this projects the append-only ledger;
 * it never writes it (invariant 3 untriggered — no value moves reading the log).
 */
export interface ActivityFeed {
  entries: readonly ActivityEntry[];
}
