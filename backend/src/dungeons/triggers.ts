/**
 * Dungeon lever triggers.
 *
 * A trigger is a lever placed on a walkable tile. When a player steps onto it
 * (moveRun), it fires once per run — the fired state lands in
 * `user_dungeon_trigger_states`, scoped to the dungeon group — and activates
 * its single target:
 *   - kind 'door': the door opens without a key.
 *   - kind 'bridge': the bridge lowers (down = walkable).
 *
 * Targets may live on any floor of the same dungeon group (cross-map). The
 * scope of a dungeon is `dungeonGroupId ?? dungeonId`; a target is valid only
 * when it shares the trigger's scope.
 */
import { one, q, run, tx } from '../db/index.js';
import { newId } from '../util/ids.js';
import type { DungeonTrigger, DungeonTriggerTarget, TriggerTargetKind } from '@digiworld/shared';
import type { TriggerInput, UpdateTriggerInput } from './validation.js';

type TriggerRow = {
  readonly id: string;
  readonly dungeon_id: string;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly unused_tile_gid: number | null;
  readonly used_tile_gid: number | null;
  readonly created_at: number;
  readonly updated_at: number;
};

type TargetRow = {
  readonly id: string;
  readonly trigger_id: string;
  readonly kind: string;
  readonly door_id: string | null;
  readonly bridge_id: string | null;
};

