/**
 * Dungeon lever trigger smoke test.
 *
 * Covers: admin create/update/delete trigger (door + bridge targets),
 * lever fires once per run when stepped on, door target opens without key,
 * bridge target makes the gap cell walkable, and reset clears state.
 *
 * Map: row 0 floor at x=0..7 (door at 7,0), row 1 floor at x=0..5 with a
 * gap at (6,1) that only the bridge lever can cross. Lever sits at (1,0).
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-triggers
 */
import { existsSync, unlinkSync } from 'node:fs';

import { closeDb, one, run } from '../src/db/index.ts';
import { closeDbAdapter, getDb } from '../src/db/adapter.ts';
import { createDoor } from '../src/dungeons/doors.ts';
import { moveRun, resetRun, startOrGetRun } from '../src/dungeons/repo.ts';
import { createTrigger, deleteTrigger, getTriggerAt, updateTrigger } from '../src/dungeons/triggers.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-triggers-smoke.db';
const USER = 'usr_trigger_smoke';
const DUNGEON = 'dgn_trigger_smoke';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; console.error(`  FAIL  ${msg}`); }
}

async function seedUser(): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    USER, 'trigger-user', 'Trigger User', 'x', 0, now, now,
  );
}

async function seedShopItem(id: string): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, is_quest_item, rarity, item_type, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, id, 'seeded', 0, 0, 'netcore', 'misc', 0, 0, 0, 0, 'consumable', 'item', '{}', 1, 0, 0, 'consumable', now,
  );
}

async function seedDungeon(): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, random_pool_json, dungeon_group_id, floor_index, challenge_kind, challenge_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    DUNGEON, 'Trigger Smoke', 'seeded', 'null', 8, 3, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', '[]', null, 0, 'none', null, now, now,
  );
  for (const x of [0, 1, 2, 3, 4, 5, 6, 7]) {
    await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', DUNGEON, x, 0, 1, 'floor');
  }
  for (const x of [0, 1, 2, 3, 4, 5]) {
    await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', DUNGEON, x, 1, 1, 'floor');
  }
}

async function walk(route: readonly (readonly [number, number])[]): Promise<string[]> {
  const kinds: string[] = [];
  for (const [x, y] of route) {
    const result = await moveRun(USER, DUNGEON, x, y);
    kinds.push(result.kind);
  }
  return kinds;
}

