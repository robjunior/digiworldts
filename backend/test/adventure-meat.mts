/**
 * Adventure system regression test — progressive meat cost, multiple
 * concurrent teams, and found-digimon data in reports + Digidex.
 *
 * Verifies:
 *   - readAdventurePage surfaces meatOwned, the progressive meat config
 *     (meatEscalationPerHour, maxActive) and all active adventures
 *   - meatCostForHours: 1h=10, 2h=25, 3h=45, 8h=220 (escalating, not linear)
 *   - startAdventure deducts the progressive cost atomically and records it
 *     in meat_spent
 *   - up to ADVENTURE_MAX_ACTIVE teams run concurrently (per-slot UNIQUE);
 *     the 4th start is blocked with 'active-adventures-limit'
 *   - collectAdventure by id works; report carries foundDigimons (real
 *     catalog species with stage/element/count) and registers each species
 *     in player_species_data (Digidex)
 *   - itm-provision inventory is NOT touched anymore
 *   - insufficient Meat → 'insufficient-meat', zero deduction, no row
 *
 * Run: pnpm --filter @digiworld/backend test:adventure-meat
 */
import { existsSync, unlinkSync } from 'node:fs';

import { closeDb, one, run } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import {
  ADVENTURE_MAX_ACTIVE,
  collectAdventure,
  meatCostForHours,
  readAdventurePage,
  startAdventure,
} from '../src/adventure/engine.ts';
import { loadCatalog } from '../src/digimon/xml.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-adventure-meat.db';
const USER = 'usr_adv_meat';
const USER_SHORT = 'usr_adv_meat_short';
const USER_WITH_PROVISIONS = 'usr_adv_meat_prov';
const MON_COUNT = 9;

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

async function seedUser(id: string, meat: number): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, `${id}-name`, `${id}-display`, 'x', 0, now, now,
  );
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Meat', meat, now);
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Bits', 100, now);
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Data', 100, now);
  for (let i = 1; i <= MON_COUNT; i++) {
    await run(
      'INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      `${id}-mon${i}`, id, 'skb-317', `Mon${i}`, 5, now, now,
    );
  }
}

function monIds(id: string, from: number, to: number): string[] {
  const ids: string[] = [];
  for (let i = from; i <= to; i++) ids.push(`${id}-mon${i}`);
  return ids;
}

async function grantProvisionItem(userId: string, qty: number): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at",
    userId, 'itm-provision', qty, now,
  );
}

async function meatOf(userId: string): Promise<number> {
  const row = await one<{ amount: number }>('SELECT amount FROM resources WHERE user_id = ? AND resource = ?', userId, 'Meat');
  return row?.amount ?? 0;
}

async function inventoryQty(userId: string, itemId: string): Promise<number> {
  const row = await one<{ qty: number }>('SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?', userId, itemId);
  return row?.qty ?? 0;
}

