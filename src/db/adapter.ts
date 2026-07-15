/**
 * Async DB adapter — single interface, two backends.
 *
 * Callers write ONE code path against this interface using `?` placeholders
 * (SQLite style). Postgres adapter translates `?` → `$1, $2, …` at query
 * time so the same SQL string works on both.
 *
 * Backends:
 *   - `sqlite`   (default)   — better-sqlite3, WAL mode, single file
 *   - `postgres`             — `pg` connection pool, for multi-node
 *
 * Chosen at boot by `config.DATABASE`. The rest of the codebase touches only
 * this interface via `getDb()`.
 *
 * Transactions: `db.transaction(async (tx) => { ... })`. Inside the callback
 * all reads/writes MUST go through `tx`, never the outer `db` — Postgres
 * needs the same physical connection for the whole tx.
 */
import { config } from '../config.js';
import { log } from '../util/log.js';

export type RunResult = {
  changes: number;
  lastInsertId: number | null;
};

export interface DbAdapter {
  readonly kind: 'sqlite' | 'postgres';
  init(): Promise<void>;
  close(): Promise<void>;

  /** Multi-row read. Empty array on no rows. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;

  /** Single-row read. `null` on no rows. */
  one<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | null>;

  /** INSERT / UPDATE / DELETE. Returns row counts. */
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;

  /** Multi-statement DDL. Not parameterizable. */
  exec(sql: string): Promise<void>;

  /**
   * Wrap a batch of operations in a transaction. Inside the callback ALL
   * work must go through the passed `tx`, not the outer adapter.
   */
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

let instance: DbAdapter | null = null;

/** Get (and lazily initialize) the process-wide DbAdapter. */
export async function getDb(): Promise<DbAdapter> {
  if (instance) return instance;
  if (config.DATABASE === 'postgres') {
    const { PgAdapter } = await import('./postgres.js');
    instance = await PgAdapter.create(config.DATABASE_URL!);
    log.info('db.init', { kind: 'postgres' });
  } else {
    const { SqliteAdapter } = await import('./sqlite.js');
    instance = await SqliteAdapter.create();
    log.info('db.init', { kind: 'sqlite', path: config.paths.db });
  }
  return instance;
}

export async function closeDbAdapter(): Promise<void> {
  if (!instance) return;
  await instance.close();
  instance = null;
}

/**
 * Translate SQLite-style `?` placeholders into Postgres-style `$1, $2, …`.
 * Skips `?` characters that appear inside quoted string literals.
 */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let i = 0;
  let paramIdx = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (!inDouble && c === "'" && !inSingle) { inSingle = true; out += c; i++; continue; }
    if (inSingle && c === "'") {
      if (next === "'") { out += "''"; i += 2; continue; }
      inSingle = false; out += c; i++; continue;
    }
    if (!inSingle && c === '"' && !inDouble) { inDouble = true; out += c; i++; continue; }
    if (inDouble && c === '"') { inDouble = false; out += c; i++; continue; }
    if (!inSingle && !inDouble && c === '?') {
      paramIdx += 1;
      out += `$${paramIdx}`;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
