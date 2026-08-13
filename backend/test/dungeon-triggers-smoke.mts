/**
 * Dungeon lever trigger smoke test — cross-map edition.
 *
 * Covers: admin CRUD for triggers (door + bridge targets) and bridges;
 * cross-map targets (lever on floor A opens a door / lowers a bridge on
 * floor B of the same group); group-scoped state kept across maps and
 * cleared on reset; one-shot firing per run; invalid/conflict handling.
 *
 * Maps (group G):
 *   A (floor 0): row 0 floor x=0..5; levers at (1,0) and (2,0).
 *   B (floor 1): row 0 floor x=0..5; door at (4,0); bridge gap at (6,0).
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-triggers
 */
import { existsSync, unlinkSync } from 'node:fs';

import { closeDb, run } from '../src/db/index.ts';
import { closeDbAdapter, getDb } from '../src/db/adapter.ts';
import { createBridge, getBridgeAt, updateBridge } from '../src/dungeons/bridges.ts';
import { createDoor } from '../src/dungeons/doors.ts';
import { activateTrigger, createEncounter, moveRun, resetRun, startOrGetRun } from '../src/dungeons/repo.ts';
import { createTrigger, deleteTrigger, getTriggerAt, updateTrigger } from '../src/dungeons/triggers.ts';
import { listFiredTriggerIds } from '../src/dungeons/trigger-states.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-triggers-smoke.db';
const USER = 'usr_trigger_smoke';
const GROUP = 'grp_trigger_smoke';
const DUNGEON_A = 'dgn_trigger_a';
const DUNGEON_B = 'dgn_trigger_b';

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

async function seedDungeon(id: string, name: string, floor: number): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, random_pool_json, dungeon_group_id, floor_index, challenge_kind, challenge_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, name, 'seeded', 'null', 8, 3, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', '[]', GROUP, floor, 'none', null, now, now,
  );
  for (const x of [0, 1, 2, 3, 4, 5]) {
    await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', id, x, 0, 1, 'floor');
  }
}

