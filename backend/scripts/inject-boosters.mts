/**
 * Minimal content-bundle injection for the Starter Evolution booster packs.
 *
 * Replaces ONLY the three booster tables (regenerated from seeds/boosters like
 * extract-local does) and appends the six new itm-evo-* shop_items rows to the
 * committed shop_items table (the bundle's shop_items was exported from the dev
 * DB before these items existed). Every OTHER table must remain byte-identical
 * to the committed bundle — this script asserts that before writing.
 *
 * Run: npx tsx backend/scripts/inject-boosters.mts   (from repo root)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBoosterTables, DEFAULT_SEEDS_DIR } from '../src/boosters/pipeline.ts';
import { parseCatalogXml } from '../src/digimon/xml.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..'); // backend/scripts/ → repo root
const BUNDLE_PATH = resolve(ROOT, 'content', 'content-bundle.json');

const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));
const tables = bundle.tables;

// --- 1. Snapshot every table we must NOT touch ---
const TOUCHED = new Set(['boosters', 'booster_digimon_nodes', 'booster_item_entries', 'shop_items']);
const untouchedJson = JSON.stringify(
  Object.fromEntries(Object.entries(tables).filter(([name]) => !TOUCHED.has(name))),
);

// --- 2. Append the 6 new evolution-key items to shop_items (mirror of the
//    canonical seeds in backend/src/social/shop.ts SEED_ITEMS) ---
const NOW = Date.now();
interface BundleItemRow {
  id: string; name: string; description: string; price_credits: number;
  kind: string; class: string; payload: string; enabled: number; created_at: number;
  is_quest_item: number; currency: string; price: number; shop_category: string;
  featured: number; quick_offer: number; one_time: number; sort_order: number;
  rarity: number; item_type: string; kit_class: null; kit_max_qty: null; drop_pool: string | null;
}
const evolutionKey = (id: string, name: string, description: string, target: string, sortOrder: number): BundleItemRow => ({
  id, name, description, price_credits: 2500, kind: 'evolve', class: 'item',
  payload: JSON.stringify({ evolution_key: name.split(' ')[0]!.toLowerCase().replace('’', ''), target }),
  enabled: 1, created_at: NOW, is_quest_item: 0, currency: 'credits', price: 2500,
  shop_category: 'evolve', featured: 0, quick_offer: 0, one_time: 0, sort_order: sortOrder,
  rarity: 1, item_type: 'evolution_key', kit_class: null, kit_max_qty: null, drop_pool: 'booster-items',
});
const newItems: BundleItemRow[] = [
  evolutionKey('itm-evo-greymon', 'Greymon Evolution Key', 'A fire-forged key that unlocks Agumon’s evolution into Greymon. Consumed on evolution. Available in the Courage Ignition booster pack.', 'skb-326', 300),
  evolutionKey('itm-evo-tyrannomon', 'Tyrannomon Evolution Key', 'A feral key that unlocks Agumon’s evolution into Tyrannomon. Consumed on evolution. Available in the Courage Ignition booster pack.', 'skb-363', 301),
  evolutionKey('itm-evo-garurumon', 'Garurumon Evolution Key', 'A howling key that unlocks Gabumon’s evolution into Garurumon. Consumed on evolution. Available in the Feral Howl booster pack.', 'skb-12', 302),
  evolutionKey('itm-evo-kyubimon', 'Kyubimon Evolution Key', 'A mystical key that unlocks Gabumon’s evolution into Kyubimon. Consumed on evolution. Available in the Feral Howl booster pack.', 'skb-395', 303),
  evolutionKey('itm-evo-angemon', 'Angemon Evolution Key', 'A radiant key that unlocks Patamon’s evolution into Angemon. Consumed on evolution. Available in the Wings of Hope booster pack.', 'skb-87', 304),
  evolutionKey('itm-evo-devimon', 'Devimon Evolution Key', 'A dark key that unlocks Patamon’s evolution into Devimon. Consumed on evolution. Available in the Wings of Hope booster pack.', 'skb-93', 305),
];

const shopItems = tables.shop_items as BundleItemRow[];
const existingIds = new Set(shopItems.map((r) => r.id));
const toAdd = newItems.filter((r) => !existingIds.has(r.id));
if (toAdd.length > 0) {
  shopItems.push(...toAdd);
  shopItems.sort((a, b) => a.id.localeCompare(b.id)); // bundle is ordered by id
  tables.shop_items = shopItems;
  console.log(`shop_items: added ${toAdd.length} new rows (${toAdd.map((r) => r.id).join(', ')})`);
} else {
  console.log('shop_items: all evolution-key items already present');
}

// --- 3. Regenerate the booster tables from seeds, validated against the
//        bundle's own shop_items ids (exactly what extract-local does) ---
const catalogXml = readFileSync(resolve(ROOT, 'backend', 'data', 'catalog', 'digimons.xml'), 'utf8');
const catalog = parseCatalogXml(catalogXml);
const itemIds = (tables.shop_items ?? []).map((r: Record<string, unknown>) => String(r['id']));
const out = await buildBoosterTables({ seedsDir: DEFAULT_SEEDS_DIR, catalog, itemIds, failOnInvalid: true });

tables['boosters'] = out.boosters;
tables['booster_digimon_nodes'] = out.booster_digimon_nodes;
tables['booster_item_entries'] = out.booster_item_entries;
console.log(`boosters: injected ${out.boosters.length} (${out.boosters.map((b) => b.code).join(', ')}) — ${out.booster_digimon_nodes.length} nodes, ${out.booster_item_entries.length} item entries`);

// --- 4. Assert untouched tables are byte-identical ---
const untouchedAfterJson = JSON.stringify(
  Object.fromEntries(Object.entries(tables).filter(([name]) => !TOUCHED.has(name))),
);
if (untouchedAfterJson !== untouchedJson) {
  throw new Error('a non-booster, non-shop_items table changed unexpectedly — aborting');
}

writeFileSync(BUNDLE_PATH, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
console.log(`bundle written: ${BUNDLE_PATH}`);