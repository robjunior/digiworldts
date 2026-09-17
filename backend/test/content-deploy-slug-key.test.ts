/**
 * Content-deploy regression: content tables whose ids are minted per-DB with
 * `newId(...)` must upsert on their stable unique natural key, NOT the
 * surrogate `id`.
 *
 * Affected tables today: `onboarding_teams` (key: `slug`) and
 * `building_blueprints` (key: `name`). Every environment that seeds
 * independently — dev DB, staging DB, fresh CI sqlite — ends up with
 * DIFFERENT random ids for the same logical row. An id-keyed upsert
 * (`ON CONFLICT (id)`) never fires against the target's rows and the insert
 * trips the natural-key unique constraint:
 *   `duplicate key value violates unique constraint "building_blueprints_name_key"`
 *   `duplicate key value violates unique constraint "onboarding_teams_slug_key"`
 * — the exact staging deploy failures (runs 35261848268 and the follow-up).
 * The natural key is the only identity stable across environments.
 *
 * Scenario (REAL engine, real SqliteAdapter, committed bundle rows):
 *   a target DB seeded independently (stale ids ≠ bundle ids) is deployed:
 *     - pre-fix:   applySeed throws duplicate-key and the whole txn rolls back;
 *     - post-fix:  apply converges rows by natural key (id follows the
 *                  bundle), records natural-key-keyed versions, a second
 *                  apply is a no-op, and a THIRD apply survives an id churn
 *                  (bundle id regenerated, natural key unchanged) with no
 *                  duplicates.
 *
 * Run: pnpm --filter @digiworld/backend test:content-deploy-slug-key
 */
import { unlinkSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteAdapter } from '../src/db/sqlite.ts';
import { applySeed } from '../src/content-deploy/versions.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = resolve(HERE, '../../content/content-bundle.json');
const DB_PATH = process.env.DB_PATH!;

// ---------------------------------------------------------------------------
// Tiny assertion harness (matches sibling smoke tests)
// ---------------------------------------------------------------------------
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

/** Version ledger tables are created by the migrator; recreate for a clean slate. */
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

/** Insert one stale row into `table`, spread from the bundle row but with a
 *  different surrogate id — simulating an independently-seeded environment. */
