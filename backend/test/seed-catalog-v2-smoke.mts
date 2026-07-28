/**
 * P3 skill catalog v2 seed smoke test.
 *
 * Boots SqliteAdapter with a scratch DB, applies baseline schema + all
 * migrations (including 005 which adds name_pt/description_pt/stage/slot_role/
 * upgrade_of/tier_2), then runs seedSkillsCatalogV2 and reports the outcome.
 *
 * Passes if: all 264 entries validate via SkillInputSchema AND upsert cleanly.
 *
 * Run: DB_PATH=/tmp/dw-seed-v2.db pnpm --filter @digiworld/backend test:seed-v2
 */
import { existsSync, unlinkSync } from 'node:fs';
import { seedSkillsCatalogV2, seedSummaryByElement } from '../src/skills/seed-catalog.ts';
import { ALL_SKILL_SEEDS } from '../src/skills/seeds/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';

const DB_PATH = process.env.DB_PATH!;
if (!DB_PATH) {
  console.error('FAIL: set DB_PATH env (e.g. /tmp/dw-seed-v2.db)');
  process.exit(1);
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

const adapter = await getDb();

console.log(`=== Seeding ${ALL_SKILL_SEEDS.length} skills into ${DB_PATH} ===`);
console.log('By element:', seedSummaryByElement());

const result = await seedSkillsCatalogV2();

console.log(`\n=== Result ===`);
console.log(`  total: ${result.total}`);
console.log(`  inserted: ${result.inserted}`);
console.log(`  skipped: ${result.skipped}`);
console.log(`  validationErrors: ${result.validationErrors.length}`);

if (result.validationErrors.length > 0) {
  console.log('\n=== Validation errors (first 5) ===');
  for (const err of result.validationErrors.slice(0, 5)) {
    console.log(`  ${err.id}:`, JSON.stringify(err.issues, null, 2));
  }
}

const chainRows = await adapter.query<{ id: string; name: string; upgrade_of: string | null; stage: string }>(
  `SELECT id, name, upgrade_of, stage FROM skills_catalog WHERE upgrade_of IS NOT NULL ORDER BY id`,
);
console.log(`\n=== Progression chains (upgrade_of set) ===`);
console.log(`  Chained skills: ${chainRows.length} (expect 66 = slot 1 + slot 6, chained across stages II→IV × 11 elements)`);

const byStage = await adapter.query<{ stage: string; n: number }>(
  `SELECT stage, COUNT(*) as n FROM skills_catalog WHERE stage IS NOT NULL GROUP BY stage ORDER BY stage`,
);
console.log(`\n=== By stage (expect 66 per stage) ===`);
for (const row of byStage) console.log(`  ${row.stage}: ${row.n}`);

const bySlot = await adapter.query<{ slot_role: string; n: number }>(
  `SELECT slot_role, COUNT(*) as n FROM skills_catalog WHERE slot_role IS NOT NULL GROUP BY slot_role ORDER BY slot_role`,
);
console.log(`\n=== By slot_role (expect 44 per role = 11 elements × 4 stages) ===`);
for (const row of bySlot) console.log(`  ${row.slot_role}: ${row.n}`);

const tier2 = await adapter.query<{ n: number }>(`SELECT COUNT(*) as n FROM skills_catalog WHERE tier_2 = 1`);
console.log(`\n=== Tier 2 skills: ${tier2[0]?.n ?? 0}`);

await closeDbAdapter();

if (result.validationErrors.length > 0 || result.inserted !== ALL_SKILL_SEEDS.length) {
  console.error('\nFAIL: not all seeds landed');
  process.exit(1);
}
console.log('\n=== all skill seeds inserted ===');
