import type { DbExecutor } from '../db/executor.js';
import { execOne, execRun } from '../db/executor.js';

/**
 * Wallet helpers shared by dialogue actions, adventure engine, and any future
 * NetCore/Credits mutator. Consolidates the upsert pattern that was previously
 * duplicated across adventure/pve-battle/daily/etc.
 *
 * All mutators accept an optional `DbExecutor` so a caller inside `tx()` (the
 * dialogue runtime is the canonical example) can serialize the wallet write
 * with sibling actions — if a sibling fails, the whole entry-actions block
 * rolls back and the ledger claim is undone, so re-entering the same node
 * cleanly re-attempts.
 */

const SQL_ADD_NETCORE = `
  INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, 0, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET netcore = player_wallet.netcore + excluded.netcore, updated_at = excluded.updated_at
`;
const SQL_ADD_CREDITS = `
  INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, ?, 0, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET credits = player_wallet.credits + excluded.credits, updated_at = excluded.updated_at
`;
const SQL_SELECT_BALANCES = `SELECT credits, netcore FROM player_wallet WHERE user_id = ?`;

export type WalletBalances = { readonly credits: number; readonly netcore: number };

function isPositiveInteger(amount: number): boolean {
  return Number.isFinite(amount) && Number.isInteger(amount) && amount > 0;
}

export async function addNetcore(userId: string, amount: number, ex?: DbExecutor): Promise<void> {
  if (!isPositiveInteger(amount)) return;
  await execRun(ex, SQL_ADD_NETCORE, [userId, amount, Date.now()]);
}

export async function addCredits(userId: string, amount: number, ex?: DbExecutor): Promise<void> {
  if (!isPositiveInteger(amount)) return;
  await execRun(ex, SQL_ADD_CREDITS, [userId, amount, Date.now()]);
}

export async function getBalances(userId: string, ex?: DbExecutor): Promise<WalletBalances> {
  const row = await execOne<{ credits: number; netcore: number }>(ex, SQL_SELECT_BALANCES, [userId]);
  return { credits: row?.credits ?? 0, netcore: row?.netcore ?? 0 };
}

export async function hasNetcore(userId: string, amount: number, ex?: DbExecutor): Promise<boolean> {
  if (amount <= 0) return true;
  const balances = await getBalances(userId, ex);
  return balances.netcore >= amount;
}

export async function hasCredits(userId: string, amount: number, ex?: DbExecutor): Promise<boolean> {
  if (amount <= 0) return true;
  const balances = await getBalances(userId, ex);
  return balances.credits >= amount;
}
