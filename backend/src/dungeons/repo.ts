import type {
  Dungeon,
  DungeonEncounter,
  DungeonItem,
  DungeonWarp,
  DungeonRunView,
  DungeonTile,
  DungeonView,
  EncounterDigimon,
  EncounterLoot,
  TilesetGrant,
  UserDungeonRun,
} from '@digiworld/shared';
import type { Element } from '@digiworld/shared/digimon';
import { one, q, run, tx } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import type { CreateEncounterInput, CreateItemInput, CreateWarpInput, TileInput, UpdateDungeonInput, UpdateEncounterInput, UpdateWarpInput } from './validation.js';
import { asEncounterDigimon, EncounterDigimonSchema } from './validation.js';
import type { TiledImportPayload, ImportedTilesetRef } from './tiled-import.js';
import { findTilesetByName } from '../tilesets/repo.js';
import { getDoorAt, getDoorById, listDoors } from './doors.js';
import { computePartyAvgSpd, evaluateTrap, getTrapAt, listTraps } from './traps.js';
import type { TrapTriggered } from '@digiworld/shared';
import { rollRandomEncounter } from './random.js';
export { createDoor, deleteDoor, updateDoor } from './doors.js';

type DungeonRow = {
  readonly id: string; readonly world_object_id: string | null; readonly quest_id: string | null; readonly parent_id: string | null; readonly name: string; readonly description: string;
  readonly biome: Dungeon['biome']; readonly width: number; readonly height: number; readonly spawn_x: number; readonly spawn_y: number;
  readonly biome_region: string | null; readonly random_encounters_enabled: number; readonly random_encounter_rate: number;
  readonly random_min_level: number; readonly random_max_level: number; readonly random_max_stage: Dungeon['randomMaxStage'];
  readonly random_min_party_size: number; readonly random_max_party_size: number; readonly random_allowed_elements: string | readonly Element[] | null;
  readonly unlock_requires_items: string | readonly string[] | null;
  readonly created_at: number; readonly updated_at: number;
};
type TileRow = { readonly x: number; readonly y: number; readonly gid: number };
type EncounterRow = {
  readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly label: string | null; readonly difficulty: DungeonEncounter['difficulty'];
  readonly digimon_data: string | readonly EncounterDigimon[]; readonly reward_item_id: string | null; readonly loots: string | readonly EncounterLoot[]; readonly scene_id: string | null; readonly created_at: number; readonly updated_at: number;
};
type ItemRow = { readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly item_id: string; readonly qty: number; readonly created_at: number };
type WarpRow = { readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly target_dungeon_id: string | null; readonly label: string | null; readonly created_at: number; readonly updated_at: number };
type InventoryQtyRow = { readonly qty: number };
type RunRow = {
  readonly user_id: string; readonly dungeon_id: string; readonly current_x: number; readonly current_y: number;
  readonly defeated_encounters: string | readonly string[]; readonly collected_items: string | readonly string[]; readonly unlocked_doors: string | readonly string[]; readonly oneshot_triggered_ids: string | readonly string[] | null; readonly started_at: number; readonly completed_at: number | null;
};

