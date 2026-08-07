/**
 * F8 admin item filter + CRUD smoke test — verifies the backend
 * infrastructure the F8 admin panels ride on:
 *
 *   - Migration 067 index exists
 *   - `listShopItems(filter)` narrows by item_type / item_type_in /
 *     item_type_not_in and matches expected seeded counts
 *   - Farm-recipes admin helpers list/get/create/update/delete round-
 *     trip correctly (soft delete leaves the row present with
 *     enabled=0)
 *   - Rarity-tables admin helpers list/get/create/update/delete round-
 *     trip correctly (hard delete)
 *
 * Run: pnpm --filter @digiworld/backend test:admin-item-filter
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { listShopItems } from '../src/admin/shop.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes } from '../src/farm/engine.ts';
import {
  createAdminFarmRecipe,
  deleteAdminFarmRecipe,
  getAdminFarmRecipe,
  listAdminFarmRecipes,
  updateAdminFarmRecipe,
} from '../src/admin/farm-recipes.ts';
import {
  createRarityTable,
  deleteRarityTable,
  getRarityTable,
  listRarityTables,
  seedDefaultRarityTables,
  updateRarityTable,
} from '../src/dungeons/rarity-tables.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-admin-item-filter-smoke.db';

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

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();
  await seedShopItems();
  await seedFarmRecipes();
  await seedDefaultRarityTables();

  console.log('== migration 067 index exists ==');
  const idx = await one<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_shop_items_type_rarity'");
  assert(idx !== null, 'idx_shop_items_type_rarity created');

  console.log('== listShopItems() filter by item_type ==');
  const evoOnly = await listShopItems({ itemType: 'evolution_key' });
  assert(evoOnly.length === 165, `evolution_key filter → 165 SKUs (got ${evoOnly.length})`);
  assert(evoOnly.every((i) => i.itemType === 'evolution_key'), 'every returned item is evolution_key');

  const fragOnly = await listShopItems({ itemType: 'fragment' });
  assert(fragOnly.length === 80, `fragment filter → 80 SKUs (got ${fragOnly.length})`);

  const chipOnly = await listShopItems({ itemType: 'chip' });
  assert(chipOnly.length === 3, `chip filter → 3 SKUs (got ${chipOnly.length})`);

  console.log('== listShopItems() filter by item_type_in (union) ==');
  const craftMaterials = await listShopItems({ itemTypeIn: ['fragment', 'chip'] });
  assert(craftMaterials.length === 83, `fragment+chip filter → 83 SKUs (got ${craftMaterials.length})`);

  console.log('== listShopItems() filter by item_type_not_in (exclusion) ==');
  const nonCraft = await listShopItems({ itemTypeNotIn: ['fragment', 'chip', 'evolution_key'] });
  assert(nonCraft.every((i) => i.itemType !== 'fragment' && i.itemType !== 'chip' && i.itemType !== 'evolution_key'), 'no fragment/chip/evolution_key in nonCraft filter');
  assert(nonCraft.length > 0, `non-craft filter returned ${nonCraft.length} SKUs`);

  console.log('== listShopItems() rejects unknown item_type gracefully ==');
  const bogus = await listShopItems({ itemType: 'not-a-real-type' });
  assert(bogus.length === 0, 'unknown item_type → empty array');
  const partialBogus = await listShopItems({ itemTypeIn: ['fragment', 'not-a-real-type'] });
  assert(partialBogus.length === 80, 'itemTypeIn drops bogus entries but keeps valid ones');

  console.log('== farm-recipes CRUD round-trip ==');
  const beforeCount = (await listAdminFarmRecipes()).length;
  const created = await createAdminFarmRecipe({
    itemId: 'itm-heal-small',
    meatCost: 1,
    bitsCost: 2,
    dataCost: 3,
    craftTimeMs: 60_000,
    category: 'med',
    requiresItems: [{ itemId: 'itm-shard-fire-r0', qty: 1 }],
    inheritRarityFrom: null,
    unlockCondition: null,
  });
  assert(created.ok === true, 'createAdminFarmRecipe.ok');
  if (!created.ok) return;
  const createdId = created.recipe.id;
  const afterCount = (await listAdminFarmRecipes()).length;
  assert(afterCount === beforeCount + 1, 'listAdminFarmRecipes reflects create');

  const fetched = await getAdminFarmRecipe(createdId);
  assert(fetched !== null, 'getAdminFarmRecipe returns created recipe');
  assert(fetched?.meatCost === 1, 'meatCost round-trips');
  assert(fetched?.requiresItems.length === 1 && fetched.requiresItems[0]?.itemId === 'itm-shard-fire-r0', 'requiresItems round-trips');

  const updated = await updateAdminFarmRecipe(createdId, {
    itemId: 'itm-heal-small',
    meatCost: 10,
    bitsCost: 20,
    dataCost: 30,
    craftTimeMs: 120_000,
    category: 'chip',
    requiresItems: [{ itemId: 'itm-shard-water-r0', qty: 2 }],
    inheritRarityFrom: 'fragment',
    unlockCondition: { kind: 'flag', flag: 'evolution-crafting' },
  });
  assert(updated.ok === true, 'updateAdminFarmRecipe.ok');
  if (updated.ok) {
    assert(updated.recipe.meatCost === 10, 'meatCost updated');
    assert(updated.recipe.category === 'chip', 'category updated');
    assert(updated.recipe.inheritRarityFrom === 'fragment', 'inheritRarityFrom updated');
    assert(updated.recipe.unlockCondition?.kind === 'flag', 'unlockCondition kind persisted');
  }

  console.log('== farm-recipes validation ==');
  const badCat = await createAdminFarmRecipe({
    itemId: 'itm-heal-small',
    meatCost: 1, bitsCost: 1, dataCost: 1,
    craftTimeMs: 60_000,
    category: 'invalid' as never,
  });
  assert(badCat.ok === false && !badCat.ok && badCat.error === 'invalid-category', 'invalid category rejected');
  const badReq = await createAdminFarmRecipe({
    itemId: 'itm-heal-small',
    meatCost: 1, bitsCost: 1, dataCost: 1,
    craftTimeMs: 60_000,
    category: 'med',
    requiresItems: [{ itemId: '', qty: 1 }],
  });
  assert(badReq.ok === false && !badReq.ok && badReq.error === 'invalid-requires-items', 'invalid requiresItems rejected');

  const deleted = await deleteAdminFarmRecipe(createdId);
  assert(deleted.ok === true, 'deleteAdminFarmRecipe.ok (soft delete)');
  const afterDelete = await getAdminFarmRecipe(createdId);
  assert(afterDelete !== null && afterDelete.enabled === false, 'soft delete: row still present with enabled=false');

  console.log('== rarity-tables CRUD round-trip ==');
  const beforeTables = (await listRarityTables()).length;
  await createRarityTable({
    id: 'rt_test_admin',
    weights: { 0: 40, 1: 40, 2: 15, 3: 4, 4: 1 },
    poolTag: 'shards',
    minRolls: 1,
    maxRolls: 3,
  });
  const afterCreateTables = await listRarityTables();
  assert(afterCreateTables.length === beforeTables + 1, 'listRarityTables reflects create');
  const fetchedTable = await getRarityTable('rt_test_admin');
  assert(fetchedTable?.poolTag === 'shards', 'created table poolTag round-trips');
  assert(fetchedTable?.weights[0] === 40 && fetchedTable?.weights[4] === 1, 'weights round-trip');

  const updOk = await updateRarityTable('rt_test_admin', {
    weights: { 0: 90, 1: 10 },
    poolTag: 'chips',
    minRolls: 2,
    maxRolls: 5,
  });
  assert(updOk === true, 'updateRarityTable returns true when row exists');
  const afterUpdate = await getRarityTable('rt_test_admin');
  assert(afterUpdate?.poolTag === 'chips', 'poolTag updated');
  assert(afterUpdate?.minRolls === 2 && afterUpdate?.maxRolls === 5, 'rolls updated');

  const updMissing = await updateRarityTable('rt_does_not_exist', {
    weights: {},
    poolTag: 'shards',
    minRolls: 0,
    maxRolls: 0,
  });
  assert(updMissing === false, 'updateRarityTable returns false for missing id');

  const delOk = await deleteRarityTable('rt_test_admin');
  assert(delOk === true, 'deleteRarityTable returns true on real row');
  const afterDelTables = await listRarityTables();
  assert(afterDelTables.length === beforeTables, 'listRarityTables reflects hard delete');
  const delMissing = await deleteRarityTable('rt_does_not_exist');
  assert(delMissing === false, 'deleteRarityTable returns false on missing id');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== admin-item-filter smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
