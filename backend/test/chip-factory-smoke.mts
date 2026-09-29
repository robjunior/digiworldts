/**
 * Chip-factory smoke test — craftable evolution chips gated on fragments.
 *
 * Verifies:
 *   - shop_items seeds the 9 chip-fragment SKUs (item_type='chip_fragment',
 *     drop_pool='chips') + the 3 craftable chips already exist.
 *   - farm_recipes seeds 3 chip recipes (rcp-chip-*) on the CHIP factory,
 *     each requiring its three fragments, unlock_condition kind='has-items'.
 *   - has-items gate: recipe HIDDEN until the player holds all three fragments,
 *     then visible (with names resolved); partial set stays hidden.
 *   - queueItem on a Chip Factory consumes the three fragments and produces the chip.
 *
 * Run: pnpm --filter @digiworld/backend test:chip-factory
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes, buyFactory, queueItem, readFactoryPage } from '../src/farm/engine.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-chip-factory-smoke.db';
const USER = 'usr_test_chip';
const FRAGS = ['champion', 'ultimate', 'mega'];

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; console.error(`  FAIL  ${msg}`); }
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

  console.log('== chip fragment SKUs seeded ==');
  const fragRows = await q<{ id: string }>("SELECT id FROM shop_items WHERE item_type = 'chip_fragment'");
  assert(fragRows.length === 9, `9 chip-fragment SKUs seeded (got ${fragRows.length})`);
  const fragInPool = await one<{ n: number }>("SELECT COUNT(*) AS n FROM shop_items WHERE item_type = 'chip_fragment' AND drop_pool = 'chips'");
  assert(fragInPool?.n === 9, `all chip fragments tagged drop_pool='chips'`);

  console.log('== chip recipes seeded (chip factory) ==');
  const recipeRows = await q<{ id: string; category: string; requires_items: string; unlock_condition: string }>(
    "SELECT id, category, requires_items, unlock_condition FROM farm_recipes WHERE id LIKE 'rcp-chip-%'",
  );
  assert(recipeRows.length === 3, `3 chip recipes seeded (got ${recipeRows.length})`);
  for (const stage of FRAGS) {
    const row = recipeRows.find((r) => r.id === `rcp-chip-${stage}`);
    assert(row !== undefined, `rcp-chip-${stage} exists`);
    if (row) {
      assert(row.category === 'chip', `rcp-chip-${stage} category === chip`);
      const req: unknown = JSON.parse(row.requires_items);
      assert(
        Array.isArray(req) && req.length === 3
          && (req as { itemId: string }[]).every((e, i) => e.itemId === `itm-chip-frag-${stage}-${['a', 'b', 'c'][i]}`),
        `rcp-chip-${stage} requires its 3 fragments`,
      );
      const cond: unknown = JSON.parse(row.unlock_condition);
      assert(Array.isArray((cond as { items: unknown }).items) && (cond as { kind: string }).kind === 'has-items',
        `rcp-chip-${stage} unlock_condition kind=has-items`);
    }
  }

  console.log('== has-items gate hides until ALL fragments held ==');
  const pageNone = await readFactoryPage(USER);
  assert(pageNone.recipes.filter((r) => r.id.startsWith('rcp-chip-')).length === 0, 'no chip recipes visible with zero fragments');

  await grantInventory(USER, 'itm-chip-frag-champion-a', 1);
  await grantInventory(USER, 'itm-chip-frag-champion-b', 1);
  const pagePartial = await readFactoryPage(USER);
  assert(pagePartial.recipes.filter((r) => r.id === 'rcp-chip-champion').length === 0, 'champion recipe still hidden with 2/3 fragments');

  await grantInventory(USER, 'itm-chip-frag-champion-c', 1);
  const pageComplete = await readFactoryPage(USER);
  const champRecipe = pageComplete.recipes.find((r) => r.id === 'rcp-chip-champion');
  assert(champRecipe !== undefined, 'champion recipe appears once all 3 fragments held');
  if (champRecipe) {
    assert(champRecipe.requires.length === 3, `RecipeView.requires resolves 3 entries (got ${champRecipe.requires.length})`);
    assert(champRecipe.requires.every((req) => req.itemId.startsWith('itm-chip-frag-champion-') && req.itemName !== req.itemId),
      'requires entries resolve to fragment names');
  }

  console.log('== craft consumes 3 fragments + produces the chip ==');
  const chipFactory = await buyFactory(USER, 'chip');
  assert(chipFactory.ok === true, 'buy Chip Factory');
  if (!chipFactory.ok) return;
  const factoryId = chipFactory.factory.id;
  const craft = await queueItem(USER, factoryId, 'rcp-chip-champion');
  assert(craft.ok === true, 'queue chip craft with all fragments succeeds');
  if (craft.ok) {
    assert(craft.job.itemId === 'itm-digi-chip-champion', `job.item_id === itm-digi-chip-champion (got ${craft.job.itemId})`);
  }
  const remainingA = await inventoryQty(USER, 'itm-chip-frag-champion-a');
  const remainingB = await inventoryQty(USER, 'itm-chip-frag-champion-b');
  const remainingC = await inventoryQty(USER, 'itm-chip-frag-champion-c');
  assert(remainingA === 0 && remainingB === 0 && remainingC === 0, `all 3 fragments consumed (a=${remainingA}, b=${remainingB}, c=${remainingC})`);

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== chip-factory smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});