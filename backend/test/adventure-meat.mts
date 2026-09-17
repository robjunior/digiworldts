/**
 * Adventure fuel swap regression test — expeditions must burn the Meat
 * resource (resources table) instead of the itm-provision inventory item.
 *
 * Verifies:
 *   - readAdventurePage surfaces meatOwned (resources) + meatPerHour config
 *   - startAdventure deducts ceil(hours * 10) Meat atomically
 *   - adventures.meat_spent records the spent amount
 *   - itm-provision inventory is NOT touched anymore
 *   - insufficient Meat → 'insufficient-meat', zero deduction, no row
 *   - collectAdventure still banks the meat loot on top of the spent pool
 *
 * Run: pnpm --filter @digiworld/backend test:adventure-meat
 */
import { existsSync, unlinkSync } from 'node:fs';

import { closeDb, one, run } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import {
  collectAdventure,
  readAdventurePage,
  startAdventure,
} from '../src/adventure/engine.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-adventure-meat.db';
const USER = 'usr_adv_meat';
const USER_SHORT = 'usr_adv_meat_short';
const USER_WITH_PROVISIONS = 'usr_adv_meat_prov';

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

async function seedUser(id: string, meat: number): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, `${id}-name`, `${id}-display`, 'x', 0, now, now,
  );
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Meat', meat, now);
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Bits', 100, now);
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Data', 100, now);
  for (const i of [1, 2, 3]) {
    await run(
      'INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `${id}-mon${i}`, id, 'skb-317', `Mon${i}`, 5, now, now,
    );
  }
}

async function grantProvisionItem(userId: string, qty: number): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at",
    userId, 'itm-provision', qty, now,
  );
}

async function meatOf(userId: string): Promise<number> {
  const row = await one<{ amount: number }>('SELECT amount FROM resources WHERE user_id = ? AND resource = ?', userId, 'Meat');
  return row?.amount ?? 0;
}

async function inventoryQty(userId: string, itemId: string): Promise<number> {
  const row = await one<{ qty: number }>('SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', userId, itemId);
  return row?.qty ?? 0;
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();
  await seedShopItems();
  await seedUser(USER, 100);
  await seedUser(USER_SHORT, 5);
  await seedUser(USER_WITH_PROVISIONS, 100);
  await grantProvisionItem(USER_WITH_PROVISIONS, 3);

  console.log('== page view surfaces meat ==');
  const page = await readAdventurePage(USER);
  assert(page.meatOwned === 100, `meatOwned === 100 (got ${page.meatOwned})`);
  assert(page.config.meatPerHour === 10, 'config.meatPerHour === 10');
  assert(page.config.encountersPerHour === 3, 'config.encountersPerHour === 3');
  assert(page.active === null && page.lastCollected === null, 'no adventures yet');

  console.log('== start deducts Meat atomically ==');
  const started = await startAdventure(USER, ['usr_adv_meat-mon1', 'usr_adv_meat-mon2', 'usr_adv_meat-mon3'], 2);
  assert(started.ok === true, 'start 2h expedition');
  if (started.ok) {
    assert(started.meatOwned === 80, `meatOwned after start === 80 (got ${started.meatOwned})`);
    assert(started.adventure.meatSpent === 20, `adventure.meatSpent === 20 (got ${started.adventure.meatSpent})`);
  }
  assert((await meatOf(USER)) === 80, 'resources Meat row dropped to 80');

  const advRow = await one<{ meat_spent: number; mon_ids: string }>(
    'SELECT meat_spent, mon_ids FROM adventures WHERE user_id = ? AND collected_at IS NULL', USER,
  );
  assert(advRow !== null, 'adventure row persisted');
  if (advRow) {
    assert(advRow.meat_spent === 20, `persisted meat_spent === 20 (got ${advRow.meat_spent})`);
  }

  const busy = await startAdventure(USER, ['usr_adv_meat-mon1', 'usr_adv_meat-mon2', 'usr_adv_meat-mon3'], 1);
  assert(busy.ok === false && busy.error === 'active-adventure-exists', 'second start blocked (active-adventure-exists)');

  console.log('== provisions item is NOT consumed anymore ==');
  const provStarted = await startAdventure(
    USER_WITH_PROVISIONS, ['usr_adv_meat_prov-mon1', 'usr_adv_meat_prov-mon2', 'usr_adv_meat_prov-mon3'], 1,
  );
  assert(provStarted.ok === true, 'start 1h expedition with 100 meat + 3 provisions');
  assert((await inventoryQty(USER_WITH_PROVISIONS, 'itm-provision')) === 3, `itm-provision untouched (still 3, got ${await inventoryQty(USER_WITH_PROVISIONS, 'itm-provision')})`);
  assert((await meatOf(USER_WITH_PROVISIONS)) === 90, 'meat dropped by exactly 10 instead');

  console.log('== insufficient meat → 402-style error, no deduction ==');
  const short = await startAdventure(USER_SHORT, ['usr_adv_meat_short-mon1', 'usr_adv_meat_short-mon2', 'usr_adv_meat_short-mon3'], 1);
  assert(short.ok === false, 'short user cannot start');
  if (!short.ok) {
    assert(short.error === 'insufficient-meat', `error === 'insufficient-meat' (got ${short.error})`);
    assert(short.details?.need === 10 && short.details?.have === 5, 'details { need: 10, have: 5 }');
  }
  assert((await meatOf(USER_SHORT)) === 5, 'short user meat unchanged (5)');
  const shortRows = await one<{ id: string }>('SELECT id FROM adventures WHERE user_id = ?', USER_SHORT);
  assert(shortRows === null, 'no adventure row created on insufficient meat');

  console.log('== collect banks meat loot on top ==');
  await run('UPDATE adventures SET started_at = started_at - distance_ms WHERE user_id = ?', USER);
  const collected = await collectAdventure(USER);
  assert(collected.ok === true, 'collect after backdating start');
  if (collected.ok) {
    const report = collected.adventure.report;
    assert(report !== null, 'report attached');
    if (report) {
      assert(report.totals.meat >= 0, `meat reward is >= 0 (got ${report.totals.meat})`);
      assert((await meatOf(USER)) === 80 + report.totals.meat, `meat = 80 + reward (got ${await meatOf(USER)})`);
    }
    const gone = await one<{ id: string }>('SELECT id FROM adventures WHERE user_id = ? AND collected_at IS NULL', USER);
    assert(gone === null, 'no active adventure after collect');
  }

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== adventure-meat smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});