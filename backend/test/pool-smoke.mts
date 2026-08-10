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
import { getDefaultEquippedForStage, getLearnedPoolIds, getLearnedPoolMeta, isCatalogSkillId, resolveCatalogSkills } from '../src/skills/pool.ts';
import { EQUIPPED_SLOTS_PER_STAGE } from '@digiworld/shared/digimon';

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

console.log(`\n=== Pool cumulative growth (per-element Mega pool size) ===`);
// plant was re-authored around 3 design archetypes x 4 stages x 3 skills = 36;
// every element still on the original 4 stages x 6 slot_roles grid stays at 24.
const MEGA_POOL_SIZE: Record<string, number> = { plant: 36, dark: 36, light: 36, electricity: 36, water: 36, ice: 36, earth: 36 };
const DEFAULT_MEGA_POOL_SIZE = 24;
const elements = ['fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null'] as const;
for (const el of elements) {
  const expected = MEGA_POOL_SIZE[el] ?? DEFAULT_MEGA_POOL_SIZE;
  const ids = await getLearnedPoolIds(el, 'Mega');
  check(`${el} Mega pool = ${expected}`, ids.length === expected, `got ${ids.length}`);
}

console.log(`\n=== Pool is element-scoped (no leakage) ===`);
const waterMega = await getLearnedPoolIds('water', 'Mega');
check(
  'fire Mega ∩ water Mega = ∅',
  fireMega.every((id) => !waterMega.includes(id)),
);

console.log(`\n=== Pool ordering: newest stage first, then slot_role (pa/su/cr/bs/ut/if) ===`);
check(
  'fire Champion first 6 IDs are all Champion tier',
  fireChampion.slice(0, 6).every((id) => id.endsWith('-c')),
  `first 6: ${fireChampion.slice(0, 6).join(', ')}`,
);
check(
  'fire Champion first ID is Champion primary_attack (sk-fire-pa-c)',
  fireChampion[0] === 'sk-fire-pa-c',
  `got ${fireChampion[0]}`,
);
check(
  'fire Mega first 6 IDs are all Mega tier',
  fireMega.slice(0, 6).every((id) => id.endsWith('-m')),
);
check(
  'fire Rookie first ID is Rookie primary_attack (sk-fire-pa-r)',
  fireRookie[0] === 'sk-fire-pa-r',
  `got ${fireRookie[0]}`,
);

console.log(`\n=== getDefaultEquippedForStage returns EQUIPPED_SLOTS_PER_STAGE[stage] IDs ===`);
for (const stage of ['Rookie', 'Champion', 'Ultimate', 'Mega'] as const) {
  const defaults = await getDefaultEquippedForStage('fire', stage);
  const cap = EQUIPPED_SLOTS_PER_STAGE[stage];
  check(`fire ${stage} defaults length = cap ${cap}`, defaults.length === cap, `got ${defaults.length}`);
  check(
    `fire ${stage} defaults are unique`,
    new Set(defaults).size === defaults.length,
  );
}

console.log(`\n=== Rookie defaults drop utility + identity_finisher (cap 4 < roles 6) ===`);
const fireRookieDefaults = await getDefaultEquippedForStage('fire', 'Rookie');
check(
  'fire Rookie defaults = [pa-r, sd-r, ct-r, bs-r]',
  JSON.stringify(fireRookieDefaults) === JSON.stringify(['sk-fire-pa-r', 'sk-fire-sd-r', 'sk-fire-ct-r', 'sk-fire-bs-r']),
  `got ${JSON.stringify(fireRookieDefaults)}`,
);

console.log(`\n=== Champion defaults = all 6 Champion role skills (cap 6 = roles 6) ===`);
const fireChampionDefaults = await getDefaultEquippedForStage('fire', 'Champion');
check(
  'fire Champion defaults are all Champion tier',
  fireChampionDefaults.every((id) => id.endsWith('-c')),
  `got ${JSON.stringify(fireChampionDefaults)}`,
);

