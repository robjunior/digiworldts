/**
 * Numbered SQL schema migrations.
 *
 * Files in src/db/migrations/*.sql (naming: NNN_description.sql, ordered by
 * the NNN prefix) are applied once each, tracked by a schema_versions ledger.
 * The migrator runs at boot AFTER the baseline schema (schema.sql /
 * schema-pg.sql) has been applied by the adapter's `init`.
 *
 * Each migration executes inside a transaction; a failure rolls the entire
 * change (including the ledger insert) back and boot aborts.
 *
 * Portability — three shapes:
 *   NNN_desc.sql          → portable, applied on BOTH dialects
 *   NNN_desc.sqlite.sql   → applied only on SQLite (PG skips)
 *   NNN_desc.pg.sql       → applied only on Postgres (SQLite skips)
 *
 * The version key stored in `schema_versions` strips the dialect suffix, so
 * a dialect-specific migration and its counterpart on the OTHER dialect
 * share the same version. Migrations that only need to run on one dialect
 * (like fixing a SQLite-only CHECK constraint drift where Postgres was
 * born with the right shape) simply have no counterpart — the other
 * dialect's ledger just won't have that entry.
 *
 * Race safety: `schema_versions.version` is a PRIMARY KEY. If two nodes
 * boot simultaneously and both attempt migration X, the loser's INSERT
 * fails on the unique constraint, its transaction ROLLBACKs, and the DDL
 * rolls with it (both dialects support transactional CREATE/ALTER/DROP
 * for the operations we do). We recheck the ledger after a failed apply;
 * if the row is there the loser continues, otherwise the error rethrows.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../util/log.js';
import type { DbAdapter } from './adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, 'migrations');

const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS schema_versions (
  version    TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
)`;

export type Dialect = 'sqlite' | 'postgres';
export type Migration = { version: string; filename: string; sql: string };

export function loadMigrations(dialect: Dialect): Migration[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const mySuffix = dialect === 'sqlite' ? '.sqlite.sql' : '.pg.sql';
  const otherSuffix = dialect === 'sqlite' ? '.pg.sql' : '.sqlite.sql';
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => {
      if (!f.endsWith('.sql')) return false;
      if (f.endsWith(otherSuffix)) return false;
      return true;
    })
    .sort();
  return files.map((filename) => {
    let version = filename;
    if (version.endsWith(mySuffix)) version = version.slice(0, -mySuffix.length);
    else version = version.slice(0, -'.sql'.length);
    return {
      version,
      filename,
      sql: readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf8'),
    };
  });
}

export type MigrationResult = { applied: string[]; skipped: string[] };

export async function runMigrations(adapter: DbAdapter): Promise<MigrationResult> {
  await adapter.exec(CREATE_LEDGER);
  const migrations = loadMigrations(adapter.kind);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const m of migrations) {
    const already = await adapter.one<{ version: string }>(
      `SELECT version FROM schema_versions WHERE version = ?`,
      [m.version],
    );
    if (already) {
      skipped.push(m.version);
      continue;
    }

    try {
      await adapter.transaction(async (tx) => {
        await tx.exec(m.sql);
        await tx.run(
          `INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)`,
          [m.version, Date.now()],
        );
      });
      applied.push(m.version);
      log.info('db.migration.applied', { version: m.version, filename: m.filename });
    } catch (err) {
      const recheck = await adapter.one<{ version: string }>(
        `SELECT version FROM schema_versions WHERE version = ?`,
        [m.version],
      );
      if (recheck) {
        skipped.push(m.version);
        log.info('db.migration.race.won-by-other', { version: m.version });
        continue;
      }
      log.error('db.migration.failed', {
        version: m.version,
        filename: m.filename,
        err: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  if (applied.length > 0) {
    log.info('db.migrator.done', { applied: applied.length, skipped: skipped.length });
  }
  return { applied, skipped };
}
