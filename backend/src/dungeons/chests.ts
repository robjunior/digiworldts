import type { ChestReward, DungeonChest } from '@digiworld/shared';
import { one, q, run } from '../db/index.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';
import type { CreateChestInput, UpdateChestInput } from './validation.js';
import { ensureDungeonKeyForPoi } from './keys.js';

export type ChestRow = {
  readonly id: string;
  readonly dungeon_id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly contents_json: string;
  readonly locked_by_key_id: string | null;
  readonly unused_tile_gid: number | null;
  readonly used_tile_gid: number | null;
  readonly created_at: number;
  readonly updated_at: number;
};

const SQL_LIST_CHESTS = `SELECT * FROM dungeon_chests WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_CHEST = `SELECT * FROM dungeon_chests WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_CHEST_BY_ID = `SELECT * FROM dungeon_chests WHERE id = ?`;
const SQL_GET_CHEST_AT = `SELECT * FROM dungeon_chests WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_CHEST = `INSERT INTO dungeon_chests (id, dungeon_id, x, y, label, contents_json, locked_by_key_id, unused_tile_gid, used_tile_gid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_CHEST = `UPDATE dungeon_chests SET x = ?, y = ?, label = ?, contents_json = ?, locked_by_key_id = ?, unused_tile_gid = ?, used_tile_gid = ?, updated_at = ? WHERE dungeon_id = ? AND id = ?`;
const SQL_UPDATE_CHEST_LOCKED_KEY = `UPDATE dungeon_chests SET locked_by_key_id = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE_CHEST = `DELETE FROM dungeon_chests WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_DUNGEON_EXISTS = `SELECT id FROM dungeons WHERE id = ?`;
const SQL_GET_DUNGEON_GROUP = `SELECT dungeon_group_id FROM dungeons WHERE id = ?`;

function isChestReward(value: unknown): value is ChestReward {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ChestReward>;
  return typeof candidate.itemId === 'string' && candidate.itemId.length > 0 && typeof candidate.qty === 'number' && candidate.qty > 0;
}

function parseContents(json: string): readonly ChestReward[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isChestReward) : [];
  } catch (err) {
    log.warn('dungeon.chest.parse.fail', { err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function chestFromRow(row: ChestRow): DungeonChest {
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    x: row.x,
    y: row.y,
    label: row.label,
    contents: parseContents(row.contents_json),
    lockedByKeyId: row.locked_by_key_id,
    unusedTileGid: row.unused_tile_gid,
    usedTileGid: row.used_tile_gid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getChestById(chestId: string): Promise<DungeonChest | null> {
  const row = await one<ChestRow>(SQL_GET_CHEST_BY_ID, chestId);
  return row ? chestFromRow(row) : null;
}

export async function getChestAt(dungeonId: string, x: number, y: number): Promise<DungeonChest | null> {
  const row = await one<ChestRow>(SQL_GET_CHEST_AT, dungeonId, x, y);
  return row ? chestFromRow(row) : null;
}

export async function listChests(dungeonId: string): Promise<readonly DungeonChest[]> {
  return (await q<ChestRow>(SQL_LIST_CHESTS, dungeonId)).map(chestFromRow);
}

export async function createChest(
  dungeonId: string,
  input: CreateChestInput,
): Promise<DungeonChest | 'not-found' | 'conflict'> {
  if (!(await one<{ readonly id: string }>(SQL_GET_DUNGEON_EXISTS, dungeonId))) return 'not-found';
  if (await getChestAt(dungeonId, input.x, input.y)) return 'conflict';
  const now = Date.now();
  const id = newId('chst');
  await run(
    SQL_INSERT_CHEST,
    id,
    dungeonId,
    input.x,
    input.y,
    input.label ?? null,
    JSON.stringify(input.contents),
    input.lockedByKeyId ?? null,
    input.unusedTileGid ?? null,
    input.usedTileGid ?? null,
    now,
    now,
  );
  // Wave E: if the chest is locked and the dungeon has a group, auto-provision
  // a dungeon-scoped key and rewire lockedByKeyId to point at it. Silently
  // drop the lock in group-less dungeons (keys are group-scoped by design).
  let effectiveLockedKey: string | null = input.lockedByKeyId ?? null;
  if (effectiveLockedKey !== null) {
    const dungeonRow = await one<{ readonly dungeon_group_id: string | null }>(SQL_GET_DUNGEON_GROUP, dungeonId);
    const groupId = dungeonRow?.dungeon_group_id ?? null;
    if (groupId !== null) {
      const key = await ensureDungeonKeyForPoi(groupId, 'chest', id);
      if (key.id !== effectiveLockedKey) {
        effectiveLockedKey = key.id;
        await run(SQL_UPDATE_CHEST_LOCKED_KEY, effectiveLockedKey, Date.now(), id);
      }
    } else {
      effectiveLockedKey = null;
      await run(SQL_UPDATE_CHEST_LOCKED_KEY, null, Date.now(), id);
      log.info('dungeon.chest.lock.dropped', { dungeonId, chestId: id, reason: 'dungeon-has-no-group' });
    }
  }
  const row = await one<ChestRow>(SQL_GET_CHEST, dungeonId, id);
  return row ? chestFromRow(row) : 'not-found';
}

export async function updateChest(
  dungeonId: string,
  chestId: string,
  input: UpdateChestInput,
): Promise<DungeonChest | 'not-found' | 'conflict'> {
  const existing = await one<ChestRow>(SQL_GET_CHEST, dungeonId, chestId);
  if (!existing) return 'not-found';
  const nextX = input.x ?? existing.x;
  const nextY = input.y ?? existing.y;
  if (nextX !== existing.x || nextY !== existing.y) {
    const conflict = await getChestAt(dungeonId, nextX, nextY);
    if (conflict && conflict.id !== chestId) return 'conflict';
  }
  const nextContents = input.contents ?? parseContents(existing.contents_json);
  const nextLockedBy = input.lockedByKeyId === undefined ? existing.locked_by_key_id : input.lockedByKeyId;
  const nextUnusedGid = input.unusedTileGid === undefined ? existing.unused_tile_gid : input.unusedTileGid;
  const nextUsedGid = input.usedTileGid === undefined ? existing.used_tile_gid : input.usedTileGid;
  const nextLabel = input.label === undefined ? existing.label : input.label;
  await run(
    SQL_UPDATE_CHEST,
    nextX,
    nextY,
    nextLabel,
    JSON.stringify(nextContents),
    nextLockedBy,
    nextUnusedGid,
    nextUsedGid,
    Date.now(),
    dungeonId,
    chestId,
  );
  const row = await one<ChestRow>(SQL_GET_CHEST, dungeonId, chestId);
  return row ? chestFromRow(row) : 'not-found';
}

export async function deleteChest(dungeonId: string, chestId: string): Promise<boolean> {
  return (await run(SQL_DELETE_CHEST, dungeonId, chestId)).changes > 0;
}
