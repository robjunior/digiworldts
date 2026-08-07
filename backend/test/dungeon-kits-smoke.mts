/**
 * Dungeon kits smoke test — F2 of the dungeon extraction refactor.
 *
 * Locks in that:
 *   - migrations 053-056 apply (shop_items kit columns + 3 new dungeon tables)
 *   - kit CRUD roundtrips (create, update, list, delete)
 *   - name uniqueness per user enforced
 *   - kit items are max 20, must have unique itemId, positive qty
 *   - escrow to stash is atomic: partial deduct on failure rolls back
 *   - readStash returns kit-origin rows after escrow
 *   - insufficient-items reports every missing item, not just the first
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-kits
 *   (requires DB_PATH pointing at a scratch file, e.g. /tmp/dw-dungeon-kits-smoke.db)
 */
import { unlinkSync, existsSync } from 'node:fs';

import { one, q, run, closeDb, tx } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import {
  createKit,
  deleteKit,
  getKitWithItems,
  listKitsForUser,
  updateKit,
} from '../src/dungeons/kits.ts';
import { escrowKitToStash, readStash } from '../src/dungeons/stash.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-kits-smoke.db';
const USER = 'usr_test_kit_owner';
const DUNGEON = 'dgn_test_tutorial';

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
    id, name, 'seeded for test', 10, 10, 'credits', 'misc', 0, 0, 0, 0, 'consumable', 'item', '{}', 1, 0, 0, 'consumable', now,
  );
  await run(
    'INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)',
    USER, id, qty, now,
  );
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();

  console.log('== migration ledger ==');
  for (const v of ['053_shop_items_kit_class', '054_dungeon_kits', '055_dungeon_kit_items', '056_dungeon_run_stash']) {
    const row = await one<{ version: string }>('SELECT version FROM schema_versions WHERE version = ?', v);
    assert(row !== null, `migration ${v} recorded`);
  }

  console.log('== seed inventory ==');
  await seedUser(USER);
  await seedUser('usr_test_other');
  await seedItem('itm-smoke-heal', 'Test Heal', 5);
  await seedItem('itm-smoke-revive', 'Test Revive', 2);
  await seedItem('itm-smoke-scarce', 'Test Scarce', 1);

  console.log('== createKit ==');
  const created = await createKit(USER, {
    name: 'Boss Push',
    items: [
      { itemId: 'itm-smoke-heal', qty: 3, slotOrder: 0 },
      { itemId: 'itm-smoke-revive', qty: 1, slotOrder: 1 },
    ],
  });
  assert(created.ok === true, 'create returned ok');
  assert(created.ok && created.kit.name === 'Boss Push', 'kit.name === "Boss Push"');
  assert(created.ok && created.kit.items.length === 2, 'kit has 2 items');
  const kitId = created.ok ? created.kit.id : '';

  console.log('== createKit rejects duplicates ==');
  const dup = await createKit(USER, {
    name: 'Boss Push',
    items: [{ itemId: 'itm-smoke-heal', qty: 1, slotOrder: 0 }],
  });
  assert(!dup.ok && dup.error === 'duplicate-name', 'duplicate name rejected');

  const dupItem = await createKit(USER, {
    name: 'Bad Kit',
    items: [
      { itemId: 'itm-smoke-heal', qty: 1, slotOrder: 0 },
      { itemId: 'itm-smoke-heal', qty: 2, slotOrder: 1 },
    ],
  });
  assert(!dupItem.ok && dupItem.error === 'duplicate-item', 'duplicate itemId in a single kit rejected');

  console.log('== createKit rejects invalid input ==');
  const emptyName = await createKit(USER, { name: '', items: [] });
  assert(!emptyName.ok && emptyName.error === 'invalid-name', 'empty name rejected');

  const badQty = await createKit(USER, {
    name: 'Zero Qty',
    items: [{ itemId: 'itm-smoke-heal', qty: 0, slotOrder: 0 }],
  });
  assert(!badQty.ok && badQty.error === 'invalid-items', 'qty = 0 rejected');

  const tooMany = await createKit(USER, {
    name: 'Too Many Slots',
    items: Array.from({ length: 21 }, (_, i) => ({
      itemId: `itm-slot-${i}`,
      qty: 1,
      slotOrder: i,
    })),
  });
  assert(!tooMany.ok && tooMany.error === 'invalid-items', '> 20 slots rejected');

  console.log('== updateKit ==');
  const updated = await updateKit(USER, kitId, {
    name: 'Boss Push v2',
    items: [{ itemId: 'itm-smoke-heal', qty: 5, slotOrder: 0 }],
  });
  assert(updated.ok && updated.kit.name === 'Boss Push v2', 'update kit.name');
  assert(updated.ok && updated.kit.items.length === 1, 'update replaces items (was 2, now 1)');
  assert(updated.ok && updated.kit.items[0]!.qty === 5, 'update qty === 5');

  console.log('== listKitsForUser + getKitWithItems ==');
  const list = await listKitsForUser(USER);
  assert(list.length === 1, 'list returns 1 kit');
  assert(list[0]!.items.length === 1, 'listed kit has updated items');

  const fetched = await getKitWithItems(USER, kitId);
  assert(fetched !== null, 'getKitWithItems returns row');
  assert(fetched?.name === 'Boss Push v2', 'fetched kit has current name');

  console.log('== escrowKitToStash: happy path ==');
  const escrowKit = await createKit(USER, {
    name: 'Escrow Test',
    items: [
      { itemId: 'itm-smoke-heal', qty: 2, slotOrder: 0 },
      { itemId: 'itm-smoke-revive', qty: 1, slotOrder: 1 },
    ],
  });
  const eKit = escrowKit.ok ? escrowKit.kit : null;
  assert(eKit !== null, 'escrow test kit created');

  const escrow = await escrowKitToStash(USER, DUNGEON, eKit!);
  assert(escrow.ok === true, 'escrow returned ok');
  assert(escrow.ok && escrow.stash.items.length === 2, 'stash has 2 kit-origin rows');
  assert(
    escrow.ok && escrow.stash.items.every((row) => row.origin === 'kit'),
    'every stash row is origin=kit',
  );

  const invHeal = await one<{ qty: number }>(
    'SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?',
    USER,
    'itm-smoke-heal',
  );
  assert(invHeal?.qty === 3, 'player_inventory heal decremented (5 - 2 = 3)');

  const invRevive = await one<{ qty: number }>(
    'SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?',
    USER,
    'itm-smoke-revive',
  );
  assert(invRevive?.qty === 1, 'player_inventory revive decremented (2 - 1 = 1)');

  console.log('== escrowKitToStash: insufficient-items lists ALL misses ==');
  const greedyKit = await createKit(USER, {
    name: 'Greedy Kit',
    items: [
      { itemId: 'itm-smoke-heal', qty: 10, slotOrder: 0 },
      { itemId: 'itm-smoke-scarce', qty: 5, slotOrder: 1 },
    ],
  });
  const gKit = greedyKit.ok ? greedyKit.kit : null;
  assert(gKit !== null, 'greedy kit created');

  const invHealBefore = (await one<{ qty: number }>(
    'SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?',
    USER,
    'itm-smoke-heal',
  ))?.qty ?? 0;

  const escrowFail = await escrowKitToStash(USER, `${DUNGEON}-fail`, gKit!);
  assert(!escrowFail.ok, 'greedy escrow fails');
  assert(
    !escrowFail.ok && escrowFail.error === 'insufficient-items',
    'error === insufficient-items',
  );
  assert(
    !escrowFail.ok && escrowFail.missing.length === 2,
    'missing lists BOTH items (not just the first)',
  );

  const invHealAfter = (await one<{ qty: number }>(
    'SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?',
    USER,
    'itm-smoke-heal',
  ))?.qty ?? 0;
  assert(invHealAfter === invHealBefore, 'atomic rollback: heal qty unchanged on failed escrow');

  const stashAfterFail = await readStash(USER, `${DUNGEON}-fail`);
  assert(stashAfterFail.items.length === 0, 'atomic rollback: no stash rows on failed escrow');

  console.log('== deleteKit CASCADEs to kit_items ==');
  const doomedKit = await createKit(USER, {
    name: 'Doomed',
    items: [{ itemId: 'itm-smoke-heal', qty: 1, slotOrder: 0 }],
  });
  const dKitId = doomedKit.ok ? doomedKit.kit.id : '';
  assert(dKitId.length > 0, 'doomed kit created');

  const itemRowsBefore = await q<{ kit_id: string }>(
    'SELECT kit_id FROM dungeon_kit_items WHERE kit_id = ?',
    dKitId,
  );
  assert(itemRowsBefore.length === 1, 'kit_items row exists before delete');

  const removed = await deleteKit(USER, dKitId);
  assert(removed === true, 'delete returned true');

  const itemRowsAfter = await q<{ kit_id: string }>(
    'SELECT kit_id FROM dungeon_kit_items WHERE kit_id = ?',
    dKitId,
  );
  assert(itemRowsAfter.length === 0, 'kit_items rows CASCADE deleted');

  console.log('== per-user isolation ==');
  const otherUser = 'usr_test_other';
  const cross = await getKitWithItems(otherUser, kitId);
  assert(cross === null, "another user cannot read this user's kit");

  const crossDel = await deleteKit(otherUser, kitId);
  assert(crossDel === false, "another user cannot delete this user's kit");

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== dungeon-kits smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
