/**
 * P4 skill pool smoke test.
 *
 * Boots SqliteAdapter with a scratch DB, seeds all 264 catalog skills, then
 * exercises pool.ts: cumulative learned-pool IDs per (element, stage), batch
 * catalog resolution → Skill[] with .actions populated, and prefix detection.
 *
 * Run: DB_PATH=/tmp/dw-pool-smoke.db pnpm --filter @digiworld/backend test:pool
 */
import { existsSync, unlinkSync } from 'node:fs';
import { seedSkillsCatalogV2 } from '../src/skills/seed-catalog.ts';
import { ALL_SKILL_SEEDS } from '../src/skills/seeds/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { getLearnedPoolIds, isCatalogSkillId, resolveCatalogSkills } from '../src/skills/pool.ts';

const DB_PATH = process.env.DB_PATH!;
if (!DB_PATH) {
  console.error('FAIL: set DB_PATH env (e.g. /tmp/dw-pool-smoke.db)');
  process.exit(1);
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

await getDb();
const seed = await seedSkillsCatalogV2();
if (seed.inserted !== ALL_SKILL_SEEDS.length) {
  console.error(`FAIL: seed inserted ${seed.inserted}, expected ${ALL_SKILL_SEEDS.length}`);
  process.exit(1);
}

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

console.log(`\n=== Pool cumulative growth (fire) ===`);
const fireRookie = await getLearnedPoolIds('fire', 'Rookie');
const fireChampion = await getLearnedPoolIds('fire', 'Champion');
const fireUltimate = await getLearnedPoolIds('fire', 'Ultimate');
const fireMega = await getLearnedPoolIds('fire', 'Mega');
check('fire Rookie pool = 6', fireRookie.length === 6, `got ${fireRookie.length}`);
check('fire Champion pool = 12', fireChampion.length === 12, `got ${fireChampion.length}`);
check('fire Ultimate pool = 18', fireUltimate.length === 18, `got ${fireUltimate.length}`);
check('fire Mega pool = 24', fireMega.length === 24, `got ${fireMega.length}`);
check(
  'fire Champion pool ⊇ Rookie pool',
  fireRookie.every((id) => fireChampion.includes(id)),
);
check(
  'fire Mega pool ⊇ Ultimate pool',
  fireUltimate.every((id) => fireMega.includes(id)),
);

console.log(`\n=== Pool cumulative growth (all 11 elements at Mega = 24 each) ===`);
const elements = ['fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null'] as const;
for (const el of elements) {
  const ids = await getLearnedPoolIds(el, 'Mega');
  check(`${el} Mega pool = 24`, ids.length === 24, `got ${ids.length}`);
}

console.log(`\n=== Pool is element-scoped (no leakage) ===`);
const waterMega = await getLearnedPoolIds('water', 'Mega');
check(
  'fire Mega ∩ water Mega = ∅',
  fireMega.every((id) => !waterMega.includes(id)),
);

console.log(`\n=== resolveCatalogSkills ===`);
const resolved = await resolveCatalogSkills(fireRookie);
check('resolved 6 fire Rookie skills', resolved.length === 6, `got ${resolved.length}`);
check(
  'every resolved skill has .actions populated (non-empty)',
  resolved.every((s) => Array.isArray(s.actions) && s.actions.length > 0),
);
check(
  'every resolved skill has element=fire',
  resolved.every((s) => s.element === 'fire'),
);
check(
  'every resolved skill has non-zero energyCost or Basic slot',
  resolved.every((s) => typeof s.energyCost === 'number'),
);

console.log(`\n=== resolveCatalogSkills mixed input (silently drops non-catalog ids) ===`);
const mixed = await resolveCatalogSkills([...fireRookie.slice(0, 2), 'skb-317:s0', 'wikimon-only']);
check('mixed input resolves only catalog IDs', mixed.length === 2, `got ${mixed.length}`);

console.log(`\n=== resolveCatalogSkills empty / no-catalog inputs ===`);
const noneEmpty = await resolveCatalogSkills([]);
const noneWikimon = await resolveCatalogSkills(['skb-317:s0']);
check('empty input → []', noneEmpty.length === 0);
check('all-wikimon input → []', noneWikimon.length === 0);

console.log(`\n=== isCatalogSkillId prefix detection ===`);
check('sk-fire-pa-r → true', isCatalogSkillId('sk-fire-pa-r'));
check('sk- → true (any sk- prefix)', isCatalogSkillId('sk-anything'));
check('skb-317:s0 → false (wikimon key)', !isCatalogSkillId('skb-317:s0'));
check('empty string → false', !isCatalogSkillId(''));
check('s0 → false (bare wikimon id)', !isCatalogSkillId('s0'));

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);

await closeDbAdapter();
process.exit(failed === 0 ? 0 : 1);
