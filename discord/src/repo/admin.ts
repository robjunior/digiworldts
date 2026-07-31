import type { Queryable } from './types.js';

export type SalesPause = {
  readonly paused: boolean;
  readonly pausedAt: number | null;
  readonly pausedBy: string | null;
  readonly reason: string | null;
};

export type PurchaseStats = {
  readonly delivered: number;
  readonly refunded: number;
  readonly failed: number;
  readonly expired: number;
  readonly deliveredBrlCents: number;
};

type SalesPauseRow = {
  readonly paused: boolean;
  readonly paused_at: number | null;
  readonly paused_by: string | null;
  readonly reason: string | null;
};

type PurchaseStatsRow = {
  readonly delivered: number;
  readonly refunded: number;
  readonly failed: number;
  readonly expired: number;
  readonly delivered_brl_cents: number | string;
};

const SQL_SELECT_PAUSE = `SELECT paused, paused_at, paused_by, reason FROM sales_pause WHERE id = TRUE`;
const SQL_UPSERT_PAUSE = `INSERT INTO sales_pause (id, paused, paused_at, paused_by, reason) VALUES (TRUE, $1, $2, $3, $4)
  ON CONFLICT (id) DO UPDATE SET paused = EXCLUDED.paused, paused_at = EXCLUDED.paused_at, paused_by = EXCLUDED.paused_by, reason = EXCLUDED.reason`;

const SQL_AGGREGATE_STATS = `
  SELECT
    COUNT(*) FILTER (WHERE state = 'delivered')::int AS delivered,
    COUNT(*) FILTER (WHERE state = 'refunded')::int AS refunded,
    COUNT(*) FILTER (WHERE state = 'failed')::int AS failed,
    COUNT(*) FILTER (WHERE state = 'expired')::int AS expired,
    COALESCE(SUM(amount_brl_cents) FILTER (WHERE state = 'delivered'), 0) AS delivered_brl_cents
  FROM purchase_sessions
`;

export async function getSalesPause(db: Queryable): Promise<SalesPause> {
  const result = await db.query<SalesPauseRow>(SQL_SELECT_PAUSE);
  const row = result.rows[0];
  if (row === undefined) return { paused: false, pausedAt: null, pausedBy: null, reason: null };
  return { paused: row.paused, pausedAt: row.paused_at, pausedBy: row.paused_by, reason: row.reason };
}

export async function isSalesPaused(db: Queryable): Promise<boolean> {
  return (await getSalesPause(db)).paused;
}

export async function setSalesPaused(db: Queryable, input: { readonly paused: boolean; readonly actorDiscordId: string; readonly reason: string | null; readonly now: number }): Promise<void> {
  await db.query(SQL_UPSERT_PAUSE, [input.paused, input.paused ? input.now : null, input.paused ? input.actorDiscordId : null, input.paused ? input.reason : null]);
}

export async function aggregatePurchaseStats(db: Queryable): Promise<PurchaseStats> {
  const result = await db.query<PurchaseStatsRow>(SQL_AGGREGATE_STATS);
  const row = result.rows[0];
  if (row === undefined) return { delivered: 0, refunded: 0, failed: 0, expired: 0, deliveredBrlCents: 0 };
  return {
    delivered: Number(row.delivered),
    refunded: Number(row.refunded),
    failed: Number(row.failed),
    expired: Number(row.expired),
    deliveredBrlCents: Number(row.delivered_brl_cents),
  };
}
