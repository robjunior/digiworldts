import { z } from 'zod';

import type { EncounterDigimon, EncounterLoot, TiledMap, TiledObject, TrapKind } from '@digiworld/shared';
import { getObjectClass, getProperty, isObjectGroup, isTileLayer, tiledTilesetKey, TRAP_KINDS } from '@digiworld/shared';
import { ELEMENTS, STAGES, type Element, type Stage } from '@digiworld/shared/digimon';
import { BIOMES, type Biome } from '@digiworld/shared/world';

const TILED_MAX_DIM = 200;

const TiledPropertySchema = z
  .object({
    name: z.string(),
    type: z.enum(['string', 'int', 'float', 'bool', 'color', 'file', 'object', 'class']).optional(),
    propertytype: z.string().optional(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  })
  .passthrough();

const TiledObjectSchema = z
  .object({
    id: z.number(),
    name: z.string().optional(),
    type: z.string().optional(),
    class: z.string().optional(),
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    point: z.boolean().optional(),
    ellipse: z.boolean().optional(),
    visible: z.boolean().optional(),
    gid: z.number().optional(),
    properties: z.array(TiledPropertySchema).optional(),
  })
  .passthrough();

const TiledTileLayerSchema = z
  .object({
    type: z.literal('tilelayer'),
    name: z.string(),
    width: z.number().int().min(1).max(TILED_MAX_DIM),
    height: z.number().int().min(1).max(TILED_MAX_DIM),
    data: z.array(z.number()),
    properties: z.array(TiledPropertySchema).optional(),
  })
  .passthrough();

const TiledObjectGroupSchema = z
  .object({
    type: z.literal('objectgroup'),
    name: z.string(),
    objects: z.array(TiledObjectSchema),
    properties: z.array(TiledPropertySchema).optional(),
  })
  .passthrough();

const TiledOtherLayerSchema = z.object({ type: z.string() }).passthrough();

const TiledLayerSchema = z.union([TiledTileLayerSchema, TiledObjectGroupSchema, TiledOtherLayerSchema]);

const TiledTilesetSchema = z
  .object({
    firstgid: z.number().int().min(1),
    name: z.string().optional(),
    source: z.string().optional(),
    tilewidth: z.number().int().min(1).optional(),
    tileheight: z.number().int().min(1).optional(),
    columns: z.number().int().min(1).optional(),
    tilecount: z.number().int().min(1).optional(),
    image: z.string().optional(),
    imagewidth: z.number().int().min(1).optional(),
    imageheight: z.number().int().min(1).optional(),
  })
  .passthrough();

export const TiledMapSchema = z
  .object({
    type: z.literal('map').optional(),
    version: z.string().optional(),
    tiledversion: z.string().optional(),
    width: z.number().int().min(1).max(TILED_MAX_DIM),
    height: z.number().int().min(1).max(TILED_MAX_DIM),
    tilewidth: z.number().int().min(1),
    tileheight: z.number().int().min(1),
    orientation: z.string().optional(),
    layers: z.array(TiledLayerSchema),
    tilesets: z.array(TiledTilesetSchema).optional(),
    properties: z.array(TiledPropertySchema).optional(),
  })
  .passthrough();

export type TiledParseSuccess = { readonly ok: true; readonly map: TiledMap };
export type TiledParseFailure = { readonly ok: false; readonly error: string; readonly details: readonly string[] };
export type TiledParseResult = TiledParseSuccess | TiledParseFailure;

export function parseTiledJson(input: unknown): TiledParseResult {
  const parsed = TiledMapSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid-tiled-json',
      details: parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    };
  }
  const map = parsed.data as unknown as TiledMap;
  if (map.orientation !== undefined && map.orientation !== 'orthogonal') {
    return { ok: false, error: 'unsupported-orientation', details: [`orientation "${map.orientation}" not supported; use orthogonal`] };
  }
  return { ok: true, map };
}