const SQL_LIST_DUNGEONS = `SELECT * FROM dungeons ORDER BY created_at DESC`;
const SQL_GET_DUNGEON = `SELECT * FROM dungeons WHERE id = ?`;
const SQL_INSERT_DUNGEON = `INSERT INTO dungeons (id, world_object_id, quest_id, parent_id, name, description, biome, width, height, spawn_x, spawn_y, biome_region, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_DUNGEON = `UPDATE dungeons SET world_object_id = ?, quest_id = ?, parent_id = ?, name = ?, description = ?, biome = ?, width = ?, height = ?, spawn_x = ?, spawn_y = ?, biome_region = ?, random_encounters_enabled = ?, random_encounter_rate = ?, random_min_level = ?, random_max_level = ?, random_max_stage = ?, random_min_party_size = ?, random_max_party_size = ?, random_allowed_elements = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE_DUNGEON = `DELETE FROM dungeons WHERE id = ?`;
const SQL_LIST_TILES = `SELECT x, y, gid FROM dungeon_tiles WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_LIST_DUNGEON_TILESETS = `SELECT t.id, t.name, t.image_filename, t.tile_width, t.tile_height, t.image_width, t.image_height, t.columns, t.tile_count, t.created_at, t.updated_at, dt.firstgid FROM dungeon_tilesets dt JOIN tilesets t ON t.id = dt.tileset_id WHERE dt.dungeon_id = ? ORDER BY dt.firstgid`;
const SQL_GET_TILE = `SELECT x, y FROM dungeon_tiles WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_DELETE_TILES = `DELETE FROM dungeon_tiles WHERE dungeon_id = ?`;
const SQL_LIST_ENCOUNTERS = `SELECT * FROM dungeon_encounters WHERE dungeon_id = ? ORDER BY y, x`;
const SQL_GET_ENCOUNTER = `SELECT * FROM dungeon_encounters WHERE dungeon_id = ? AND id = ?`;
const SQL_GET_ENCOUNTER_AT = `SELECT * FROM dungeon_encounters WHERE dungeon_id = ? AND x = ? AND y = ?`;
const SQL_INSERT_ENCOUNTER = `INSERT INTO dungeon_encounters (id, dungeon_id, x, y, label, difficulty, digimon_data, loots, scene_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_ENCOUNTER = `UPDATE dungeon_encounters SET x = ?, y = ?, label = ?, difficulty = ?, digimon_data = ?, loots = ?, scene_id = ?, updated_at = ? WHERE dungeon_id = ? AND id = ?`;
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
// Position-guarded write: two concurrent moves must not both pass the
// adjacency check against the same stale position and both apply.
const SQL_UPDATE_RUN_POSITION_CAS = `UPDATE user_dungeon_runs SET current_x = ?, current_y = ?, collected_items = ?, oneshot_triggered_ids = ? WHERE user_id = ? AND dungeon_id = ? AND current_x = ? AND current_y = ?`;
const SQL_UPDATE_RUN_DEFEATED = `UPDATE user_dungeon_runs SET defeated_encounters = ? WHERE user_id = ? AND dungeon_id = ?`;
const SQL_UPDATE_RUN_UNLOCKED_DOORS = `UPDATE user_dungeon_runs SET unlocked_doors = ? WHERE user_id = ? AND dungeon_id = ?`;
const SQL_COMPLETE_RUN = `UPDATE user_dungeon_runs SET completed_at = ? WHERE user_id = ? AND dungeon_id = ?`;
const SQL_RESET_RUN = `UPDATE user_dungeon_runs SET current_x = ?, current_y = ?, defeated_encounters = '[]', collected_items = '[]', unlocked_doors = '[]', started_at = ?, completed_at = NULL WHERE user_id = ? AND dungeon_id = ?`;
const SQL_UPSERT_QUEST_PROGRESS = `INSERT INTO user_quest_progress (user_id, quest_id, current_step_index, current_dialogue_node_id, choices_made, started_at, completed_at) VALUES (?, ?, 0, NULL, '{}', ?, ?) ON CONFLICT(user_id, quest_id) DO UPDATE SET completed_at = excluded.completed_at`;
const SQL_SELECT_INVENTORY_QTY = `SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?`;
const SQL_DECREMENT_INVENTORY = `UPDATE player_inventory SET qty = qty - 1, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= 1`;
const SQL_DELETE_EMPTY_INVENTORY = `DELETE FROM player_inventory WHERE user_id = ? AND item_id = ? AND qty <= 0`;
const SQL_UPSERT_INVENTORY_PICKUP = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`;
const SQL_ITEM_IS_CATALOGED = `SELECT id FROM shop_items WHERE id = ?`;

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

function parseAllowedElements(value: string | readonly Element[] | null): readonly Element[] | null {
  if (value === null) return null;
  const input: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(input) ? input.filter((entry): entry is Element => typeof entry === 'string') : null;
}