async function activeCount(userId: string): Promise<number> {
  const rows = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM adventures WHERE user_id = ? AND collected_at IS NULL', userId,
  );
  return rows?.n ?? 0;
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();
  await seedShopItems();
  await seedUser(USER, 100);
  await seedUser(USER_SHORT, 5);
  await seedUser(USER_WITH_PROVISIONS, 100);
  await grantProvisionItem(USER_WITH_PROVISIONS, 3);

  console.log('== progressive meat cost curve ==');
  assert(meatCostForHours(1) === 10, 'meatCostForHours(1) === 10');
  assert(meatCostForHours(2) === 25, 'meatCostForHours(2) === 25');
  assert(meatCostForHours(3) === 45, 'meatCostForHours(3) === 45');
  assert(meatCostForHours(8) === 220, 'meatCostForHours(8) === 220');
  assert(ADVENTURE_MAX_ACTIVE === 3, 'ADVENTURE_MAX_ACTIVE === 3');

  console.log('== page view surfaces config + meat ==');
  const page = await readAdventurePage(USER);
  assert(page.meatOwned === 100, `meatOwned === 100 (got ${page.meatOwned})`);
  assert(page.config.meatPerHour === 10, 'config.meatPerHour === 10');
  assert(page.config.meatEscalationPerHour === 5, 'config.meatEscalationPerHour === 5');
  assert(page.config.encountersPerHour === 3, 'config.encountersPerHour === 3');
  assert(page.config.maxActive === 3, 'config.maxActive === 3');
  assert(page.active.length === 0 && page.lastCollected === null, 'no adventures yet');

  console.log('== start deducts progressive Meat atomically ==');
  const started = await startAdventure(USER, monIds(USER, 1, 3), 2);
  assert(started.ok === true, 'start 2h expedition');
  if (started.ok) {
    assert(started.meatOwned === 75, `meatOwned after 2h start === 75 (got ${started.meatOwned})`);
    assert(started.adventure.meatSpent === 25, `adventure.meatSpent === 25 (got ${started.adventure.meatSpent})`);
    assert(started.adventure.slot === 0, 'first team takes slot 0');
  }
  assert((await meatOf(USER)) === 75, 'resources Meat row dropped to 75');

  const advRow = await one<{ meat_spent: number; mon_ids: string; slot: number }>(
    'SELECT meat_spent, mon_ids, slot FROM adventures WHERE user_id = ? AND collected_at IS NULL ORDER BY started_at LIMIT 1', USER,
  );
  assert(advRow !== null, 'adventure row persisted');
  if (advRow) {
    assert(advRow.meat_spent === 25, `persisted meat_spent === 25 (got ${advRow.meat_spent})`);
    assert(advRow.slot === 0, 'persisted slot === 0');
  }

  console.log('== multiple concurrent teams (was: one active) ==');
  const team2 = await startAdventure(USER, monIds(USER, 4, 6), 1);
  assert(team2.ok === true, 'second concurrent start allowed');
  if (team2.ok) {
    assert(team2.meatOwned === 65, `meatOwned after second start === 65 (got ${team2.meatOwned})`);
    assert(team2.adventure.slot === 1, 'second team takes slot 1');
  }
  const team3 = await startAdventure(USER, monIds(USER, 7, 9), 1);
  assert(team3.ok === true, 'third concurrent start allowed');
  if (team3.ok) {
    assert(team3.meatOwned === 55, `meatOwned after third start === 55 (got ${team3.meatOwned})`);
    assert(team3.adventure.slot === 2, 'third team takes slot 2');
  }
  assert((await activeCount(USER)) === 3, 'three active rows');

  const blocked = await startAdventure(USER, monIds(USER, 1, 3), 1);
  assert(blocked.ok === false && blocked.error === 'active-adventures-limit', '4th start blocked (active-adventures-limit)');
  if (!blocked.ok) {
    assert(blocked.details?.maxActive === 3, 'details.maxActive === 3');
  }
  assert((await activeCount(USER)) === 3, 'still exactly three active rows after blocked start');
  assert((await meatOf(USER)) === 55, 'meat unchanged after blocked start (55)');

  const page2 = await readAdventurePage(USER);
  assert(page2.active.length === 3, 'readAdventurePage surfaces all 3 active teams');
  assert(page2.active.every((a) => [0, 1, 2].includes(a.slot)), 'active teams carry slots 0..2');

  console.log('== provisions item is NOT consumed anymore ==');
  const provStarted = await startAdventure(
    USER_WITH_PROVISIONS, monIds(USER_WITH_PROVISIONS, 1, 3), 1,
  );
  assert(provStarted.ok === true, 'start 1h expedition with 100 meat + 3 provisions');
  assert((await inventoryQty(USER_WITH_PROVISIONS, 'itm-provision')) === 3, `itm-provision untouched (still 3, got ${await inventoryQty(USER_WITH_PROVISIONS, 'itm-provision')})`);
  assert((await meatOf(USER_WITH_PROVISIONS)) === 90, 'meat dropped by exactly 10 instead');

  console.log('== insufficient meat → 402-style error, no deduction ==');
  const short = await startAdventure(USER_SHORT, monIds(USER_SHORT, 1, 3), 1);
  assert(short.ok === false, 'short user cannot start');
  if (!short.ok) {
    assert(short.error === 'insufficient-meat', `error === 'insufficient-meat' (got ${short.error})`);
    assert(short.details?.need === 10 && short.details?.have === 5, 'details { need: 10, have: 5 }');
  }
  assert((await meatOf(USER_SHORT)) === 5, 'short user meat unchanged (5)');
  const shortRows = await one<{ id: string }>('SELECT id FROM adventures WHERE user_id = ?', USER_SHORT);
  assert(shortRows === null, 'no adventure row created on insufficient meat');

  console.log('== collect banks loot + found digimons + digidex registration ==');
  await run('UPDATE adventures SET started_at = started_at - distance_ms WHERE user_id = ?', USER);
  const catalog = loadCatalog();
  const team1Collected = await collectAdventure(USER);
  assert(team1Collected.ok === true, 'collect first (oldest) team without id');
  if (team1Collected.ok) {
    const report = team1Collected.adventure.report;
    assert(report !== null, 'report attached');
    if (report) {
      assert(report.totals.meat >= 0, `meat reward is >= 0 (got ${report.totals.meat})`);
      assert((await meatOf(USER)) === 55 + report.totals.meat, `meat = 55 + reward (got ${await meatOf(USER)})`);
      assert(report.encounters.length > 0, 'encounters rolled');
      assert(report.foundDigimons.length > 0, 'report lists found digimons');
      const sumCounts = report.foundDigimons.reduce((acc, f) => acc + f.count, 0);
      assert(sumCounts === report.encounters.length, 'found counts sum to encounter count');
      for (const e of report.encounters) {
        const tpl = catalog.digimons.find((d) => d.id === e.wildCatalogId);
        assert(tpl !== undefined, `encounter ${e.index} wild species in catalog (${e.wildCatalogId})`);
        if (tpl) {
          assert(e.wildName === tpl.name && e.wildStage === tpl.stage && e.wildElement === tpl.element,
            `encounter ${e.index} carries species data (${tpl.name} / ${tpl.stage} / ${tpl.element})`);
        }
      }
      const nothingFound = report.foundDigimons.every((f) => f.catalogId === 'wild-unknown');
      assert(!nothingFound, 'at least one real catalog species found (no empty-catalog fallback)');
    }
    assert((await activeCount(USER)) === 2, 'two teams still active after first collect');
  }

  const species = await one<{ n: number; minKills: number }>(
    'SELECT COUNT(*) AS n, MIN(kills) AS minKills FROM player_species_data WHERE user_id = ?', USER,
  );
  assert(species !== null && species.n >= 1, `digidex registered found species (n=${species?.n})`);
  assert(species !== null && species.minKills >= 1, 'every registered species has >= 1 kill');

  const team2Id = (await one<{ id: string }>(
    'SELECT id FROM adventures WHERE user_id = ? AND collected_at IS NULL ORDER BY started_at LIMIT 1', USER,
  ))?.id;
  assert(team2Id !== undefined, 'team 2 still active with an id');
  if (team2Id) {
    const c2 = await collectAdventure(USER, team2Id);
    assert(c2.ok === true, 'collect team 2 by id');
    assert((await activeCount(USER)) === 1, 'one team left after second collect');
  }
  const team3Id = (await one<{ id: string }>(
    'SELECT id FROM adventures WHERE user_id = ? AND collected_at IS NULL ORDER BY started_at LIMIT 1', USER,
  ))?.id;
  assert(team3Id !== undefined, 'team 3 still active with an id');
  if (team3Id) {
    const c3 = await collectAdventure(USER, team3Id);
    assert(c3.ok === true, 'collect team 3 by id');
    assert((await activeCount(USER)) === 0, 'no active teams after all collects');
  }

  const gone = await one<{ id: string }>('SELECT id FROM adventures WHERE user_id = ? AND collected_at IS NULL', USER);
  assert(gone === null, 'no active adventure after all collects');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== adventure-meat smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});