async function insertStaleRow(adapter: SqliteAdapter, table: string, row: Row, staleId: string): Promise<void> {
  const cols = Object.keys(row);
  const names = cols.join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  await adapter.run(
    `INSERT INTO ${table} (${names}) VALUES (${placeholders})`,
    cols.map((c) => (c === 'id' ? staleId : row[c])),
  );
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  cleanupDb();

  const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')) as {
    tables: Record<string, Row[]>;
  };
  const teamRows = bundle.tables['onboarding_teams'] ?? [];
  const blueprintRows = bundle.tables['building_blueprints'] ?? [];

  check('committed bundle has onboarding_teams rows', teamRows.length >= 2, `got ${teamRows.length}`);
  check('committed bundle has building_blueprints rows', blueprintRows.length >= 2, `got ${blueprintRows.length}`);
  if (teamRows.length < 2 || blueprintRows.length < 2) {
    console.log('  Cannot simulate: bundle missing expected rows. Aborting.');
    failed = 1;
    return;
  }

  const teamByKey = new Map(teamRows.map((r) => [String(r['slug']), r] as const));
  const blueprintByKey = new Map(blueprintRows.map((r) => [String(r['name']), r] as const));
  const hasTeam = (k: string) => teamByKey.has(k);
  const hasBlueprint = (k: string) => blueprintByKey.has(k);
  if (!hasTeam('triad') || !hasTeam('tide') || !hasBlueprint('Meat Farm')) {
    console.log('  Cannot simulate: expected keys missing from bundle. Aborting.');
    failed = 1;
    return;
  }

  const adapter = await SqliteAdapter.create(); // runs migrations → full schema
  await ensureVersionTables(adapter);

  // --- Simulate an independently-seeded target DB: same natural keys, DIFFERENT ids ---
  for (const [slug, b] of teamByKey) {
    await insertStaleRow(adapter, 'onboarding_teams', b, `onb_STALE_${slug}_0000000000000001`);
  }
  for (const [name, b] of blueprintByKey) {
    await insertStaleRow(adapter, 'building_blueprints', b, `bp_STALE_${name.replace(/\W+/g, '_')}_0000000000000001`);
  }
  console.log('  Inserted stale target rows (same natural keys, different random ids)');

  // --- Apply the COMMITTED bundle rows — the same engine call the deploy step makes.
  // The env is focused on the regression tables: the five dungeon tables' DDL was
  // removed from the repo with the feature-removal commit and no longer exists
  // on fresh DBs, so a full-bundle apply cannot run there yet (separate issue).
  const env = (teams: Row[], blueprints: Row[]) => ({
    tables: { onboarding_teams: teams, building_blueprints: blueprints },
  });
  try {
    await applySeed(env(teamRows, blueprintRows));
    check('applySeed succeeds with stale rows present (both tables)', true);
  } catch (e) {
    check('applySeed succeeds with stale rows present (both tables)', false,
      e instanceof Error ? e.message : String(e));
    await adapter.close();
    cleanupDb();
    console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // --- Convergence: rows updated by natural key, ids follow the bundle ---
  const teams = await adapter.query<Row>('SELECT id, slug FROM onboarding_teams ORDER BY slug');
  const blueprints = await adapter.query<Row>('SELECT id, name FROM building_blueprints ORDER BY name');
  check('no duplicate onboarding_teams rows', teams.length === teamRows.length, `got ${teams.length}`);
  check('no duplicate building_blueprints rows', blueprints.length === blueprintRows.length, `got ${blueprints.length}`);

  for (const [slug, b] of teamByKey) {
    const dbRow = teams.find((r) => String(r['slug']) === slug);
    check(`team ${slug} exists`, !!dbRow);
    check(`team ${slug} converged to bundle id`, !!dbRow && String(dbRow['id']) === String(b['id']),
      `db=${dbRow?.['id']} bundle=${b['id']}`);
  }
  for (const [name, b] of blueprintByKey) {
    const dbRow = blueprints.find((r) => String(r['name']) === name);
    check(`blueprint ${name} exists`, !!dbRow);
    check(`blueprint ${name} converged to bundle id`, !!dbRow && String(dbRow['id']) === String(b['id']),
      `db=${dbRow?.['id']} bundle=${b['id']}`);
  }

  // --- Version ledger is keyed by the natural key (stable across id churn) ---
  const teamRefs = new Set((await adapter.query<{ ref_id: string }>(
    `SELECT DISTINCT ref_id FROM content_versions WHERE domain = 'onboarding_teams'`,
  )).map((v) => v.ref_id));
  check('onboarding_teams version refs keyed by slug',
    teamRefs.has(JSON.stringify(['triad'])) && teamRefs.has(JSON.stringify(['tide'])),
    `refs: ${[...teamRefs].join(', ')}`);
  const bpRefs = new Set((await adapter.query<{ ref_id: string }>(
    `SELECT DISTINCT ref_id FROM content_versions WHERE domain = 'building_blueprints'`,
  )).map((v) => v.ref_id));
  check('building_blueprints version refs keyed by name',
    bpRefs.has(JSON.stringify(['Meat Farm'])),
    `refs: ${[...bpRefs].join(', ')}`);

  // --- Idempotent re-apply (steady state: ids already converged) ---
  try {
    await applySeed(env(teamRows, blueprintRows));
    const again = await adapter.query<{ c: number }>('SELECT COUNT(*) AS c FROM onboarding_teams');
    const againBp = await adapter.query<{ c: number }>('SELECT COUNT(*) AS c FROM building_blueprints');
    check('second apply is a no-op (no duplicate rows, no throw)',
      again[0].c === teamRows.length && againBp[0].c === blueprintRows.length,
      `teams=${again[0].c} blueprints=${againBp[0].c}`);
  } catch (e) {
    check('second apply is a no-op (no duplicate rows, no throw)', false,
      e instanceof Error ? e.message : String(e));
  }

  // --- Id churn: bundle picks NEW random ids (dev rows recreated), natural keys unchanged ---
  const churnedTeams = teamRows.map((b) => ({ ...b, id: `onb_CHURNED_${String(b['slug'])}_0000000000000002` }));
  const churnedBlueprints = blueprintRows.map((b) => ({ ...b, id: `bp_CHURNED_${String(b['name']).replace(/\W+/g, '_')}_0000000000000002` }));
  try {
    await applySeed(env(churnedTeams, churnedBlueprints));
    const afterChurn = await adapter.query<Row>('SELECT id, slug FROM onboarding_teams ORDER BY slug');
    const afterChurnBp = await adapter.query<Row>('SELECT id, name FROM building_blueprints ORDER BY name');
    const teamsConverged = afterChurn.every((r) =>
      String(r['id']) === `onb_CHURNED_${String(r['slug'])}_0000000000000002`);
    const bpConverged = afterChurnBp.every((r) =>
      String(r['id']) === `bp_CHURNED_${String(r['name']).replace(/\W+/g, '_')}_0000000000000002`);
    check('id churn converges by natural key (no duplicates, ids track the bundle)',
      afterChurn.length === teamRows.length && afterChurnBp.length === blueprintRows.length
        && teamsConverged && bpConverged,
      `teams=${afterChurn.length}/${teamRows.length} blueprints=${afterChurnBp.length}/${blueprintRows.length}`);
  } catch (e) {
    check('id churn converges by natural key (no duplicates, ids track the bundle)', false,
      e instanceof Error ? e.message : String(e));
  }

  await adapter.close();
  cleanupDb();

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();