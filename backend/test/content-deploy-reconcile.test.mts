/**
 * Reconcile smoke — applySeed(..., { reconcile: true }) purges, IN the same
 * transaction, the content rows content-deploy previously deployed (they carry
 * an active_versions pointer) that are absent from the incoming bundle, while
 * leaving boot-seeded rows that have NO version pointer untouched.
 *
 * This is the "only clean content enters the system" deploy guarantee, and the
 * safety model that stops a stale bundle from deleting content the server
 * depends on.
 *
 * Run: pnpm --filter @digiworld/backend test:content-deploy-reconcile
 */
import { unlinkSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteAdapter } from '../src/db/sqlite.ts';
import { applySeed } from '../src/content-deploy/versions.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = resolve(HERE, '../../content/content-bundle.json');
const DB_PATH = process.env.DB_PATH!;
if (!DB_PATH) {
  console.error('FAIL: set DB_PATH env');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function cleanupDb(): void {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

async function ensureVersionTables(adapter: SqliteAdapter): Promise<void> {
  await adapter.run(`DROP TABLE IF EXISTS active_versions`);
  await adapter.run(`DROP TABLE IF EXISTS content_versions`);
  await adapter.run(`
    CREATE TABLE content_versions (
      id              TEXT PRIMARY KEY,
      domain          TEXT NOT NULL,
      ref_id          TEXT NOT NULL,
      version_number  INTEGER NOT NULL CHECK (version_number > 0),
      status          TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      definition_json TEXT NOT NULL,
      created_at      INTEGER NOT NULL,
      created_by      TEXT,
      UNIQUE (domain, ref_id, version_number)
    )
  `);
  await adapter.run(`
    CREATE TABLE active_versions (
      domain      TEXT NOT NULL,
      ref_id      TEXT NOT NULL,
      version_id  TEXT NOT NULL,
      PRIMARY KEY (domain, ref_id),
      UNIQUE (domain, ref_id)
    )
  `);
}

type Row = Record<string, unknown>;

async function main(): Promise<void> {
  cleanupDb();
  const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')) as {
    tables: Record<string, Row[]>;
  };

  const adapter = await SqliteAdapter.create();
  await ensureVersionTables(adapter);

  // Pick a bundle table with several rows to exercise purge + keep.
  const table = 'shop_items';
  const bundleRows = bundle.tables[table] ?? [];
  check('bundle has shop_items rows', bundleRows.length >= 3, `got ${bundleRows.length}`);
  if (bundleRows.length < 3) {
    await adapter.close();
    cleanupDb();
    console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // First apply: deploy two of the rows from the bundle (a "PREVIOUS" bundle).
  const priorRows = bundleRows.slice(0, 2);
  await applySeed({ tables: { shop_items: priorRows } });
  const applied = await adapter.query<{ id: string }>('SELECT id FROM shop_items ORDER BY id');
  check('prior apply wrote 2 shop_items rows', applied.length === 2, `got ${applied.length}`);
  const activePointers = await adapter.query<{ domain: string; ref_id: string }>(
    `SELECT domain, ref_id FROM active_versions WHERE domain = 'shop_items'`,
  );
  check('prior apply recorded active_versions pointers', activePointers.length === 2, `got ${activePointers.length}`);

  // Simulate a BOOT-SEEDED row: inserted directly, NO version pointer.
  const bootRow = bundleRows.map((r) => ({ ...r, id: `${String(r['id'])}` }))[0];
  const bootId = 'itm-reconcile-boot-seeded';
  const bootCols = Object.keys(bootRow);
  const bootStmt = await adapter.run(
    `INSERT INTO shop_items (${bootCols.map((c) => `"${c}"`).join(', ')}) VALUES (${bootCols.map(() => '?').join(', ')})`,
    bootCols.map((c) => (c === 'id' ? bootId : bootRow[c])),
  );
  check('boot-seeded row inserted (no version pointer)', bootStmt.changes === 1, `changes=${bootStmt.changes}`);
  const bootCount = await adapter.query<{ c: number }>('SELECT COUNT(*) AS c FROM shop_items');
  check('3 rows total before reconcile', (bootCount[0]?.c ?? 0) === 3, `got ${bootCount[0]?.c}`);

  // Now the NEW bundle only carries ONE of the previously-deployed rows —
  // row[0] still in bundle, row[1] REMOVED from the bundle.
  const nextBundle = bundleRows.slice(0, 1);
  const summary = await applySeed({ tables: { shop_items: nextBundle } }, { reconcile: true });

  const purgedShop = summary.purged?.[table] ?? 0;
  check('reconcile purged 1 orphaned content row', purgedShop === 1, `purged=${purgedShop}`);

  const finalRows = await adapter.query<{ id: string }>('SELECT id FROM shop_items ORDER BY id');
  const finalIds = finalRows.map((r) => r.id);
  check('bundle row kept', finalIds.includes(String(nextBundle[0]!['id'])), finalIds.join(', '));
  check('previously-shipped-but-removed row purged', !finalIds.includes(String(priorRows[1]!['id'])));
  check('boot-seeded row (no version pointer) SURVIVED reconcile',
    finalIds.includes(bootId), finalIds.join(', '));

  const remainingPointers = await adapter.query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM active_versions WHERE domain = 'shop_items'`,
  );
  check('version ledger reconciled (1 pointer left)', (remainingPointers[0]?.c ?? 0) === 1, `got ${remainingPointers[0]?.c}`);

  // --- SELF-REFERENTIAL FK: booster_digimon_nodes parent_node_id ---
  // Prior bundle shipped a parent + child node (child.parent_node_id = parent id).
  // The NEW bundle ships NEITHER, so reconcile must purge BOTH — and must delete
  // the child BEFORE the parent or the self-FK trips (the deploy failure).
  if (!('booster_digimon_nodes' in bundle.tables) || !('boosters' in bundle.tables)) {
    check('booster tables present for self-FK scenario', false, 'bundle missing booster tables');
  } else {
    check('booster tables present for self-FK scenario', true);
    const booster = (bundle.tables['boosters'] ?? [])[0];
    const parentRow = { id: 'bt-prune:parent', booster_id: booster?.id ?? 'bt-x', ref: 'parent', digimon_id: 'skb-1', rarity: 'rare', weight: 1, order: 0 };
    const childRow = { ...parentRow, id: 'bt-prune:child', ref: 'child', parent_node_id: 'bt-prune:parent', order: 1 };
    const envFor = (tables: Record<string, Row[]>) => ({ tables });
    await applySeed(envFor({
      boosters: [booster].filter((b): b is Row => !!b),
      booster_digimon_nodes: [parentRow, childRow],
    }));
    // The bundle now ships neither node → both are orphans to purge.
    const summary2 = await applySeed(envFor({
      boosters: [booster].filter((b): b is Row => !!b),
      booster_digimon_nodes: [],
    }), { reconcile: true });
    check('reconcile purged both booster nodes (child before parent, self-FK safe)',
      (summary2.purged?.['booster_digimon_nodes'] ?? 0) === 2,
      `purged=${summary2.purged?.['booster_digimon_nodes']}`);
    const nodes = await adapter.query<{ id: string }>('SELECT id FROM booster_digimon_nodes ORDER BY id');
    check('booster_digimon_nodes empty after purge', nodes.length === 0, `got ${nodes.length}`);
  }

  await adapter.close();
  cleanupDb();
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();