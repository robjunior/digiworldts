/**
 * Content-deploy regression: `onboarding_teams` must upsert on its `slug`
 * natural key, NOT on its surrogate `id`.
 *
 * Team ids come from `newId('onb')` at seeding time (onboarding/engine.ts),
 * so every environment that seeds independently — dev DB, staging DB, fresh
 * CI sqlite — ends up with DIFFERENT random ids for the same team slug. The
 * old id-keyed upsert (`ON CONFLICT (id)`) then died with `duplicate key
 * value violates unique constraint "onboarding_teams_slug_key"` the first
 * time a committed bundle reached a DB that already had the slug under
 * another id — the exact staging deploy failure (run 35261848268, "Deploy
 * content (committed bundle)" step). Identity for this table is `slug`.
 *
 * Scenario (REAL engine, real SqliteAdapter, committed bundle rows):
 *   a target DB seeded independently (stale ids ≠ bundle ids) is deployed:
 *     - pre-fix:   applySeed throws duplicate-key and the whole txn rolls back;
 *     - post-fix:  apply converges rows by slug (id, mons, name follow the
 *                  bundle), records slug-keyed versions, a second apply is a
 *                  no-op, and a THIRD apply survives an id churn (bundle id
 *                  regenerated, slug unchanged) with no duplicates.
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

type TeamRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  mon_1_catalog_id: string;
  mon_2_catalog_id: string;
  mon_3_catalog_id: string;
  sort_order: number;
  enabled: number;
  created_at: number;
  updated_at: number;
};

const TEAM_COLS =
  '(id, slug, name, description, mon_1_catalog_id, mon_2_catalog_id, mon_3_catalog_id, sort_order, enabled, created_at, updated_at)';

function teamParams(t: TeamRow): unknown[] {
  return [t.id, t.slug, t.name, t.description, t.mon_1_catalog_id,
    t.mon_2_catalog_id, t.mon_3_catalog_id, t.sort_order, t.enabled,
    t.created_at, t.updated_at];
}

async function insertTeam(adapter: SqliteAdapter, t: TeamRow): Promise<void> {
  await adapter.run(`INSERT INTO onboarding_teams ${TEAM_COLS} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, teamParams(t));
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  cleanupDb();

  const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')) as {
    tables: Record<string, Array<Record<string, unknown>>>;
  };
  const bundleTeams = (bundle.tables['onboarding_teams'] ?? []) as unknown as TeamRow[];
  const bySlug = new Map(bundleTeams.map((r) => [r.slug, r] as const));
  check('committed bundle has onboarding_teams rows', bundleTeams.length >= 2,
    `got ${bundleTeams.length}`);
  if (bundleTeams.length < 2 || !bySlug.has('triad') || !bySlug.has('tide')) {
    console.log('  Cannot simulate: bundle missing triad/tide teams. Aborting.');
    failed = 1;
    return;
  }

  const adapter = await SqliteAdapter.create(); // runs migrations → full schema
  await ensureVersionTables(adapter);

  // --- Simulate an independently-seeded target DB: same slugs, DIFFERENT ids ---
  const now = Date.now();
  for (const [slug, b] of bySlug) {
    await insertTeam(adapter, {
      ...b,
      id: `onb_STALE_${slug}_0000000000000001`,
      created_at: now - 1000,
      updated_at: now - 1000,
    });
  }
  console.log('  Inserted stale target rows (same slugs, different random ids)');

  // --- Apply the COMMITTED bundle rows — the same engine call the deploy step makes.
  // The env is focused on onboarding_teams: the five dungeon tables' DDL was
  // removed from the repo with the feature-removal commit and no longer exists
  // on fresh DBs, so a full-bundle apply cannot run there yet (separate issue) —
  // and the regression under test is this table's identity, not those tables.
  const env = (teams: TeamRow[]) => ({ tables: { onboarding_teams: teams } });
  try {
    await applySeed(env(bundleTeams));
    check('applySeed succeeds with stale slug rows present', true);
  } catch (e) {
    check('applySeed succeeds with stale slug rows present', false,
      e instanceof Error ? e.message : String(e));
    await adapter.close();
    cleanupDb();
    console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // --- Convergence: rows updated by slug, ids follow the bundle ---
  const after = await adapter.query<TeamRow>(
    'SELECT id, slug, name, mon_1_catalog_id FROM onboarding_teams ORDER BY slug',
  );
  const afterBySlug = new Map(after.map((r) => [r.slug, r] as const));
  check('no duplicate rows (still exactly one row per slug)',
    after.length === bySlug.size, `got ${after.length}`);
  for (const [slug, b] of bySlug) {
    const dbRow = afterBySlug.get(slug);
    check(`row for ${slug} exists`, !!dbRow);
    check(`row for ${slug} converged to bundle id`,
      !!dbRow && dbRow.id === b.id, `db=${dbRow?.id} bundle=${b.id}`);
    check(`row for ${slug} kept bundle name`,
      !!dbRow && dbRow.name === b.name);
    check(`row for ${slug} kept bundle mons`,
      !!dbRow && dbRow.mon_1_catalog_id === b.mon_1_catalog_id);
  }

  // --- Version ledger is keyed by slug (stable across id churn) ---
  const versionRefs = await adapter.query<{ ref_id: string }>(
    `SELECT DISTINCT ref_id FROM content_versions WHERE domain = 'onboarding_teams'`,
  );
  const refs = new Set(versionRefs.map((v) => v.ref_id));
  check('content_versions refs keyed by slug',
    refs.has(JSON.stringify(['triad'])) && refs.has(JSON.stringify(['tide'])),
    `refs: ${[...refs].join(', ')}`);

  // --- Idempotent re-apply (steady state: ids already converged) ---
  try {
    await applySeed(env(bundleTeams));
    const again = await adapter.query<{ c: number }>('SELECT COUNT(*) AS c FROM onboarding_teams');
    check('second apply is a no-op (no duplicate rows, no throw)',
      again[0].c === bySlug.size, `got ${again[0].c}`);
  } catch (e) {
    check('second apply is a no-op (no duplicate rows, no throw)', false,
      e instanceof Error ? e.message : String(e));
  }

  // --- Id churn: bundle picks NEW random ids (dev row recreated), slug unchanged ---
  const churnedTeams = bundleTeams.map((b) => ({
    ...b,
    id: `onb_CHURNED_${b.slug}_0000000000000002`,
  }));
  try {
    await applySeed(env(churnedTeams));
    const afterChurn = await adapter.query<{ c: number }>('SELECT COUNT(*) AS c FROM onboarding_teams');
    const converged = await adapter.query<{ slug: string; id: string }>(
      'SELECT slug, id FROM onboarding_teams ORDER BY slug',
    );
    const allConverged = converged.every((r) =>
      r.id === `onb_CHURNED_${r.slug}_0000000000000002`);
    check('id churn converges by slug (no duplicates, ids track the bundle)',
      afterChurn[0].c === bySlug.size && allConverged,
      `count=${afterChurn[0].c}`);
    const churnRefs = await adapter.query<{ ref_id: string }>(
      `SELECT DISTINCT ref_id FROM content_versions WHERE domain = 'onboarding_teams'`,
    );
    const refSet = new Set(churnRefs.map((v) => v.ref_id));
    check('version refs stay slug-keyed across id churn',
      refSet.has(JSON.stringify(['triad'])) && refSet.has(JSON.stringify(['tide'])));
  } catch (e) {
    check('id churn converges by slug (no duplicates, ids track the bundle)', false,
      e instanceof Error ? e.message : String(e));
  }

  await adapter.close();
  cleanupDb();

  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();