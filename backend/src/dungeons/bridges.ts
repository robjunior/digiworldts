/**
 * Dungeon bridges.
 *
 * A bridge is placed on a tile that is usually not walkable (a gap). Its run
 * state is derived from the lever triggers targeting it: UP (blocked,
 * up_tile_gid) until a targeting lever fires, then DOWN (walkable,
 * down_tile_gid). Cross-map lowering works because lever states are
 * group-scoped.
 */
import { one, q, run } from '../db/index.js';
import { newId } from '../util/ids.js';
import type { DungeonBridge } from '@digiworld/shared';
import type { BridgeInput, UpdateBridgeInput } from './validation.js';

export type BridgeRow = {
  readonly id: string;
  readonly dungeon_id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly down_tile_gid: number | null;
  readonly up_tile_gid: number | null;
  readonly enabled: number;
  readonly created_at: number;
  readonly updated_at: number;
};

const SQL_LIST_BRIDGES = `SELECT * FROM dungeon_bridges WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_BRIDGE = `SELECT * FROM dungeon_bridges WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_BRIDGE_AT = `SELECT * FROM dungeon_bridges WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_BRIDGE = `INSERT INTO dungeon_bridges (id, dungeon_id, x, y, label, down_tile_gid, up_tile_gid, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_BRIDGE = `UPDATE dungeon_bridges SET x = ?, y = ?, label = ?, down_tile_gid = ?, up_tile_gid = ?, enabled = ?, updated_at = ? WHERE dungeon_id = ? AND id = ?`;
const SQL_DELETE_BRIDGE = `DELETE FROM dungeon_bridges WHERE dungeon_id = ? AND id = ?`;

function bridgeFromRow(row: BridgeRow): DungeonBridge {
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    x: row.x,
    y: row.y,
    label: row.label,
    downTileGid: row.down_tile_gid ?? null,
    upTileGid: row.up_tile_gid ?? null,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listBridges(dungeonId: string): Promise<DungeonBridge[]> {
  return (await q<BridgeRow>(SQL_LIST_BRIDGES, dungeonId)).map(bridgeFromRow);
}

export async function getBridgeAt(dungeonId: string, x: number, y: number): Promise<DungeonBridge | null> {
  const row = await one<BridgeRow>(SQL_GET_BRIDGE_AT, dungeonId, x, y);
  return row ? bridgeFromRow(row) : null;
}

export async function createBridge(
  dungeonId: string,
  input: BridgeInput,
): Promise<DungeonBridge | 'not-found' | 'conflict'> {
  if (await getBridgeAt(dungeonId, input.x, input.y)) return 'conflict';
  const id = newId('brg');
  const now = Date.now();
  await run(SQL_INSERT_BRIDGE, id, dungeonId, input.x, input.y, input.label ?? null, input.downTileGid ?? null, input.upTileGid ?? null, input.enabled === false ? 0 : 1, now, now);
  const row = await one<BridgeRow>(SQL_GET_BRIDGE, dungeonId, id);
  return row ? bridgeFromRow(row) : 'not-found';
}

export async function updateBridge(
  dungeonId: string,
  bridgeId: string,
  input: UpdateBridgeInput,
): Promise<DungeonBridge | 'not-found' | 'conflict'> {
  const existing = await one<BridgeRow>(SQL_GET_BRIDGE, dungeonId, bridgeId);
  if (!existing) return 'not-found';
  const nextX = input.x ?? existing.x;
  const nextY = input.y ?? existing.y;
  if ((nextX !== existing.x || nextY !== existing.y) && (await getBridgeAt(dungeonId, nextX, nextY))) return 'conflict';
  await run(SQL_UPDATE_BRIDGE, nextX, nextY, input.label !== undefined ? input.label : existing.label, input.downTileGid !== undefined ? input.downTileGid : existing.down_tile_gid, input.upTileGid !== undefined ? input.upTileGid : existing.up_tile_gid, input.enabled === undefined ? existing.enabled : (input.enabled ? 1 : 0), Date.now(), dungeonId, bridgeId);
  const row = await one<BridgeRow>(SQL_GET_BRIDGE, dungeonId, bridgeId);
  return row ? bridgeFromRow(row) : 'not-found';
}

export async function deleteBridge(dungeonId: string, bridgeId: string): Promise<boolean> {
  return (await run(SQL_DELETE_BRIDGE, dungeonId, bridgeId)).changes > 0;
}
