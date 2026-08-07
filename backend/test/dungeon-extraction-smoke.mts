/**
 * Dungeon extraction smoke test — F3 of the dungeon extraction refactor.
 *
 * Locks in the semantic switch: loot redirect, wipe forfeiture, extraction
 * (walked out + teleport scroll). All flag-gated via `dungeon-extraction`.
 *
 * Assertions:
 *   - migration 057 records state / ended_at / extraction_kind / stash_*
 *     + dungeon_warps.is_exit in schema_versions
 *   - flag ON: defeatEncounter grants loot into dungeon_run_stash (origin='loot'),
 *     NOT into player_inventory
 *   - flag OFF: defeatEncounter keeps legacy behavior (inventory)
 *   - wipeRun purges stash rows + zeroes resource counters + state='wiped'
 *     (idempotent — second call returns null)
 *   - extractRun('walked_out') merges stash into player_inventory + resources,
 *     zeroes stash, sets state='extracted'
 *   - extractRun('teleport_scroll') sets state='extracted_by_teleport'
 *   - extractRun on non-active run returns null
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-extraction
 *   (requires DB_PATH pointing at a scratch file)
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { defeatEncounter, extractRun, wipeRun, startOrGetRun } from '../src/dungeons/repo.ts';
import { setFlag, clearFlag } from '../src/flags/repo.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes } from '../src/farm/engine.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-extraction-smoke.db';
const USER = 'usr_test_extractor';
const DUNGEON = 'dgn_test_extraction';
const ENCOUNTER = 'enc_test_boss';

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

async function seedItem(id: string, name: string, qty: number): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, is_quest_item, rarity, item_type, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, name, 'seeded', 10, 10, 'credits', 'misc', 0, 0, 0, 0, 'consumable', 'item', '{}', 1, 0, 0, 'consumable', now,
  );
  if (qty > 0) {
    await run(
      'INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)',
      USER, id, qty, now,
    );
  }
}

async function seedDungeon(): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    DUNGEON, 'Test Dungeon', 'seeded', 'null', 10, 10, 0, 0, 0, 0, 1, 1, 'Rookie', 3, 3, '[]', now, now,
  );
}

async function seedEncounter(): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeon_encounters (id, dungeon_id, x, y, difficulty, digimon_data, loots, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ENCOUNTER, DUNGEON, 3, 3, 'boss',
    JSON.stringify([{ catalogId: 'test-catalog', level: 5 }]),
    JSON.stringify([{ itemId: 'itm-smoke-loot-a', qty: 2, chance: 1 }, { itemId: 'itm-smoke-loot-b', qty: 1, chance: 1 }]),
    now, now,
  );
}

async function seedRun(): Promise<void> {
  // startOrGetRun requires the dungeon to exist, which it does.
  const view = await startOrGetRun(USER, DUNGEON);
  if (!view) throw new Error('startOrGetRun failed');
}

async function readRunState(): Promise<{ state: string; stash_meat: number; stash_bits: number; stash_data: number } | null> {
  return await one('SELECT state, stash_meat, stash_bits, stash_data FROM user_dungeon_runs WHERE user_id = ? AND dungeon_id = ?', USER, DUNGEON);
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();

  console.log('== migration ledger ==');
  const row = await one<{ version: string }>('SELECT version FROM schema_versions WHERE version = ?', '057_user_dungeon_runs_state');
  assert(row !== null, 'migration 057_user_dungeon_runs_state recorded');

  console.log('== new columns exist ==');
  const runCols = await q<{ name: string }>('PRAGMA table_info(user_dungeon_runs)');
  const runColNames = new Set(runCols.map((c) => c.name));
  for (const c of ['state', 'ended_at', 'extraction_kind', 'stash_meat', 'stash_bits', 'stash_data']) {
    assert(runColNames.has(c), `user_dungeon_runs.${c} exists`);
  }
  const warpCols = await q<{ name: string }>('PRAGMA table_info(dungeon_warps)');
  const warpColNames = new Set(warpCols.map((c) => c.name));
  assert(warpColNames.has('is_exit'), 'dungeon_warps.is_exit exists');

  console.log('== seed test data ==');
  await seedUser(USER);
  await seedItem('itm-smoke-loot-a', 'Loot A', 0);
  await seedItem('itm-smoke-loot-b', 'Loot B', 0);
  await seedDungeon();
  await seedEncounter();
  await seedRun();

  console.log('== run production seeders (idempotent) ==');
  await seedShopItems();
  await seedFarmRecipes();

  const initialState = await readRunState();
  assert(initialState?.state === 'active', 'freshly created run.state === active');

  console.log('== flag OFF: defeatEncounter goes to player_inventory (legacy) ==');
  await clearFlag(USER, 'dungeon-extraction');
  const legacyDefeat = await defeatEncounter(USER, DUNGEON, ENCOUNTER);
  assert(legacyDefeat !== null, 'defeatEncounter returned result');
  const invA = await one<{ qty: number }>('SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', USER, 'itm-smoke-loot-a');
  assert(invA?.qty === 2, 'flag off: player_inventory.itm-smoke-loot-a === 2');
  const stashA = await one<{ qty: number }>("SELECT qty FROM dungeon_run_stash WHERE user_id = ? AND item_id = ? AND origin = 'loot'", USER, 'itm-smoke-loot-a');
  assert(stashA === null, 'flag off: stash has no rows for loot');

  console.log('== reset run for flag-on test ==');
  await run(
    "UPDATE user_dungeon_runs SET defeated_encounters = '[]', state = 'active', ended_at = NULL WHERE user_id = ? AND dungeon_id = ?",
    USER, DUNGEON,
  );
  await run('DELETE FROM player_inventory WHERE user_id = ?', USER);

  console.log('== flag ON: defeatEncounter goes to dungeon_run_stash (redirect) ==');
  await setFlag(USER, 'dungeon-extraction');
  const redirectDefeat = await defeatEncounter(USER, DUNGEON, ENCOUNTER);
  assert(redirectDefeat !== null, 'defeatEncounter returned result');
  const invAafter = await one<{ qty: number }>('SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', USER, 'itm-smoke-loot-a');
  assert(invAafter === null, 'flag on: player_inventory has no row for loot A');
  const stashAafter = await one<{ qty: number }>("SELECT qty FROM dungeon_run_stash WHERE user_id = ? AND item_id = ? AND origin = 'loot'", USER, 'itm-smoke-loot-a');
  assert(stashAafter?.qty === 2, 'flag on: dungeon_run_stash has 2 of loot A (origin=loot)');
  const stashBafter = await one<{ qty: number }>("SELECT qty FROM dungeon_run_stash WHERE user_id = ? AND item_id = ? AND origin = 'loot'", USER, 'itm-smoke-loot-b');
  assert(stashBafter?.qty === 1, 'flag on: dungeon_run_stash has 1 of loot B');

  console.log('== extractRun (walked_out) merges stash into inventory ==');
  await run(
    'UPDATE user_dungeon_runs SET stash_meat = 100, stash_bits = 200, stash_data = 50 WHERE user_id = ? AND dungeon_id = ?',
    USER, DUNGEON,
  );
  const extraction = await extractRun(USER, DUNGEON, 'walked_out');
  assert(extraction !== null, 'extractRun returned result');
  assert(extraction?.extractionKind === 'walked_out', 'extractionKind === walked_out');
  assert(extraction?.extractedItems.length === 2, 'extraction reports 2 items');
  assert(extraction?.extractedResources.meat === 100, 'extraction reports 100 meat');
  assert(extraction?.extractedResources.bits === 200, 'extraction reports 200 bits');

  const stateAfterExtract = await readRunState();
  assert(stateAfterExtract?.state === 'extracted', 'run.state === extracted');
  assert(stateAfterExtract?.stash_meat === 0, 'run.stash_meat zeroed');
  assert(stateAfterExtract?.stash_bits === 0, 'run.stash_bits zeroed');
  assert(stateAfterExtract?.stash_data === 0, 'run.stash_data zeroed');

  const invAfinal = await one<{ qty: number }>('SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', USER, 'itm-smoke-loot-a');
  assert(invAfinal?.qty === 2, 'after extract: player_inventory loot A === 2');
  const stashRowCount = await one<{ n: number }>('SELECT COUNT(*) AS n FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ?', USER, DUNGEON);
  assert(stashRowCount?.n === 0, 'after extract: dungeon_run_stash cleared');

  const meatRow = await one<{ amount: number }>("SELECT amount FROM resources WHERE user_id = ? AND resource = 'Meat'", USER);
  assert(meatRow?.amount === 100, 'resources.Meat === 100');
  const bitsRow = await one<{ amount: number }>("SELECT amount FROM resources WHERE user_id = ? AND resource = 'Bits'", USER);
  assert(bitsRow?.amount === 200, 'resources.Bits === 200');
  const dataRow = await one<{ amount: number }>("SELECT amount FROM resources WHERE user_id = ? AND resource = 'Data'", USER);
  assert(dataRow?.amount === 50, 'resources.Data === 50');

  console.log('== extractRun idempotency (already extracted) ==');
  const secondExtract = await extractRun(USER, DUNGEON, 'walked_out');
  assert(secondExtract === null, 'second extractRun on non-active returns null');

  console.log('== wipeRun purges stash + zeroes resources ==');
  const DUNGEON2 = 'dgn_test_extraction_2';
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    DUNGEON2, 'Test Dungeon 2', 'seeded', 'null', 10, 10, 0, 0, 0, 0, 1, 1, 'Rookie', 3, 3, '[]', Date.now(), Date.now(),
  );
  const view2 = await startOrGetRun(USER, DUNGEON2);
  assert(view2 !== null, 'second dungeon run created');
  await run(
    "INSERT INTO dungeon_run_stash (user_id, dungeon_id, item_id, qty, origin, updated_at) VALUES (?, ?, ?, ?, 'kit', ?)",
    USER, DUNGEON2, 'itm-smoke-loot-a', 5, Date.now(),
  );
  await run(
    'UPDATE user_dungeon_runs SET stash_meat = 999, stash_bits = 888, stash_data = 777 WHERE user_id = ? AND dungeon_id = ?',
    USER, DUNGEON2,
  );

  const wipeResult = await wipeRun(USER, DUNGEON2);
  assert(wipeResult !== null, 'wipeRun returned result');
  assert(wipeResult?.purgedItemCount === 1, 'wipeRun reports 1 purged item');
  assert(wipeResult?.purgedResources.meat === 999, 'wipeRun reports 999 purged meat');

  const stateAfterWipe = await one<{ state: string; stash_meat: number }>('SELECT state, stash_meat FROM user_dungeon_runs WHERE user_id = ? AND dungeon_id = ?', USER, DUNGEON2);
  assert(stateAfterWipe?.state === 'wiped', 'run.state === wiped');
  assert(stateAfterWipe?.stash_meat === 0, 'run.stash_meat zeroed by wipe');
  const stashAfterWipe = await q('SELECT * FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ?', USER, DUNGEON2);
  assert(stashAfterWipe.length === 0, 'stash purged by wipe');

  console.log('== wipeRun idempotency ==');
  const secondWipe = await wipeRun(USER, DUNGEON2);
  assert(secondWipe === null, 'second wipeRun on non-active returns null');

  console.log('== extractRun (teleport_scroll) sets extracted_by_teleport ==');
  const DUNGEON3 = 'dgn_test_extraction_3';
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    DUNGEON3, 'Test Dungeon 3', 'seeded', 'null', 10, 10, 0, 0, 0, 0, 1, 1, 'Rookie', 3, 3, '[]', Date.now(), Date.now(),
  );
  await startOrGetRun(USER, DUNGEON3);
  const scrollExtraction = await extractRun(USER, DUNGEON3, 'teleport_scroll');
  assert(scrollExtraction?.extractionKind === 'teleport_scroll', 'scroll extraction kind === teleport_scroll');
  const stateAfterScroll = await one<{ state: string }>('SELECT state FROM user_dungeon_runs WHERE user_id = ? AND dungeon_id = ?', USER, DUNGEON3);
  assert(stateAfterScroll?.state === 'extracted_by_teleport', 'run.state === extracted_by_teleport');

  console.log('== extraction scroll item seeded ==');
  const scroll = await one<{ item_type: string; rarity: number }>('SELECT item_type, rarity FROM shop_items WHERE id = ?', 'itm-extraction-scroll');
  assert(scroll?.item_type === 'extraction', 'itm-extraction-scroll.item_type === extraction');
  assert(scroll?.rarity === 3, 'itm-extraction-scroll.rarity === 3 (epic)');
  const recipe = await one<{ id: string }>('SELECT id FROM farm_recipes WHERE id = ?', 'rcp-extraction-scroll');
  assert(recipe !== null, 'rcp-extraction-scroll seeded in farm_recipes');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== dungeon-extraction smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