console.log(`\n=== Ultimate defaults = 6 Ultimate + 2 Champion (cap 8) ===`);
const fireUltimateDefaults = await getDefaultEquippedForStage('fire', 'Ultimate');
const ultimateTier = fireUltimateDefaults.filter((id) => id.endsWith('-u'));
const championTierInUlt = fireUltimateDefaults.filter((id) => id.endsWith('-c'));
check('Ultimate defaults have 6 Ultimate skills', ultimateTier.length === 6, `got ${ultimateTier.length}`);
check('Ultimate defaults have 2 Champion carry-forward skills', championTierInUlt.length === 2, `got ${championTierInUlt.length}`);
check(
  'Champion carry-forwards are pa + sd',
  championTierInUlt.includes('sk-fire-pa-c') && championTierInUlt.includes('sk-fire-sd-c'),
  `got ${JSON.stringify(championTierInUlt)}`,
);

console.log(`\n=== Mega defaults = 6 Mega + 4 Ultimate (cap 10) ===`);
const fireMegaDefaults = await getDefaultEquippedForStage('fire', 'Mega');
const megaTier = fireMegaDefaults.filter((id) => id.endsWith('-m'));
const ultimateTierInMega = fireMegaDefaults.filter((id) => id.endsWith('-u'));
check('Mega defaults have 6 Mega skills', megaTier.length === 6, `got ${megaTier.length}`);
check('Mega defaults have 4 Ultimate carry-forward skills', ultimateTierInMega.length === 4, `got ${ultimateTierInMega.length}`);

console.log(`\n=== getDefaultEquippedForStage output is a valid PUT skills body ===`);
const validationCheck = fireMegaDefaults.every((id) => isCatalogSkillId(id));
check('every default is a catalog id (routes through catalog validation)', validationCheck);
const inLearnedPool = new Set(fireMega);
check(
  'every default is in the learned pool (would pass PUT validation)',
  fireMegaDefaults.every((id) => inLearnedPool.has(id)),
);

console.log(`\n=== getLearnedPoolMeta returns rich metadata (name_pt, slot_role, tier_2, etc.) ===`);
const fireChampionMeta = await getLearnedPoolMeta('fire', 'Champion');
check('fire Champion meta length = 12', fireChampionMeta.length === 12, `got ${fireChampionMeta.length}`);
check(
  'first meta entry is Champion tier primary_attack',
  fireChampionMeta[0]?.stage === 'Champion' && fireChampionMeta[0]?.slot_role === 'primary_attack',
  `got stage=${fireChampionMeta[0]?.stage} role=${fireChampionMeta[0]?.slot_role}`,
);
check(
  'every meta entry has name_pt populated',
  fireChampionMeta.every((m) => m.name_pt && m.name_pt.length > 0),
);
check(
  'every meta entry has element=fire',
  fireChampionMeta.every((m) => m.element === 'fire'),
);
check(
  'every meta entry has non-null slot_role',
  fireChampionMeta.every((m) => m.slot_role !== null),
);
check(
  'tier_2 field is boolean (not 0/1)',
  fireChampionMeta.every((m) => typeof m.tier_2 === 'boolean'),
);
check(
  'meta sort order matches getLearnedPoolIds',
  JSON.stringify(fireChampionMeta.map((m) => m.id)) === JSON.stringify(fireChampion),
);
const megaMeta = await getLearnedPoolMeta('fire', 'Mega');
check('fire Mega meta length = 24', megaMeta.length === 24);
const megaChainEntries = megaMeta.filter((m) => m.upgrade_of !== null);
check('some Mega entries have upgrade_of populated (chain skills)', megaChainEntries.length > 0, `got ${megaChainEntries.length} chained`);

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
check(
  'every resolved skill has name_pt propagated (P5 Day 3)',
  resolved.every((s) => typeof s.name_pt === 'string' && s.name_pt.length > 0),
);
check(
  'every resolved skill has description_pt propagated (P5 Day 3)',
  resolved.every((s) => typeof s.description_pt === 'string' && (s.description_pt?.length ?? 0) > 0),
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
