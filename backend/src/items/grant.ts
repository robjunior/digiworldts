import type { DbExecutor } from '../db/executor.js';
import { execOne, execRun } from '../db/executor.js';
import { bumpCollectObjectives } from '../quests/repo.js';

const SQL_GRANT = `
  INSERT INTO player_inventory (user_id, item_id, qty, updated_at)
       VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, item_id) DO UPDATE
       SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at
`;
const SQL_TAKE = `
  UPDATE player_inventory
     SET qty = qty - ?, updated_at = ?
   WHERE user_id = ? AND item_id = ? AND qty >= ?
`;
const SQL_COUNT = `SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?`;

function assertPositive(qty: number, caller: string): void {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`${caller} requires a positive integer quantity, got ${qty}`);
  }
}

export async function grantItem(userId: string, itemId: string, qty = 1, now = Date.now(), ex?: DbExecutor): Promise<void> {
  assertPositive(qty, 'grantItem');
  await execRun(ex, SQL_GRANT, [userId, itemId, qty, now]);
  if (ex === undefined) {
    try {
      await bumpCollectObjectives(userId, itemId, qty);
    } catch { /* best-effort — a quest-bump failure never blocks an item grant */ }
  }
}

/**
 * Conditional in one statement rather than read-then-write: two grants racing a
 * removal must never drive the balance negative or spend the same stack twice.
 * Returns false when the player is short, so callers can refuse the action.
 */
export async function removeItem(userId: string, itemId: string, qty = 1, now = Date.now(), ex?: DbExecutor): Promise<boolean> {
  assertPositive(qty, 'removeItem');
  const info = await execRun(ex, SQL_TAKE, [qty, now, userId, itemId, qty]);
  return info.changes > 0;
}

export async function countItem(userId: string, itemId: string, ex?: DbExecutor): Promise<number> {
  const row = await execOne<{ readonly qty: number }>(ex, SQL_COUNT, [userId, itemId]);
  return row === null ? 0 : row.qty;
}

export async function hasItem(userId: string, itemId: string, qty = 1, ex?: DbExecutor): Promise<boolean> {
  return (await countItem(userId, itemId, ex)) >= qty;
}
