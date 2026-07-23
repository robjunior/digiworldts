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

async function assertMigrationsApplied(a: SqliteAdapter): Promise<void> {
  const legacy = await a.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('active_matches','matchmaking_queue')",
  );
  if (legacy.length !== 0) {
    console.error('FAIL: legacy tables still present:', legacy.map((r) => r.name));
    process.exit(1);
  }
  const chat = await a.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('chat_rooms','chat_room_members') ORDER BY name",
  );
  if (chat.length !== 2) {
    console.error('FAIL: chat tables missing, got:', chat.map((r) => r.name));
    process.exit(1);
  }
  // migration 003 recreated skills_catalog with the 11-element CHECK — probe it
  // by trying to insert a row with an element that would have been rejected
  // under the old 5-element CHECK ('plant').
  try {
    await a.run(
      "INSERT INTO skills_catalog (id, name, description, element, energy_cost, cooldown, actions_json, tags_json, animation, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ['sk_probe', 'PlantProbe', '', 'plant', 0, 0, '[]', '[]', null, 1, Date.now(), Date.now()],
    );
    await a.run("DELETE FROM skills_catalog WHERE id = ?", ['sk_probe']);
  } catch (err) {
    console.error('FAIL: skills_catalog rejects element=plant after migration 003:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
  // migration 004 added game_settings.damage_rate with DEFAULT 1.0 CHECK (> 0).
  // Probe: PRAGMA reveals the column definition + default. The migrator smoke
  // test doesn't call seedDefaultGameSettings (that's boot-side), so we can't
  // SELECT a row — we can still confirm the column landed.
  const cols = await a.query<{ name: string; dflt_value: string | null }>(
    "PRAGMA table_info(game_settings)",
  );
  const dmgCol = cols.find((c) => c.name === 'damage_rate');
  if (!dmgCol) {
    console.error(`FAIL: game_settings.damage_rate column missing after migration 004; cols=`, cols.map((c) => c.name));
    process.exit(1);
  }
  if (dmgCol.dflt_value !== '1.0' && dmgCol.dflt_value !== '1') {
    console.error(`FAIL: game_settings.damage_rate default should be 1.0, got: ${dmgCol.dflt_value}`);
    process.exit(1);
  }
  const versions = await a.query<{ version: string }>(`SELECT version FROM schema_versions ORDER BY version`);
  const expected = ['001_drop_legacy_tables', '002_chat_rooms', '003_skills_element_check', '004_add_damage_rate_setting'];
  const got = versions.map((v) => v.version);
  for (const v of expected) {
    if (!got.includes(v)) {
      console.error(`FAIL: schema_versions missing ${v}, got:`, got);
      process.exit(1);
    }
  }
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

console.log('=== Case A: fresh DB ===');
{
  const a = await SqliteAdapter.create();
  await assertMigrationsApplied(a);
  console.log('  PASS: fresh DB — legacy tables absent, chat tables present, both migrations in ledger');
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
  await assertMigrationsApplied(a);
  console.log('  PASS: legacy tables dropped, chat tables created, both migrations recorded');
  await a.close();
}

for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

console.log('\n=== all migrator checks passed ===');
process.exit(0);
