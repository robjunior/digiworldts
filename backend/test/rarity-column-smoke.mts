/**
 * Rarity column smoke test — F1 of the dungeon extraction refactor
 * (see .omo/plans/dungeon-crawler-extraction.md).
 *
 * Locks in that:
 *   - migration 052_shop_items_rarity.sql lands in schema_versions
 *   - shop_items.rarity column exists with DEFAULT 0
 *   - existing rows backfill to rarity=0 (common)
 *   - admin CRUD round-trips rarity strings via the ShopItem enum
 *   - invalid rarity strings are rejected by the validator
 *
 * Run: pnpm --filter @digiworld/backend test:rarity
 *   (requires DB_PATH pointing at a scratch file, e.g. /tmp/dw-rarity-smoke.db)
 */
import { unlinkSync, existsSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { createShopItem, updateShopItem, getShopItem } from '../src/admin/shop.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-rarity-smoke.db';

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

  console.log('== migration ledger ==');
  const migRow = await one<{ version: string }>(
    "SELECT version FROM schema_versions WHERE version = '052_shop_items_rarity'",
  );
  assert(migRow !== null, 'migration 052_shop_items_rarity recorded in schema_versions');

  console.log('== shop_items.rarity column ==');
  const cols = await q<{ name: string; type: string; dflt_value: string | null; notnull: number }>(
    'PRAGMA table_info(shop_items)',
  );
  const rarityCol = cols.find((c) => c.name === 'rarity');
  assert(rarityCol !== undefined, 'shop_items has rarity column');
  assert(rarityCol?.type.toUpperCase() === 'INTEGER', 'rarity column is INTEGER');
  assert(rarityCol?.notnull === 1, 'rarity column is NOT NULL');
  assert(rarityCol?.dflt_value === '0', 'rarity column DEFAULT 0');

  console.log('== backfill on pre-existing seeded item ==');
  await run(
    "INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, is_quest_item, rarity, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    'itm-smoke-legacy',
    'Legacy Item',
    'seeded before rarity input',
    100,
    100,
    'credits',
    'misc',
    0,
    0,
    0,
    0,
    'consumable',
    'item',
    '{}',
    1,
    0,
    0,
    Date.now(),
  );
  const legacy = await one<{ rarity: number }>(
    "SELECT rarity FROM shop_items WHERE id = 'itm-smoke-legacy'",
  );
  assert(legacy?.rarity === 0, 'legacy row rarity = 0 (common)');

  console.log('== admin.createShopItem accepts rarity ==');
  const created = await createShopItem({
    name: 'Smoke Epic Item',
    description: 'crafted via admin CRUD',
    price: 200,
    currency: 'credits',
    shopCategory: 'misc',
    featured: false,
    quickOffer: false,
    oneTime: false,
    sortOrder: 0,
    kind: 'consumable',
    class: 'item',
    payload: {},
    enabled: true,
    rarity: 'epic',
  });
  assert(created.ok === true, 'createShopItem returned ok');
  assert(created.ok && created.item.rarity === 'epic', 'created view.rarity === "epic"');

  const createdId = created.ok ? created.item.id : '';
  const raw = await one<{ rarity: number }>(
    'SELECT rarity FROM shop_items WHERE id = ?',
    createdId,
  );
  assert(raw?.rarity === 3, 'DB row.rarity === 3 (epic rank)');

  console.log('== admin.updateShopItem promotes rarity ==');
  const updated = await updateShopItem(createdId, {
    name: 'Smoke Epic Item',
    description: 'crafted via admin CRUD',
    price: 200,
    currency: 'credits',
    shopCategory: 'misc',
    featured: false,
    quickOffer: false,
    oneTime: false,
    sortOrder: 0,
    kind: 'consumable',
    class: 'item',
    payload: {},
    enabled: true,
    rarity: 'legendary',
  });
  assert(updated.ok && updated.item.rarity === 'legendary', 'update -> rarity === "legendary"');

  const rawUpdated = await one<{ rarity: number }>(
    'SELECT rarity FROM shop_items WHERE id = ?',
    createdId,
  );
  assert(rawUpdated?.rarity === 4, 'DB row.rarity === 4 (legendary rank)');

  console.log('== admin.updateShopItem preserves rarity when omitted ==');
  const preserved = await updateShopItem(createdId, {
    name: 'Smoke Epic Item',
    description: 'crafted via admin CRUD',
    price: 200,
    currency: 'credits',
    shopCategory: 'misc',
    featured: false,
    quickOffer: false,
    oneTime: false,
    sortOrder: 0,
    kind: 'consumable',
    class: 'item',
    payload: {},
    enabled: true,
  });
  assert(
    preserved.ok && preserved.item.rarity === 'legendary',
    'omitting rarity preserves prior value (legendary)',
  );

  console.log('== admin.createShopItem defaults to common when omitted ==');
  const defaulted = await createShopItem({
    name: 'Smoke Common Item',
    description: 'no rarity supplied',
    price: 50,
    currency: 'credits',
    shopCategory: 'misc',
    featured: false,
    quickOffer: false,
    oneTime: false,
    sortOrder: 0,
    kind: 'consumable',
    class: 'item',
    payload: {},
    enabled: true,
  });
  assert(defaulted.ok && defaulted.item.rarity === 'common', 'default rarity === "common"');

  console.log('== admin.createShopItem rejects invalid rarity ==');
  const invalid = await createShopItem({
    name: 'Smoke Bad Item',
    description: 'bogus rarity string',
    price: 50,
    currency: 'credits',
    shopCategory: 'misc',
    featured: false,
    quickOffer: false,
    oneTime: false,
    sortOrder: 0,
    kind: 'consumable',
    class: 'item',
    payload: {},
    enabled: true,
    // deliberately-invalid string to prove the validator rejects it
    rarity: 'mythic' as never,
  });
  assert(invalid.ok === false, 'invalid rarity is rejected');
  assert(!invalid.ok && invalid.error === 'invalid-rarity', 'error code === invalid-rarity');

  console.log('== getShopItem round-trips rarity string ==');
  const fetched = await getShopItem(createdId);
  assert(fetched !== null, 'getShopItem returned a view');
  assert(fetched?.rarity === 'legendary', 'getShopItem view.rarity === "legendary"');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== rarity-column smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
