/**
 * P4 skill pool smoke test.
 *
 * Boots SqliteAdapter with a scratch DB, seeds every catalog skill (396 pool + signatures), then
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
// Every element now runs the archetype grid: 9 skills per stage, so the
// cumulative pool is 9 / 18 / 27 / 36. The pre-rework grid was 6 per stage.
check('fire Rookie pool = 9', fireRookie.length === 9, `got ${fireRookie.length}`);
check('fire Champion pool = 18', fireChampion.length === 18, `got ${fireChampion.length}`);
check('fire Ultimate pool = 27', fireUltimate.length === 27, `got ${fireUltimate.length}`);
check('fire Mega pool = 36', fireMega.length === 36, `got ${fireMega.length}`);
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
const MEGA_POOL_SIZE: Record<string, number> = { plant: 36, dark: 36, light: 36, electricity: 36, water: 36, ice: 36, earth: 36, steel: 36, fire: 36, wind: 36, null: 36 };
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
  'fire Champion first 9 IDs are all Champion tier',
  fireChampion.slice(0, 9).every((id) => /-c-\d+$/.test(id)),
  `first 9: ${fireChampion.slice(0, 9).join(', ')}`,
);
check(
  'fire Champion first ID is a Champion primary_attack',
  /-c-\d+$/.test(fireChampion[0] ?? ''),
  `got ${fireChampion[0]}`,
);
check(
  'fire Mega first 9 IDs are all Mega tier',
  fireMega.slice(0, 9).every((id) => /-m-\d+$/.test(id)),
);
check(
  'fire Rookie first ID is a Rookie skill',
  /-r-\d+$/.test(fireRookie[0] ?? ''),
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

console.log(`\n=== Rookie defaults take 4 of the 9 Rookie skills (cap 4) ===`);
const fireRookieDefaults = await getDefaultEquippedForStage('fire', 'Rookie');
check(
  'fire Rookie defaults are 4 Rookie-tier skills',
  fireRookieDefaults.length === 4 && fireRookieDefaults.every((id) => /-r-\d+$/.test(id)),
  `got ${JSON.stringify(fireRookieDefaults)}`,
);

console.log(`\n=== Champion defaults = all 6 Champion role skills (cap 6 = roles 6) ===`);
const fireChampionDefaults = await getDefaultEquippedForStage('fire', 'Champion');
check(
  'fire Champion defaults are all Champion tier',
  fireChampionDefaults.every((id) => /-c-\d+$/.test(id)),
  `got ${JSON.stringify(fireChampionDefaults)}`,
);

// The archetype rework squeezed carry-forward out of the DEFAULT loadout.
// With 6 skills per stage, Ultimate's cap of 8 pulled 6 Ultimate + 2 Champion
// and Mega's cap of 10 pulled 6 Mega + 4 Ultimate. With 9 per stage the
// current tier alone fills Ultimate entirely and all but one Mega slot.
// The LEARNED pool still carries forward (36 ids at Mega) — a player can
// still equip a lower-stage skill by hand — but nothing below the current
// stage is auto-equipped except a single Ultimate slot at Mega.
console.log(`\n=== Ultimate defaults = 8 Ultimate, no carry-forward (cap 8, 9 available) ===`);
const fireUltimateDefaults = await getDefaultEquippedForStage('fire', 'Ultimate');
const ultimateTier = fireUltimateDefaults.filter((id) => /-u-\d+$/.test(id));
const championTierInUlt = fireUltimateDefaults.filter((id) => /-c-\d+$/.test(id));
check('Ultimate defaults have 8 Ultimate skills', ultimateTier.length === 8, `got ${ultimateTier.length}`);
check('Ultimate defaults have no Champion carry-forward', championTierInUlt.length === 0, `got ${championTierInUlt.length}`);

console.log(`\n=== Mega defaults = 9 Mega + 1 Ultimate (cap 10, 9 available) ===`);
const fireMegaDefaults = await getDefaultEquippedForStage('fire', 'Mega');
const megaTier = fireMegaDefaults.filter((id) => /-m-\d+$/.test(id));
const ultimateTierInMega = fireMegaDefaults.filter((id) => /-u-\d+$/.test(id));
check('Mega defaults have 9 Mega skills', megaTier.length === 9, `got ${megaTier.length}`);
check('Mega defaults have 1 Ultimate carry-forward skill', ultimateTierInMega.length === 1, `got ${ultimateTierInMega.length}`);

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
check('fire Champion meta length = 18', fireChampionMeta.length === 18, `got ${fireChampionMeta.length}`);
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
check('fire Mega meta length = 36', megaMeta.length === 36);
const megaChainEntries = megaMeta.filter((m) => m.upgrade_of !== null);
check('some Mega entries have upgrade_of populated (chain skills)', megaChainEntries.length > 0, `got ${megaChainEntries.length} chained`);

console.log(`\n=== resolveCatalogSkills ===`);
const resolved = await resolveCatalogSkills(fireRookie);
check('resolved 9 fire Rookie skills', resolved.length === 9, `got ${resolved.length}`);
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
check('sk-fire-berserk-r-1 → true', isCatalogSkillId('sk-fire-berserk-r-1'));
check('sk- → true (any sk- prefix)', isCatalogSkillId('sk-anything'));
check('skb-317:s0 → false (wikimon key)', !isCatalogSkillId('skb-317:s0'));
check('empty string → false', !isCatalogSkillId(''));
check('s0 → false (bare wikimon id)', !isCatalogSkillId('s0'));

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);

await closeDbAdapter();
process.exit(failed === 0 ? 0 : 1);
