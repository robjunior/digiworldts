import type {
  Dungeon,
  DungeonEncounter,
  DungeonItem,
  DungeonWarp,
  DungeonRunView,
  DungeonTile,
  DungeonView,
  EncounterDigimon,
  UserDungeonRun,
} from '@digiworld/shared';
import { one, q, run, tx } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import type { CreateEncounterInput, CreateItemInput, CreateWarpInput, TileInput, UpdateDungeonInput, UpdateEncounterInput, UpdateWarpInput } from './validation.js';
import { asEncounterDigimon, EncounterDigimonSchema } from './validation.js';
import { getDoorAt, getDoorById, listDoors } from './doors.js';
export { createDoor, deleteDoor, updateDoor } from './doors.js';

type DungeonRow = {
  readonly id: string; readonly world_object_id: string | null; readonly quest_id: string | null; readonly name: string; readonly description: string;
  readonly biome: Dungeon['biome']; readonly width: number; readonly height: number; readonly spawn_x: number; readonly spawn_y: number;
  readonly biome_region: string | null; readonly created_at: number; readonly updated_at: number;
};
type TileRow = { readonly x: number; readonly y: number };
type EncounterRow = {
  readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly label: string | null; readonly difficulty: DungeonEncounter['difficulty'];
  readonly digimon_data: string | readonly EncounterDigimon[]; readonly created_at: number; readonly updated_at: number;
};
type ItemRow = { readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly item_id: string; readonly qty: number; readonly created_at: number };
type WarpRow = { readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly target_dungeon_id: string | null; readonly label: string | null; readonly created_at: number; readonly updated_at: number };
type InventoryQtyRow = { readonly qty: number };
type RunRow = {
  readonly user_id: string; readonly dungeon_id: string; readonly current_x: number; readonly current_y: number;
  readonly defeated_encounters: string | readonly string[]; readonly collected_items: string | readonly string[]; readonly unlocked_doors: string | readonly string[]; readonly started_at: number; readonly completed_at: number | null;
};

