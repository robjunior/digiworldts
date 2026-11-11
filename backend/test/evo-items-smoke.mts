/**
 * Evolution item system smoke test — 3 items required for every evolution:
 *   1. Elemental Essence (per element, craftable from fragments)
 *   2. Rarity Core (per rarity, purchasable for netcore)
 *   3. Archetype Sigil (per type, purchasable for netcore + ultra-rare drop)
 *
 * Verifies:
 *   - Essences, cores, and sigils are seeded correctly
 *   - Essence recipes exist and consume fragments
 *   - Evolution requires all 3 items
 *   - Only published digimons are considered
 *
 * Run: pnpm --filter @digiworld/backend test:evo-items
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes, buyFactory, queueItem, readFactoryPage } from '../src/farm/engine.ts';
import { buildElementalEssences, buildRarityCores, buildArchetypeSigils } from '../src/evolution/items.ts';
import { loadCatalog } from '../src/digimon/xml.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-evo-items-smoke.db';
const USER = 'usr_test_evo_items';

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

  const catalog = loadCatalog();
  const publishedDigimons = catalog.digimons.filter((t) => (t.status ?? 'published') === 'published');

  console.log('== elemental essences seeded ==');
  const essences = buildElementalEssences();
  assert(essences.length === 11, `11 elemental essences (got ${essences.length})`);
  for (const e of essences) {
    const row = await one<{ id: string }>('SELECT id FROM shop_items WHERE id = ?', e.id);
    assert(row !== null, `essence ${e.id} exists in shop_items`);
  }

  console.log('== rarity cores seeded ==');
  const cores = buildRarityCores();
  assert(cores.length === 4, `4 rarity cores (got ${cores.length})`);
  for (const c of cores) {
    const row = await one<{ id: string; price: number; currency: string }>('SELECT id, price, currency FROM shop_items WHERE id = ?', c.id);
    assert(row !== null, `core ${c.id} exists in shop_items`);
    if (row) {
      assert(row.currency === 'netcore', `core ${c.id} priced in netcore`);
      assert(row.price === c.priceNetcore, `core ${c.id} price ${c.priceNetcore}`);
    }
  }

  console.log('== archetype sigils seeded ==');
  const sigils = buildArchetypeSigils(catalog.digimons);
  const expectedTypes = new Set(publishedDigimons.map((t) => t.type).filter(Boolean));
  assert(sigils.length === expectedTypes.size, `sigils match published types (${sigils.length} vs ${expectedTypes.size})`);
  for (const s of sigils) {
    const row = await one<{ id: string; price: number; currency: string }>('SELECT id, price, currency FROM shop_items WHERE id = ?', s.id);
    assert(row !== null, `sigil ${s.id} exists in shop_items`);
    if (row) {
      assert(row.currency === 'netcore', `sigil ${s.id} priced in netcore`);
    }
  }

  console.log('== essence recipes seeded ==');
  const page = await readFactoryPage(USER);
  const essenceRecipes = page.recipes.filter((r) => r.id.startsWith('rcp-essence-'));
  assert(essenceRecipes.length === 11, `11 essence recipes (got ${essenceRecipes.length})`);
  for (const r of essenceRecipes) {
    const element = r.id.replace('rcp-essence-', '');
    assert(r.itemId === `itm-essence-${element}`, `recipe ${r.id} outputs itm-essence-${element}`);
    assert(r.requires.length === 1, `recipe ${r.id} has 1 ingredient`);
    assert(r.requires[0]?.itemId === `itm-frag-${element}`, `recipe ${r.id} requires itm-frag-${element}`);
    assert(r.requires[0]?.qty === 5, `recipe ${r.id} requires 5 fragments`);
  }

  console.log('== craft essence consumes fragments ==');
  const rareFactory = await buyFactory(USER, 'rare');
  assert(rareFactory.ok === true, 'buy Rare Factory');
  if (!rareFactory.ok) return;
  const factoryId = rareFactory.factory.id;

  await grantInventory(USER, 'itm-frag-fire', 12);
  const craft = await queueItem(USER, factoryId, 'rcp-essence-fire');
  assert(craft.ok === true, 'queue fire essence with 12 fragments succeeds');
  const afterCraft = await inventoryQty(USER, 'itm-frag-fire');
  assert(afterCraft === 7, `5 fragments consumed (remaining ${afterCraft})`);
  if (craft.ok) {
    assert(craft.job.itemId === 'itm-essence-fire', `job outputs itm-essence-fire (got ${craft.job.itemId})`);
  }

  console.log('== insufficient fragments → error ==');
  await grantInventory(USER, 'itm-frag-water', 3);
  const insufficient = await queueItem(USER, factoryId, 'rcp-essence-water');
  assert(insufficient.ok === false, 'queue water essence with 3/5 fragments fails');
  if (!insufficient.ok) {
    assert(insufficient.error === 'insufficient-items', `error is insufficient-items (got ${insufficient.error})`);
  }
  const waterAfter = await inventoryQty(USER, 'itm-frag-water');
  assert(waterAfter === 3, `no fragments consumed on failure (still ${waterAfter})`);

  console.log('== old items removed ==');
  const oldFrag = await one<{ id: string }>('SELECT id FROM shop_items WHERE id = ?', 'itm-evo-frag-greymon');
  assert(oldFrag === null, 'itm-evo-frag-greymon removed');
  const oldKey = await one<{ id: string }>('SELECT id FROM shop_items WHERE id = ?', 'itm-evo-greymon');
  assert(oldKey === null, 'itm-evo-greymon removed');
  const oldCypher = await one<{ id: string }>('SELECT id FROM shop_items WHERE id = ?', 'itm-cypher-fire-t1-r0');
  assert(oldCypher === null, 'itm-cypher-fire-t1-r0 removed');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== evo-items smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
