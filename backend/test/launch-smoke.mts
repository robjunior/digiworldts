/**
 * Launch-meta seed — smoke test.
 *
 * Runs `seedLaunchMeta()` against a SCRATCH catalog copy + scratch sqlite DB and
 * asserts the gate:
 *   1. All 10 launch places exist and are enabled, pools contain only roster ids.
 *   2. Champion cap: no Ultimate/Mega is published; every published species is a
 *      roster Rookie/Champion; everything else is draft.
 *   3. Roster universe resolves fully (no unknown names).
 *   4. Idempotent: a second run reports the same counts.
 *
 * Run (from repo root):
 *   DATABASE=sqlite DB_PATH=/tmp/dw-launch-smoke.db CATALOG_XML=/tmp/dw-launch-catalog.xml \
 *     pnpm --filter @digiworld/backend launch:smoke
 */
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { seedLaunchMeta } from '../src/launch/seed.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { q } from '../src/db/index.ts';
import { loadCatalog } from '../src/digimon/xml.ts';
import { LAUNCH_PLACES, rosterUniverse } from '../src/launch/roster.ts';
import { EVO_FRAGMENTS_PER_EVOLUTION, fragmentItemIdFor } from '../src/launch/evolution.ts';
import { seedShopItems } from '../src/social/shop.ts';

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
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n=== Run 1 ===');
await getDb();
await seedShopItems(); // fragment shop_items must exist for the catalog_loot_entries FK
const r1 = await seedLaunchMeta();
const catalog = loadCatalog();
const published = catalog.digimons.filter((t) => (t.status ?? 'published') === 'published');
const drafted = catalog.digimons.filter((t) => (t.status ?? 'published') === 'draft');
const universe = rosterUniverse();

check('no unknown roster names', r1.unknownNames.length === 0, r1.unknownNames.join(',') || 'all resolved');
check('all 10 places seeded', r1.places === 10 && r1.places === LAUNCH_PLACES.length, `${r1.places}`);
check('roster species resolved to ids', r1.rosterSpecies === universe.size, `${r1.rosterSpecies} of ${universe.size}`);

console.log('\n=== Champion-cap gate ===');
check('no Ultimate/Mega published', published.every((t) => t.stage === 'Rookie' || t.stage === 'Champion'));
check('every published species is on the roster',
  published.every((t) => [...universe.keys()].includes(t.name)),
  `${published.length} published`);
check('published == roster size', published.length === r1.rosterSpecies, `${published.length}`);
check('everything else drafted', drafted.length === catalog.digimons.length - r1.rosterSpecies, `${drafted.length} drafted`);
check('roster names all exist in catalog',
  [...universe.keys()].every((n) => catalog.digimons.some((t) => t.name === n)));

console.log('\n=== Evolution fragments (every roster Rookie→Champion edge digimon-specific) ===');
let evoPairs = 0;
let preservedBooster = 0;
const evoEdgesBefore = new Map<string, string>();
for (const rookie of catalog.digimons) {
  if (rookie.stage !== 'Rookie' || !rookie.evolvesInto) continue;
  if (![...universe.keys()].includes(rookie.name)) continue; // only launch-roster rookies
  for (const edge of rookie.evolvesInto) {
    const target = catalog.digimons.find((t) => t.id === edge.targetId);
    if (!target || target.stage !== 'Champion') continue;
    const champSpecies = [...universe.values()].find((s) => s.name === target.name);
    if (!champSpecies) continue; // champion not on the launch roster -> gated (farmed via wild/hatch)
    evoPairs++;
    const isPreservedBooster =
      edge.requiredItemId !== undefined && edge.requiredItemId !== null &&
      edge.requiredItemId.startsWith('itm-evo-') && !edge.requiredItemId.startsWith('itm-evo-frag-');
    if (isPreservedBooster) {
      preservedBooster++;
      check(`evo ${rookie.name}→${target.name}: booster-key edge preserved untouched`, true, edge.requiredItemId);
      evoEdgesBefore.set(`${rookie.name}->${target.name}`, `${edge.requiredItemId ?? ''}:${edge.requiredItemQty ?? ''}`);
      continue;
    }
    const fragId = fragmentItemIdFor(target.name);
    check(`evo ${rookie.name}→${target.name}: fragment assigned`, edge.requiredItemId === fragId, edge.requiredItemId ?? 'none');
    check(`evo ${rookie.name}→${target.name}: qty ×${EVO_FRAGMENTS_PER_EVOLUTION}`, edge.requiredItemQty === EVO_FRAGMENTS_PER_EVOLUTION, `${edge.requiredItemQty ?? 'none'}`);
    evoEdgesBefore.set(`${rookie.name}->${target.name}`, `${edge.requiredItemId ?? ''}:${edge.requiredItemQty ?? ''}`);
  }
}
check('at least one roster Rookie→Champion evolution fragment-gated', evoPairs > preservedBooster, `${evoPairs - preservedBooster} fragment paths, ${preservedBooster} booster preserved`);
check('fragment shop items + loot entries seeded', r1.evolutionFragments > 0, `${r1.evolutionFragments} fragment loot entries`);

