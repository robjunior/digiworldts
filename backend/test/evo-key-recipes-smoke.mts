/**
 * Evolution-key recipe smoke test — 5× itm-evo-frag-<champion> → 1× itm-evo-<champion>
 * at the Rare Factory.
 *
 * Verifies:
 *   - 6 evo-key recipes are seeded and visible on the factory page
 *   - Each recipe requires exactly 5 of the matching fragment
 *   - queueItem consumes fragments from inventory on craft
 *   - Insufficient fragments → 'insufficient-items', no partial deduct
 *
 * Run: pnpm --filter @digiworld/backend test:evo-key-recipes
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes, buyFactory, queueItem } from '../src/farm/engine.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-evo-key-recipes-smoke.db';
const USER = 'usr_test_evo_key_crafter';

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
  await seedUser(USER);

  const rareFactory = await buyFactory(USER, 'rare');
  assert(rareFactory.ok === true, 'buy Rare Factory');
  if (!rareFactory.ok) return;
  const factoryId = rareFactory.factory.id;

  console.log('== 6 evo-key recipes seeded ==');
  const { readFactoryPage } = await import('../src/farm/engine.ts');
  const page = await readFactoryPage(USER);
  const recipes = page.recipes.filter((r) => r.id.startsWith('rcp-evo-key-'));
  assert(recipes.length === 6, `6 evo-key recipes visible (got ${recipes.length})`);

  const greymonRecipe = recipes.find((r) => r.id === 'rcp-evo-key-greymon');
  assert(greymonRecipe !== undefined, 'rcp-evo-key-greymon exists');
  if (greymonRecipe) {
    assert(greymonRecipe.requires.length === 1, 'greymon recipe has 1 ingredient');
    assert(greymonRecipe.requires[0]?.itemId === 'itm-evo-frag-greymon', 'ingredient is itm-evo-frag-greymon');
    assert(greymonRecipe.requires[0]?.qty === 5, 'requires 5 fragments');
    assert(greymonRecipe.category === 'rare', 'category is rare');
  }

  console.log('== craft consumes 5 fragments ==');
  await grantInventory(USER, 'itm-evo-frag-greymon', 12);
  const craft = await queueItem(USER, factoryId, 'rcp-evo-key-greymon');
  assert(craft.ok === true, 'queue with 12 fragments succeeds');
  const afterCraft = await inventoryQty(USER, 'itm-evo-frag-greymon');
  assert(afterCraft === 7, `5 fragments consumed (remaining ${afterCraft})`);
  if (craft.ok) {
    assert(craft.job.itemId === 'itm-evo-greymon', `job.item_id === itm-evo-greymon (got ${craft.job.itemId})`);
  }

  console.log('== insufficient fragments → error, no partial deduct ==');
  await grantInventory(USER, 'itm-evo-frag-angemon', 3);
  const insufficient = await queueItem(USER, factoryId, 'rcp-evo-key-angemon');
  assert(insufficient.ok === false, 'queue with 3/5 fragments fails');
  if (!insufficient.ok) {
    assert(insufficient.error === 'insufficient-items', `error === insufficient-items (got ${insufficient.error})`);
  }
  const angemonAfter = await inventoryQty(USER, 'itm-evo-frag-angemon');
  assert(angemonAfter === 3, `no fragments consumed on failure (still ${angemonAfter})`);

  console.log('== count > 1 multiplies fragment requirement ==');
  // Currently has 7 greymon fragments; count=2 needs 10 → should fail
  const twoCount = await queueItem(USER, factoryId, 'rcp-evo-key-greymon', { count: 2 });
  assert(twoCount.ok === false, 'count=2 with 7 fragments (need 10) fails');
  if (!twoCount.ok) {
    assert(twoCount.error === 'insufficient-items', 'count=2 partial → insufficient-items');
  }
  const afterFail = await inventoryQty(USER, 'itm-evo-frag-greymon');
  assert(afterFail === 7, 'count=2 failure: no fragments consumed');

  // Top up to exactly 10 → count=2 should succeed
  await grantInventory(USER, 'itm-evo-frag-greymon', 3);
  const twoCountOk = await queueItem(USER, factoryId, 'rcp-evo-key-greymon', { count: 2 });
  assert(twoCountOk.ok === true, 'count=2 with exactly 10 fragments succeeds');
  if (twoCountOk.ok) {
    assert(twoCountOk.queuedCount === 2, 'queuedCount === 2');
  }

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== evo-key-recipes smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