export type ImportedTile = { readonly x: number; readonly y: number; readonly gid: number };
export type ImportedTilesetRef = { readonly name: string; readonly firstgid: number };
export type ImportedEncounter = {
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly difficulty: 'easy' | 'normal' | 'elite' | 'boss';
  readonly digimon: readonly EncounterDigimon[];
  readonly loots: readonly EncounterLoot[];
};
export type ImportedItem = { readonly x: number; readonly y: number; readonly itemId: string; readonly qty: number };
export type ImportedDoor = { readonly x: number; readonly y: number; readonly keyItemId: string; readonly label: string | null };
export type ImportedWarp = { readonly x: number; readonly y: number; readonly targetDungeonId: string | null; readonly label: string | null };
export type ImportedTrap = { readonly x: number; readonly y: number; readonly kind: TrapKind; readonly severity: number; readonly label: string | null };

export type ImportedRandomSettings = {
  readonly randomEncountersEnabled?: boolean;
  readonly randomEncounterRate?: number;
  readonly randomMinLevel?: number;
  readonly randomMaxLevel?: number;
  readonly randomMaxStage?: Stage;
  readonly randomMinPartySize?: number;
  readonly randomMaxPartySize?: number;
  readonly randomAllowedElements?: readonly Element[] | null;
};

export type TiledImportPayload = {
  readonly width: number;
  readonly height: number;
  readonly spawn: { readonly x: number; readonly y: number };
  readonly biome: Biome | null;
  readonly randomSettings: ImportedRandomSettings;
  readonly tilesets: readonly ImportedTilesetRef[];
  readonly tiles: readonly ImportedTile[];
  readonly encounters: readonly ImportedEncounter[];
  readonly items: readonly ImportedItem[];
  readonly doors: readonly ImportedDoor[];
  readonly warps: readonly ImportedWarp[];
  readonly traps: readonly ImportedTrap[];
};

export type TiledImportSuccess = { readonly ok: true; readonly payload: TiledImportPayload; readonly warnings: readonly string[] };
export type TiledImportFailure = { readonly ok: false; readonly error: string; readonly details: readonly string[] };
export type TiledImportResult = TiledImportSuccess | TiledImportFailure;

export type TiledImportOptions = {
  readonly currentSpawn?: { readonly x: number; readonly y: number };
};

/**
 * Pure transformation: canonical Tiled map → dungeon import payload.
 *
 * Coordinate conversion is based on Tiled's default orthogonal anchoring
 * (rect / point objects anchor at top-left in pixels; tile objects with a
 * gid anchor at bottom-left — we shift them up by one tile height so a
 * dropped tile marker at cell `(x, y)` lands on `(x, y)` after the import).
 *
 * Unknown object classes are skipped with a warning. POIs falling outside
 * the map grid are collected as errors and abort the import — silent drop
 * would hide typos in the Tiled file.
 */
export function tiledMapToImportPayload(map: TiledMap, options: TiledImportOptions = {}): TiledImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const tw = map.tilewidth;
  const th = map.tileheight;

  const biome = readBiomeProp(map.properties, errors);
  const randomSettings = readRandomSettings(map.properties, errors);

  const tiles = extractTiles(map, warnings);
  const tilesets = extractTilesets(map, warnings);

  const encounters: ImportedEncounter[] = [];
  const items: ImportedItem[] = [];
  const doors: ImportedDoor[] = [];
  const warps: ImportedWarp[] = [];
  const traps: ImportedTrap[] = [];
  let spawn: { x: number; y: number } | null = null;

  for (const layer of map.layers) {
    if (!isObjectGroup(layer)) continue;
    for (const obj of layer.objects) {
      const cls = getObjectClass(obj);
      if (cls === '') {
        warnings.push(`object ${obj.id} (${layer.name}) has no class; skipped`);
        continue;
      }
      const cell = pixelToTile(obj, tw, th);
      if (cell.x < 0 || cell.y < 0 || cell.x >= map.width || cell.y >= map.height) {
        errors.push(`object ${obj.id} (${cls}) at (${cell.x}, ${cell.y}) is outside the ${map.width}×${map.height} grid`);
        continue;
      }
      switch (cls) {
        case 'spawn': {
          if (spawn !== null) warnings.push(`multiple spawn objects; keeping the first at (${spawn.x}, ${spawn.y})`);
          else spawn = cell;
          break;
        }
        case 'encounter': {
          const enc = readEncounter(obj, cell, errors);
          if (enc) encounters.push(enc);
          break;
        }
        case 'item': {
          const it = readItem(obj, cell, errors);
          if (it) items.push(it);
          break;
        }
        case 'door': {
          const dr = readDoor(obj, cell, errors);
          if (dr) doors.push(dr);
          break;
        }
        case 'warp': {
          const wp = readWarp(obj, cell, errors);
          if (wp) warps.push(wp);
          break;
        }
        case 'trap': {
          const tr = readTrap(obj, cell, errors);
          if (tr) traps.push(tr);
          break;
        }
        default:
          warnings.push(`object ${obj.id} class "${cls}" not recognized; skipped`);
      }
    }
  }

  if (spawn === null) {
    const currentSpawn = options.currentSpawn;
    const firstWalkable = tiles[0];
    if (currentSpawn !== undefined && tiles.some((t) => t.x === currentSpawn.x && t.y === currentSpawn.y)) {
      spawn = { x: currentSpawn.x, y: currentSpawn.y };
      warnings.push(`no spawn object; keeping existing spawn at (${spawn.x}, ${spawn.y})`);
    } else if (firstWalkable !== undefined) {
      spawn = { x: firstWalkable.x, y: firstWalkable.y };
      warnings.push(`no spawn object; using first walkable tile at (${spawn.x}, ${spawn.y}) — adjust with the SPAWN tool in the admin editor`);
    } else {
      errors.push('no spawn object AND no walkable tiles; the map is empty');
    }
  }
  ensureNoPositionConflicts(encounters, items, doors, warps, traps, errors);

  if (errors.length > 0) return { ok: false, error: 'invalid-tiled-payload', details: errors };
  return {
    ok: true,
    payload: {
      width: map.width,
      height: map.height,
      spawn: spawn ?? { x: 0, y: 0 },
      biome,
      randomSettings,
      tilesets,
      tiles,
      encounters,
      items,
      doors,
      warps,
      traps,
    },
    warnings,
  };
}

