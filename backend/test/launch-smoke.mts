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
import { CANONICAL_ROOKIE_TO_CHAMPION, EVO_CHIP_CHAMPION, chipQtyForTier } from '../src/launch/evolution.ts';

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

console.log('\n=== Canonical evolution keys (Rookie→Champion item gate) ===');
let evoPairs = 0;
const evoEdgesBefore = new Map<string, string>();
for (const [rookieKey, champName] of Object.entries(CANONICAL_ROOKIE_TO_CHAMPION)) {
  const rookie = catalog.digimons.find((t) => t.name.toLowerCase() === rookieKey && t.stage === 'Rookie');
  if (!rookie) continue;
  const champ = catalog.digimons.find((t) => t.name === champName);
  const champSpecies = [...universe.values()].find((s) => s.name === champName);
  if (!champ || !champSpecies) continue; // canonical champion not on the roster -> family farms via wild/hatch
  const edge = rookie.evolvesInto?.find((e) => e.targetId === champ.id);
  const expectQty = chipQtyForTier(champSpecies.tier);
  check(`evo ${rookie.name}→${champName}: chip assigned`, edge?.requiredItemId === EVO_CHIP_CHAMPION, edge?.requiredItemId ?? 'none');
  check(`evo ${rookie.name}→${champName}: qty ×${expectQty}`, edge?.requiredItemQty === expectQty, `${edge?.requiredItemQty ?? 'none'}`);
  evoPairs++;
  evoEdgesBefore.set(`${rookieKey}->${champName}`, `${edge?.requiredItemId ?? ''}:${edge?.requiredItemQty ?? ''}`);
}
check('at least one canonical pair resolved', evoPairs > 0, `${evoPairs} pairs`);

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
  const [rookieKey, champName] = key.split('->');
  const rookie = catalog2.digimons.find((t) => t.name.toLowerCase() === rookieKey && t.stage === 'Rookie');
  const champ = catalog2.digimons.find((t) => t.name === champName);
  const edge = rookie?.evolvesInto?.find((e) => e.targetId === champ?.id);
  const after = `${edge?.requiredItemId ?? ''}:${edge?.requiredItemQty ?? ''}`;
  if (after !== before) edgesSame = false;
}
check('evolution edges unchanged across re-run', edgesSame, `${evoEdgesBefore.size} edges`);

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
await closeDbAdapter();
if (failed > 0) process.exit(1);