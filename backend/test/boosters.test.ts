/**
 * Booster loader + pipeline regression tests (see spec §8/§9).
 *
 * Covers:
 *  1. Transform: deterministic ids (code:ref), parentNodeId resolution.
 *  2. Semantic validation: duplicate ref, dangling parentRef, no root, cycle.
 *  3. Cross-file validation: duplicate code across files, missing digimonId,
 *     missing itemId, weight/rarity/order schema rules.
 *  4. Idempotency: same fixture produced from disk twice has identical hashes.
 *  5. Fresh-DB content-deploy apply: boosters land as runtime rows via the REAL
 *     engine (SqliteAdapter + applySeed), re-apply is a no-op (converges).
 *
 * Run: pnpm --filter @digiworld/backend test:boosters
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '../src/db/sqlite.ts';
import { applySeed } from '../src/content-deploy/versions.ts';
import {
  loadBoosters,
  transformSeed,
  seedHashOfText,
  validateCrossFile,
} from '../src/boosters/loader.ts';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name} ${detail}`);
  }
}

const write = (dir: string, name: string, obj: unknown) =>
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2));

function validSeed(over: Record<string, unknown> = {}) {
  return {
    code: 'BT-99',
    name: 'Valid Test Booster',
    set: 'Test',
    releaseDate: '2026-01-01',
    status: 'draft',
    digimonPool: [
      { ref: 'agumon', digimonId: 'skb-50', parentRef: null, rarity: 'common', weight: 10, order: 0 },
      { ref: 'greymon', digimonId: 'skb-326', parentRef: 'agumon', rarity: 'uncommon', weight: 5, order: 0 },
    ],
    itemPool: [
      { ref: 'spirit', itemId: 'itm-atk-buff', rarity: 'common', weight: 10, order: 0 },
    ],
    ...over,
  };
}

const DIGIMON_IDS = new Set(['skb-50', 'skb-326']);
const ITEM_IDS = new Set(['itm-atk-buff']);

async function freshDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'dw-boosters-'));
  return dir;
}

// ---------------------------------------------------------------------------
// 1. Transform correctness
// ---------------------------------------------------------------------------
{
  const seed: any = validSeed();
  const { booster, nodes, items } = transformSeed(seed, 'abc', 123);
  check('transform: booster id = code lowercased', booster.id === 'bt-99', booster.id);
  check('transform: seedHash carried', booster.seed_hash === 'abc', booster.seed_hash);
  check('transform: node id = code:ref', nodes[0]?.id === 'bt-99:agumon', JSON.stringify(nodes[0]?.id));
  check('transform: root parentNodeId null', nodes[0]?.parent_node_id === null, String(nodes[0]?.parent_node_id));
  const greymon = nodes[1];
  check('transform: child parentNodeId = code:parentRef', greymon?.parent_node_id === 'bt-99:agumon', String(greymon?.parent_node_id));
  check('transform: item id = code:item:ref', items[0]?.id === 'bt-99:item:spirit', items[0]?.id);
  check('transform: item boosterId', items[0]?.booster_id === 'bt-99', items[0]?.booster_id);
}

// ---------------------------------------------------------------------------
// 2. Semantic validation
// ---------------------------------------------------------------------------
{
  const dir = await freshDir();
  // duplicate ref
  const dupRef = validSeed({ digimonPool: [
    { ref: 'agumon', digimonId: 'skb-50', parentRef: null, rarity: 'common', weight: 1, order: 0 },
    { ref: 'agumon', digimonId: 'skb-50', parentRef: null, rarity: 'common', weight: 1, order: 1 },
  ] });
  write(dir, 'dup-ref.booster.json', dupRef);
  const dupRefOut = await loadBoosters(dir);
  check('semantic: duplicate ref flagged', dupRefOut.issues.some((i) => i.rule === 'ref-unique'));

  // dangling parentRef
  write(dir, 'dangle.booster.json', validSeed({ digimonPool: [
    { ref: 'a', digimonId: 'skb-50', parentRef: null, rarity: 'common', weight: 1, order: 0 },
    { ref: 'b', digimonId: 'skb-326', parentRef: 'ghost', rarity: 'common', weight: 1, order: 0 },
  ] }));
  const dangleOut = await loadBoosters(dir);
  check('semantic: dangling parentRef flagged', dangleOut.issues.some((i) => i.rule === 'parent-ref'));

  // no root
  write(dir, 'noroot.booster.json', validSeed({ digimonPool: [
    { ref: 'a', digimonId: 'skb-50', parentRef: 'b', rarity: 'common', weight: 1, order: 0 },
    { ref: 'b', digimonId: 'skb-326', parentRef: 'a', rarity: 'common', weight: 1, order: 0 },
  ] }));
  const noRootOut = await loadBoosters(dir);
  check('semantic: no-root flagged', noRootOut.issues.some((i) => i.rule === 'root'));
  check('semantic: cycle also flagged on 2-cycle', noRootOut.issues.some((i) => i.rule === 'cycle'));

  // weight 0 → schema (parse) issue
  write(dir, 'weight0.booster.json', validSeed({ digimonPool: [
    { ref: 'a', digimonId: 'skb-50', parentRef: null, rarity: 'common', weight: 0, order: 0 },
  ] }));
  const weightOut = await loadBoosters(dir);
  check('schema: weight 0 rejected', weightOut.issues.some((i) => i.rule === 'schema'));

  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 3. Cross-file validation
// ---------------------------------------------------------------------------
{
  const a = validSeed({ code: 'BT-99' });
  const b = validSeed({ code: 'BT-99' }); // same code
  const c = validSeed({ code: 'BT-98', digimonPool: [
    { ref: 'x', digimonId: 'skb-NONEXISTENT', parentRef: null, rarity: 'common', weight: 1, order: 0 },
  ], itemPool: [
    { ref: 'y', itemId: 'itm-NONEXISTENT', rarity: 'common', weight: 1, order: 0 },
  ] });
  const issues = validateCrossFile([a, b, c], [], DIGIMON_IDS, ITEM_IDS);
  check('cross-file: duplicate code flagged', issues.some((i) => i.rule === 'code-unique'));
  check('cross-file: missing digimonId flagged', issues.some((i) => i.rule === 'digimon-exists'));
  check('cross-file: missing itemId flagged', issues.some((i) => i.rule === 'item-exists'));
  check('cross-file: no false positive for valid refs', !issues.some((i) => i.message.includes('in (a)')));
}

// ---------------------------------------------------------------------------
// 4. Hash idempotency (deterministic seed_hash)
// ---------------------------------------------------------------------------
{
  const h1 = seedHashOfText('{"a":1}');
  const h2 = seedHashOfText('{"a":1}');
  const h3 = seedHashOfText('{"a":2}');
  check('hash: stable for same bytes', h1 === h2);
  check('hash: differs on change', h1 !== h3);
}

// ---------------------------------------------------------------------------
// 5. Fresh-DB content-deploy apply (real engine) — boosters land as rows
// ---------------------------------------------------------------------------
// Use the SAME committed seed file through the pipeline, then apply a bundle
// containing booster tables into a scratch sqlite DB and assert the rows exist,
// parent refs resolve, and a re-apply converges (no duplicate-key error).
if (process.env.DB_PATH) {
  const dbPath = process.env.DB_PATH;
  rmSync(dbPath, { force: true });
  const adapter = await SqliteAdapter.create();
  // Build booster tables from the seed files; inject them into the committed
  // bundle so applySeed validates the FULL artifact (like extract-local does
  // on content:refresh).
  const { readFileSync, existsSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const HERE = dirname(fileURLToPath(import.meta.url));
  const BUNDLE_PATH = resolve(HERE, '../../content/content-bundle.json');

  const { buildBoosterTables, DEFAULT_SEEDS_DIR } = await import('../src/boosters/pipeline.ts');
  const { loadCatalog } = await import('../src/digimon/xml.ts');
  let catalog;
  try {
    catalog = loadCatalog();
  } catch {
    catalog = undefined;
  }
  // Item ids available in the bundle's own shop_items table.
  const bundleRaw = existsSync(BUNDLE_PATH) ? JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')) : { tables: {} };
  const itemIds = (bundleRaw.tables?.['shop_items'] ?? []).map((r: { id: unknown }) => String(r['id']));

  const out = await buildBoosterTables({ seedsDir: DEFAULT_SEEDS_DIR, ...(catalog ? { catalog } : {}), itemIds });
  check('pipeline: seed compiles to ≥1 booster', out.boosters.length >= 1, String(out.boosters.length));
  check('pipeline: valid seed, no issues', out.valid, out.issues.map((i) => i.message).join('; '));

  const bundle: any = {
    schemaVersion: bundleRaw.schemaVersion ?? 1,
    exportedAt: Date.now(),
    source: { test: 'boosters' },
    skippedMissingTables: bundleRaw.skippedMissingTables ?? [],
    assetManifest: bundleRaw.assetManifest ?? [],
    tables: {
      ...(bundleRaw.tables ?? {}),
      boosters: out.boosters,
      booster_digimon_nodes: out.booster_digimon_nodes,
      booster_item_entries: out.booster_item_entries,
    },
  };

  await applySeed(bundle as Parameters<typeof applySeed>[0]);

  const booster = await adapter.one<{ id: string; code: string; status: string; seed_hash: string }>(
    'SELECT id, code, status, seed_hash FROM boosters WHERE code = ?', ['BT-05']);
  check('apply: booster row present', booster !== undefined);
  check('apply: booster status published', booster?.status === 'published');
  check('apply: booster seed_hash non-empty', typeof booster?.seed_hash === 'string' && booster.seed_hash.length > 0);

  const nodes = await adapter.query<{ id: string; parent_node_id: string | null; digimon_id: string }>(
    'SELECT id, parent_node_id, digimon_id FROM booster_digimon_nodes WHERE booster_id = ? ORDER BY id', ['bt-05']);
  check('apply: 9 digimon nodes', nodes.length === 9, String(nodes.length));
  const angemon = nodes.find((n) => n.id === 'bt-05:angemon');
  check('apply: parent ref resolved in DB', angemon?.parent_node_id === 'bt-05:patamon', String(angemon?.parent_node_id));

  // Re-apply → must converge, not throw duplicate-key (idempotent).
  await applySeed(bundle as Parameters<typeof applySeed>[0]);
  const after = await adapter.query<{ id: string }>('SELECT id FROM booster_digimon_nodes WHERE booster_id = ?', ['bt-05']);
  check('apply: idempotent re-apply (no dup rows)', after.length === 9, String(after.length));

  adapter.close();
  rmSync(dbPath, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;