function pixelToTile(obj: { readonly x: number; readonly y: number; readonly gid?: number }, tw: number, th: number): { x: number; y: number } {
  const yShift = obj.gid !== undefined && obj.gid > 0 ? th : 0;
  return { x: Math.floor(obj.x / tw), y: Math.floor((obj.y - yShift) / th) };
}

function extractTiles(map: TiledMap, warnings: string[]): ImportedTile[] {
  const tileLayers = map.layers.filter(isTileLayer);
  if (tileLayers.length === 0) {
    warnings.push('no tile layer found; dungeon will have no walkable tiles');
    return [];
  }
  const walkable = tileLayers.find((l) => l.name.toLowerCase() === 'walkable') ?? tileLayers[0];
  if (walkable === undefined) return [];
  if (walkable.width !== map.width || walkable.height !== map.height) {
    warnings.push(`tile layer "${walkable.name}" is ${walkable.width}×${walkable.height}, expected ${map.width}×${map.height}; using layer dimensions`);
  }
  const out: ImportedTile[] = [];
  for (let i = 0; i < walkable.data.length; i += 1) {
    const gid = walkable.data[i] ?? 0;
    if (gid === 0) continue;
    const x = i % walkable.width;
    const y = Math.floor(i / walkable.width);
    if (x < map.width && y < map.height) out.push({ x, y, gid });
  }
  return out;
}

function extractTilesets(map: TiledMap, warnings: string[]): ImportedTilesetRef[] {
  const raw = map.tilesets ?? [];
  const out: ImportedTilesetRef[] = [];
  const seen = new Set<string>();
  for (const ts of raw) {
    const name = tiledTilesetKey(ts);
    if (seen.has(name)) {
      warnings.push(`duplicate tileset reference "${name}"; keeping first`);
      continue;
    }
    seen.add(name);
    out.push({ name, firstgid: ts.firstgid });
  }
  return out;
}

function readEncounter(obj: TiledObject, cell: { x: number; y: number }, errors: string[]): ImportedEncounter | null {
  const properties = obj.properties;
  const difficulty = coerceDifficulty(getProperty(properties, 'difficulty'), errors, obj);
  const digimon = coerceDigimon(getProperty(properties, 'digimon'), errors, obj);
  if (digimon === null) return null;
  const loots = coerceLoots(getProperty(properties, 'loots'), errors, obj);
  const label = coerceOptionalString(getProperty(properties, 'label'));
  return { x: cell.x, y: cell.y, label, difficulty, digimon, loots };
}

