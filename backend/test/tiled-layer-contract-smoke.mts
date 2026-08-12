/**
 * Tiled layer contract smoke test — F5 of the dungeon extraction refactor.
 *
 * Locks in:
 *   - migrations 060 (dungeon_tiles.layer_kind) + 061 (dungeons.walkable_mask_json)
 *   - tiled-import layer classification (walkable/floor/dw_kind override/no-floor fail)
 *   - walkable_mask_json is populated on new import and used by moveRun
 *   - moveRun falls back to SQL_GET_TILE for legacy dungeons (walkable_mask_json null)
 *   - dungeon_tiles rows round-trip layer_kind
 *
 * Run: pnpm --filter @digiworld/backend test:tiled-layer-contract
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import {
  computeWalkableMaskFromTiles,
  getDungeon,
  listTiles,
  parseWalkableMaskSafe,
  serializeWalkableMask,
} from '../src/dungeons/repo.ts';
import { parseTiledJson, tiledMapToImportPayload } from '../src/dungeons/tiled-import.ts';
import type { LayerKind } from '@digiworld/shared';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-tiled-layer-contract-smoke.db';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

function buildTmj(layers: readonly {
  readonly name: string;
  readonly data: readonly number[];
  readonly dwKind?: string;
}[], width = 4, height = 4): unknown {
  return {
    type: 'map',
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    orientation: 'orthogonal',
    tilesets: [{ firstgid: 1, name: 'test', tilewidth: 32, tileheight: 32, columns: 2, tilecount: 4, image: 'x.png', imagewidth: 64, imageheight: 64 }],
    layers: layers.map((l) => ({
      type: 'tilelayer',
      name: l.name,
      width,
      height,
      data: l.data,
      ...(l.dwKind !== undefined ? { properties: [{ name: 'dw_kind', value: l.dwKind }] } : {}),
    })),
  };
}

const ZERO_4x4 = new Array(16).fill(0);
function floorRow(y: number): number[] { const arr = [...ZERO_4x4]; for (let x = 0; x < 4; x += 1) arr[y * 4 + x] = 1; return arr; }
const FULL_FLOOR_4x4 = new Array(16).fill(1);

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();

  console.log('== migration ledger ==');
  const m060 = await one<{ version: string }>('SELECT version FROM schema_versions WHERE version = ?', '060_dungeon_tiles_layer_kind');
  const m061 = await one<{ version: string }>('SELECT version FROM schema_versions WHERE version = ?', '061_dungeons_walkable_mask');
  assert(m060 !== null, 'migration 060_dungeon_tiles_layer_kind recorded');
  assert(m061 !== null, 'migration 061_dungeons_walkable_mask recorded');

  console.log('== new columns exist ==');
  const tCols = await q<{ name: string }>('PRAGMA table_info(dungeon_tiles)');
  assert(tCols.some((c) => c.name === 'layer_kind'), 'dungeon_tiles.layer_kind exists');
  const dCols = await q<{ name: string }>('PRAGMA table_info(dungeons)');
  assert(dCols.some((c) => c.name === 'walkable_mask_json'), 'dungeons.walkable_mask_json exists');

  console.log('== parseWalkableMaskSafe + serializeWalkableMask round-trip ==');
  const sample: readonly (readonly [number, number])[] = [[0, 0], [1, 2], [3, 3]];
  const serialized = serializeWalkableMask(sample);
  assert(serialized === '[[0,0],[1,2],[3,3]]', 'serializeWalkableMask produces JSON array-of-pairs');
  const parsed = parseWalkableMaskSafe(serialized);
  assert(parsed !== null && parsed.length === 3 && parsed[0]?.[0] === 0 && parsed[0]?.[1] === 0 && parsed[2]?.[0] === 3, 'parseWalkableMaskSafe round-trips the same shape');
  assert(parseWalkableMaskSafe(null) === null, 'parseWalkableMaskSafe(null) === null');
  assert(parseWalkableMaskSafe('') === null, 'parseWalkableMaskSafe empty string === null');
  assert(parseWalkableMaskSafe('not json') === null, 'parseWalkableMaskSafe garbage === null');
  assert(parseWalkableMaskSafe('[[0,0],[1,"bad"]]') !== null && parseWalkableMaskSafe('[[0,0],[1,"bad"]]')!.length === 1, 'parseWalkableMaskSafe skips malformed entries');

  console.log('== computeWalkableMaskFromTiles filters by layer_kind ==');
  const mix: readonly { readonly x: number; readonly y: number; readonly layerKind: LayerKind }[] = [
    { x: 0, y: 0, layerKind: 'floor' },
    { x: 1, y: 0, layerKind: 'walls' },
    { x: 2, y: 0, layerKind: 'doors' },
    { x: 3, y: 0, layerKind: 'water' },
    { x: 0, y: 1, layerKind: 'pit' },
    { x: 1, y: 1, layerKind: 'decoration' },
    { x: 2, y: 1, layerKind: 'hidden' },
  ];
  const mask = computeWalkableMaskFromTiles(mix);
  assert(mask.length === 3, 'walkable mask contains only floor + doors + hidden (3 tiles)');
  assert(mask.some(([x, y]) => x === 0 && y === 0), 'floor tile (0,0) is walkable');
  assert(mask.some(([x, y]) => x === 2 && y === 0), 'doors tile (2,0) is walkable');
  assert(mask.some(([x, y]) => x === 2 && y === 1), 'hidden tile (2,1) is walkable');
  assert(!mask.some(([x, y]) => x === 1 && y === 0), 'walls tile (1,0) is NOT walkable');
  assert(!mask.some(([x, y]) => x === 3 && y === 0), 'water tile (3,0) is NOT walkable');
  assert(!mask.some(([x, y]) => x === 0 && y === 1), 'pit tile (0,1) is NOT walkable');
  assert(!mask.some(([x, y]) => x === 1 && y === 1), 'decoration tile (1,1) is NOT walkable');

  console.log('== tiled-import: legacy "walkable" layer classified as floor ==');
  const legacyTmj = buildTmj([{ name: 'walkable', data: FULL_FLOOR_4x4 }]);
  const legacyParsed = parseTiledJson(legacyTmj);
  assert(legacyParsed.ok === true, 'legacy TMJ parses');
  if (legacyParsed.ok) {
    const result = tiledMapToImportPayload(legacyParsed.map);
    assert(result.ok === true, 'legacy TMJ imports');
    if (result.ok) {
      assert(result.payload.tiles.length === 16, 'legacy: 16 tiles imported (all floor)');
      assert(result.payload.tiles.every((t) => t.layerKind === 'floor'), 'legacy: every tile classified as floor');
    }
  }

  console.log('== tiled-import: multi-layer TMJ classifies per-name ==');
  const multiTmj = buildTmj([
    { name: 'floor', data: FULL_FLOOR_4x4 },
    { name: 'walls', data: [...floorRow(0), ...ZERO_4x4.slice(0, 12)] },
    { name: 'water', data: [...ZERO_4x4.slice(0, 4), ...floorRow(1), ...ZERO_4x4.slice(0, 8)] },
  ]);
  const multiParsed = parseTiledJson(multiTmj);
  assert(multiParsed.ok === true, 'multi-layer TMJ parses');
  if (multiParsed.ok) {
    const result = tiledMapToImportPayload(multiParsed.map);
    assert(result.ok === true, 'multi-layer TMJ imports');
    if (result.ok) {
      const kinds = new Set(result.payload.tiles.map((t) => t.layerKind));
      assert(kinds.has('floor'), 'multi-layer: floor tiles present');
      assert(kinds.has('walls'), 'multi-layer: walls tiles present');
      assert(kinds.has('water'), 'multi-layer: water tiles present');
    }
  }

  console.log('== tiled-import: dw_kind property overrides layer name ==');
  const dwKindTmj = buildTmj([
    { name: 'floor', data: FULL_FLOOR_4x4 },
    { name: 'gunk', data: floorRow(1), dwKind: 'pit' },
  ]);
  const dwParsed = parseTiledJson(dwKindTmj);
  if (dwParsed.ok) {
    const result = tiledMapToImportPayload(dwParsed.map);
    assert(result.ok === true, 'dw_kind TMJ imports');
    if (result.ok) {
      const pitTiles = result.payload.tiles.filter((t) => t.layerKind === 'pit');
      assert(pitTiles.length === 4, 'gunk layer with dw_kind=pit classified as pit (4 tiles)');
    }
  }

  console.log('== tiled-import: HARD FAIL when no floor tiles ==');
  const noFloorTmj = buildTmj([
    { name: 'walls', data: FULL_FLOOR_4x4 },
    { name: 'water', data: FULL_FLOOR_4x4 },
  ]);
  const noFloorParsed = parseTiledJson(noFloorTmj);
  if (noFloorParsed.ok) {
    const result = tiledMapToImportPayload(noFloorParsed.map);
    assert(result.ok === false, 'no-floor TMJ FAILS import (422 tmj-invalid)');
    if (!result.ok) {
      assert(result.details.some((d) => d.includes('floor')), 'error details mention "floor"');
    }
  }

  console.log('== tiled-import: HARD FAIL when no tile layer at all ==');
  const emptyTmj = buildTmj([]);
  const emptyParsed = parseTiledJson(emptyTmj);
  if (emptyParsed.ok) {
    const result = tiledMapToImportPayload(emptyParsed.map);
    assert(result.ok === false, 'empty TMJ FAILS import');
  }

  console.log('== unknown layer name warns and defaults to decoration ==');
  const unknownTmj = buildTmj([
    { name: 'floor', data: FULL_FLOOR_4x4 },
    { name: 'zap-random-name', data: floorRow(2) },
  ]);
  const unknownParsed = parseTiledJson(unknownTmj);
  if (unknownParsed.ok) {
    const result = tiledMapToImportPayload(unknownParsed.map);
    assert(result.ok === true, 'unknown-name TMJ imports');
    if (result.ok) {
      const decor = result.payload.tiles.filter((t) => t.layerKind === 'decoration');
      assert(decor.length === 4, 'unknown-name layer defaulted to decoration (4 tiles)');
      assert(result.warnings.some((w) => w.includes('zap-random-name') && w.includes('decoration')), 'unknown-name emitted a decoration warning');
    }
  }

  console.log('== tiled-import: flip/rotation flags are stripped from GIDs ==');
  const flipTmj = buildTmj([
    { name: 'floor', data: [0xa000007e, 0x80000005, 0x40000002, ...ZERO_4x4.slice(3)] },
  ]);
  const flipParsed = parseTiledJson(flipTmj);
  assert(flipParsed.ok === true, 'flip-flag TMJ parses');
  if (flipParsed.ok) {
    const result = tiledMapToImportPayload(flipParsed.map);
    assert(result.ok === true, 'flip-flag TMJ imports (would be Postgres 22003 otherwise)');
    if (result.ok) {
      const byCoord = new Map(result.payload.tiles.map((t) => [`${t.x},${t.y}`, t.gid]));
      assert(byCoord.get('0,0') === 126, 'GID 0xa000007e stripped to tile id 126');
      assert(byCoord.get('1,0') === 5, 'GID 0x80000005 stripped to tile id 5');
      assert(byCoord.get('2,0') === 2, 'GID 0x40000002 stripped to tile id 2');
      assert(result.payload.tiles.every((t) => t.gid === (t.gid & 0x0fffffff)), 'no imported tile retains flag bits');
      assert(result.warnings.some((w) => w.includes('flip')), 'flip-flag warning emitted');
    }
  }

  console.log('== createDungeon persists walkable_mask_json ==');
  const now = Date.now();
  const D_NEW = 'dgn_new_f5';
  await run(
    "INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, challenge_kind, challenge_config, walkable_mask_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    D_NEW, 'F5 New', 'seeded', 'null', 4, 4, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', 'none', null,
    JSON.stringify([[0, 0], [1, 0], [2, 0]]),
    now, now,
  );
  const gotNew = await getDungeon(D_NEW);
  assert(gotNew !== null, 'new dungeon loaded');
  assert(gotNew?.walkableMask !== null && gotNew!.walkableMask!.length === 3, 'walkableMask parsed as 3-tuple array');
  assert(gotNew?.walkableMask?.[0]?.[0] === 0 && gotNew!.walkableMask![0]![1] === 0, 'walkableMask[0] === (0,0)');

  console.log('== legacy dungeon has walkable_mask_json NULL ==');
  const D_LEGACY = 'dgn_legacy_f5';
  await run(
    "INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, challenge_kind, challenge_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    D_LEGACY, 'F5 Legacy', 'seeded', 'null', 4, 4, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', 'none', null, now, now,
  );
  await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid) VALUES (?, ?, ?, ?)', D_LEGACY, 0, 0, 1);
  await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid) VALUES (?, ?, ?, ?)', D_LEGACY, 1, 0, 1);
  const gotLegacy = await getDungeon(D_LEGACY);
  assert(gotLegacy?.walkableMask === null, 'legacy dungeon walkableMask === null');
  const legacyTiles = await listTiles(D_LEGACY);
  assert(legacyTiles.length === 2, 'legacy dungeon has 2 tiles');
  assert(legacyTiles.every((t) => t.layerKind === 'floor'), 'legacy tiles default to layer_kind=floor');

  console.log('== dungeon_tiles.layer_kind round-trips (floor/walls/water/hidden) ==');
  const D_KINDS = 'dgn_kinds_f5';
  await run(
    "INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, challenge_kind, challenge_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    D_KINDS, 'F5 Kinds', 'seeded', 'null', 4, 4, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', 'none', null, now, now,
  );
  await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', D_KINDS, 0, 0, 1, 'floor');
  await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', D_KINDS, 1, 0, 1, 'walls');
  await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', D_KINDS, 2, 0, 1, 'water');
  await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', D_KINDS, 0, 1, 1, 'hidden');
  const kindTiles = await listTiles(D_KINDS);
  assert(kindTiles.find((t) => t.x === 0 && t.y === 0)?.layerKind === 'floor', 'tile (0,0) layerKind === floor');
  assert(kindTiles.find((t) => t.x === 1 && t.y === 0)?.layerKind === 'walls', 'tile (1,0) layerKind === walls');
  assert(kindTiles.find((t) => t.x === 2 && t.y === 0)?.layerKind === 'water', 'tile (2,0) layerKind === water');
  assert(kindTiles.find((t) => t.x === 0 && t.y === 1)?.layerKind === 'hidden', 'tile (0,1) layerKind === hidden');

  console.log('== dungeon_tiles.layer_kind CHECK constraint rejects bogus value ==');
  let rejected = false;
  try {
    await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', D_KINDS, 3, 0, 1, 'bogus');
  } catch { rejected = true; }
  assert(rejected, 'CHECK constraint rejects layer_kind="bogus"');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== tiled-layer-contract smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
