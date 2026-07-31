import type { Queryable } from './types.js';

export type DisabledPack = {
  readonly sku: string;
  readonly disabledAt: number;
  readonly disabledBy: string;
  readonly reason: string | null;
};

export type PurchaseStats = {
  readonly delivered: number;
  readonly refunded: number;
  readonly failed: number;
  readonly expired: number;
  readonly deliveredBrlCents: number;
};

type DisabledPackRow = {
  readonly sku: string;
  readonly disabled_at: number;
  readonly disabled_by: string;
  readonly reason: string | null;
};

type PurchaseStatsRow = {
  readonly delivered: number;
  readonly refunded: number;
  readonly failed: number;
  readonly expired: number;
  readonly delivered_brl_cents: number | string;
};

const SQL_LIST_DISABLED = `SELECT sku, disabled_at, disabled_by, reason FROM disabled_credit_packs ORDER BY disabled_at DESC`;
const SQL_LIST_DISABLED_SKUS = `SELECT sku FROM disabled_credit_packs`;
const SQL_UPSERT_DISABLED = `INSERT INTO disabled_credit_packs (sku, disabled_at, disabled_by, reason) VALUES ($1, $2, $3, $4)
  ON CONFLICT (sku) DO UPDATE SET disabled_at = EXCLUDED.disabled_at, disabled_by = EXCLUDED.disabled_by, reason = EXCLUDED.reason`;
const SQL_DELETE_DISABLED = `DELETE FROM disabled_credit_packs WHERE sku = $1`;

const SQL_AGGREGATE_STATS = `
  SELECT
    COUNT(*) FILTER (WHERE state = 'delivered')::int AS delivered,
    COUNT(*) FILTER (WHERE state = 'refunded')::int AS refunded,
    COUNT(*) FILTER (WHERE state = 'failed')::int AS failed,
    COUNT(*) FILTER (WHERE state = 'expired')::int AS expired,
    COALESCE(SUM(amount_brl_cents) FILTER (WHERE state = 'delivered'), 0) AS delivered_brl_cents
  FROM purchase_sessions
`;

export async function listDisabledPacks(db: Queryable): Promise<readonly DisabledPack[]> {
  const result = await db.query<DisabledPackRow>(SQL_LIST_DISABLED);
  return result.rows.map((row) => ({ sku: row.sku, disabledAt: row.disabled_at, disabledBy: row.disabled_by, reason: row.reason }));
}

export async function listDisabledPackSkus(db: Queryable): Promise<ReadonlySet<string>> {
  const result = await db.query<{ readonly sku: string }>(SQL_LIST_DISABLED_SKUS);
  return new Set(result.rows.map((row) => row.sku));
}

export async function upsertDisabledPack(db: Queryable, input: { readonly sku: string; readonly disabledAt: number; readonly disabledBy: string; readonly reason: string | null }): Promise<void> {
  await db.query(SQL_UPSERT_DISABLED, [input.sku, input.disabledAt, input.disabledBy, input.reason]);
}

export async function deleteDisabledPack(db: Queryable, sku: string): Promise<boolean> {
  const result = await db.query(SQL_DELETE_DISABLED, [sku]);
  return (result.rowCount ?? 0) > 0;
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
