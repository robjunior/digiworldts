/**
 * Multi-floor dungeon smoke test — F9 (final phase) of the dungeon
 * extraction refactor.
 *
 * Locks in:
 *   - migration 068 columns + composite index
 *   - Dungeon row round-trips dungeonGroupId + floorIndex
 *   - maybeMigrateStashBetweenFloors:
 *       * moves stash rows across floors of the same group
 *       * moves the run row + resets position to target's spawn
 *       * MERGES stash into the target when the item_id already exists
 *       * is a no-op when source == target
 *       * is a no-op when the two dungeons have different group_ids
 *       * is a no-op when either dungeon has no group_id
 *   - getRun falls back to group lookup when queried by a floor that
 *     the run has already left
 *   - Legacy single-floor dungeons keep working unchanged
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-multi-floor
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import {
  getDungeon,
  getDungeonGridNeighbors,
  getRun,
  maybeMigrateStashBetweenFloors,
  moveRun,
  startOrGetRun,
} from '../src/dungeons/repo.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-multi-floor-smoke.db';
const USER = 'usr_test_tower';

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

async function seedUser(id: string): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, `${id}-name`, `${id}-display`, 'x', 0, now, now,
  );
}

async function seedDungeon(id: string, spawnX: number, spawnY: number, groupId: string | null, floorIndex: number | null, gridX: number | null = null, gridY: number | null = null): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, challenge_kind, challenge_config, dungeon_group_id, floor_index, grid_x, grid_y, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, `Dungeon ${id}`, 'seeded', 'null', 10, 10, spawnX, spawnY, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', 'none', null, groupId, floorIndex, gridX, gridY, now, now,
  );
}

async function seedStash(userId: string, dungeonId: string, itemId: string, qty: number): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO dungeon_run_stash (user_id, dungeon_id, item_id, qty, origin, updated_at) VALUES (?, ?, ?, ?, 'loot', ?) ON CONFLICT(user_id, dungeon_id, item_id, origin) DO UPDATE SET qty = dungeon_run_stash.qty + excluded.qty, updated_at = excluded.updated_at",
    userId, dungeonId, itemId, qty, now,
  );
}

async function seedWalkableTile(dungeonId: string, x: number, y: number): Promise<void> {
  await run(
    "INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, 1, 'floor')",
    dungeonId, x, y,
  );
}

async function stashQty(userId: string, dungeonId: string, itemId: string): Promise<number> {
  const row = await one<{ qty: number }>('SELECT qty FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ? AND item_id = ?', userId, dungeonId, itemId);
  return row?.qty ?? 0;
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();

  console.log('== migration 068 ledger + columns + index ==');
  const m068 = await one<{ version: string }>('SELECT version FROM schema_versions WHERE version = ?', '068_dungeons_group_and_floor');
  assert(m068 !== null, 'migration 068_dungeons_group_and_floor recorded');
  const cols = await q<{ name: string }>('PRAGMA table_info(dungeons)');
  assert(cols.some((c) => c.name === 'dungeon_group_id'), 'dungeons.dungeon_group_id exists');
  assert(cols.some((c) => c.name === 'floor_index'), 'dungeons.floor_index exists');
  const idx = await one<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dungeons_group_floor'");
  assert(idx !== null, 'idx_dungeons_group_floor created');

  console.log('== seed 3-floor tower + one single-floor legacy dungeon ==');
  await seedUser(USER);
  await seedDungeon('dgn-tower-f1', 0, 0, 'grp-tower', 0, 0, 0);
  await seedDungeon('dgn-tower-f2', 1, 1, 'grp-tower', 1, 1, 0);
  await seedDungeon('dgn-tower-f3', 2, 2, 'grp-tower', 2, 2, 0);
  await seedDungeon('dgn-tower-diagonal', 2, 2, 'grp-tower', 3, 2, 1);
  await seedDungeon('dgn-legacy', 3, 3, null, null);

  console.log('== Dungeon round-trip: dungeonGroupId + floorIndex ==');
  const f1 = await getDungeon('dgn-tower-f1');
  assert(f1?.dungeonGroupId === 'grp-tower', 'dgn-tower-f1.dungeonGroupId === grp-tower');
  assert(f1?.floorIndex === 0, 'dgn-tower-f1.floorIndex === 0');
  assert(f1?.gridX === 0 && f1?.gridY === 0, 'dgn-tower-f1 grid position round-trips');
  const neighbors = await getDungeonGridNeighbors(USER, 'dgn-tower-f2');
  assert(neighbors?.neighbors.map((entry) => entry.dungeonId).join(',') === 'dgn-tower-f1,dgn-tower-f3', 'grid neighbors include only orthogonal same-group dungeons');
  const legacy = await getDungeon('dgn-legacy');
  assert(legacy?.dungeonGroupId === null, 'legacy dungeon.dungeonGroupId === null');
  assert(legacy?.floorIndex === null, 'legacy dungeon.floorIndex === null');

  console.log('== enter F1 + seed stash ==');
  await startOrGetRun(USER, 'dgn-tower-f1');
  await seedStash(USER, 'dgn-tower-f1', 'itm-heal-small', 3);
  assert(await stashQty(USER, 'dgn-tower-f1', 'itm-heal-small') === 3, 'F1 stash: itm-heal-small × 3');

  console.log('== warp F1 → F2: migrate stash + run + reset position ==');
  const migrated = await maybeMigrateStashBetweenFloors(USER, 'dgn-tower-f1', 'dgn-tower-f2');
  assert(migrated === true, 'migrate F1 → F2 returned true');
  assert(await stashQty(USER, 'dgn-tower-f1', 'itm-heal-small') === 0, 'F1 stash emptied');
  assert(await stashQty(USER, 'dgn-tower-f2', 'itm-heal-small') === 3, 'F2 stash inherits the 3');
  const runF1 = await one<{ dungeon_id: string; current_x: number; current_y: number }>('SELECT dungeon_id, current_x, current_y FROM user_dungeon_runs WHERE user_id = ?', USER);
  assert(runF1?.dungeon_id === 'dgn-tower-f2', 'run row now points at F2');
  assert(runF1?.current_x === 1 && runF1?.current_y === 1, 'position reset to F2 spawn (1,1)');

  console.log('== getRun fallback: query by F1 → returns run on F2 via group ==');
  const runByF1 = await getRun(USER, 'dgn-tower-f1');
  assert(runByF1 !== null, 'getRun(F1) still resolves via group fallback');
  assert(runByF1?.dungeonId === 'dgn-tower-f2', 'group fallback returns the run currently on F2');

  console.log('== warp F2 → F3: stash accumulates + merges ==');
  await seedStash(USER, 'dgn-tower-f2', 'itm-energy-drink', 2);
  await seedStash(USER, 'dgn-tower-f2', 'itm-heal-small', 1);
  const migrated2 = await maybeMigrateStashBetweenFloors(USER, 'dgn-tower-f2', 'dgn-tower-f3');
  assert(migrated2 === true, 'migrate F2 → F3 returned true');
  assert(await stashQty(USER, 'dgn-tower-f3', 'itm-heal-small') === 4, 'F3 stash: 3 (from F1) + 1 (F2 add) merged to 4');
  assert(await stashQty(USER, 'dgn-tower-f3', 'itm-energy-drink') === 2, 'F3 stash: itm-energy-drink × 2');
  assert(await stashQty(USER, 'dgn-tower-f2', 'itm-heal-small') === 0, 'F2 stash purged');

  console.log('== no-op scenarios ==');
  const noopSame = await maybeMigrateStashBetweenFloors(USER, 'dgn-tower-f3', 'dgn-tower-f3');
  assert(noopSame === false, 'same-dungeon migrate returns false');
  const noopUnrelated = await maybeMigrateStashBetweenFloors(USER, 'dgn-tower-f3', 'dgn-legacy');
  assert(noopUnrelated === false, 'cross-group migrate (grp-tower → NULL) returns false');
  assert(await stashQty(USER, 'dgn-legacy', 'itm-heal-small') === 0, 'legacy dungeon stash untouched');
  assert(await stashQty(USER, 'dgn-tower-f3', 'itm-heal-small') === 4, 'F3 stash untouched by no-op');

  console.log('== legacy single-floor dungeon still works ==');
  await startOrGetRun(USER, 'dgn-legacy');
  const legacyRun = await getRun(USER, 'dgn-legacy');
  assert(legacyRun !== null, 'legacy dungeon startOrGetRun succeeds');
  assert(legacyRun?.dungeonId === 'dgn-legacy', 'legacy run.dungeonId === dgn-legacy (no group fallback)');

  console.log('== automatic grid edge transition ==');
  await seedDungeon('dgn-grid-west', 1, 1, 'grp-grid', 0, 0, 0);
  await seedDungeon('dgn-grid-east', 1, 1, 'grp-grid', 1, 1, 0);
  await seedWalkableTile('dgn-grid-west', 8, 1);
  await seedWalkableTile('dgn-grid-west', 9, 1);
  await seedWalkableTile('dgn-grid-east', 1, 1);
  await startOrGetRun(USER, 'dgn-grid-west');
  await run('UPDATE user_dungeon_runs SET current_x = 8, current_y = 1 WHERE user_id = ? AND dungeon_id = ?', USER, 'dgn-grid-west');
  const crossed = await moveRun(USER, 'dgn-grid-west', 9, 1);
  assert(crossed.kind === 'ok', 'edge move succeeds');
  assert(crossed.kind === 'ok' && crossed.warpToDungeonId === 'dgn-grid-east', 'edge move reports the orthogonal neighbor');
  assert(crossed.kind === 'ok' && crossed.run.dungeonId === 'dgn-grid-east' && crossed.run.currentX === 1 && crossed.run.currentY === 1, 'edge move enters one tile inside the target');

  console.log('== automatic grid edge transition: west (enter from the right side of the neighbor) ==');
  await seedDungeon('dgn-grid-south', 1, 1, 'grp-grid2', 0, 0, 1);
  await startOrGetRun(USER, 'dgn-grid-east');
  await run('UPDATE user_dungeon_runs SET current_x = 1, current_y = 1 WHERE user_id = ? AND dungeon_id = ?', USER, 'dgn-grid-east');
  const crossedWest = await moveRun(USER, 'dgn-grid-east', 0, 1);
  assert(crossedWest.kind === 'ok', 'west edge move succeeds (exit cell is a wall)');
  assert(crossedWest.kind === 'ok' && crossedWest.warpToDungeonId === 'dgn-grid-west', 'west edge move reports the west neighbor');
  assert(crossedWest.kind === 'ok' && crossedWest.run.dungeonId === 'dgn-grid-west' && crossedWest.run.currentX === 8 && crossedWest.run.currentY === 1, 'west edge move enters one tile inside the target (x = width - 2)');

  console.log('== automatic grid edge transition: north (enter from the bottom side of the neighbor) ==');
  await seedDungeon('dgn-grid-north', 1, 1, 'grp-grid2', 0, 0, 0);
  await seedWalkableTile('dgn-grid-south', 1, 0);
  await seedWalkableTile('dgn-grid-south', 1, 1);
  await seedWalkableTile('dgn-grid-north', 1, 7);
  await run('DELETE FROM user_dungeon_runs WHERE user_id = ?', USER);
  await startOrGetRun(USER, 'dgn-grid-south');
  await run('UPDATE user_dungeon_runs SET current_x = 1, current_y = 1 WHERE user_id = ? AND dungeon_id = ?', USER, 'dgn-grid-south');
  const crossedNorth = await moveRun(USER, 'dgn-grid-south', 1, 0);
  assert(crossedNorth.kind === 'ok', 'north edge move succeeds');
  assert(crossedNorth.kind === 'ok' && crossedNorth.warpToDungeonId === 'dgn-grid-north', 'north edge move reports the north neighbor');
  assert(crossedNorth.kind === 'ok' && crossedNorth.run.dungeonId === 'dgn-grid-north' && crossedNorth.run.currentX === 1 && crossedNorth.run.currentY === 7, 'north edge move slides to the nearest walkable entry cell (y = 7)');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== dungeon-multi-floor smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
