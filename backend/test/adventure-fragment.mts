/**
 * Adventure evolution-fragment drop test.
 *
 * Verifies the per-species loot hook end-to-end:
 *   - a winning wild encounter rolls its catalog_loot_entries and grants the item;
 *   - drops are recorded per-encounter and aggregated in the report (itemDrops);
 *   - grant is atomic inside the collect tx and lands in player_inventory.
 *
 * Deterministic setup: a scratch catalog with a SINGLE published Champion ('FragChamp')
 * so every wild encounter is that species, plus a catalog_loot_entries row with
 * drop_pct=100 → exactly one fragment per winning encounter.
 *
 * Run: pnpm --filter @digiworld/backend test:adventure-fragment
 */
import { existsSync, unlinkSync } from 'node:fs';

import { closeDb, one, q, run } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { collectAdventure, startAdventure } from '../src/adventure/engine.ts';
import { saveCatalog, type Catalog, type TemplateDigimon } from '../src/digimon/xml.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-adventure-fragment.db';
const CATALOG_XML = process.env.CATALOG_XML ?? '/tmp/dw-adventure-fragment-catalog.xml';
for (const suffix of ['', '-wal', '-shm']) if (existsSync(DB_PATH + suffix)) unlinkSync(DB_PATH + suffix);
if (existsSync(CATALOG_XML)) unlinkSync(CATALOG_XML);
process.env.DB_PATH = DB_PATH;
process.env.CATALOG_XML = CATALOG_XML;

const USER = 'usr_frag';
const CHAMP_ID = 'mon-frag-champ';
const FRAG = 'itm-evo-frag-fragchamp';
const FRAG_NAME = 'FragChamp Evolution Fragment';

const champ: TemplateDigimon = {
  id: CHAMP_ID,
  name: 'FragChamp',
  stage: 'Champion',
  attribute: 'Vaccine',
  element: 'fire',
  baseStats: { hp: 900, en: 40, atk: 160, def: 120, int: 130, spd: 140 },
  skillPool: [{ id: 's0', name: 'Fire Blast', element: 'fire', energyCost: 10, power: 200 }],
  assets: { portrait: '/test/champ/portrait.webp', dot: '/test/champ/dot.gif' },
};
const catalog: Catalog = { version: '1', updatedAt: Date.now(), digimons: [champ] };
saveCatalog(catalog);

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; console.error(`  FAIL  ${msg}`); }
}

async function inventoryQty(itemId: string): Promise<number> {
  const row = await one<{ qty: number }>('SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', USER, itemId);
  return row?.qty ?? 0;
}

async function main(): Promise<void> {
  await getDb();
  const now = Date.now();

  // User + resources + a 3-mon party (the wild is the party's only possible foe).
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    USER, `${USER}-name`, `${USER}-display`, 'x', 0, now, now,
  );
  for (const [res, amt] of [['Meat', 100000], ['Bits', 100000], ['Data', 100000]] as const) {
    await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', USER, res, amt, now);
  }
  for (let i = 1; i <= 3; i++) {
    await run(
      'INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `${USER}-mon${i}`, USER, CHAMP_ID, `Mon${i}`, 40, now, now,
    );
  }

  // The drop-only fragment shop item (FK target for inventory + loot).
  await run(
    "INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at) VALUES (?, ?, ?, 0, 'evolve', 'item', '{}', 0, ?)",
    FRAG, FRAG_NAME, 'A fragment of FragChamp.', now,
  );

  // Per-species drop table: 100% so every win deterministically drops one fragment.
  await run(
    'INSERT INTO catalog_loot_entries (id, catalog_id, item_id, drop_pct, qty_min, qty_max, updated_at) VALUES (?, ?, ?, 100, 1, 1, ?)',
    `cle-frag-${CHAMP_ID}-${FRAG}`, CHAMP_ID, FRAG, now,
  );

  console.log('== start a long expedition (every wild is FragChamp) ==');
  const started = await startAdventure(USER, [`${USER}-mon1`, `${USER}-mon2`, `${USER}-mon3`], 8);
  assert(started.ok === true, 'start 8h adventure');
  if (!started.ok) return;

  // Force readiness then collect.
  await run('UPDATE adventures SET started_at = started_at - distance_ms WHERE user_id = ?', USER);
  const collected = await collectAdventure(USER);
  assert(collected.ok === true, 'collect adventure');
  if (!collected.ok) return;
  const report = collected.adventure.report;
  assert(report !== null, 'report attached');
  if (!report) return;

  const wins = report.encounters.filter((e) => e.outcome === 'win').length;
  const losses = report.encounters.length - wins;
  console.log(`== ${report.encounters.length} encounters (${wins} wins, ${losses} losses) ==`);
  assert(report.encounters.length > 0, 'encounters rolled');

  // Every winning encounter (all FragChamp, 100% drop) yields exactly one fragment;
  // losses yield none.
  const totalDropped = report.encounters.reduce((acc, e) => acc + e.drops.reduce((s, d) => s + d.qty, 0), 0);
  assert(totalDropped === wins, `per-encounter drops sum to wins (${totalDropped} === ${wins})`);
  const onWinAllFrag = report.encounters
    .filter((e) => e.outcome === 'win')
    .every((e) => e.drops.length === 1 && e.drops[0]!.itemId === FRAG);
  assert(onWinAllFrag, 'every win dropped exactly the fragment');
  const lossNoDrop = report.encounters.filter((e) => e.outcome === 'loss').every((e) => e.drops.length === 0);
  assert(lossNoDrop, 'no drops on losses');

  // Report aggregates + resolves the item name.
  assert(report.itemDrops.length === 1, `one aggregate item in report (${report.itemDrops.length})`);
  const agg = report.itemDrops[0];
  assert(agg?.itemId === FRAG && agg.qty === wins, `aggregate qty === wins (${agg?.qty} === ${wins})`);
  assert(agg?.itemName === FRAG_NAME, `aggregate item name resolved (${agg?.itemName})`);

  // Inventory was granted atomically during collect.
  const inv = await inventoryQty(FRAG);
  assert(inv === wins, `inventory holds exactly the dropped fragments (${inv} === ${wins})`);

  await closeDb();
  await closeDbAdapter();
  if (existsSync(CATALOG_XML)) unlinkSync(CATALOG_XML);

  console.log('');
  console.log(`== adventure-fragment smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});