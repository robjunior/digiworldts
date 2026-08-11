/**
 * Dungeon chests + dungeon-scoped keys smoke test.
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-chests-keys
 */
import { existsSync, unlinkSync } from 'node:fs';

import { closeDb, one, q, run } from '../src/db/index.ts';
import { closeDbAdapter, getDb } from '../src/db/adapter.ts';
import { createChest } from '../src/dungeons/chests.ts';
import { createDoor } from '../src/dungeons/doors.ts';
import { listGroupInventoryForUser } from '../src/dungeons/group-inventory.ts';
import { listKeysForGroup, updateKeyPlacement } from '../src/dungeons/keys.ts';
import { extractRun, moveRun, startOrGetRun, unlockDoor, wipeRun } from '../src/dungeons/repo.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-chests-keys-smoke.db';
const USER = 'usr_chest_key_smoke';
const GROUP = 'grp_chest_key_smoke';
const DUNGEON = 'dgn_chest_key_f1';

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
    USER, 'chest-key-user', 'Chest Key User', 'x', 0, now, now,
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
    DUNGEON, 'Chest Key Smoke', 'seeded', 'null', 8, 3, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', '[]', GROUP, 0, 'none', null, now, now,
  );
  for (const [x, y] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]) {
    await run('INSERT INTO dungeon_tiles (dungeon_id, x, y, gid, layer_kind) VALUES (?, ?, ?, ?, ?)', DUNGEON, x, y, 1, 'floor');
  }
}

async function main(): Promise<void> {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) if (existsSync(f)) unlinkSync(f);
  process.env.DB_PATH = DB_PATH;
  await getDb();

  console.log('== seed ==');
  await seedUser();
  await seedShopItem('itm-chest-reward');
  await seedShopItem('itm-door-legacy-key');
  await seedDungeon();

  console.log('== locked chest auto-provisions a group key ==');
  const chest = await createChest(DUNGEON, { x: 2, y: 0, contents: [{ itemId: 'itm-chest-reward', qty: 3 }], lockedByKeyId: 'auto' });
  assert(typeof chest !== 'string', 'createChest returned a chest');
  const keysAfterChest = await listKeysForGroup(GROUP);
  const chestKey = keysAfterChest.find((key) => key.generatedForPoiKind === 'chest');
  assert(chestKey !== undefined, 'locked chest generated a dungeon key');
  assert(chestKey?.generatedForPoiId === (typeof chest === 'string' ? '' : chest.id), 'generated key points at chest');

  console.log('== placed key pickup unlocks chest ==');
  if (!chestKey || typeof chest === 'string') throw new Error('missing chest/key fixture');
  await updateKeyPlacement(chestKey.id, DUNGEON, 1, 0);
  await startOrGetRun(USER, DUNGEON);
  const keyMove = await moveRun(USER, DUNGEON, 1, 0);
  assert(keyMove.kind === 'ok', 'moving onto placed key succeeds');
  const invWithKey = await listGroupInventoryForUser(USER, GROUP);
  assert(invWithKey.some((row) => row.itemKind === 'dungeon-key' && row.itemId === chestKey.id), 'group inventory contains picked-up key');
  const placedAfterPickup = await one<{ placed_dungeon_id: string | null }>('SELECT placed_dungeon_id FROM dungeon_keys WHERE id = ?', chestKey.id);
  assert(placedAfterPickup?.placed_dungeon_id === null, 'key placement clears after pickup');

  const chestMove = await moveRun(USER, DUNGEON, 2, 0);
  assert(chestMove.kind === 'ok' && chestMove.openedChestId === chest.id, 'moving onto locked chest with key opens it');
  const rewardQty = await one<{ qty: number }>('SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', USER, 'itm-chest-reward');
  assert(rewardQty?.qty === 3, 'chest contents granted to player inventory');
  const chestState = await one<{ state: string }>('SELECT state FROM user_dungeon_run_poi_states WHERE user_id = ? AND dungeon_id = ? AND poi_kind = ? AND poi_id = ?', USER, DUNGEON, 'chest', chest.id);
  assert(chestState?.state === 'used', 'chest poi state marked used');

  console.log('== door dungeon key path ==');
  const door = await createDoor(DUNGEON, { x: 4, y: 0, keyItemId: 'itm-door-legacy-key', dungeonKeyId: 'auto' });
  assert(typeof door !== 'string' && door.dungeonKeyId !== null, 'createDoor auto-provisions dungeon key');
  if (typeof door === 'string' || door.dungeonKeyId === null) throw new Error('missing door key fixture');
  const lockedDoorResult = await unlockDoor(USER, DUNGEON, door.id);
  assert(!lockedDoorResult.ok && lockedDoorResult.error === 'missing-key', 'door unlock fails without dungeon key');
  await run('INSERT INTO user_dungeon_run_group_inventory (user_id, dungeon_group_id, item_kind, item_id, qty, acquired_at) VALUES (?, ?, ?, ?, ?, ?)', USER, GROUP, 'dungeon-key', door.dungeonKeyId, 1, Date.now());
  const unlockedDoorResult = await unlockDoor(USER, DUNGEON, door.id);
  assert(unlockedDoorResult.ok, 'door unlock succeeds with dungeon key in group inventory');

  console.log('== terminal states purge group inventory ==');
  await startOrGetRun(USER, DUNGEON);
  await extractRun(USER, DUNGEON, 'walked_out');
  const invAfterExtract = await listGroupInventoryForUser(USER, GROUP);
  assert(invAfterExtract.length === 0, 'extractRun purges group inventory');

  await run("UPDATE user_dungeon_runs SET state = 'active', ended_at = NULL, extraction_kind = NULL WHERE user_id = ? AND dungeon_id = ?", USER, DUNGEON);
  await run('INSERT INTO user_dungeon_run_group_inventory (user_id, dungeon_group_id, item_kind, item_id, qty, acquired_at) VALUES (?, ?, ?, ?, ?, ?)', USER, GROUP, 'dungeon-key', chestKey.id, 1, Date.now());
  await wipeRun(USER, DUNGEON);
  const invAfterWipe = await listGroupInventoryForUser(USER, GROUP);
  assert(invAfterWipe.length === 0, 'wipeRun purges group inventory');

  await closeDb();
  await closeDbAdapter();
  console.log(`\n== dungeon-chests-keys smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
