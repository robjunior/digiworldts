import type { DbExecutor } from '../db/executor.js';
import { execOne, execRun } from '../db/executor.js';
import { one, q, tx, type DungeonRunStashRow } from '../db/index.js';
import { log } from '../util/log.js';
import type { InsufficientKitItem, Kit, KitItem, RunStashRow, RunStashView } from '@digiworld/shared/dungeon';

const SQL_SELECT_INVENTORY_QTY = `SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?`;
const SQL_DECREMENT_INVENTORY = `UPDATE player_inventory SET qty = qty - ?, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= ?`;
const SQL_UPSERT_INVENTORY = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`;

const SQL_UPSERT_STASH = `INSERT INTO dungeon_run_stash (user_id, dungeon_id, item_id, qty, origin, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, dungeon_id, item_id, origin) DO UPDATE SET qty = dungeon_run_stash.qty + excluded.qty, updated_at = excluded.updated_at`;
const SQL_SELECT_STASH_BY_RUN = `SELECT * FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ? ORDER BY origin, item_id`;
const SQL_DELETE_STASH_BY_RUN = `DELETE FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ?`;

export type EscrowResult =
  | { ok: true; stash: RunStashView }
  | { ok: false; error: 'insufficient-items'; missing: readonly InsufficientKitItem[] };

export async function escrowKitToStash(userId: string, dungeonId: string, kit: Kit): Promise<EscrowResult> {
  let missing: InsufficientKitItem[] = [];
  let succeeded = false;
  const now = Date.now();

  try {
    await tx(async (t) => {
      for (const it of kit.items) {
        const row = await execOne<{ qty: number }>(t, SQL_SELECT_INVENTORY_QTY, [userId, it.itemId]);
        const have = row?.qty ?? 0;
        if (have < it.qty) missing.push({ itemId: it.itemId, needed: it.qty, have });
      }
      if (missing.length > 0) throw new Error('__insufficient_items');

      for (const it of kit.items) {
        const dec = await execRun(t, SQL_DECREMENT_INVENTORY, [it.qty, now, userId, it.itemId, it.qty]);
        if (dec.changes === 0) throw new Error('__race');
        await execRun(t, SQL_UPSERT_STASH, [userId, dungeonId, it.itemId, it.qty, 'kit', now]);
      }
      succeeded = true;
    });
  } catch (err) {
    if (err instanceof Error && err.message === '__insufficient_items') {
      return { ok: false, error: 'insufficient-items', missing };
    }
    if (err instanceof Error && err.message === '__race') {
      return { ok: false, error: 'insufficient-items', missing: kit.items.map((it) => ({ itemId: it.itemId, needed: it.qty, have: 0 })) };
    }
    throw err;
  }

  if (!succeeded) return { ok: false, error: 'insufficient-items', missing };
  log.info('dungeon.kit.escrow', { userId, dungeonId, kitId: kit.id, itemCount: kit.items.length });
  const stash = await readStash(userId, dungeonId);
  return { ok: true, stash };
}

export async function readStash(userId: string, dungeonId: string): Promise<RunStashView> {
  const rows = await q<DungeonRunStashRow>(SQL_SELECT_STASH_BY_RUN, userId, dungeonId);
  return {
    items: rows.map((r) => ({
      itemId: r.item_id,
      qty: r.qty,
      origin: r.origin,
      updatedAt: r.updated_at,
    })),
    meat: 0,
    bits: 0,
    data: 0,
  };
}

export async function refundStash(userId: string, dungeonId: string): Promise<void> {
  const rows = await q<DungeonRunStashRow>(SQL_SELECT_STASH_BY_RUN, userId, dungeonId);
  if (rows.length === 0) return;
  const now = Date.now();
  await tx(async (t) => {
    for (const row of rows) {
      await t.run(SQL_UPSERT_INVENTORY, [row.user_id, row.item_id, row.qty, now]);
    }
    await t.run(SQL_DELETE_STASH_BY_RUN, [userId, dungeonId]);
  });
  log.info('dungeon.stash.refund', { userId, dungeonId, rowCount: rows.length });
}

export async function purgeStash(userId: string, dungeonId: string): Promise<void> {
  await tx(async (t) => {
    await t.run(SQL_DELETE_STASH_BY_RUN, [userId, dungeonId]);
  });
  log.info('dungeon.stash.purge', { userId, dungeonId });
}

export type StashRowView = RunStashRow;