function readItem(obj: TiledObject, cell: { x: number; y: number }, errors: string[]): ImportedItem | null {
  const properties = obj.properties;
  const itemId = coerceRequiredString(getProperty(properties, 'itemId'), 'item.itemId', obj, errors);
  if (itemId === null) return null;
  const qty = coerceInt(getProperty(properties, 'qty'), 1);
  return { x: cell.x, y: cell.y, itemId, qty: Math.max(1, qty) };
}

function readDoor(obj: TiledObject, cell: { x: number; y: number }, errors: string[]): ImportedDoor | null {
  const properties = obj.properties;
  const keyItemId = coerceRequiredString(getProperty(properties, 'keyItemId'), 'door.keyItemId', obj, errors);
  if (keyItemId === null) return null;
  const label = coerceOptionalString(getProperty(properties, 'label'));
  return { x: cell.x, y: cell.y, keyItemId, label };
}

function readWarp(obj: TiledObject, cell: { x: number; y: number }, _errors: string[]): ImportedWarp | null {
  const properties = obj.properties;
  const raw = getProperty(properties, 'targetDungeonId');
  const targetDungeonId = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  const label = coerceOptionalString(getProperty(properties, 'label'));
  return { x: cell.x, y: cell.y, targetDungeonId, label };
}

function readTrap(obj: TiledObject, cell: { x: number; y: number }, errors: string[]): ImportedTrap | null {
  const properties = obj.properties;
  const rawKind = getProperty(properties, 'kind');
  const kindStr = typeof rawKind === 'string' ? rawKind : '';
  const kind = (TRAP_KINDS as readonly string[]).includes(kindStr) ? (kindStr as TrapKind) : null;
  if (kind === null) {
    errors.push(`trap object ${describeObject(obj)}: "kind" must be one of ${TRAP_KINDS.join(', ')}`);
    return null;
  }
  const severityRaw = getProperty(properties, 'severity');
  const severity = coerceInt(severityRaw, -1);
  if (severity < 1 || severity > 100) {
    errors.push(`trap object ${describeObject(obj)}: "severity" must be an int in [1, 100]`);
    return null;
  }
  const label = coerceOptionalString(getProperty(properties, 'label'));
  return { x: cell.x, y: cell.y, kind, severity, label };
}

function readBiomeProp(properties: TiledMap['properties'], errors: string[]): Biome | null {
  const raw = getProperty(properties, 'biome');
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !(BIOMES as readonly string[]).includes(raw)) {
    errors.push(`map property "biome" must be one of ${BIOMES.join(', ')}, got "${String(raw)}"`);
    return null;
  }
  return raw as Biome;
}

function readRandomSettings(properties: TiledMap['properties'], errors: string[]): ImportedRandomSettings {
  const result: {
    randomEncountersEnabled?: boolean;
    randomEncounterRate?: number;
    randomMinLevel?: number;
    randomMaxLevel?: number;
    randomMaxStage?: Stage;
    randomMinPartySize?: number;
    randomMaxPartySize?: number;
    randomAllowedElements?: readonly Element[] | null;
  } = {};
  const enabled = getProperty(properties, 'randomEncountersEnabled');
  if (typeof enabled === 'boolean') result.randomEncountersEnabled = enabled;
  const rate = getProperty(properties, 'randomEncounterRate');
  if (typeof rate === 'number' && rate >= 0 && rate <= 1) result.randomEncounterRate = rate;
  const minL = getProperty(properties, 'randomMinLevel');
  if (typeof minL === 'number') result.randomMinLevel = Math.max(1, Math.floor(minL));
  const maxL = getProperty(properties, 'randomMaxLevel');
  if (typeof maxL === 'number') result.randomMaxLevel = Math.max(1, Math.floor(maxL));
  const maxStage = getProperty(properties, 'randomMaxStage');
  if (typeof maxStage === 'string' && (STAGES as readonly string[]).includes(maxStage)) result.randomMaxStage = maxStage as Stage;
  const minP = getProperty(properties, 'randomMinPartySize');
  if (typeof minP === 'number') result.randomMinPartySize = clampInt(minP, 1, 3);
  const maxP = getProperty(properties, 'randomMaxPartySize');
  if (typeof maxP === 'number') result.randomMaxPartySize = clampInt(maxP, 1, 3);
  const allowedRaw = getProperty(properties, 'randomAllowedElements');
  const parsed = parseArrayOrJsonString(allowedRaw);
  if (parsed !== null) {
    const filtered = parsed.filter((e): e is Element => typeof e === 'string' && (ELEMENTS as readonly string[]).includes(e));
    result.randomAllowedElements = filtered.length > 0 ? filtered : null;
    if (parsed.length > 0 && filtered.length === 0) {
      errors.push(`map property "randomAllowedElements" contained no valid element`);
    }
  }
  if (result.randomMinLevel !== undefined && result.randomMaxLevel !== undefined && result.randomMaxLevel < result.randomMinLevel) {
    errors.push(`randomMaxLevel (${result.randomMaxLevel}) must be >= randomMinLevel (${result.randomMinLevel})`);
  }
  return result;
}

