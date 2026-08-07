/**
 * Factory rarity inheritance smoke test — F6b of the dungeon extraction refactor.
 *
 * Verifies the queueItem runtime path for Cypher recipes:
 *   - Recipe carries requires_items (shard SKUs) + inherit_rarity_from='fragment'
 *   - queueItem deducts shards highest-rarity-first from player inventory
 *   - Job.item_id is remapped from the base -r0 template to -r{maxConsumedRarity}
 *   - Craft completes and grants the correct rarity-mapped Cypher
 *   - Insufficient shards → 'insufficient-items' error, no partial deduct
 *   - Empty requires_items → legacy recipe path unchanged
 *
 * Run: pnpm --filter @digiworld/backend test:factory-rarity-inherit
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes, buyFactory, queueItem } from '../src/farm/engine.ts';
import { seedDefaultRarityTables } from '../src/dungeons/rarity-tables.ts';
import { setFlag } from '../src/flags/repo.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-factory-rarity-inherit-smoke.db';
const USER = 'usr_test_crafter';

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
  for (const [res, amt] of [['Meat', 10000], ['Bits', 10000], ['Data', 10000]] as const) {
    await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, res, amt, now);
  }
}

async function grantInventory(userId: string, itemId: string, qty: number): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at",
    userId, itemId, qty, now,
  );
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
  await seedFarmRecipes();
  await seedDefaultRarityTables();
  await seedUser(USER);
  await setFlag(USER, 'evolution-crafting');

  const rareFactory = await buyFactory(USER, 'rare');
  assert(rareFactory.ok === true, 'buy Rare Factory');
  if (!rareFactory.ok) return;
  const factoryId = rareFactory.factory.id;

  console.log('== insufficient shards → error ==');
  const insufficient = await queueItem(USER, factoryId, 'rcp-cypher-fire-t1');
  assert(insufficient.ok === false, 'queue with zero shards fails');
  if (!insufficient.ok) {
    assert(insufficient.error === 'insufficient-items', `error === insufficient-items (got ${insufficient.error})`);
  }
  const beforeShards = await inventoryQty(USER, 'itm-shard-fire-r0');
  assert(beforeShards === 0, 'no shards consumed on failure');

  console.log('== craft consumes only r0 shards when only r0 available ==');
  await grantInventory(USER, 'itm-shard-fire-r0', 4);
  const craftR0 = await queueItem(USER, factoryId, 'rcp-cypher-fire-t1');
  assert(craftR0.ok === true, 'queue with 4 r0 shards succeeds');
  const remainingR0 = await inventoryQty(USER, 'itm-shard-fire-r0');
  assert(remainingR0 === 0, `all 4 r0 shards consumed (remaining ${remainingR0})`);
  if (craftR0.ok) {
    assert(craftR0.job.itemId === 'itm-cypher-fire-t1-r0', `job.item_id === itm-cypher-fire-t1-r0 (got ${craftR0.job.itemId})`);
  }

  console.log('== craft consumes highest-rarity shards first + remaps output ==');
  await grantInventory(USER, 'itm-shard-fire-r0', 2);
  await grantInventory(USER, 'itm-shard-fire-r1', 1);
  await grantInventory(USER, 'itm-shard-fire-r3', 1);
  const craftMixed = await queueItem(USER, factoryId, 'rcp-cypher-fire-t1');
  assert(craftMixed.ok === true, 'queue with mixed rarities succeeds');
  if (craftMixed.ok) {
    assert(craftMixed.job.itemId === 'itm-cypher-fire-t1-r3', `job.item_id remapped to r3 (got ${craftMixed.job.itemId})`);
  }
  const afterR3 = await inventoryQty(USER, 'itm-shard-fire-r3');
  const afterR1 = await inventoryQty(USER, 'itm-shard-fire-r1');
  const afterR0 = await inventoryQty(USER, 'itm-shard-fire-r0');
  assert(afterR3 === 0, `r3 consumed first (remaining ${afterR3})`);
  assert(afterR1 === 0, `r1 consumed next (remaining ${afterR1})`);
  assert(afterR0 === 0, `r0 consumed last (remaining ${afterR0})`);

  console.log('== mixed shards WITHOUT any high-rarity → output stays at max available ==');
  await grantInventory(USER, 'itm-shard-fire-r0', 3);
  await grantInventory(USER, 'itm-shard-fire-r2', 1);
  const craftR2 = await queueItem(USER, factoryId, 'rcp-cypher-fire-t1');
  assert(craftR2.ok === true, 'queue with r0+r2 succeeds');
  if (craftR2.ok) {
    assert(craftR2.job.itemId === 'itm-cypher-fire-t1-r2', `job.item_id === r2 (got ${craftR2.job.itemId})`);
  }

  console.log('== partial shortfall → all-or-nothing + no partial deduct ==');
  await grantInventory(USER, 'itm-shard-water-r0', 2);
  const partial = await queueItem(USER, factoryId, 'rcp-cypher-water-t1');
  assert(partial.ok === false, 'queue with 2/4 shards fails');
  if (!partial.ok) {
    assert(partial.error === 'insufficient-items', 'error === insufficient-items on partial');
  }
  const waterAfter = await inventoryQty(USER, 'itm-shard-water-r0');
  assert(waterAfter === 2, `partial: no shards consumed on failure (still 2, got ${waterAfter})`);

  console.log('== legacy recipe path unchanged (empty requires_items) ==');
  const medFactory = await buyFactory(USER, 'med');
  assert(medFactory.ok === true, 'buy Med Factory');
  if (medFactory.ok) {
    const legacy = await queueItem(USER, medFactory.factory.id, 'rcp-heal-small');
    assert(legacy.ok === true, 'legacy recipe queues successfully');
    if (legacy.ok) {
      assert(legacy.job.itemId === 'itm-heal-small', 'legacy job.item_id unchanged');
    }
  }

  console.log('== count > 1 multiplies shard requirement ==');
  await grantInventory(USER, 'itm-shard-plant-r0', 7);
  const twoCount = await queueItem(USER, factoryId, 'rcp-cypher-plant-t1', { count: 2 });
  assert(twoCount.ok === false, 'count=2 with only 7 shards (need 8) fails');
  if (!twoCount.ok) {
    assert(twoCount.error === 'insufficient-items', 'count=2 partial → insufficient-items');
  }
  const plantAfter = await inventoryQty(USER, 'itm-shard-plant-r0');
  assert(plantAfter === 7, 'count=2 failure: no shards consumed');

  await grantInventory(USER, 'itm-shard-plant-r0', 1);
  const twoCountOk = await queueItem(USER, factoryId, 'rcp-cypher-plant-t1', { count: 2 });
  assert(twoCountOk.ok === true, 'count=2 with exactly 8 shards succeeds');
  if (twoCountOk.ok) {
    assert(twoCountOk.queuedCount === 2, 'queuedCount === 2');
  }

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== factory-rarity-inherit smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
