import type { DungeonKey } from '@digiworld/shared';
import { one, q, run } from '../db/index.js';
import { newId } from '../util/ids.js';

type KeyRow = {
  readonly id: string;
  readonly dungeon_group_id: string;
  readonly generated_for_kind: 'door' | 'chest';
  readonly generated_for_id: string;
  readonly name: string;
  readonly placed_dungeon_id: string | null;
  readonly placed_x: number | null;
  readonly placed_y: number | null;
  readonly created_at: number;
};

const SQL_LIST_KEYS_FOR_GROUP = `SELECT * FROM dungeon_keys WHERE dungeon_group_id = ? ORDER BY name`;
const SQL_GET_KEY_BY_ID = `SELECT * FROM dungeon_keys WHERE id = ?`;
const SQL_GET_KEY_FOR_POI = `SELECT * FROM dungeon_keys WHERE generated_for_kind = ? AND generated_for_id = ?`;
const SQL_INSERT_KEY = `INSERT INTO dungeon_keys (id, dungeon_group_id, generated_for_kind, generated_for_id, name, placed_dungeon_id, placed_x, placed_y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_KEY_PLACEMENT = `UPDATE dungeon_keys SET placed_dungeon_id = ?, placed_x = ?, placed_y = ? WHERE id = ?`;
const SQL_CLEAR_KEY_PLACEMENT = `UPDATE dungeon_keys SET placed_dungeon_id = NULL, placed_x = NULL, placed_y = NULL WHERE id = ?`;
const SQL_GET_KEY_AT_PLACEMENT = `SELECT * FROM dungeon_keys WHERE placed_dungeon_id = ? AND placed_x = ? AND placed_y = ?`;
const SQL_COUNT_KEYS_IN_GROUP = `SELECT COUNT(*) as count FROM dungeon_keys WHERE dungeon_group_id = ?`;

function keyFromRow(row: KeyRow): DungeonKey {
  return {
    id: row.id,
    dungeonGroupId: row.dungeon_group_id,
    generatedForPoiKind: row.generated_for_kind,
    generatedForPoiId: row.generated_for_id,
    name: row.name,
    placedDungeonId: row.placed_dungeon_id,
    placedX: row.placed_x,
    placedY: row.placed_y,
    createdAt: row.created_at,
  };
}

async function nextKeyNameForGroup(groupId: string): Promise<string> {
  const row = await one<{ readonly count: number }>(SQL_COUNT_KEYS_IN_GROUP, groupId);
  const n = row?.count ?? 0;
  const cycle = Math.floor(n / 26) + 1;
  const letter = String.fromCharCode(65 + (n % 26));
  return `Chave ${letter.repeat(cycle)}`;
}

export async function ensureDungeonKeyForPoi(
  groupId: string,
  poiKind: 'door' | 'chest',
  poiId: string,
): Promise<DungeonKey> {
  const existing = await one<KeyRow>(SQL_GET_KEY_FOR_POI, poiKind, poiId);
  if (existing) return keyFromRow(existing);
  const id = newId('dkey');
  const name = await nextKeyNameForGroup(groupId);
  const now = Date.now();
  await run(SQL_INSERT_KEY, id, groupId, poiKind, poiId, name, null, null, null, now);
  return { id, dungeonGroupId: groupId, generatedForPoiKind: poiKind, generatedForPoiId: poiId, name, placedDungeonId: null, placedX: null, placedY: null, createdAt: now };
}

export async function listKeysForGroup(groupId: string): Promise<readonly DungeonKey[]> {
  return (await q<KeyRow>(SQL_LIST_KEYS_FOR_GROUP, groupId)).map(keyFromRow);
}

export async function getKeyById(id: string): Promise<DungeonKey | null> {
  const row = await one<KeyRow>(SQL_GET_KEY_BY_ID, id);
  return row ? keyFromRow(row) : null;
}

export async function updateKeyPlacement(id: string, dungeonId: string, x: number, y: number): Promise<DungeonKey | null> {
  await run(SQL_UPDATE_KEY_PLACEMENT, dungeonId, x, y, id);
  return getKeyById(id);
}

export async function clearKeyPlacement(id: string): Promise<void> {
  await run(SQL_CLEAR_KEY_PLACEMENT, id);
}

export async function getKeyAtPlacement(dungeonId: string, x: number, y: number): Promise<DungeonKey | null> {
  const row = await one<KeyRow>(SQL_GET_KEY_AT_PLACEMENT, dungeonId, x, y);
  return row ? keyFromRow(row) : null;
}
