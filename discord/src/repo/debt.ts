import type { Queryable } from './types.js';

export type CreditDebt = {
  readonly userId: string;
  readonly amount: number;
  readonly reason: string | null;
  readonly purchaseSessionId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

type DebtRow = {
  readonly user_id: string;
  readonly amount: number;
  readonly reason: string | null;
  readonly purchase_session_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

const SQL_SELECT_DEBT = `SELECT user_id, amount, reason, purchase_session_id, created_at, updated_at FROM credit_debt WHERE user_id = $1`;
const SQL_UPSERT_DEBT = `INSERT INTO credit_debt (user_id, amount, reason, purchase_session_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)
  ON CONFLICT (user_id) DO UPDATE SET amount = credit_debt.amount + excluded.amount, reason = excluded.reason, purchase_session_id = excluded.purchase_session_id, updated_at = excluded.updated_at`;
const SQL_DELETE_DEBT = `DELETE FROM credit_debt WHERE user_id = $1`;

export async function getCreditDebt(db: Queryable, userId: string): Promise<CreditDebt | null> {
  const result = await db.query<DebtRow>(SQL_SELECT_DEBT, [userId]);
  const row = result.rows[0];
  return row ? { userId: row.user_id, amount: row.amount, reason: row.reason, purchaseSessionId: row.purchase_session_id, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

export async function addCreditDebt(db: Queryable, input: { readonly userId: string; readonly amount: number; readonly reason: string | null; readonly purchaseSessionId: string | null; readonly now: number }): Promise<void> {
  if (input.amount <= 0) return;
  await db.query(SQL_UPSERT_DEBT, [input.userId, input.amount, input.reason, input.purchaseSessionId, input.now]);
}

export async function clearCreditDebt(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query(SQL_DELETE_DEBT, [userId]);
  return (result.rowCount ?? 0) > 0;
}
