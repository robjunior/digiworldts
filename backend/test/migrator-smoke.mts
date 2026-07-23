/**
 * Migrator smoke test — proves numbered migrations apply on both a fresh DB
 * and a pre-existing DB. Uses the `SqliteAdapter` boot path end-to-end, so it
 * also exercises `applyColumnMigrations` (legacy backfill) + `runMigrations`
 * (the migrator itself) in the same order that production boot does.
 *
 * Each migration under src/db/migrations/ should add its own case here as a
 * targeted regression guard against "someone added a migration that broke on
 * existing DBs". The migrator is dialect-agnostic (see migrator.ts docstring);
 * this test drives it via SQLite because that's the cheapest way to spin up a
 * throwaway DB. Postgres is covered end-to-end by boot on the multinode stack.
 *
 * Run: pnpm --filter @digiworld/backend test:migrator
 *   (requires DB_PATH to point at a scratch file, e.g. /tmp/dw-migrator-smoke.db)
 */
import { SqliteAdapter } from '../src/db/sqlite.ts';
import Database from 'better-sqlite3';
import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = process.env.DB_PATH!;

async function assertGone(a: SqliteAdapter): Promise<void> {
  const t = await a.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('active_matches','matchmaking_queue')",
  );
  if (t.length !== 0) {
    console.error('FAIL: legacy tables still present:', t.map((r) => r.name));
    process.exit(1);
  }
  const v = await a.query<{ version: string }>(
    "SELECT version FROM schema_versions WHERE version = ?",
    ['001_drop_legacy_tables'],
  );
  if (v.length !== 1) {
    console.error('FAIL: migration 001 not in ledger, got:', v);
    process.exit(1);
  }
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

console.log('=== Case A: fresh DB (no legacy tables) ===');
{
  const a = await SqliteAdapter.create();
  await assertGone(a);
  console.log('  PASS: fresh DB has no legacy tables, migration 001 in ledger');
  await a.close();
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

console.log('=== Case B: pre-existing DB WITH legacy tables ===');
{
  const raw = new Database(DB_PATH);
  raw.exec(`
    CREATE TABLE active_matches (
      id TEXT PRIMARY KEY, player_a TEXT NOT NULL, player_b TEXT NOT NULL,
      snapshot TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 1,
      active_side TEXT NOT NULL, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE matchmaking_queue (
      user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
      average_level INTEGER NOT NULL, queued_at INTEGER NOT NULL
    );
    INSERT INTO active_matches VALUES ('mtc_stale', 'usr_test', 'usr_test', '{}', 1, 'a', 0, 0);
  `);
  const pre = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('active_matches','matchmaking_queue')").all();
  raw.close();
  if (pre.length !== 2) {
    console.error('FAIL: setup did not create both tables, got:', pre);
    process.exit(1);
  }
  console.log('  seeded: legacy tables present with 1 stale row');

  const a = await SqliteAdapter.create();
  await assertGone(a);
  console.log('  PASS: migration 001 dropped both legacy tables cleanly');
  await a.close();
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

console.log('\n=== all migrator N2 checks passed ===');
process.exit(0);