function coerceDifficulty(raw: unknown, errors: string[], obj: TiledObject): 'easy' | 'normal' | 'elite' | 'boss' {
  if (typeof raw !== 'string') return 'normal';
  if (raw === 'easy' || raw === 'normal' || raw === 'elite' || raw === 'boss') return raw;
  errors.push(`encounter ${describeObject(obj)}: "difficulty" must be easy|normal|elite|boss, got "${raw}"`);
  return 'normal';
}

function coerceDigimon(raw: unknown, errors: string[], obj: TiledObject): readonly EncounterDigimon[] | null {
  const parsed = parseArrayOrJsonString(raw);
  if (parsed === null || parsed.length === 0) {
    errors.push(`encounter ${describeObject(obj)}: "digimon" must be a non-empty array (JSON string or class value)`);
    return null;
  }
  const out: EncounterDigimon[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const catalogId = typeof record.catalogId === 'string' ? record.catalogId : null;
    const level = typeof record.level === 'number' ? Math.max(1, Math.floor(record.level)) : null;
    if (catalogId === null || level === null) {
      errors.push(`encounter ${describeObject(obj)}: each digimon entry needs {catalogId: string, level: int}`);
      return null;
    }
    const digimon: EncounterDigimon = { catalogId, level };
    if (typeof record.nickname === 'string' && record.nickname.trim().length > 0) {
      out.push({ ...digimon, nickname: record.nickname });
    } else {
      out.push(digimon);
    }
  }
  return out.length > 0 ? out : null;
}

function coerceLoots(raw: unknown, errors: string[], obj: TiledObject): readonly EncounterLoot[] {
  if (raw === undefined || raw === null) return [];
  const parsed = parseArrayOrJsonString(raw);
  if (parsed === null) {
    errors.push(`encounter ${describeObject(obj)}: "loots" must be an array (JSON string or class value)`);
    return [];
  }
  const out: EncounterLoot[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const itemId = typeof record.itemId === 'string' ? record.itemId : null;
    if (itemId === null) continue;
    const qty = typeof record.qty === 'number' ? Math.max(1, Math.floor(record.qty)) : 1;
    const chance = typeof record.chance === 'number' ? Math.max(0, Math.min(1, record.chance)) : 1;
    out.push({ itemId, qty, chance });
  }
  return out;
}

function coerceRequiredString(raw: unknown, path: string, obj: TiledObject, errors: string[]): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    errors.push(`object ${describeObject(obj)}: "${path}" is required`);
    return null;
  }
  return raw.trim();
}

function coerceOptionalString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceInt(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw);
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clampInt(raw: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function parseArrayOrJsonString(raw: unknown): readonly unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function describeObject(obj: TiledObject): string {
  return obj.name && obj.name.trim().length > 0 ? `#${obj.id} "${obj.name}"` : `#${obj.id}`;
}

function ensureNoPositionConflicts(
  encounters: readonly ImportedEncounter[],
  items: readonly ImportedItem[],
  doors: readonly ImportedDoor[],
  warps: readonly ImportedWarp[],
  traps: readonly ImportedTrap[],
  errors: string[],
): void {
  const collide = (kind: string, list: readonly { readonly x: number; readonly y: number }[]): void => {
    const seen = new Set<string>();
    for (const { x, y } of list) {
      const key = `${x},${y}`;
      if (seen.has(key)) errors.push(`multiple ${kind} objects at (${x}, ${y})`);
      seen.add(key);
    }
  };
  collide('encounter', encounters);
  collide('item', items);
  collide('door', doors);
  collide('warp', warps);
  collide('trap', traps);
}