async function walk(dungeonId: string, route: readonly (readonly [number, number])[]): Promise<string[]> {
  const kinds: string[] = [];
  for (const [x, y] of route) {
    const result = await moveRun(USER, dungeonId, x, y);
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
  await seedDungeon(DUNGEON_A, 'Trigger Floor A', 0);
  await seedDungeon(DUNGEON_B, 'Trigger Floor B', 1);
  const doorB = await createDoor(DUNGEON_B, { x: 4, y: 0, keyItemId: 'itm-trigger-key' });
  assert(typeof doorB !== 'string', 'createDoor on floor B');
  if (typeof doorB === 'string') throw new Error('missing door fixture');
  const bridgeB = await createBridge(DUNGEON_B, { x: 6, y: 0, downTileGid: 30, upTileGid: 31 });
  assert(typeof bridgeB !== 'string' && bridgeB.downTileGid === 30, 'createBridge on floor B');
  const DUNGEON_C = 'dgn_trigger_c';
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, random_pool_json, dungeon_group_id, floor_index, challenge_kind, challenge_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    DUNGEON_C, 'Trigger Solo Map', 'seeded', 'null', 8, 3, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', '[]', null, 0, 'none', null, Date.now(), Date.now(),
  );
  for (const x of [0, 1, 2, 3, 4, 5]) {
    await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', DUNGEON_C, x, 0, 1, 'floor');
  }
  const bridgeC = await createBridge(DUNGEON_C, { x: 6, y: 0, downTileGid: 40 });
  assert(typeof bridgeC !== 'string', 'createBridge on ungrouped solo map');
  if (typeof bridgeC === 'string') throw new Error('missing bridgeC fixture');

  console.log('== admin CRUD (cross-map targets) ==');
  const leverBridge = await createTrigger(DUNGEON_A, {
    x: 1, y: 0, label: 'Bridge lever', target: { kind: 'bridge', bridgeId: bridgeB.id },
  });
  assert(typeof leverBridge !== 'string' && leverBridge.targets[0]?.bridgeId === bridgeB.id, 'trigger on A can target a bridge on B (same group)');
  const leverDoor = await createTrigger(DUNGEON_A, {
    x: 2, y: 0, label: 'Door lever', target: { kind: 'door', doorId: doorB.id },
  });
  assert(typeof leverDoor !== 'string' && leverDoor.targets[0]?.doorId === doorB.id, 'trigger on A can target a door on B (same group)');
  const soloTarget = await createTrigger(DUNGEON_A, { x: 3, y: 0, label: 'Solo bridge lever', target: { kind: 'bridge', bridgeId: bridgeC.id } });
  assert(typeof soloTarget !== 'string' && soloTarget.targets[0]?.bridgeId === bridgeC.id, 'trigger can target a bridge on an ungrouped map (global pool)');
  const badDoor = await createTrigger(DUNGEON_A, { x: 4, y: 0, target: { kind: 'door', doorId: 'dor-nope' } });
  assert(badDoor === 'invalid-target', 'unknown door target rejected');
  const badBridge = await createTrigger(DUNGEON_A, { x: 5, y: 0, target: { kind: 'bridge', bridgeId: 'brg-nope' } });
  assert(badBridge === 'invalid-target', 'unknown bridge target rejected');
  const conflict = await createTrigger(DUNGEON_A, { x: 1, y: 0, target: { kind: 'bridge', bridgeId: bridgeB.id } });
  assert(conflict === 'conflict', 'second trigger at same cell conflicts');
  if (typeof leverBridge === 'string' || typeof leverDoor === 'string') throw new Error('missing trigger fixtures');
  const updated = await updateTrigger(DUNGEON_A, leverBridge.id, { label: 'Bridge lever v2' });
  assert(typeof updated !== 'string' && updated.label === 'Bridge lever v2', 'updateTrigger keeps target and changes label');
  const stillAt = await getTriggerAt(DUNGEON_A, 1, 0);
  assert(stillAt?.id === leverBridge.id, 'trigger still at original cell');

  console.log('== cross-map door: lever on A opens door on B ==');
  await startOrGetRun(USER, DUNGEON_A);
  await startOrGetRun(USER, DUNGEON_B);
  const approachB = await walk(DUNGEON_B, [[1, 0], [2, 0], [3, 0]]);
  assert(approachB.every((kind) => kind === 'ok'), 'approach to the door works');
  const doorBlocked = await moveRun(USER, DUNGEON_B, 4, 0);
  assert(doorBlocked.kind === 'blocked-by-door', 'door on B blocks before any lever fires');
  const farActivate = await activateTrigger(USER, DUNGEON_A, leverDoor.id);
  assert(!farActivate.ok && farActivate.error === 'not-adjacent', 'activate from far away is rejected');
  const steppedOnLever = await moveRun(USER, DUNGEON_A, 1, 0);
  assert(steppedOnLever.kind === 'ok', 'stepping on the lever moves without firing');
  const firedBeforeActivate = await listFiredTriggerIds(USER, GROUP);
  assert(!firedBeforeActivate.includes(leverBridge.id), 'stepping on the lever does NOT fire it');
  const doorActivate = await activateTrigger(USER, DUNGEON_A, leverDoor.id);
  assert(doorActivate.ok && doorActivate.triggeredTriggerId === leverDoor.id && doorActivate.activatedDoorId === doorB.id, 'lever on A fires and opens the door on B');
  const doorOpen = await moveRun(USER, DUNGEON_B, 4, 0);
  assert(doorOpen.kind === 'ok', 'door on B is passable after lever on A');

  console.log('== cross-map bridge: lever on A lowers bridge on B ==');
  const fired = await listFiredTriggerIds(USER, GROUP);
  assert(fired.includes(leverDoor.id), 'fired trigger state kept in group scope');
  await resetRun(USER, DUNGEON_A);
  const firedAfterReset = await listFiredTriggerIds(USER, GROUP);
  assert(firedAfterReset.length === 0, 'reset clears trigger states');
  const bridgeBlocked = await moveRun(USER, DUNGEON_B, 6, 0);
  assert(bridgeBlocked.kind === 'blocked', 'bridge gap on B blocks before lever fires');
  await walk(DUNGEON_B, [[5, 0]]);
  const bridgeActivate = await activateTrigger(USER, DUNGEON_A, leverBridge.id);
  assert(bridgeActivate.ok && bridgeActivate.activatedBridgeId === bridgeB.id, 'lever on A fires and lowers the bridge on B');
  const bridgeOpen = await moveRun(USER, DUNGEON_B, 6, 0);
  assert(bridgeOpen.kind === 'ok', 'bridge gap on B is walkable after lever on A');

  console.log('== global pool state: lever on A lowers bridge on solo map C ==');
  const firedGlobal = await listFiredTriggerIds(USER);
  assert(!firedGlobal.includes(soloTarget.id), 'solo-map lever not fired yet');
  const soloWalk = await walk(DUNGEON_A, [[1, 0], [2, 0], [3, 0]]);
  assert(soloWalk.every((kind) => kind === 'ok'), 'approach to solo lever works');
  const soloActivate = await activateTrigger(USER, DUNGEON_A, soloTarget.id);
  assert(soloActivate.ok && soloActivate.activatedBridgeId === bridgeC.id, 'lever on A fires bridge on ungrouped map C (global pool)');
  const firedGlobalAfter = await listFiredTriggerIds(USER);
  assert(firedGlobalAfter.includes(soloTarget.id), 'fired state is global by trigger id');
  await startOrGetRun(USER, DUNGEON_C);
  const cWalk = await walk(DUNGEON_C, [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]);
  assert(cWalk.every((kind) => kind === 'ok'), 'approach on solo map works');
  const cGap = await moveRun(USER, DUNGEON_C, 6, 0);
  assert(cGap.kind === 'ok', 'bridge on the ungrouped map is walkable after lever fired elsewhere');

  console.log('== enabled flags ==');
  const backWalk = await walk(DUNGEON_A, [[2, 0], [1, 0]]);
  assert(backWalk.every((kind) => kind === 'ok'), 'walk back to the bridge lever');
  const disabledBridge = await updateBridge(DUNGEON_B, bridgeB.id, { enabled: false });
  assert(typeof disabledBridge !== 'string' && disabledBridge.enabled === false, 'updateBridge can disable');
  const gapWithDisabled = await moveRun(USER, DUNGEON_B, 6, 0);
  assert(gapWithDisabled.kind === 'blocked', 'disabled bridge does NOT become walkable even with lever fired');
  const disabledTrigger = await updateTrigger(DUNGEON_A, leverBridge.id, { enabled: false });
  assert(typeof disabledTrigger !== 'string' && disabledTrigger.enabled === false, 'updateTrigger can disable');
  const pullDisabled = await activateTrigger(USER, DUNGEON_A, leverBridge.id);
  assert(!pullDisabled.ok && pullDisabled.error === 'disabled', 'disabled lever cannot be pulled');
  await updateTrigger(DUNGEON_A, leverBridge.id, { enabled: true });

  console.log('== one-shot + reset ==');
  const alreadyFired = await activateTrigger(USER, DUNGEON_A, leverBridge.id);
  assert(!alreadyFired.ok && alreadyFired.error === 'already-fired', 'second activate in the same run is rejected');
  await resetRun(USER, DUNGEON_A);
  await walk(DUNGEON_B, [[5, 0]]);
  const bridgeBlockedAgain = await moveRun(USER, DUNGEON_B, 6, 0);
  assert(bridgeBlockedAgain.kind === 'blocked', 'bridge gap blocks again after reset');
  const refire = await activateTrigger(USER, DUNGEON_A, leverBridge.id);
  assert(refire.ok && refire.triggeredTriggerId === leverBridge.id, 'lever fires again in a fresh run');

  console.log('== boss encounter: visible on map, click to start ==');
  const boss = await createEncounter(DUNGEON_B, { x: 3, y: 0, label: 'Skull Boss', difficulty: 'boss', digimon: [{ catalogId: 'skb-999', level: 12 }] });
  assert(typeof boss !== 'string' && boss.difficulty === 'boss', 'createEncounter with boss difficulty');
  if (typeof boss === 'string') throw new Error('missing boss fixture');
  const normalEnc = await createEncounter(DUNGEON_B, { x: 2, y: 0, difficulty: 'normal', digimon: [{ catalogId: 'skb-998', level: 3 }] });
  assert(typeof normalEnc !== 'string', 'createEncounter with normal difficulty');
  if (typeof normalEnc === 'string') throw new Error('missing normal encounter fixture');
  await resetRun(USER, DUNGEON_B);
  const normalStep = await moveRun(USER, DUNGEON_B, 1, 0);
  assert(normalStep.kind === 'ok' && normalStep.triggeredEncounterId === null, 'approach step works');
  const normalEncStep = await moveRun(USER, DUNGEON_B, 2, 0);
  assert(normalEncStep.kind === 'ok' && normalEncStep.triggeredEncounterId === normalEnc.id, 'stepping on a normal encounter still auto-triggers');
  const bossStep = await moveRun(USER, DUNGEON_B, 3, 0);
  assert(bossStep.kind === 'ok' && bossStep.triggeredEncounterId === null, 'stepping on the boss does NOT auto-trigger the encounter');

  console.log('== delete ==');
  const removed = await deleteTrigger(DUNGEON_A, leverBridge.id);
  assert(removed, 'deleteTrigger removes the trigger');
  const gone = await getTriggerAt(DUNGEON_A, 1, 0);
  assert(gone === null, 'getTriggerAt returns null after delete');
  const bridgeStill = await getBridgeAt(DUNGEON_B, 6, 0);
  assert(bridgeStill?.id === bridgeB.id, 'bridge survives trigger deletion');

  await closeDb();
  await closeDbAdapter();
  console.log(`\n== dungeon-triggers smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

void main();
