import type { DungeonInventoryItemKind, DungeonRunGroupInventoryEntry } from '@digiworld/shared';
import { one, q, run } from '../db/index.js';

type InventoryRow = {
  readonly user_id: string;
  readonly dungeon_group_id: string;
  readonly item_kind: DungeonInventoryItemKind;
  readonly item_id: string;
  readonly qty: number;
  readonly acquired_at: number;
};

const SQL_LIST_INVENTORY_FOR_USER_GROUP = `SELECT * FROM user_dungeon_run_group_inventory WHERE user_id = ? AND dungeon_group_id = ?`;
const SQL_GET_INVENTORY_ENTRY = `SELECT * FROM user_dungeon_run_group_inventory WHERE user_id = ? AND dungeon_group_id = ? AND item_kind = ? AND item_id = ?`;
export const SQL_UPSERT_GROUP_INVENTORY = `INSERT INTO user_dungeon_run_group_inventory (user_id, dungeon_group_id, item_kind, item_id, qty, acquired_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, dungeon_group_id, item_kind, item_id) DO UPDATE SET qty = user_dungeon_run_group_inventory.qty + excluded.qty, acquired_at = excluded.acquired_at`;
const SQL_PURGE_INVENTORY_FOR_USER_GROUP = `DELETE FROM user_dungeon_run_group_inventory WHERE user_id = ? AND dungeon_group_id = ?`;

function inventoryFromRow(row: InventoryRow): DungeonRunGroupInventoryEntry {
  return {
    userId: row.user_id,
    dungeonGroupId: row.dungeon_group_id,
    itemKind: row.item_kind,
    itemId: row.item_id,
    qty: row.qty,
    acquiredAt: row.acquired_at,
  };
}

export async function listGroupInventoryForUser(userId: string, groupId: string): Promise<readonly DungeonRunGroupInventoryEntry[]> {
  return (await q<InventoryRow>(SQL_LIST_INVENTORY_FOR_USER_GROUP, userId, groupId)).map(inventoryFromRow);
}

export async function addToGroupInventory(userId: string, groupId: string, itemKind: DungeonInventoryItemKind, itemId: string, qty: number): Promise<void> {
  await run(SQL_UPSERT_GROUP_INVENTORY, userId, groupId, itemKind, itemId, qty, Date.now());
}

export async function hasKey(userId: string, groupId: string, keyId: string): Promise<boolean> {
  const row = await one<InventoryRow>(SQL_GET_INVENTORY_ENTRY, userId, groupId, 'dungeon-key', keyId);
  return row !== null && row.qty > 0;
}

export async function purgeGroupInventory(userId: string, groupId: string): Promise<void> {
  await run(SQL_PURGE_INVENTORY_FOR_USER_GROUP, userId, groupId);
}