function parseAllowedElementsSafe(value: string | readonly Element[] | null): readonly Element[] | null {
  try {
    return parseAllowedElements(value);
  } catch (err) {
    log.warn('dungeon.json.parse.fail', { field: 'random_allowed_elements', err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function dungeonFromRow(row: DungeonRow): Dungeon {
  return { id: row.id, worldObjectId: row.world_object_id, questId: row.quest_id, parentId: row.parent_id, name: row.name, description: row.description, biome: row.biome, width: row.width, height: row.height, spawnX: row.spawn_x, spawnY: row.spawn_y, biomeRegion: row.biome_region, randomEncountersEnabled: row.random_encounters_enabled === 1, randomEncounterRate: row.random_encounter_rate, randomMinLevel: row.random_min_level, randomMaxLevel: row.random_max_level, randomMaxStage: row.random_max_stage, randomMinPartySize: row.random_min_party_size, randomMaxPartySize: row.random_max_party_size, randomAllowedElements: parseAllowedElementsSafe(row.random_allowed_elements), unlockRequiresItems: parseStringArraySafe(row.unlock_requires_items), createdAt: row.created_at, updatedAt: row.updated_at };
}

function parseStringArraySafe(value: string | readonly string[] | null): readonly string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((entry): entry is string => typeof entry === 'string');
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}

function tileFromRow(row: TileRow): DungeonTile {
  return { x: row.x, y: row.y, gid: row.gid };
}

function encounterFromRow(row: EncounterRow): DungeonEncounter {
  return { id: row.id, dungeonId: row.dungeon_id, x: row.x, y: row.y, label: row.label, difficulty: row.difficulty, digimon: parseDigimonSafe(row.digimon_data), rewardItemId: row.reward_item_id, loots: parseLootsSafe(row.loots), sceneId: row.scene_id ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
}

function parseDigimonSafe(value: string | readonly EncounterDigimon[]): readonly EncounterDigimon[] {
  try {
    return parseDigimon(value);
  } catch (err) {
    log.warn('dungeon.json.parse.fail', { field: 'digimon_data', err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function parseLootsSafe(value: string | readonly EncounterLoot[]): readonly EncounterLoot[] {
  if (Array.isArray(value)) return value as readonly EncounterLoot[];
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: EncounterLoot[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record['itemId'] !== 'string') continue;
      const qty = typeof record['qty'] === 'number' ? record['qty'] : 1;
      const chance = typeof record['chance'] === 'number' ? record['chance'] : 1;
      out.push({ itemId: record['itemId'], qty: Math.max(1, Math.floor(qty)), chance: Math.max(0, Math.min(1, chance)) });
    }
    return out;
  } catch (err) {
    log.warn('dungeon.json.parse.fail', { field: 'loots', err: err instanceof Error ? err.message : String(err) });
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
  return { userId: row.user_id, dungeonId: row.dungeon_id, currentX: row.current_x, currentY: row.current_y, defeatedEncounters: parseStringArray(row.defeated_encounters, 'defeated_encounters'), collectedItems: parseStringArray(row.collected_items, 'collected_items'), unlockedDoors: parseStringArray(row.unlocked_doors, 'unlocked_doors'), oneshotTriggeredIds: parseStringArray(row.oneshot_triggered_ids ?? '[]', 'oneshot_triggered_ids'), startedAt: row.started_at, completedAt: row.completed_at };
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
  return {
    dungeon,
    tiles: await listTiles(id),
    tilesets: await listDungeonTilesets(id),
    encounters: await listEncounters(id),
    items: await listItems(id),
    warps: await listWarps(id),
    doors: await listDoors(id),
    traps: await listTraps(id),
  };
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
  await run(SQL_INSERT_DUNGEON, dungeon.id, dungeon.worldObjectId, dungeon.questId, dungeon.parentId, dungeon.name, dungeon.description, dungeon.biome, dungeon.width, dungeon.height, dungeon.spawnX, dungeon.spawnY, dungeon.biomeRegion, dungeon.randomEncountersEnabled ? 1 : 0, dungeon.randomEncounterRate, dungeon.randomMinLevel, dungeon.randomMaxLevel, dungeon.randomMaxStage, dungeon.randomMinPartySize, dungeon.randomMaxPartySize, JSON.stringify(dungeon.randomAllowedElements), now, now);
  return dungeon;
}

export async function updateDungeon(id: string, input: UpdateDungeonInput): Promise<Dungeon | null> {
  const existing = await getDungeon(id);
  if (!existing) return null;
  const updated: Dungeon = {
    id: existing.id,
    worldObjectId: input.worldObjectId === undefined ? existing.worldObjectId : input.worldObjectId,
    questId: input.questId === undefined ? existing.questId : input.questId,
    parentId: input.parentId === undefined ? existing.parentId : input.parentId,
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    biome: input.biome ?? existing.biome,
    width: input.width ?? existing.width,
    height: input.height ?? existing.height,
    spawnX: input.spawnX ?? existing.spawnX,
    spawnY: input.spawnY ?? existing.spawnY,
    biomeRegion: input.biomeRegion === undefined ? existing.biomeRegion : input.biomeRegion,
    unlockRequiresItems: existing.unlockRequiresItems,
    randomEncountersEnabled: input.randomEncountersEnabled ?? existing.randomEncountersEnabled,
    randomEncounterRate: input.randomEncounterRate ?? existing.randomEncounterRate,
    randomMinLevel: input.randomMinLevel ?? existing.randomMinLevel,
    randomMaxLevel: input.randomMaxLevel ?? existing.randomMaxLevel,
    randomMaxStage: input.randomMaxStage ?? existing.randomMaxStage,
    randomMinPartySize: input.randomMinPartySize ?? existing.randomMinPartySize,
    randomMaxPartySize: input.randomMaxPartySize ?? existing.randomMaxPartySize,
    randomAllowedElements: input.randomAllowedElements === undefined ? existing.randomAllowedElements : input.randomAllowedElements,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  if (updated.parentId === id) return null;
  await run(SQL_UPDATE_DUNGEON, updated.worldObjectId, updated.questId, updated.parentId, updated.name, updated.description, updated.biome, updated.width, updated.height, updated.spawnX, updated.spawnY, updated.biomeRegion, updated.randomEncountersEnabled ? 1 : 0, updated.randomEncounterRate, updated.randomMinLevel, updated.randomMaxLevel, updated.randomMaxStage, updated.randomMinPartySize, updated.randomMaxPartySize, JSON.stringify(updated.randomAllowedElements), updated.updatedAt, id);
  return updated;
}

export async function deleteDungeon(id: string): Promise<boolean> {
  return (await run(SQL_DELETE_DUNGEON, id)).changes > 0;
}

export async function listTiles(dungeonId: string): Promise<DungeonTile[]> {
  return (await q<TileRow>(SQL_LIST_TILES, dungeonId)).map(tileFromRow);
}

type DungeonTilesetRow = {
  readonly id: string;
  readonly name: string;
  readonly image_filename: string;
  readonly tile_width: number;
  readonly tile_height: number;
  readonly image_width: number;
  readonly image_height: number;
  readonly columns: number;
  readonly tile_count: number;
  readonly created_at: number;
  readonly updated_at: number;
  readonly firstgid: number;
};

export async function listDungeonTilesets(dungeonId: string): Promise<TilesetGrant[]> {
  const rows = await q<DungeonTilesetRow>(SQL_LIST_DUNGEON_TILESETS, dungeonId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    imageFilename: r.image_filename,
    imageUrl: `/api/tilesets/${encodeURIComponent(r.id)}/image`,
    tileWidth: r.tile_width,
    tileHeight: r.tile_height,
    imageWidth: r.image_width,
    imageHeight: r.image_height,
    columns: r.columns,
    tileCount: r.tile_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    firstgid: r.firstgid,
  }));
}

export async function replaceTiles(dungeonId: string, tiles: readonly TileInput[]): Promise<DungeonTile[] | null> {
  const dungeon = await getDungeon(dungeonId);
  if (!dungeon) return null;
  await tx(async (t) => {
    await t.run(SQL_DELETE_TILES, [dungeonId]);
    for (const tile of tiles) await t.run(SQL_INSERT_TILE_WITH_GID, [dungeonId, tile.x, tile.y, tile.gid]);
  });
  return listTiles(dungeonId);
}

export async function createEncounter(dungeonId: string, input: CreateEncounterInput): Promise<DungeonEncounter | 'not-found' | 'conflict'> {
  if (!(await getDungeon(dungeonId))) return 'not-found';
  if (await one<EncounterRow>(SQL_GET_ENCOUNTER_AT, dungeonId, input.x, input.y)) return 'conflict';
  const now = Date.now();
  const id = newId('enc');
  const loots = input.loots ?? [];
  const sceneId = input.sceneId ?? null;
  await run(SQL_INSERT_ENCOUNTER, id, dungeonId, input.x, input.y, input.label ?? null, input.difficulty, JSON.stringify(input.digimon.map(asEncounterDigimon)), JSON.stringify(loots), sceneId, now, now);
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
  const nextLoots = input.loots === undefined ? parseLootsSafe(existing.loots) : input.loots;
  const nextSceneId = input.sceneId === undefined ? (existing.scene_id ?? null) : (input.sceneId ?? null);
  const next = { x: nextX, y: nextY, label: input.label === undefined ? existing.label : input.label, difficulty: input.difficulty ?? existing.difficulty, digimon: input.digimon === undefined ? parseDigimonSafe(existing.digimon_data) : input.digimon.map(asEncounterDigimon), loots: nextLoots, sceneId: nextSceneId, updatedAt: Date.now() };
  await run(SQL_UPDATE_ENCOUNTER, next.x, next.y, next.label, next.difficulty, JSON.stringify(next.digimon), JSON.stringify(next.loots), next.sceneId, next.updatedAt, dungeonId, encId);
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
  return {
    dungeon,
    run: runFromRow(runRow),
    tiles: await listTiles(dungeonId),
    tilesets: await listDungeonTilesets(dungeonId),
    encounters: await listEncounters(dungeonId),
    items: await listItems(dungeonId),
    doors: await listDoors(dungeonId),
  };
}

export async function getDungeonRunView(userId: string, dungeonId: string): Promise<DungeonRunView | null> {
  const dungeon = await getDungeon(dungeonId);
  const runRow = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!dungeon || !runRow) return null;
  return {
    dungeon,
    run: runFromRow(runRow),
    tiles: await listTiles(dungeonId),
    tilesets: await listDungeonTilesets(dungeonId),
    encounters: await listEncounters(dungeonId),
    items: await listItems(dungeonId),
    doors: await listDoors(dungeonId),
  };
}

export async function moveRun(userId: string, dungeonId: string, x: number, y: number): Promise<{ readonly kind: 'ok'; readonly run: UserDungeonRun; readonly triggeredEncounterId: string | null; readonly pickedUpItemId: string | null; readonly randomEncounter?: readonly EncounterDigimon[]; readonly warpToDungeonId?: string | null; readonly trapTriggered?: TrapTriggered } | { readonly kind: 'blocked-by-door'; readonly run: UserDungeonRun; readonly doorId: string } | { readonly kind: 'not-found' | 'blocked' | 'not-adjacent' }> {
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
  const isNewPickup = item !== null && !current.collectedItems.includes(item.id);
  const collectedItems = isNewPickup ? [...current.collectedItems, item.id] : current.collectedItems;
  // Trap: fires once per run. Resolve landing tile (teleport may redirect) before writing position.
  const trap = await getTrapAt(dungeonId, x, y);
  let trapTriggered: TrapTriggered | undefined;
  let nextOneshot = current.oneshotTriggeredIds;
  let landX = x;
  let landY = y;
  if (trap && !current.oneshotTriggeredIds.includes(trap.id)) {
    const partySpd = await computePartyAvgSpd(userId);
    const walkables = await listTiles(dungeonId);
    trapTriggered = evaluateTrap(trap, partySpd, walkables);
    nextOneshot = [...current.oneshotTriggeredIds, trap.id];
    if (trapTriggered.teleportTo) {
      landX = trapTriggered.teleportTo.x;
      landY = trapTriggered.teleportTo.y;
    }
  }
  if (isNewPickup) {
    const cataloged = await one<{ readonly id: string }>(SQL_ITEM_IS_CATALOGED, item.item_id);
    if (!cataloged) {
      log.warn('dungeon.pickup.uncataloged', { dungeonId, itemRowId: item.id, itemId: item.item_id });
    }
    let applied = false;
    await tx(async (t) => {
      const now = Date.now();
      const moveResult = await t.run(SQL_UPDATE_RUN_POSITION_CAS, [landX, landY, JSON.stringify(collectedItems), JSON.stringify(nextOneshot), userId, dungeonId, current.currentX, current.currentY]);
      if (moveResult.changes === 0) return;
      applied = true;
      if (cataloged) await t.run(SQL_UPSERT_INVENTORY_PICKUP, [userId, item.item_id, item.qty, now]);
    });
    if (!applied) return { kind: 'not-adjacent' };
  } else {
    const moveResult = await run(SQL_UPDATE_RUN_POSITION_CAS, landX, landY, JSON.stringify(collectedItems), JSON.stringify(nextOneshot), userId, dungeonId, current.currentX, current.currentY);
    if (moveResult.changes === 0) return { kind: 'not-adjacent' };
  }
  const row = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  if (!row) return { kind: 'not-found' };
  const triggeredEncounterId = encounter && !current.defeatedEncounters.includes(encounter.id) ? encounter.id : null;
  const dungeon = await getDungeon(dungeonId);
  const randomEncounter = dungeon && triggeredEncounterId === null && !warp && !door && !trapTriggered ? rollRandomEncounter(dungeon, loadCatalog()) : null;
  return {
    kind: 'ok',
    run: runFromRow(row),
    triggeredEncounterId,
    pickedUpItemId: isNewPickup ? item.id : null,
    ...(randomEncounter ? { randomEncounter } : {}),
    ...(warp ? { warpToDungeonId: warp.target_dungeon_id } : {}),
    ...(trapTriggered ? { trapTriggered } : {}),
  };
}

const SQL_GRANT_REWARD_ITEM = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`;

export async function defeatEncounter(userId: string, dungeonId: string, encId: string): Promise<{ readonly run: UserDungeonRun; readonly grantedLoots: readonly { readonly itemId: string; readonly qty: number }[] } | null> {
  const existing = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  const encounterRow = await one<EncounterRow>(SQL_GET_ENCOUNTER, dungeonId, encId);
  if (!existing || !encounterRow) return null;
  const current = runFromRow(existing);
  const wasAlreadyDefeated = current.defeatedEncounters.includes(encId);
  const defeated = wasAlreadyDefeated ? current.defeatedEncounters : [...current.defeatedEncounters, encId];
  await run(SQL_UPDATE_RUN_DEFEATED, JSON.stringify(defeated), userId, dungeonId);
  const grantedLoots: { itemId: string; qty: number }[] = [];
  if (!wasAlreadyDefeated) {
    const now = Date.now();
    const loots = parseLootsSafe(encounterRow.loots);
    // Legacy fallback: encounters saved before migration 021 may have loots='[]'
    // but a non-null reward_item_id. Treat that single item as a guaranteed drop.
    const legacyFallback: readonly EncounterLoot[] =
      loots.length === 0 && encounterRow.reward_item_id
        ? [{ itemId: encounterRow.reward_item_id, qty: 1, chance: 1 }]
        : [];
    for (const loot of loots.length > 0 ? loots : legacyFallback) {
      if (Math.random() >= loot.chance) continue;
      await run(SQL_GRANT_REWARD_ITEM, userId, loot.itemId, loot.qty, now);
      grantedLoots.push({ itemId: loot.itemId, qty: loot.qty });
    }
  }
  const row = await one<RunRow>(SQL_GET_RUN, userId, dungeonId);
  return row ? { run: runFromRow(row), grantedLoots } : null;
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

const SQL_INSERT_DOOR_IMPORT = `INSERT INTO dungeon_doors (id, dungeon_id, x, y, key_item_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_INSERT_TRAP_IMPORT = `INSERT INTO dungeon_traps (id, dungeon_id, x, y, kind, severity, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_DUNGEON_META_IMPORT = `UPDATE dungeons SET width = ?, height = ?, spawn_x = ?, spawn_y = ?, biome = ?, random_encounters_enabled = ?, random_encounter_rate = ?, random_min_level = ?, random_max_level = ?, random_max_stage = ?, random_min_party_size = ?, random_max_party_size = ?, random_allowed_elements = ?, updated_at = ? WHERE id = ?`;
const SQL_INSERT_TILE_WITH_GID = `INSERT INTO dungeon_tiles (dungeon_id, x, y, gid) VALUES (?, ?, ?, ?)`;
const SQL_INSERT_DUNGEON_TILESET = `INSERT INTO dungeon_tilesets (dungeon_id, tileset_id, firstgid) VALUES (?, ?, ?)`;
const SQL_DELETE_DUNGEON_TILESETS = `DELETE FROM dungeon_tilesets WHERE dungeon_id = ?`;

type ResolvedTilesetLinks = readonly { readonly tilesetId: string; readonly firstgid: number }[];

async function resolveTilesetLinks(
  refs: readonly ImportedTilesetRef[],
): Promise<{ readonly ok: true; readonly links: ResolvedTilesetLinks } | { readonly ok: false; readonly missing: readonly string[] }> {
  const links: { tilesetId: string; firstgid: number }[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const found = await findTilesetByName(ref.name);
    if (!found) missing.push(ref.name);
    else links.push({ tilesetId: found.id, firstgid: ref.firstgid });
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, links };
}

export type ApplyTiledImportNewResult =
  | { readonly ok: true; readonly dungeon: Dungeon }
  | { readonly ok: false; readonly error: 'missing-tilesets'; readonly missing: readonly string[] };

export type ApplyTiledImportReplaceResult =
  | { readonly ok: true; readonly view: DungeonView }
  | { readonly ok: false; readonly error: 'missing-tilesets'; readonly missing: readonly string[] }
  | { readonly ok: false; readonly error: 'not-found' };

export async function applyTiledImportReplace(dungeonId: string, payload: TiledImportPayload): Promise<ApplyTiledImportReplaceResult> {
  const existing = await getDungeon(dungeonId);
  if (!existing) return { ok: false, error: 'not-found' };
  const resolved = await resolveTilesetLinks(payload.tilesets);
  if (!resolved.ok) return { ok: false, error: 'missing-tilesets', missing: resolved.missing };
  const now = Date.now();
  const rs = payload.randomSettings;
  const biome: Dungeon['biome'] = payload.biome ?? existing.biome;
  const allowedElements = rs.randomAllowedElements === undefined ? existing.randomAllowedElements : rs.randomAllowedElements;
  await tx(async (t) => {
    await t.run(SQL_UPDATE_DUNGEON_META_IMPORT, [
      payload.width, payload.height, payload.spawn.x, payload.spawn.y, biome,
      (rs.randomEncountersEnabled ?? existing.randomEncountersEnabled) ? 1 : 0,
      rs.randomEncounterRate ?? existing.randomEncounterRate,
      rs.randomMinLevel ?? existing.randomMinLevel,
      rs.randomMaxLevel ?? existing.randomMaxLevel,
      rs.randomMaxStage ?? existing.randomMaxStage,
      rs.randomMinPartySize ?? existing.randomMinPartySize,
      rs.randomMaxPartySize ?? existing.randomMaxPartySize,
      JSON.stringify(allowedElements),
      now, dungeonId,
    ]);
    await t.run(SQL_DELETE_DUNGEON_TILESETS, [dungeonId]);
    await t.run(`DELETE FROM dungeon_tiles WHERE dungeon_id = ?`, [dungeonId]);
    await t.run(`DELETE FROM dungeon_encounters WHERE dungeon_id = ?`, [dungeonId]);
    await t.run(`DELETE FROM dungeon_items WHERE dungeon_id = ?`, [dungeonId]);
    await t.run(`DELETE FROM dungeon_doors WHERE dungeon_id = ?`, [dungeonId]);
    await t.run(`DELETE FROM dungeon_warps WHERE dungeon_id = ?`, [dungeonId]);
    await t.run(`DELETE FROM dungeon_traps WHERE dungeon_id = ?`, [dungeonId]);
    for (const link of resolved.links) await t.run(SQL_INSERT_DUNGEON_TILESET, [dungeonId, link.tilesetId, link.firstgid]);
    for (const tile of payload.tiles) await t.run(SQL_INSERT_TILE_WITH_GID, [dungeonId, tile.x, tile.y, tile.gid]);
    for (const enc of payload.encounters) {
      await t.run(SQL_INSERT_ENCOUNTER, [newId('enc'), dungeonId, enc.x, enc.y, enc.label, enc.difficulty, JSON.stringify(enc.digimon), JSON.stringify(enc.loots), null, now, now]);
    }
    for (const it of payload.items) {
      await t.run(SQL_INSERT_ITEM, [newId('ditm'), dungeonId, it.x, it.y, it.itemId, it.qty, now]);
    }
    for (const dr of payload.doors) {
      await t.run(SQL_INSERT_DOOR_IMPORT, [newId('dor'), dungeonId, dr.x, dr.y, dr.keyItemId, dr.label, now, now]);
    }
    for (const wp of payload.warps) {
      await t.run(SQL_INSERT_WARP, [newId('wrp'), dungeonId, wp.x, wp.y, wp.targetDungeonId, wp.label, now, now]);
    }
    for (const tr of payload.traps) {
      await t.run(SQL_INSERT_TRAP_IMPORT, [newId('trap'), dungeonId, tr.x, tr.y, tr.kind, tr.severity, tr.label, now]);
    }
  });
  const view = await getDungeonView(dungeonId);
  if (!view) return { ok: false, error: 'not-found' };
  return { ok: true, view };
}

export async function applyTiledImportNew(input: {
  readonly name: string;
  readonly description?: string;
  readonly biome: Dungeon['biome'];
  readonly payload: TiledImportPayload;
}): Promise<ApplyTiledImportNewResult> {
  const { name, description, biome: fallbackBiome, payload } = input;
  const resolved = await resolveTilesetLinks(payload.tilesets);
  if (!resolved.ok) return { ok: false, error: 'missing-tilesets', missing: resolved.missing };
  const biome: Dungeon['biome'] = payload.biome ?? fallbackBiome;
  const rs = payload.randomSettings;
  const now = Date.now();
  const dungeon: Dungeon = {
    id: newId('dun'),
    worldObjectId: null,
    questId: null,
    parentId: null,
    name,
    description: description ?? '',
    biome,
    width: payload.width,
    height: payload.height,
    spawnX: payload.spawn.x,
    spawnY: payload.spawn.y,
    biomeRegion: null,
    unlockRequiresItems: null,
    randomEncountersEnabled: rs.randomEncountersEnabled ?? false,
    randomEncounterRate: rs.randomEncounterRate ?? 0.12,
    randomMinLevel: rs.randomMinLevel ?? 1,
    randomMaxLevel: rs.randomMaxLevel ?? 5,
    randomMaxStage: rs.randomMaxStage ?? 'Rookie',
    randomMinPartySize: rs.randomMinPartySize ?? 1,
    randomMaxPartySize: rs.randomMaxPartySize ?? 1,
    randomAllowedElements: rs.randomAllowedElements ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await tx(async (t) => {
    await t.run(SQL_INSERT_DUNGEON, [
      dungeon.id, dungeon.worldObjectId, dungeon.questId, dungeon.parentId, dungeon.name, dungeon.description,
      dungeon.biome, dungeon.width, dungeon.height, dungeon.spawnX, dungeon.spawnY, dungeon.biomeRegion,
      dungeon.randomEncountersEnabled ? 1 : 0, dungeon.randomEncounterRate,
      dungeon.randomMinLevel, dungeon.randomMaxLevel, dungeon.randomMaxStage,
      dungeon.randomMinPartySize, dungeon.randomMaxPartySize, JSON.stringify(dungeon.randomAllowedElements),
      dungeon.createdAt, dungeon.updatedAt,
    ]);
    for (const link of resolved.links) await t.run(SQL_INSERT_DUNGEON_TILESET, [dungeon.id, link.tilesetId, link.firstgid]);
    for (const tile of payload.tiles) await t.run(SQL_INSERT_TILE_WITH_GID, [dungeon.id, tile.x, tile.y, tile.gid]);
    for (const enc of payload.encounters) {
      await t.run(SQL_INSERT_ENCOUNTER, [newId('enc'), dungeon.id, enc.x, enc.y, enc.label, enc.difficulty, JSON.stringify(enc.digimon), JSON.stringify(enc.loots), null, now, now]);
    }
    for (const it of payload.items) {
      await t.run(SQL_INSERT_ITEM, [newId('ditm'), dungeon.id, it.x, it.y, it.itemId, it.qty, now]);
    }
    for (const dr of payload.doors) {
      await t.run(SQL_INSERT_DOOR_IMPORT, [newId('dor'), dungeon.id, dr.x, dr.y, dr.keyItemId, dr.label, now, now]);
    }
    for (const wp of payload.warps) {
      await t.run(SQL_INSERT_WARP, [newId('wrp'), dungeon.id, wp.x, wp.y, wp.targetDungeonId, wp.label, now, now]);
    }
    for (const tr of payload.traps) {
      await t.run(SQL_INSERT_TRAP_IMPORT, [newId('trap'), dungeon.id, tr.x, tr.y, tr.kind, tr.severity, tr.label, now]);
    }
  });
  return { ok: true, dungeon };
}
