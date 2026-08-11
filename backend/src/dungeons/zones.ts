import type { DungeonZone, WildPool, WildPoolEntry, WildPoolRollParams } from '@digiworld/shared';
import { one, q, run, tx } from '../db/index.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';

/**
 * Structural input shape for replacing a dungeon's zones. Accepts both the
 * Zod-inferred `CreateZoneInput` (mutable pool) and `ImportedZone` (readonly
 * pool) — both are structurally assignable to `readonly ZoneInput[]`.
 */
export type ZoneInput = {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly safe: boolean;
  readonly pool: WildPool;
  readonly rollOverrides?: Partial<WildPoolRollParams> | undefined;
};

type ZoneRow = {
  readonly id: string;
  readonly dungeon_id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly safe: number;
  readonly pool_json: string;
  readonly roll_overrides_json: string | null;
  readonly created_at: number;
  readonly updated_at: number;
};

const SQL_LIST_ZONES = `SELECT * FROM dungeon_zones WHERE dungeon_id = ? ORDER BY created_at`;
const SQL_INSERT_ZONE = `INSERT INTO dungeon_zones (id, dungeon_id, name, x, y, width, height, safe, pool_json, roll_overrides_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_DELETE_ZONES = `DELETE FROM dungeon_zones WHERE dungeon_id = ?`;
const SQL_GET_DUNGEON_EXISTS = `SELECT id FROM dungeons WHERE id = ?`;

function isWildPoolEntry(value: unknown): value is WildPoolEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WildPoolEntry>;
  return typeof candidate.catalogId === 'string' && candidate.catalogId.length > 0;
}

function parsePool(value: string): WildPool {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isWildPoolEntry) : [];
  } catch (err) {
    log.warn('dungeon.zone.parse.fail', { field: 'pool_json', err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function parseRollOverrides(value: string | null): Partial<WildPoolRollParams> | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return parsed as Partial<WildPoolRollParams>;
  } catch (err) {
    log.warn('dungeon.zone.parse.fail', { field: 'roll_overrides_json', err: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

function zoneFromRow(row: ZoneRow): DungeonZone {
  const rollOverrides = parseRollOverrides(row.roll_overrides_json);
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    name: row.name,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    safe: row.safe === 1,
    pool: parsePool(row.pool_json),
    ...(rollOverrides !== undefined ? { rollOverrides } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listZones(dungeonId: string): Promise<readonly DungeonZone[]> {
  return (await q<ZoneRow>(SQL_LIST_ZONES, dungeonId)).map(zoneFromRow);
}

export async function replaceZones(dungeonId: string, inputs: readonly ZoneInput[]): Promise<readonly DungeonZone[] | 'not-found'> {
  if (!(await one<{ readonly id: string }>(SQL_GET_DUNGEON_EXISTS, dungeonId))) return 'not-found';
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_DELETE_ZONES, [dungeonId]);
    for (const input of inputs) {
      const id = newId('dzn');
      const rollOverridesJson = input.rollOverrides === undefined ? null : JSON.stringify(input.rollOverrides);
      await t.run(SQL_INSERT_ZONE, [id, dungeonId, input.name, input.x, input.y, input.width, input.height, input.safe ? 1 : 0, JSON.stringify(input.pool), rollOverridesJson, now, now]);
    }
  });
  return listZones(dungeonId);
}