const SQL_LIST_DUNGEONS = `SELECT * FROM dungeons ORDER BY created_at DESC`;
const SQL_GET_DUNGEON = `SELECT * FROM dungeons WHERE id = ?`;
const SQL_INSERT_DUNGEON = `INSERT INTO dungeons (id, world_object_id, quest_id, name, description, biome, width, height, spawn_x, spawn_y, biome_region, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_DUNGEON = `UPDATE dungeons SET world_object_id = ?, quest_id = ?, name = ?, description = ?, biome = ?, width = ?, height = ?, spawn_x = ?, spawn_y = ?, biome_region = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE_DUNGEON = `DELETE FROM dungeons WHERE id = ?`;
const SQL_LIST_TILES = `SELECT x, y FROM dungeon_tiles WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_TILE = `SELECT x, y FROM dungeon_tiles WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_DELETE_TILES = `DELETE FROM dungeon_tiles WHERE dungeon_id = ?`;
const SQL_INSERT_TILE = `INSERT INTO dungeon_tiles (dungeon_id, x, y) VALUES (?, ?, ?)`;
const SQL_LIST_ENCOUNTERS = `SELECT * FROM dungeon_encounters WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_ENCOUNTER = `SELECT * FROM dungeon_encounters WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_ENCOUNTER_AT = `SELECT * FROM dungeon_encounters WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_ENCOUNTER = `INSERT INTO dungeon_encounters (id, dungeon_id, x, y, label, difficulty, digimon_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_ENCOUNTER = `UPDATE dungeon_encounters SET x = ?, y = ?, label = ?, difficulty = ?, digimon_data = ?, updated_at = ? WHERE dungeon_id = ? AND id = ?`;
const SQL_DELETE_ENCOUNTER = `DELETE FROM dungeon_encounters WHERE dungeon_id = ? AND id = ?`;
const SQL_LIST_ITEMS = `SELECT * FROM dungeon_items WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_ITEM = `SELECT * FROM dungeon_items WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_ITEM_AT = `SELECT * FROM dungeon_items WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_ITEM = `INSERT INTO dungeon_items (id, dungeon_id, x, y, item_id, qty, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const SQL_DELETE_ITEM = `DELETE FROM dungeon_items WHERE dungeon_id = ? AND id = ?`;
const SQL_LIST_WARPS = `SELECT * FROM dungeon_warps WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_WARP = `SELECT * FROM dungeon_warps WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_WARP_AT = `SELECT * FROM dungeon_warps WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_WARP = `INSERT INTO dungeon_warps (id, dungeon_id, x, y, target_dungeon_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_WARP = `UPDATE dungeon_warps SET target_dungeon_id = ?, label = ?, updated_at = ? WHERE dungeon_id = ? AND id = ?`;
const SQL_DELETE_WARP = `DELETE FROM dungeon_warps WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_RUN = `SELECT * FROM user_dungeon_runs WHERE user_id = ? AND dungeon_id = ?`;
const SQL_INSERT_RUN = `INSERT INTO user_dungeon_runs (user_id, dungeon_id, current_x, current_y, defeated_encounters, collected_items, unlocked_doors, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`;
const SQL_UPDATE_RUN_POSITION = `UPDATE user_dungeon_runs SET current_x = ?, current_y = ?, collected_items = ? WHERE user_id = ? AND dungeon_id = ?`;
const SQL_UPDATE_RUN_DEFEATED = `UPDATE user_dungeon_runs SET defeated_encounters = ? WHERE user_id = ? AND dungeon_id = ?`;
const SQL_UPDATE_RUN_UNLOCKED_DOORS = `UPDATE user_dungeon_runs SET unlocked_doors = ? WHERE user_id = ? AND dungeon_id = ?`;
const SQL_COMPLETE_RUN = `UPDATE user_dungeon_runs SET completed_at = ? WHERE user_id = ? AND dungeon_id = ?`;
const SQL_RESET_RUN = `UPDATE user_dungeon_runs SET current_x = ?, current_y = ?, defeated_encounters = '[]', collected_items = '[]', unlocked_doors = '[]', started_at = ?, completed_at = NULL WHERE user_id = ? AND dungeon_id = ?`;
const SQL_UPSERT_QUEST_PROGRESS = `INSERT INTO user_quest_progress (user_id, quest_id, current_step_index, current_dialogue_node_id, choices_made, started_at, completed_at) VALUES (?, ?, 0, NULL, '{}', ?, ?) ON CONFLICT(user_id, quest_id) DO UPDATE SET completed_at = excluded.completed_at`;
const SQL_SELECT_INVENTORY_QTY = `SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?`;
const SQL_DECREMENT_INVENTORY = `UPDATE player_inventory SET qty = qty - 1, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= 1`;
const SQL_DELETE_EMPTY_INVENTORY = `DELETE FROM player_inventory WHERE user_id = ? AND item_id = ? AND qty <= 0`;

function parseStringArray(value: string | readonly string[], field: string): readonly string[] {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch (err) {
    log.warn('dungeon.json.parse.fail', { field, err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function parseDigimon(value: string | readonly EncounterDigimon[]): readonly EncounterDigimon[] {
  const input: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    const parsed = EncounterDigimonSchema.safeParse(entry);
    return parsed.success ? [asEncounterDigimon(parsed.data)] : [];
  });
}

function dungeonFromRow(row: DungeonRow): Dungeon {
  return { id: row.id, worldObjectId: row.world_object_id, questId: row.quest_id, name: row.name, description: row.description, biome: row.biome, width: row.width, height: row.height, spawnX: row.spawn_x, spawnY: row.spawn_y, biomeRegion: row.biome_region, createdAt: row.created_at, updatedAt: row.updated_at };
}

function tileFromRow(row: TileRow): DungeonTile {
  return { x: row.x, y: row.y };
}

function encounterFromRow(row: EncounterRow): DungeonEncounter {
  return { id: row.id, dungeonId: row.dungeon_id, x: row.x, y: row.y, label: row.label, difficulty: row.difficulty, digimon: parseDigimonSafe(row.digimon_data), createdAt: row.created_at, updatedAt: row.updated_at };
}

function parseDigimonSafe(value: string | readonly EncounterDigimon[]): readonly EncounterDigimon[] {
  try {
    return parseDigimon(value);
  } catch (err) {
    log.warn('dungeon.json.parse.fail', { field: 'digimon_data', err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function itemFromRow(row: ItemRow): DungeonItem {
  return { id: row.id, dungeonId: row.dungeon_id, x: row.x, y: row.y, itemId: row.item_id, qty: row.qty, createdAt: row.created_at };
}

function warpFromRow(row: WarpRow): DungeonWarp {
  return { id: row.id, dungeonId: row.dungeon_id, x: row.x, y: row.y, targetDungeonId: row.target_dungeon_id, label: row.label, createdAt: row.created_at, updatedAt: row.updated_at };
}

function runFromRow(row: RunRow): UserDungeonRun {
  return { userId: row.user_id, dungeonId: row.dungeon_id, currentX: row.current_x, currentY: row.current_y, defeatedEncounters: parseStringArray(row.defeated_encounters, 'defeated_encounters'), collectedItems: parseStringArray(row.collected_items, 'collected_items'), unlockedDoors: parseStringArray(row.unlocked_doors, 'unlocked_doors'), startedAt: row.started_at, completedAt: row.completed_at };
}

export async function listDungeons(): Promise<Dungeon[]> {
  return (await q<DungeonRow>(SQL_LIST_DUNGEONS)).map(dungeonFromRow);
}

export async function getDungeon(id: string): Promise<Dungeon | null> {
  const row = await one<DungeonRow>(SQL_GET_DUNGEON, id);
  return row ? dungeonFromRow(row) : null;
}

export async function getDungeonView(id: string): Promise<DungeonView | null> {
  const dungeon = await getDungeon(id);
  if (!dungeon) return null;
  return { dungeon, tiles: await listTiles(id), encounters: await listEncounters(id), items: await listItems(id), warps: await listWarps(id), doors: await listDoors(id) };
}

export async function getEncounter(dungeonId: string, encId: string): Promise<DungeonEncounter | null> {
  const row = await one<EncounterRow>(SQL_GET_ENCOUNTER, dungeonId, encId);
  return row ? encounterFromRow(row) : null;
}

export async function getRun(userId: string, dungeonId: string): Promise<UserDungeonRun | null> {
  const row = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  return row ? runFromRow(row) : null;
}

export async function createDungeon(input: Omit<Dungeon, 'id' | 'createdAt' | 'updatedAt'>): Promise<Dungeon> {
  const now = Date.now();
  const dungeon: Dungeon = { ...input, id: newId('dun'), createdAt: now, updatedAt: now };
  await run(SQL_INSERT_DUNGEON, dungeon.id, dungeon.worldObjectId, dungeon.questId, dungeon.name, dungeon.description, dungeon.biome, dungeon.width, dungeon.height, dungeon.spawnX, dungeon.spawnY, dungeon.biomeRegion, now, now);
  return dungeon;
}

export async function updateDungeon(id: string, input: UpdateDungeonInput): Promise<Dungeon | null> {
  const existing = await getDungeon(id);
  if (!existing) return null;
  const updated: Dungeon = {
    id: existing.id,
    worldObjectId: input.worldObjectId === undefined ? existing.worldObjectId : input.worldObjectId,
    questId: input.questId === undefined ? existing.questId : input.questId,
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    biome: input.biome ?? existing.biome,
    width: input.width ?? existing.width,
    height: input.height ?? existing.height,
    spawnX: input.spawnX ?? existing.spawnX,
    spawnY: input.spawnY ?? existing.spawnY,
    biomeRegion: input.biomeRegion === undefined ? existing.biomeRegion : input.biomeRegion,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await run(SQL_UPDATE_DUNGEON, updated.worldObjectId, updated.questId, updated.name, updated.description, updated.biome, updated.width, updated.height, updated.spawnX, updated.spawnY, updated.biomeRegion, updated.updatedAt, id);
  return updated;
}

export async function deleteDungeon(id: string): Promise<boolean> {
  return (await run(SQL_DELETE_DUNGEON, id)).changes > 0;
}

export async function listTiles(dungeonId: string): Promise<DungeonTile[]> {
  return (await q<TileRow>(SQL_LIST_TILES, dungeonId)).map(tileFromRow);
}

export async function replaceTiles(dungeonId: string, tiles: readonly TileInput[]): Promise<DungeonTile[] | null> {
  const dungeon = await getDungeon(dungeonId);
  if (!dungeon) return null;
  await tx(async (t) => {
    await t.run(SQL_DELETE_TILES, [dungeonId]);
    for (const tile of tiles) await t.run(SQL_INSERT_TILE, [dungeonId, tile.x, tile.y]);
  });
  return listTiles(dungeonId);
}

export async function createEncounter(dungeonId: string, input: CreateEncounterInput): Promise<DungeonEncounter | 'not-found' | 'conflict'> {
  if (!(await getDungeon(dungeonId))) return 'not-found';
  if (await one<EncounterRow>(SQL_GET_ENCOUNTER_AT, dungeonId, input.x, input.y)) return 'conflict';
  const now = Date.now();
  const id = newId('enc');
  await run(SQL_INSERT_ENCOUNTER, id, dungeonId, input.x, input.y, input.label ?? null, input.difficulty, JSON.stringify(input.digimon.map(asEncounterDigimon)), now, now);
  const row = await one<EncounterRow>(SQL_GET_ENCOUNTER, dungeonId, id);
  return row ? encounterFromRow(row) : 'not-found';
}

export async function updateEncounter(dungeonId: string, encId: string, input: UpdateEncounterInput): Promise<DungeonEncounter | 'not-found' | 'conflict'> {
  const existing = await one<EncounterRow>(SQL_GET_ENCOUNTER, dungeonId, encId);
  if (!existing) return 'not-found';
  const nextX = input.x ?? existing.x;
  const nextY = input.y ?? existing.y;
  const conflict = await one<EncounterRow>(SQL_GET_ENCOUNTER_AT, dungeonId, nextX, nextY);
  if (conflict && conflict.id !== encId) return 'conflict';
  const next = { x: nextX, y: nextY, label: input.label === undefined ? existing.label : input.label, difficulty: input.difficulty ?? existing.difficulty, digimon: input.digimon === undefined ? parseDigimonSafe(existing.digimon_data) : input.digimon.map(asEncounterDigimon), updatedAt: Date.now() };
  await run(SQL_UPDATE_ENCOUNTER, next.x, next.y, next.label, next.difficulty, JSON.stringify(next.digimon), next.updatedAt, dungeonId, encId);
  const row = await one<EncounterRow>(SQL_GET_ENCOUNTER, dungeonId, encId);
  return row ? encounterFromRow(row) : 'not-found';
}

export async function deleteEncounter(dungeonId: string, encId: string): Promise<boolean> {
  return (await run(SQL_DELETE_ENCOUNTER, dungeonId, encId)).changes > 0;
}

export async function createItem(dungeonId: string, input: CreateItemInput): Promise<DungeonItem | 'not-found' | 'conflict'> {
  if (!(await getDungeon(dungeonId))) return 'not-found';
  if (await one<ItemRow>(SQL_GET_ITEM_AT, dungeonId, input.x, input.y)) return 'conflict';
  const now = Date.now();
  const id = newId('ditm');
  await run(SQL_INSERT_ITEM, id, dungeonId, input.x, input.y, input.itemId, input.qty, now);
  const row = await one<ItemRow>(SQL_GET_ITEM, dungeonId, id);
  return row ? itemFromRow(row) : 'not-found';
}

export async function deleteItem(dungeonId: string, itemId: string): Promise<boolean> {
  return (await run(SQL_DELETE_ITEM, dungeonId, itemId)).changes > 0;
}

export async function listWarps(dungeonId: string): Promise<DungeonWarp[]> {
  return (await q<WarpRow>(SQL_LIST_WARPS, dungeonId)).map(warpFromRow);
}

export async function createWarp(dungeonId: string, input: CreateWarpInput): Promise<DungeonWarp | 'not-found' | 'conflict'> {
  if (!(await getDungeon(dungeonId))) return 'not-found';
  if (input.targetDungeonId !== undefined && input.targetDungeonId !== null && !(await getDungeon(input.targetDungeonId))) return 'not-found';
  if (await one<WarpRow>(SQL_GET_WARP_AT, dungeonId, input.x, input.y)) return 'conflict';
  const now = Date.now();
  const id = newId('wrp');
  await run(SQL_INSERT_WARP, id, dungeonId, input.x, input.y, input.targetDungeonId ?? null, input.label ?? null, now, now);
  const row = await one<WarpRow>(SQL_GET_WARP, dungeonId, id);
  return row ? warpFromRow(row) : 'not-found';
}

export async function updateWarp(dungeonId: string, warpId: string, input: UpdateWarpInput): Promise<DungeonWarp | 'not-found'> {
  const existing = await one<WarpRow>(SQL_GET_WARP, dungeonId, warpId);
  if (!existing) return 'not-found';
  if (input.targetDungeonId !== undefined && input.targetDungeonId !== null && !(await getDungeon(input.targetDungeonId))) return 'not-found';
  const targetDungeonId = input.targetDungeonId === undefined ? existing.target_dungeon_id : input.targetDungeonId;
  const label = input.label === undefined ? existing.label : input.label;
  await run(SQL_UPDATE_WARP, targetDungeonId, label, Date.now(), dungeonId, warpId);
  const row = await one<WarpRow>(SQL_GET_WARP, dungeonId, warpId);
  return row ? warpFromRow(row) : 'not-found';
}

export async function deleteWarp(dungeonId: string, warpId: string): Promise<boolean> {
  return (await run(SQL_DELETE_WARP, dungeonId, warpId)).changes > 0;
}

export async function unlockDoor(userId: string, dungeonId: string, doorId: string): Promise<{ readonly ok: true; readonly view: DungeonRunView } | { readonly ok: false; readonly error: 'not-found' | 'no-run' | 'missing-key'; readonly keyItemId?: string }> {
  const door = await getDoorById(doorId);
  if (!door || door.dungeon_id !== dungeonId) return { ok: false, error: 'not-found' };
  const runRow = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!runRow) return { ok: false, error: 'no-run' };
  const current = runFromRow(runRow);
  if (current.unlockedDoors.includes(doorId)) {
    const view = await getDungeonRunView(userId, dungeonId);
    return view ? { ok: true, view } : { ok: false, error: 'no-run' };
  }
  const inventory = await one<InventoryQtyRow>(SQL_SELECT_INVENTORY_QTY, userId, door.key_item_id);
  if (!inventory || inventory.qty < 1) return { ok: false, error: 'missing-key', keyItemId: door.key_item_id };
  await tx(async (t) => {
    const now = Date.now();
    await t.run(SQL_DECREMENT_INVENTORY, [now, userId, door.key_item_id]);
    await t.run(SQL_DELETE_EMPTY_INVENTORY, [userId, door.key_item_id]);
    await t.run(SQL_UPDATE_RUN_UNLOCKED_DOORS, [JSON.stringify([...current.unlockedDoors, doorId]), userId, dungeonId]);
  });
  const view = await getDungeonRunView(userId, dungeonId);
  return view ? { ok: true, view } : { ok: false, error: 'no-run' };
}

export async function startOrGetRun(userId: string, dungeonId: string): Promise<DungeonRunView | null> {
  const dungeon = await getDungeon(dungeonId);
  if (!dungeon) return null;
  const existing = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!existing) await run(SQL_INSERT_RUN, userId, dungeonId, dungeon.spawnX, dungeon.spawnY, '[]', '[]', '[]', Date.now());
  const runRow = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!runRow) return null;
  return { dungeon, run: runFromRow(runRow), tiles: await listTiles(dungeonId), encounters: await listEncounters(dungeonId), items: await listItems(dungeonId), doors: await listDoors(dungeonId) };
}

export async function getDungeonRunView(userId: string, dungeonId: string): Promise<DungeonRunView | null> {
  const dungeon = await getDungeon(dungeonId);
  const runRow = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!dungeon || !runRow) return null;
  return { dungeon, run: runFromRow(runRow), tiles: await listTiles(dungeonId), encounters: await listEncounters(dungeonId), items: await listItems(dungeonId), doors: await listDoors(dungeonId) };
}

export async function moveRun(userId: string, dungeonId: string, x: number, y: number): Promise<{ readonly kind: 'ok'; readonly run: UserDungeonRun; readonly triggeredEncounterId: string | null; readonly pickedUpItemId: string | null; readonly warpToDungeonId?: string | null } | { readonly kind: 'blocked-by-door'; readonly run: UserDungeonRun; readonly doorId: string } | { readonly kind: 'not-found' | 'blocked' | 'not-adjacent' }> {
  const existing = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!existing) return { kind: 'not-found' };
  const current = runFromRow(existing);
  if (!(await one<TileRow>(SQL_GET_TILE, dungeonId, x, y))) return { kind: 'blocked' };
  if (Math.abs(current.currentX - x) + Math.abs(current.currentY - y) !== 1) return { kind: 'not-adjacent' };
  const encounter = await one<EncounterRow>(SQL_GET_ENCOUNTER_AT, dungeonId, x, y);
  const item = await one<ItemRow>(SQL_GET_ITEM_AT, dungeonId, x, y);
  const warp = await one<WarpRow>(SQL_GET_WARP_AT, dungeonId, x, y);
  const door = await getDoorAt(dungeonId, x, y);
  if (door && !current.unlockedDoors.includes(door.id)) return { kind: 'blocked-by-door', run: current, doorId: door.id };
  const collectedItems = item && !current.collectedItems.includes(item.id) ? [...current.collectedItems, item.id] : current.collectedItems;
  await run(SQL_UPDATE_RUN_POSITION, x, y, JSON.stringify(collectedItems), userId, dungeonId);
  const row = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!row) return { kind: 'not-found' };
  return {
    kind: 'ok',
    run: runFromRow(row),
    triggeredEncounterId: encounter && !current.defeatedEncounters.includes(encounter.id) ? encounter.id : null,
    pickedUpItemId: item && !current.collectedItems.includes(item.id) ? item.id : null,
    ...(warp ? { warpToDungeonId: warp.target_dungeon_id } : {}),
  };
}

export async function defeatEncounter(userId: string, dungeonId: string, encId: string): Promise<UserDungeonRun | null> {
  const existing = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!existing || !(await one<EncounterRow>(SQL_GET_ENCOUNTER, dungeonId, encId))) return null;
  const current = runFromRow(existing);
  const defeated = current.defeatedEncounters.includes(encId) ? current.defeatedEncounters : [...current.defeatedEncounters, encId];
  await run(SQL_UPDATE_RUN_DEFEATED, JSON.stringify(defeated), userId, dungeonId);
  const row = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  return row ? runFromRow(row) : null;
}

export async function completeRun(userId: string, dungeonId: string): Promise<{ readonly run: UserDungeonRun; readonly questCompleted: boolean } | null> {
  const dungeon = await getDungeon(dungeonId);
  const existing = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!dungeon || !existing) return null;
  const now = Date.now();
  await run(SQL_COMPLETE_RUN, now, userId, dungeonId);
  if (dungeon.questId !== null) await run(SQL_UPSERT_QUEST_PROGRESS, userId, dungeon.questId, now, now);
  const row = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  return row ? { run: runFromRow(row), questCompleted: dungeon.questId !== null } : null;
}

export async function resetRun(userId: string, dungeonId: string): Promise<UserDungeonRun | null> {
  const dungeon = await getDungeon(dungeonId);
  if (!dungeon) return null;
  await startOrGetRun(userId, dungeonId);
  await run(SQL_RESET_RUN, dungeon.spawnX, dungeon.spawnY, Date.now(), userId, dungeonId);
  const row = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  return row ? runFromRow(row) : null;
}

async function listEncounters(dungeonId: string): Promise<DungeonEncounter[]> {
  return (await q<EncounterRow>(SQL_LIST_ENCOUNTERS, dungeonId)).map(encounterFromRow);
}

async function listItems(dungeonId: string): Promise<DungeonItem[]> {
  return (await q<ItemRow>(SQL_LIST_ITEMS, dungeonId)).map(itemFromRow);
}
