/**
 * Evolution-crafting foundation smoke test — F6 (foundation) of the dungeon
 * extraction refactor.
 *
 * Locks in the schema + seed-content half of F6. The gameplay half (queueItem
 * requires_items deduct + advanceFactory rarity inheritance + defeatEncounter
 * rarity table roll) ships in F6b.
 *
 * Verifies:
 *   - migrations 062-066 ledger + new columns
 *   - dungeon_rarity_tables + 5 default tables seeded
 *   - shop_items seeded: 80 fragments (16 families × 5 rarities), 3 chips,
 *     165 cyphers (11 elements × 3 tiers × 5 rarities)
 *   - farm_recipes seeded: 33 Cypher recipes (11 elements × 3 tiers),
 *     each with requires_items + inherit_rarity_from='fragment' + gated
 *     by flag:evolution-crafting via unlock_condition
 *   - flag OFF: readFactoryPage hides Cypher recipes
 *   - flag ON: readFactoryPage exposes Cypher recipes
 *   - RarityTable read helpers round-trip weights + pool_tag + roll counts
 *
 * Run: pnpm --filter @digiworld/backend test:evolution-crafting-foundation
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes, readFactoryPage } from '../src/farm/engine.ts';
import { getRarityTable, seedDefaultRarityTables } from '../src/dungeons/rarity-tables.ts';
import { setFlag, clearFlag } from '../src/flags/repo.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-evolution-crafting-foundation-smoke.db';
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
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();

  console.log('== migration ledger ==');
  for (const version of ['062_dungeon_rarity_tables', '063_dungeon_encounters_rarity_table', '064_farm_recipes_requires_items', '065_farm_recipes_unlock_condition', '066_shop_items_drop_pool']) {
    const row = await one<{ version: string }>('SELECT version FROM schema_versions WHERE version = ?', version);
    assert(row !== null, `migration ${version} recorded`);
  }

  console.log('== new columns exist ==');
  const dtCols = await q<{ name: string }>('PRAGMA table_info(dungeon_rarity_tables)');
  assert(dtCols.some((c) => c.name === 'weights'), 'dungeon_rarity_tables.weights exists');
  assert(dtCols.some((c) => c.name === 'pool_tag'), 'dungeon_rarity_tables.pool_tag exists');
  const encCols = await q<{ name: string }>('PRAGMA table_info(dungeon_encounters)');
  assert(encCols.some((c) => c.name === 'rarity_table_id'), 'dungeon_encounters.rarity_table_id exists');
  const rcpCols = await q<{ name: string }>('PRAGMA table_info(farm_recipes)');
  assert(rcpCols.some((c) => c.name === 'requires_items'), 'farm_recipes.requires_items exists');
  assert(rcpCols.some((c) => c.name === 'inherit_rarity_from'), 'farm_recipes.inherit_rarity_from exists');
  assert(rcpCols.some((c) => c.name === 'unlock_condition'), 'farm_recipes.unlock_condition exists');
  const shopCols = await q<{ name: string }>('PRAGMA table_info(shop_items)');
  assert(shopCols.some((c) => c.name === 'drop_pool'), 'shop_items.drop_pool exists');

  console.log('== seed content ==');
  await seedShopItems();
  await seedFarmRecipes();
  await seedDefaultRarityTables();

  const fragmentRow = await one<{ n: number }>("SELECT COUNT(*) AS n FROM shop_items WHERE item_type = 'fragment'");
  assert(fragmentRow?.n === 80, `80 fragment SKUs seeded (got ${fragmentRow?.n})`);

  const chipRow = await one<{ n: number }>("SELECT COUNT(*) AS n FROM shop_items WHERE item_type = 'chip'");
  assert(chipRow?.n === 3, `3 chip SKUs seeded (got ${chipRow?.n})`);

  const cypherRow = await one<{ n: number }>("SELECT COUNT(*) AS n FROM shop_items WHERE item_type = 'evolution_key'");
  assert(cypherRow?.n === 165, `165 cypher SKUs seeded (got ${cypherRow?.n})`);

  const cypherRecipeRow = await one<{ n: number }>("SELECT COUNT(*) AS n FROM farm_recipes WHERE inherit_rarity_from = 'fragment'");
  assert(cypherRecipeRow?.n === 33, `33 cypher recipes seeded (got ${cypherRecipeRow?.n})`);

  const rarityTablesRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM dungeon_rarity_tables');
  assert(rarityTablesRow?.n === 5, `5 default rarity tables seeded (got ${rarityTablesRow?.n})`);

  console.log('== drop_pool populated ==');
  const shardsInPool = await one<{ n: number }>("SELECT COUNT(*) AS n FROM shop_items WHERE drop_pool = 'shards'");
  assert(shardsInPool?.n === 80, `80 shop_items tagged drop_pool='shards' (got ${shardsInPool?.n})`);
  const cyphersInPool = await one<{ n: number }>("SELECT COUNT(*) AS n FROM shop_items WHERE drop_pool = 'cyphers'");
  assert(cyphersInPool?.n === 165, `165 shop_items tagged drop_pool='cyphers' (got ${cyphersInPool?.n})`);
  const chipsInPool = await one<{ n: number }>("SELECT COUNT(*) AS n FROM shop_items WHERE drop_pool = 'chips'");
  assert(chipsInPool?.n === 3, `3 shop_items tagged drop_pool='chips' (got ${chipsInPool?.n})`);

  console.log('== rarity table round-trip ==');
  const rt = await getRarityTable('rt_boss_champion');
  assert(rt !== null, 'rt_boss_champion loaded');
  assert(rt?.poolTag === 'shards', 'rt_boss_champion.poolTag === shards');
  assert(rt?.minRolls === 2 && rt?.maxRolls === 4, 'rt_boss_champion rolls 2..4');
  assert(rt?.weights[0] === 30 && rt?.weights[3] === 4, 'rt_boss_champion.weights[0]===30, weights[3]===4');

  console.log('== rarity table CHECK constraint rejects max < min ==');
  let rejectedRolls = false;
  try {
    await run(
      "INSERT INTO dungeon_rarity_tables (id, weights, pool_tag, min_rolls, max_rolls) VALUES ('rt_broken', '{\"0\":1}', 'shards', 5, 2)",
    );
  } catch { rejectedRolls = true; }
  assert(rejectedRolls, 'CHECK constraint rejects max_rolls < min_rolls');

  console.log('== recipe listing: flag OFF hides Cypher recipes ==');
  await seedUser(USER);
  await clearFlag(USER, 'evolution-crafting');
  const pageOff = await readFactoryPage(USER);
  const cypherRecipesOff = pageOff.recipes.filter((r) => r.id.startsWith('rcp-cypher-'));
  assert(cypherRecipesOff.length === 0, 'flag off: cypher recipes hidden from readFactoryPage');
  const legacyOff = pageOff.recipes.filter((r) => r.id === 'rcp-heal-small');
  assert(legacyOff.length === 1, 'flag off: legacy recipes still visible');

  console.log('== recipe listing: flag ON exposes Cypher recipes ==');
  await setFlag(USER, 'evolution-crafting');
  const pageOn = await readFactoryPage(USER);
  const cypherRecipesOn = pageOn.recipes.filter((r) => r.id.startsWith('rcp-cypher-'));
  assert(cypherRecipesOn.length === 33, `flag on: 33 cypher recipes visible (got ${cypherRecipesOn.length})`);
  const legacyOn = pageOn.recipes.filter((r) => r.id === 'rcp-heal-small');
  assert(legacyOn.length === 1, 'flag on: legacy recipes still visible alongside cypher recipes');

  console.log('== recipe carries requires_items + inherit_rarity_from ==');
  const cypherRecipeRaw = await one<{ requires_items: string; inherit_rarity_from: string | null; unlock_condition: string | null }>(
    "SELECT requires_items, inherit_rarity_from, unlock_condition FROM farm_recipes WHERE id = ?",
    'rcp-cypher-fire-t1',
  );
  assert(cypherRecipeRaw !== null, 'rcp-cypher-fire-t1 seeded');
  assert(cypherRecipeRaw?.inherit_rarity_from === 'fragment', 'rcp-cypher-fire-t1 inherits from fragment');
  const parsedReq: unknown = cypherRecipeRaw ? JSON.parse(cypherRecipeRaw.requires_items) : null;
  assert(Array.isArray(parsedReq) && parsedReq.length === 1, 'requires_items parses as 1-entry array');
  if (Array.isArray(parsedReq) && parsedReq[0] && typeof parsedReq[0] === 'object') {
    const first = parsedReq[0] as { itemId?: unknown; qty?: unknown };
    assert(first.itemId === 'itm-shard-fire-r0', 'requires_items[0].itemId === itm-shard-fire-r0');
    assert(typeof first.qty === 'number' && first.qty >= 4, `requires_items[0].qty >= 4 (got ${first.qty})`);
  }
  const parsedCond: unknown = cypherRecipeRaw?.unlock_condition ? JSON.parse(cypherRecipeRaw.unlock_condition) : null;
  assert(parsedCond !== null && typeof parsedCond === 'object' && (parsedCond as { kind: string }).kind === 'flag', 'unlock_condition parses with kind=flag');
  assert((parsedCond as { flag: string }).flag === 'evolution-crafting', 'unlock_condition.flag === evolution-crafting');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== evolution-crafting-foundation smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