async function main(): Promise<void> {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f);
  process.env.DB_PATH = DB_PATH;
  await getDb();

  console.log('== seed ==');
  await seedUser();
  await seedShopItem('itm-trigger-key');
  await seedDungeon();

  console.log('== admin CRUD ==');
  const door = await createDoor(DUNGEON, { x: 7, y: 0, keyItemId: 'itm-trigger-key' });
  assert(typeof door !== 'string', 'createDoor for trigger target');
  if (typeof door === 'string') throw new Error('missing door fixture');
  const lever = await createTrigger(DUNGEON, {
    x: 1, y: 0, label: 'Door lever', unusedTileGid: 10, usedTileGid: 11,
    target: { kind: 'door', doorId: door.id },
  });
  assert(typeof lever !== 'string' && lever.targets.length === 1 && lever.targets[0]?.kind === 'door', 'createTrigger with door target');
  const badDoor = await createTrigger(DUNGEON, {
    x: 2, y: 0, target: { kind: 'door', doorId: 'dor-nope' },
  });
  assert(badDoor === 'invalid-target', 'door target must point at a door in the dungeon');
  const badBridge = await createTrigger(DUNGEON, {
    x: 2, y: 0, target: { kind: 'bridge', targetX: null, targetY: null },
  });
  assert(badBridge === 'invalid-target', 'bridge target requires targetX/targetY');
  const conflict = await createTrigger(DUNGEON, {
    x: 1, y: 0, target: { kind: 'bridge', targetX: 6, targetY: 1, usedTileGid: 20 },
  });
  assert(conflict === 'conflict', 'second trigger at same cell conflicts');
  if (typeof lever === 'string') throw new Error('missing trigger fixture');
  const moved = await updateTrigger(DUNGEON, lever.id, { target: { kind: 'bridge', targetX: 6, targetY: 1, usedTileGid: 20 } });
  assert(typeof moved !== 'string' && moved.targets[0]?.kind === 'bridge' && moved.targets[0]?.targetX === 6, 'updateTrigger replaces target');
  const stillAt = await getTriggerAt(DUNGEON, 1, 0);
  assert(stillAt?.id === lever.id, 'trigger still at original cell after target update');

  console.log('== door lever: opens door without key ==');
  await updateTrigger(DUNGEON, lever.id, { target: { kind: 'door', doorId: door.id } });
  await startOrGetRun(USER, DUNGEON);
  const leverMove = await moveRun(USER, DUNGEON, 1, 0);
  assert(leverMove.kind === 'ok' && leverMove.triggeredTriggerId === lever.id && leverMove.activatedDoorId === door.id, 'stepping on lever fires it and opens the door');
  assert(leverMove.kind === 'ok' && leverMove.run.unlockedDoors.includes(door.id), 'run.unlockedDoors includes the door');
  const rowKinds = await walk([[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0]]);
  assert(rowKinds.every((kind) => kind === 'ok'), 'door tile is passable after lever');
  const runRow = await one<{ triggered_triggers: string }>('SELECT triggered_triggers FROM user_dungeon_runs WHERE user_id = ? AND dungeon_id = ?', USER, DUNGEON);
  assert(runRow !== null && JSON.parse(runRow.triggered_triggers).includes(lever.id), 'triggered_triggers persisted on the run row');
  await walk([[6, 0], [5, 0], [4, 0], [3, 0], [2, 0]]);
  const refire = await moveRun(USER, DUNGEON, 1, 0);
  assert(refire.kind === 'ok' && refire.triggeredTriggerId === undefined, 'lever does not refire in the same run');

  console.log('== bridge lever: gap becomes walkable ==');
  await resetRun(USER, DUNGEON);
  await updateTrigger(DUNGEON, lever.id, { target: { kind: 'bridge', targetX: 6, targetY: 1, usedTileGid: 20 } });
  const row1Kinds = await walk([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
  assert(row1Kinds.every((kind) => kind === 'ok'), 'approach to the gap works');
  const gapBlocked = await moveRun(USER, DUNGEON, 6, 1);
  assert(gapBlocked.kind === 'blocked', 'bridge gap is blocked before lever fires');
  await walk([[5, 0], [4, 0], [3, 0], [2, 0]]);
  const bridgeMove = await moveRun(USER, DUNGEON, 1, 0);
  assert(bridgeMove.kind === 'ok' && bridgeMove.triggeredTriggerId === lever.id && bridgeMove.triggerTargetKind === 'bridge', 'lever fires for bridge target');
  await walk([[2, 0], [3, 0], [4, 0], [5, 0], [6, 0]]);
  const gapOpen = await moveRun(USER, DUNGEON, 6, 1);
  assert(gapOpen.kind === 'ok', 'bridge gap is walkable after lever fires');

  console.log('== reset clears trigger state ==');
  const reset = await resetRun(USER, DUNGEON);
  assert(reset?.triggeredTriggers.length === 0, 'resetRun clears triggered triggers');
  await walk([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1]]);
  const gapBlockedAgain = await moveRun(USER, DUNGEON, 6, 1);
  assert(gapBlockedAgain.kind === 'blocked', 'bridge gap blocks again after reset');
  await walk([[5, 0], [4, 0], [3, 0], [2, 0]]);
  const refireAfterReset = await moveRun(USER, DUNGEON, 1, 0);
  assert(refireAfterReset.kind === 'ok' && refireAfterReset.triggeredTriggerId === lever.id, 'lever fires again in a fresh run');

  console.log('== delete trigger ==');
  const removed = await deleteTrigger(DUNGEON, lever.id);
  assert(removed, 'deleteTrigger removes the trigger');
  const gone = await getTriggerAt(DUNGEON, 1, 0);
  assert(gone === null, 'getTriggerAt returns null after delete');

  await closeDb();
  await closeDbAdapter();
  console.log(`\n== dungeon-triggers smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

void main();
