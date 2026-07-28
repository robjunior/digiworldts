/**
 * P4d backfill smoke test.
 *
 * Boots SqliteAdapter with a scratch DB, seeds catalog skills, inserts a
 * user + several player_roster rows with equipped_skill_ids = NULL (varied
 * catalog_ids covering different elements/stages), runs the backfill, and
 * verifies:
 *   - Every NULL row gets populated with the expected getDefaultEquippedForStage JSON
 *   - Idempotency — rerunning finds 0 rows to update
 *   - Templates missing from catalog get skippedTemplateMissing incremented
 *
 * Run: DB_PATH=/tmp/dw-backfill-smoke.db pnpm --filter @digiworld/backend test:backfill
 */
import { existsSync, unlinkSync } from 'node:fs';
import { seedSkillsCatalogV2 } from '../src/skills/seed-catalog.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { one, run } from '../src/db/index.ts';
import { loadCatalog } from '../src/digimon/xml.ts';
import { getDefaultEquippedForStage } from '../src/skills/pool.ts';
import { backfillEquippedDefaults } from '../src/db/data-migrations/populate-equipped-defaults.ts';

const DB_PATH = process.env.DB_PATH!;
if (!DB_PATH) {
  console.error('FAIL: set DB_PATH env (e.g. /tmp/dw-backfill-smoke.db)');
  process.exit(1);
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

await getDb();
const seed = await seedSkillsCatalogV2();
if (seed.validationErrors.length > 0) {
  console.error(`FAIL: seed had ${seed.validationErrors.length} validation errors`);
  process.exit(1);
}

const catalog = loadCatalog();
if (catalog.digimons.length === 0) {
  console.error('FAIL: XML catalog is empty — cannot pick test templates. Run pnpm scrape --enrich first.');
  process.exit(1);
}

const rookieTemplates = catalog.digimons.filter((t) => t.stage === 'Rookie');
if (rookieTemplates.length === 0) {
  console.error('FAIL: no Rookie templates in XML catalog to seed test rosters with.');
  process.exit(1);
}
const chosenTemplates = rookieTemplates.slice(0, Math.min(5, rookieTemplates.length));

const now = Date.now();
await run(
  `INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  'usr-backfill-1',
  'backfilltester',
  'BackfillTester',
  'not-a-real-hash',
  now,
  now,
);

for (const [i, tpl] of chosenTemplates.entries()) {
  await run(
    `INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus, mood, status, slot_index, equipped_skill_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 50, 'resting', NULL, NULL, ?, ?)`,
    `mon-backfill-${i}`,
    'usr-backfill-1',
    tpl.id,
    tpl.name,
    5,
    now,
    now,
  );
}

await run(
  `INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus, mood, status, slot_index, equipped_skill_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 50, 'resting', NULL, NULL, ?, ?)`,
  'mon-backfill-orphan',
  'usr-backfill-1',
  'not-a-real-catalog-id',
  'OrphanMon',
  5,
  now,
  now,
);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log(`\n=== Pre-backfill state ===`);
console.log(`  Seeded ${chosenTemplates.length} valid Rookie rosters + 1 orphan roster (bad catalog_id)`);
console.log(`  All rows have equipped_skill_ids = NULL`);

console.log(`\n=== Running backfillEquippedDefaults() ===`);
const result1 = await backfillEquippedDefaults();
console.log(`  scanned: ${result1.scanned}`);
console.log(`  updated: ${result1.updated}`);
console.log(`  skippedTemplateMissing: ${result1.skippedTemplateMissing}`);
console.log(`  skippedEmptyDefaults: ${result1.skippedEmptyDefaults}`);

check(
  `scanned = ${chosenTemplates.length + 1} (all NULL rows)`,
  result1.scanned === chosenTemplates.length + 1,
  `got ${result1.scanned}`,
);
check(
  `updated = ${chosenTemplates.length} (skips orphan)`,
  result1.updated === chosenTemplates.length,
  `got ${result1.updated}`,
);
check(
  `skippedTemplateMissing = 1 (orphan)`,
  result1.skippedTemplateMissing === 1,
  `got ${result1.skippedTemplateMissing}`,
);

console.log(`\n=== Per-row verification ===`);
for (const [i, tpl] of chosenTemplates.entries()) {
  const row = await one<{ equipped_skill_ids: string | null }>(
    `SELECT equipped_skill_ids FROM player_roster WHERE id = ?`,
    `mon-backfill-${i}`,
  );
  const expectedDefaults = await getDefaultEquippedForStage(tpl.element, tpl.stage);
  const expectedJson = expectedDefaults.length > 0 ? JSON.stringify(expectedDefaults) : null;
  check(
    `mon-backfill-${i} (${tpl.name}, ${tpl.element}/${tpl.stage}) equipped matches defaults`,
    row?.equipped_skill_ids === expectedJson,
    `got ${row?.equipped_skill_ids?.slice(0, 40)}...`,
  );
}

console.log(`\n=== Orphan row is untouched ===`);
const orphan = await one<{ equipped_skill_ids: string | null }>(
  `SELECT equipped_skill_ids FROM player_roster WHERE id = ?`,
  'mon-backfill-orphan',
);
check('orphan equipped_skill_ids remains NULL', orphan?.equipped_skill_ids === null);

console.log(`\n=== Idempotency: rerun finds 0 rows to update ===`);
const result2 = await backfillEquippedDefaults();
check(`scanned = 1 (only orphan still NULL)`, result2.scanned === 1, `got ${result2.scanned}`);
check(`updated = 0`, result2.updated === 0, `got ${result2.updated}`);
check(`skippedTemplateMissing = 1`, result2.skippedTemplateMissing === 1, `got ${result2.skippedTemplateMissing}`);

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);

await closeDbAdapter();
process.exit(failed === 0 ? 0 : 1);
