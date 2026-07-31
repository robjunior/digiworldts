/**
 * Item grant smoke test — the shared inventory write path that dialogue
 * actions (give_item / remove_item) and battle loot both go through.
 * Boots the real SqliteAdapter so schema.sql and every migration apply,
 * including the CHECK (qty >= 0) and the FK onto shop_items.
 *
 * Run: pnpm --filter @digiworld/backend test:items
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { grantItem, removeItem, countItem, hasItem } from '../src/items/grant.ts';
import { grantItemDrop } from '../src/world/pve-battle.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-items-smoke.db';
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(DB + suffix)) unlinkSync(DB + suffix);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

const A = 'usr_item_a';
const B = 'usr_item_b';
const POTION = 'itm_test_potion';
const RELIC = 'itm_test_relic';

await getDb();

const now = Date.now();
for (const id of [A, B]) {
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, id, id, 'x', 0, now, now],
  );
}
for (const [id, name] of [[POTION, 'Test Potion'], [RELIC, 'Test Relic']]) {
  await run(
    'INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, name, 'fixture', 0, 'quest', 'item', '{}', 1, now],
  );
}

await test('granting an item the player does not own creates the row', async () => {
  await grantItem(A, POTION, 2);
  assert((await countItem(A, POTION)) === 2, 'expected qty 2');
});

await test('granting again is additive, not a replace', async () => {
  await grantItem(A, POTION, 3);
  assert((await countItem(A, POTION)) === 5, 'expected qty 5 after 2 + 3');
});

await test('an unowned item counts as zero rather than throwing', async () => {
  assert((await countItem(A, RELIC)) === 0, 'expected 0 for an unowned item');
});

await test('hasItem honours the quantity threshold', async () => {
  assert((await hasItem(A, POTION, 5)) === true, 'expected true at exactly 5');
  assert((await hasItem(A, POTION, 6)) === false, 'expected false above the balance');
  assert((await hasItem(A, RELIC)) === false, 'expected false for an unowned item');
});

await test('removing part of a stack leaves the remainder', async () => {
  assert((await removeItem(A, POTION, 2)) === true, 'expected the removal to succeed');
  assert((await countItem(A, POTION)) === 3, 'expected 3 left');
});

await test('removing more than the player owns fails and changes nothing', async () => {
  assert((await removeItem(A, POTION, 99)) === false, 'expected the removal to be refused');
  assert((await countItem(A, POTION)) === 3, 'balance moved despite a refused removal');
});

await test('removing an item the player does not own fails', async () => {
  assert((await removeItem(A, RELIC, 1)) === false, 'expected false for an unowned item');
});

await test('removing the exact balance is allowed and lands on zero', async () => {
  assert((await removeItem(A, POTION, 3)) === true, 'expected the exact removal to succeed');
  assert((await countItem(A, POTION)) === 0, 'expected 0 left');
  assert((await hasItem(A, POTION)) === false, 'a zero balance must not read as owned');
});

await test('a non-positive quantity is rejected rather than silently applied', async () => {
  let grantThrew = false;
  let removeThrew = false;
  try { await grantItem(A, POTION, 0); } catch { grantThrew = true; }
  try { await removeItem(A, POTION, -1); } catch { removeThrew = true; }
  assert(grantThrew, 'grantItem accepted qty 0');
  assert(removeThrew, 'removeItem accepted a negative qty');
});

await test('inventories are scoped per user', async () => {
  await grantItem(B, RELIC, 1);
  assert((await countItem(B, RELIC)) === 1, 'expected B to hold the relic');
  assert((await countItem(A, RELIC)) === 0, 'the grant leaked to another user');
});

await test('granting an unknown item id fails loudly instead of writing a dangling row', async () => {
  let threw = false;
  try { await grantItem(A, 'itm_does_not_exist', 1); } catch { threw = true; }
  assert(threw, 'expected the shop_items foreign key to reject an unknown item');
});

await test('grantItemDrop still writes through the shared path', async () => {
  await grantItemDrop(B, { itemId: POTION, name: 'Test Potion', qty: 4 });
  assert((await countItem(B, POTION)) === 4, 'expected the loot drop to land');
  await grantItemDrop(B, { itemId: POTION, name: 'Test Potion', qty: 1 });
  assert((await countItem(B, POTION)) === 5, 'expected loot drops to stack additively');
});

await test('the CHECK constraint still guards the column', async () => {
  const row = await one<{ readonly qty: number }>(
    'SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', [A, POTION],
  );
  assert(row !== null && row.qty >= 0, 'a negative balance reached the table');
});

process.stdout.write(`item grant tests: ${passed} passed, ${failed} failed\n`);
closeDb();
await closeDbAdapter();
process.exit(failed === 0 ? 0 : 1);