const SQL_GET_TRIGGER_SCOPE = `SELECT dungeon_group_id FROM dungeons WHERE id = ?`;
const SQL_GET_DOOR_SCOPE = `SELECT d.dungeon_id, dg.dungeon_group_id FROM dungeon_doors d JOIN dungeons dg ON dg.id = d.dungeon_id WHERE d.id = ?`;
const SQL_GET_BRIDGE_SCOPE = `SELECT b.dungeon_id, dg.dungeon_group_id FROM dungeon_bridges b JOIN dungeons dg ON dg.id = b.dungeon_id WHERE b.id = ?`;
const SQL_LIST_TRIGGERS = `SELECT * FROM dungeon_triggers WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_TRIGGER = `SELECT * FROM dungeon_triggers WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_TRIGGER_AT = `SELECT * FROM dungeon_triggers WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_GET_TRIGGER_BY_ID = `SELECT * FROM dungeon_triggers WHERE id = ?`;
const SQL_INSERT_TRIGGER = `INSERT INTO dungeon_triggers (id, dungeon_id, x, y, label, unused_tile_gid, used_tile_gid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_TRIGGER = `UPDATE dungeon_triggers SET x = ?, y = ?, label = ?, unused_tile_gid = ?, used_tile_gid = ?, updated_at = ? WHERE dungeon_id = ? AND id = ?`;
const SQL_DELETE_TRIGGER = `DELETE FROM dungeon_triggers WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_TARGET = `SELECT * FROM dungeon_trigger_targets WHERE trigger_id = ?`;
const SQL_INSERT_TARGET = `INSERT INTO dungeon_trigger_targets (id, trigger_id, kind, door_id, bridge_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`;
const SQL_DELETE_TARGET = `DELETE FROM dungeon_trigger_targets WHERE trigger_id = ?`;
const SQL_DOOR_TARGETING_TRIGGERS = `SELECT tt.trigger_id FROM dungeon_trigger_targets tt JOIN dungeon_triggers t ON t.id = tt.trigger_id WHERE tt.kind = 'door' AND tt.door_id = ?`;
const SQL_BRIDGE_TRIGGER_IDS_AT = `SELECT tt.trigger_id FROM dungeon_trigger_targets tt JOIN dungeon_triggers t ON t.id = tt.trigger_id JOIN dungeon_bridges b ON b.id = tt.bridge_id WHERE tt.kind = 'bridge' AND b.dungeon_id = ? AND b.x = ? AND b.y = ?`;

function triggerFromRow(row: TriggerRow, targets: readonly DungeonTriggerTarget[]): DungeonTrigger {
  return {
    id: row.id,
    dungeonId: row.dungeon_id,
    x: row.x,
    y: row.y,
    label: row.label,
    unusedTileGid: row.unused_tile_gid ?? null,
    usedTileGid: row.used_tile_gid ?? null,
    targets,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function targetFromRow(row: TargetRow): DungeonTriggerTarget {
  return {
    id: row.id,
    kind: row.kind as TriggerTargetKind,
    doorId: row.door_id ?? null,
    bridgeId: row.bridge_id ?? null,
  };
}

async function listTargets(triggerId: string): Promise<readonly DungeonTriggerTarget[]> {
  return (await q<TargetRow>(SQL_GET_TARGET, triggerId)).map(targetFromRow);
}

export async function listTriggers(dungeonId: string): Promise<DungeonTrigger[]> {
  const rows = await q<TriggerRow>(SQL_LIST_TRIGGERS, dungeonId);
  const out: DungeonTrigger[] = [];
  for (const row of rows) {
    out.push(triggerFromRow(row, await listTargets(row.id)));
  }
  return out;
}

export async function getTriggerAt(dungeonId: string, x: number, y: number): Promise<DungeonTrigger | null> {
  const row = await one<TriggerRow>(SQL_GET_TRIGGER_AT, dungeonId, x, y);
  if (!row) return null;
  return triggerFromRow(row, await listTargets(row.id));
}

export async function getTriggerById(triggerId: string): Promise<DungeonTrigger | null> {
  const row = await one<TriggerRow>(SQL_GET_TRIGGER_BY_ID, triggerId);
  if (!row) return null;
  return triggerFromRow(row, await listTargets(row.id));
}

/** Trigger ids whose door target is `doorId` (any map, same group by construction). */
export async function getDoorTargetingTriggerIds(doorId: string): Promise<readonly string[]> {
  const rows = await q<{ readonly trigger_id: string }>(SQL_DOOR_TARGETING_TRIGGERS, doorId);
  return rows.map((row) => row.trigger_id);
}

/** Trigger ids whose bridge target sits on a bridge at (x, y) in this dungeon. */
export async function getBridgeTriggerIdsAt(dungeonId: string, x: number, y: number): Promise<readonly string[]> {
  const rows = await q<{ readonly trigger_id: string }>(SQL_BRIDGE_TRIGGER_IDS_AT, dungeonId, x, y);
  return rows.map((row) => row.trigger_id);
}

async function targetSharesScope(triggerDungeonId: string, target: TriggerInput['target']): Promise<boolean> {
  const triggerScope = await one<{ readonly dungeon_group_id: string | null }>(SQL_GET_TRIGGER_SCOPE, triggerDungeonId);
  if (!triggerScope) return false;
  const triggerScopeKey = triggerScope.dungeon_group_id ?? triggerDungeonId;
  if (target.kind === 'door') {
    if (target.doorId === undefined || target.doorId === null) return false;
    const targetScope = await one<{ readonly dungeon_id: string; readonly dungeon_group_id: string | null }>(SQL_GET_DOOR_SCOPE, target.doorId);
    return targetScope !== null && (targetScope.dungeon_group_id ?? targetScope.dungeon_id) === triggerScopeKey;
  }
  if (target.bridgeId === undefined || target.bridgeId === null) return false;
  const targetScope = await one<{ readonly dungeon_id: string; readonly dungeon_group_id: string | null }>(SQL_GET_BRIDGE_SCOPE, target.bridgeId);
  return targetScope !== null && (targetScope.dungeon_group_id ?? targetScope.dungeon_id) === triggerScopeKey;
}

export async function createTrigger(
  dungeonId: string,
  input: TriggerInput,
): Promise<DungeonTrigger | 'not-found' | 'conflict' | 'invalid-target'> {
  if (!(await one<{ readonly id: string }>(SQL_GET_TRIGGER_SCOPE, dungeonId))) return 'not-found';
  if (await getTriggerAt(dungeonId, input.x, input.y)) return 'conflict';
  if (!(await targetSharesScope(dungeonId, input.target))) return 'invalid-target';
  const id = newId('trg');
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_INSERT_TRIGGER, [id, dungeonId, input.x, input.y, input.label ?? null, input.unusedTileGid ?? null, input.usedTileGid ?? null, now, now]);
    await t.run(SQL_INSERT_TARGET, [newId('trgt'), id, input.target.kind, input.target.kind === 'door' ? (input.target.doorId ?? null) : null, input.target.kind === 'bridge' ? (input.target.bridgeId ?? null) : null, now]);
  });
  const row = await one<TriggerRow>(SQL_GET_TRIGGER_BY_ID, id);
  return row ? triggerFromRow(row, await listTargets(row.id)) : 'not-found';
}

export async function updateTrigger(
  dungeonId: string,
  triggerId: string,
  input: UpdateTriggerInput,
): Promise<DungeonTrigger | 'not-found' | 'conflict' | 'invalid-target'> {
  const existing = await one<TriggerRow>(SQL_GET_TRIGGER, dungeonId, triggerId);
  if (!existing) return 'not-found';
  const nextX = input.x ?? existing.x;
  const nextY = input.y ?? existing.y;
  if ((nextX !== existing.x || nextY !== existing.y) && (await getTriggerAt(dungeonId, nextX, nextY))) return 'conflict';
  if (input.target !== undefined && !(await targetSharesScope(dungeonId, input.target))) return 'invalid-target';
  await tx(async (t) => {
    await t.run(SQL_UPDATE_TRIGGER, [nextX, nextY, input.label !== undefined ? input.label : existing.label, input.unusedTileGid !== undefined ? input.unusedTileGid : existing.unused_tile_gid, input.usedTileGid !== undefined ? input.usedTileGid : existing.used_tile_gid, Date.now(), dungeonId, triggerId]);
    if (input.target !== undefined) {
      await t.run(SQL_DELETE_TARGET, [triggerId]);
      await t.run(SQL_INSERT_TARGET, [newId('trgt'), triggerId, input.target.kind, input.target.kind === 'door' ? (input.target.doorId ?? null) : null, input.target.kind === 'bridge' ? (input.target.bridgeId ?? null) : null, Date.now()]);
    }
  });
  const row = await one<TriggerRow>(SQL_GET_TRIGGER, dungeonId, triggerId);
  if (!row) return 'not-found';
  return triggerFromRow(row, await listTargets(row.id));
}

export async function deleteTrigger(dungeonId: string, triggerId: string): Promise<boolean> {
  await run(SQL_DELETE_TARGET, triggerId);
  return (await run(SQL_DELETE_TRIGGER, dungeonId, triggerId)).changes > 0;
}