console.log('\n=== Places in DB ===');
await getDb();
const places = await q<{ id: string; explore_pool: string; enabled: number }>(`SELECT id, explore_pool, enabled FROM pve_places`);
check('10 places stored', places.length === LAUNCH_PLACES.length, `${places.length}`);
check('all places enabled', places.every((p) => Number(p.enabled) === 1));
const rosterIds = new Set<string>();
for (const name of universe.keys()) {
  const t = catalog.digimons.find((x) => x.name === name);
  if (t) rosterIds.add(t.id);
}
const allPoolIds = new Set<string>();
for (const p of places) {
  const pool = JSON.parse(p.explore_pool) as { catalogId: string; weight: number }[];
  for (const e of pool) {
    allPoolIds.add(e.catalogId);
    check(`pool entry ${e.catalogId} is on the roster`, rosterIds.has(e.catalogId));
  }
}
check('no pool references a draft/non-roster species',
  [...allPoolIds].every((id) => rosterIds.has(id)));

const lootRows = await q<{ n: number }>('SELECT COUNT(*) AS n FROM catalog_loot_entries');
check('catalog_loot_entries seeded for fragment drops', (lootRows[0]?.n ?? 0) > 0, `${lootRows[0]?.n}`);

console.log('\n=== World nodes (world_objects per place) ===');
const nodeRows = await q<{ id: string; x: number; y: number; kind: string; label: string }>(
  `SELECT id, x, y, kind, label FROM world_objects`,
);
const launchNodes = nodeRows.filter((n) => n.id.startsWith('wob-launch-'));
check('10 world nodes seeded', launchNodes.length === LAUNCH_PLACES.length, `${launchNodes.length}`);
for (const place of LAUNCH_PLACES) {
  const node = launchNodes.find((n) => n.id === `wob-launch-${place.id}`);
  check(`node ${place.id} exists`, node !== undefined);
  if (node) {
    check(`node ${place.id} coords match place`, node.x === place.x && node.y === place.y, `${node.x},${node.y}`);
    check(`node ${place.id} has a mesh kind`, typeof node.kind === 'string' && node.kind.length > 0, node.kind);
    check(`node ${place.id} labeled`, node.label === place.name, node.label ?? '');
  }
}
check('no orphan/non-launch launch-prefixed nodes', launchNodes.length === nodeRows.filter((n) => n.id.startsWith('wob-launch-')).length);

console.log('\n=== Idempotency ===');
const publishedBefore = published.map((t) => t.id).sort();
const draftedBefore = drafted.map((t) => t.id).sort();
await closeDbAdapter();
const r2 = await seedLaunchMeta();
const catalog2 = loadCatalog();
const published2 = catalog2.digimons.filter((t) => (t.status ?? 'published') === 'published').map((t) => t.id).sort();
const drafted2 = catalog2.digimons.filter((t) => (t.status ?? 'published') === 'draft').map((t) => t.id).sort();
check('re-run yields identical published set', JSON.stringify(published2) === JSON.stringify(publishedBefore), `${published2.length}`);
check('re-run yields identical drafted set', JSON.stringify(drafted2) === JSON.stringify(draftedBefore), `${drafted2.length}`);
check('re-run unchanged (no status churn)', r2.drafted === 0 && r2.published === 0, `pub ${r2.published}, draft ${r2.drafted}`);

let edgesSame = true;
for (const [key, before] of evoEdgesBefore) {
  const [rookieName, champName] = key.split('->');
  const rookie = catalog2.digimons.find((t) => t.name === rookieName && t.stage === 'Rookie');
  const champ = catalog2.digimons.find((t) => t.name === champName);
  const edge = rookie?.evolvesInto?.find((e) => e.targetId === champ?.id);
  const after = `${edge?.requiredItemId ?? ''}:${edge?.requiredItemQty ?? ''}`;
  if (after !== before) edgesSame = false;
}
check('evolution edges unchanged across re-run', edgesSame, `${evoEdgesBefore.size} edges`);

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
await closeDbAdapter();
if (failed > 0) process.exit(1);