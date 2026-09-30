/**
 * Launch-roster prune smoke — seedLaunchRosterPrune() removes player-owned
 * digimons whose species is NOT on the active launch roster, leaves the ones on
 * it, and is idempotent.
 *
 * Run: DATABASE=sqlite DB_PATH=/tmp/dw-prune-roster.db CATALOG_XML=/tmp/dw-prune.xml \
 *        pnpm --filter @digiworld/backend test:prune-roster
 */
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { seedLaunchRosterPrune } from '../src/launch/roster-prune.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { q, run } from '../src/db/index.ts';
import { loadCatalog } from '../src/digimon/xml.ts';
import { rosterUniverse } from '../src/launch/roster.ts';

const DB_PATH = process.env.DB_PATH!;
const CATALOG_XML = process.env.CATALOG_XML!;
const SRC_CATALOG = new URL('../data/catalog/digimons.xml', import.meta.url).pathname;
if (!DB_PATH || !CATALOG_XML) {
  console.error('FAIL: set DB_PATH + CATALOG_XML env');
  process.exit(1);
}
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, CATALOG_XML]) {
  if (existsSync(f)) unlinkSync(f);
}
copyFileSync(SRC_CATALOG, CATALOG_XML);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

await getDb();
const catalog = loadCatalog();
const universe = rosterUniverse();
const index = new Map(catalog.digimons.map((t) => [t.name, t]));
const rosterIds = [...universe.keys()].map((n) => index.get(n)!).map((t) => t.id);
const rosterIdSet = new Set(rosterIds);

// A roster species + a non-roster spec (drafted Ultimate/Mega).
const onRoster = rosterIds[0]!;
let offRoster = catalog.digimons.find((t) =>
  !rosterIdSet.has(t.id) && (t.stage === 'Ultimate' || t.stage === 'Mega') && (t.status ?? 'published') === 'draft');
if (!offRoster) {
  offRoster = catalog.digimons.find((t) => !rosterIdSet.has(t.id))!;
}
const offId = offRoster.id;
check('found an off-roster species to prune', onRoster !== offId, `on=${onRoster} off=${offId}`);

// Seed two players each with one on-roster + one off-roster digimon.
const now = Date.now();
await run(`INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at)
  VALUES ('u-a', 'alice', 'Alice', 'x', ${now}, ${now})`);
await run(`INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at)
  VALUES ('u-b', 'bob', 'Bob', 'x', ${now}, ${now})`);
await run(`INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, created_at, updated_at)
  VALUES ('r-a-on', 'u-a', '${onRoster}', 'A-on', 5, 0, ${now}, ${now})`);
await run(`INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, created_at, updated_at)
  VALUES ('r-a-off', 'u-a', '${offId}', 'A-off', 5, 0, ${now}, ${now})`);
await run(`INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, created_at, updated_at)
  VALUES ('r-b-on', 'u-b', '${onRoster}', 'B-on', 5, 0, ${now}, ${now})`);
await run(`INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, created_at, updated_at)
  VALUES ('r-b-off', 'u-b', '${offId}', 'B-off', 5, 0, ${now}, ${now})`);

const before = await q<{ n: number }>('SELECT COUNT(*) AS n FROM player_roster');
check('4 player digimons before prune', (before[0]?.n ?? 0) === 4, `got ${before[0]?.n}`);

const s1 = await seedLaunchRosterPrune();
check('prune deleted exactly the off-roster digimons', s1.deleted === 2, `deleted=${s1.deleted}`);
check('roster ids resolved', s1.rosterIds === rosterIdSet.size, `rosterIds=${s1.rosterIds} vs ${rosterIdSet.size}`);
check('kept count accounts for survivors', s1.kept === 2, `kept=${s1.kept}`);

const after = await q<{ id: string }>('SELECT id FROM player_roster ORDER BY id');
const afterIds = after.map((r) => r.id);
check('on-roster digimons survive', afterIds.includes('r-a-on') && afterIds.includes('r-b-on'), afterIds.join(', '));
check('off-roster digimons removed', !afterIds.includes('r-a-off') && !afterIds.includes('r-b-off'));

const s2 = await seedLaunchRosterPrune();
check('idempotent — second prune deletes nothing', s2.deleted === 0, `deleted=${s2.deleted}`);

await closeDbAdapter();
console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);