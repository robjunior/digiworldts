/**
 * Shop publish smoke test — verifies the create → publish flow that was
 * returning HTTP 400 / silently failing before the fix.
 *
 * Locks in that:
 *   - createShopItem accepts the `priceCredits` field the admin form actually
 *     sends (no `price`), instead of 400-ing on invalid-price
 *   - createShopItem tolerates a missing `currency` / `shopCategory` (the admin
 *     form omits both) and defaults them instead of 400-ing
 *   - a freshly created item defaults to status = 'draft'
 *   - publishShopItem (via admin route: updateShopItem with status:'published')
 *     actually persists status = 'published' to the DB row
 *
 * Run: pnpm --filter @digiworld/backend test:shop-publish
 *   (requires DB_PATH pointing at a scratch file, e.g. /tmp/dw-shop-publish.db)
 */
import { unlinkSync, existsSync } from 'node:fs';

import { one, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { createShopItem, updateShopItem, getShopItem } from '../src/admin/shop.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-shop-publish.db';

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

  console.log('== create accepts priceCredits (what the admin form sends) ==');
  const created = await createShopItem({
    name: 'Smoke Publish Item',
    description: 'created via admin CRUD with priceCredits, no price',
    priceCredits: 150,
    kind: 'consumable',
    class: 'item',
    payload: {},
    enabled: true,
  });
  assert(created.ok === true, 'createShopItem returned ok (no 400 on priceCredits)');
  const createdId = created.ok ? created.item.id : '';
  assert(created.ok && created.item.price === 150, 'created view.price === 150 (from priceCredits)');

  console.log('== defaults applied for omitted currency / shopCategory / status ==');
  const rawRow = await one<{ currency: string; shop_category: string; status: string }>(
    'SELECT currency, shop_category, status FROM shop_items WHERE id = ?',
    createdId,
  );
  assert(rawRow?.currency === 'credits', 'missing currency defaulted to credits');
  assert(rawRow?.shop_category === 'misc', 'missing shopCategory defaulted to misc');
  assert(rawRow?.status === 'draft', 'new item defaults to status = draft');
  assert(created.ok && created.item.status === 'draft', 'created view.status === draft');

  console.log('== publish persists status = published ==');
  const draftView = await getShopItem(createdId);
  assert(draftView !== null, 'getShopItem returned the draft');
  // This mirrors admin route /publish: updateShopItem(id, {...item, status:'published'})
  const published = await updateShopItem(createdId, {
    ...(draftView as NonNullable<typeof draftView>),
    status: 'published',
  });
  assert(published.ok === true, 'publish returned ok');
  assert(published.ok && published.item.status === 'published', 'published view.status === published');

  const publishedRow = await one<{ status: string }>(
    'SELECT status FROM shop_items WHERE id = ?',
    createdId,
  );
  assert(publishedRow?.status === 'published', 'DB row.status === published (persisted)');

  console.log('== getShopItem round-trips published status ==');
  const fetched = await getShopItem(createdId);
  assert(fetched?.status === 'published', 'getShopItem view.status === published');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== shop-publish smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
