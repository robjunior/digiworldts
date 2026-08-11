import type { DungeonDoor } from '@digiworld/shared';
import { one, q, run } from '../db/index.js';
import { newId } from '../util/ids.js';
import type { DoorInput, UpdateDoorInput } from './validation.js';

export type DoorRow = { readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly key_item_id: string; readonly label: string | null; readonly created_at: number; readonly updated_at: number };

const SQL_GET_DUNGEON_EXISTS = `SELECT id FROM dungeons WHERE id = ?`;
const SQL_LIST_DOORS = `SELECT * FROM dungeon_doors WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_DOOR = `SELECT * FROM dungeon_doors WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_DOOR_BY_ID = `SELECT * FROM dungeon_doors WHERE id = ?`;
const SQL_GET_DOOR_AT = `SELECT * FROM dungeon_doors WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_DOOR = `INSERT INTO dungeon_doors (id, dungeon_id, x, y, key_item_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_DOOR = `UPDATE dungeon_doors SET x = ?, y = ?, key_item_id = ?, label = ?, updated_at = ? WHERE dungeon_id = ? AND id = ?`;
const SQL_DELETE_DOOR = `DELETE FROM dungeon_doors WHERE dungeon_id = ? AND id = ?`;

function doorFromRow(row: DoorRow): DungeonDoor {
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    x: row.x,
    y: row.y,
    keyItemId: row.key_item_id,
    dungeonKeyId: null,
    label: row.label,
    unusedTileGid: null,
    usedTileGid: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getDoorById(doorId: string): Promise<DoorRow | null> {
  return one<DoorRow>(SQL_GET_DOOR_BY_ID, doorId);
}

export async function getDoorAt(dungeonId: string, x: number, y: number): Promise<DoorRow | null> {
  return one<DoorRow>(SQL_GET_DOOR_AT, dungeonId, x, y);
}

export async function listDoors(dungeonId: string): Promise<DungeonDoor[]> {
  return (await q<DoorRow>(SQL_LIST_DOORS, dungeonId)).map(doorFromRow);
}

export async function createDoor(dungeonId: string, input: DoorInput): Promise<DungeonDoor | 'not-found' | 'conflict'> {
  if (!(await one<{ readonly id: string }>(SQL_GET_DUNGEON_EXISTS, dungeonId))) return 'not-found';
  if (await getDoorAt(dungeonId, input.x, input.y)) return 'conflict';
  const now = Date.now();
  const id = newId('dor');
  await run(SQL_INSERT_DOOR, id, dungeonId, input.x, input.y, input.keyItemId, input.label ?? null, now, now);
  const row = await one<DoorRow>(SQL_GET_DOOR, dungeonId, id);
  return row ? doorFromRow(row) : 'not-found';
}

export async function updateDoor(dungeonId: string, doorId: string, input: UpdateDoorInput): Promise<DungeonDoor | 'not-found' | 'conflict'> {
  const existing = await one<DoorRow>(SQL_GET_DOOR, dungeonId, doorId);
  if (!existing) return 'not-found';
  const nextX = input.x ?? existing.x;
  const nextY = input.y ?? existing.y;
  const conflict = await getDoorAt(dungeonId, nextX, nextY);
  if (conflict && conflict.id !== doorId) return 'conflict';
  await run(SQL_UPDATE_DOOR, nextX, nextY, input.keyItemId ?? existing.key_item_id, input.label === undefined ? existing.label : input.label, Date.now(), dungeonId, doorId);
  const row = await one<DoorRow>(SQL_GET_DOOR, dungeonId, doorId);
  return row ? doorFromRow(row) : 'not-found';
}

export async function deleteDoor(dungeonId: string, doorId: string): Promise<boolean> {
  return (await run(SQL_DELETE_DOOR, dungeonId, doorId)).changes > 0;
}
