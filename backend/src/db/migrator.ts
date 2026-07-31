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
export type Migration = { version: string; filename: string; sql: string; selfManagedTransaction: boolean };

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
      selfManagedTransaction: false,
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
      if (isSelfManagedTransaction(m)) {
        await adapter.exec(m.sql);
        await adapter.run(
          `INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)`,
          [m.version, Date.now()],
        );
      } else {
        await adapter.transaction(async (tx) => {
          await tx.exec(m.sql);
          await tx.run(
            `INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)`,
            [m.version, Date.now()],
          );
        });
      }
      applied.push(m.version);
      log.info('db.migration.applied', { version: m.version, filename: m.filename });
    } catch (err) {
      if (await canMarkDuplicateColumnMigration(adapter, m, err)) {
        await adapter.run(
          `INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)`,
          [m.version, Date.now()],
        );
        skipped.push(m.version);
        log.info('db.migration.already-in-baseline', { version: m.version, filename: m.filename });
        continue;
      }
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

function isSelfManagedTransaction(migration: Migration): boolean {
  return migration.sql.includes('-- migrator:self-managed-transaction');
}

const ADD_COLUMN_STMT_RE = /^ALTER\s+TABLE\s+([A-Za-z_][\w]*)\s+ADD\s+COLUMN\s+([A-Za-z_][\w]*)\b/i;

/**
 * Returns the columns a migration adds, or null when it does anything else.
 * Mixed migrations must stay null: marking one applied would silently skip the
 * backfills and inserts sitting alongside the ALTER.
 */
function addedColumnsOf(sql: string): readonly { table: string; column: string }[] | null {
  const statements = sql
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (statements.length === 0) return null;

  const columns: { table: string; column: string }[] = [];
  for (const statement of statements) {
    const match = ADD_COLUMN_STMT_RE.exec(statement);
    if (match === null) return null;
    columns.push({ table: match[1]!, column: match[2]! });
  }
  return columns;
}

async function columnExists(adapter: DbAdapter, table: string, column: string): Promise<boolean> {
  if (adapter.kind === 'sqlite') {
    const rows = await adapter.query<{ name: string }>(`PRAGMA table_info(${table})`);
    return rows.some((row) => row.name === column);
  }
  const rows = await adapter.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
    [table, column],
  );
  return rows.length > 0;
}

/**
 * A pure ADD COLUMN migration whose columns the baseline schema already
 * declares is a no-op, not a failure: schema.sql has simply absorbed it since
 * it was written. Verifying every column it would add is what keeps this from
 * swallowing a genuine error.
 */
async function canMarkDuplicateColumnMigration(adapter: DbAdapter, migration: Migration, err: unknown): Promise<boolean> {
  if (!isDuplicateColumnError(err)) return false;
  const added = addedColumnsOf(migration.sql);
  if (added === null || added.length === 0) return false;
  for (const { table, column } of added) {
    if (!(await columnExists(adapter, table, column))) return false;
  }
  return true;
}

export function isDuplicateColumnError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes('duplicate column') || message.includes('already exists');
}
