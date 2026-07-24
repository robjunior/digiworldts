/**
 * SqliteAdapter — better-sqlite3 wrapped in the async DbAdapter interface.
 *
 * better-sqlite3 is synchronous under the hood. We wrap every operation in
 * `Promise.resolve` (no CPU work moved off the main loop, but the interface
 * matches Postgres). This keeps callers' code identical across backends.
 *
 * Prepared statements are cached per SQL string so repeat calls are cheap.
 * Transactions use explicit BEGIN/COMMIT/ROLLBACK so an async callback can
 * `await` inside (SQLite serializes writes anyway; long awaits will delay
 * other writers, so keep transactions short).
 */
import Database, { type Database as DatabaseHandle, type Statement } from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { log } from '../util/log.js';
import type { DbAdapter, RunResult } from './adapter.js';
import { runMigrations } from './migrator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, 'schema.sql');

export function applyColumnMigrations(handle: DatabaseHandle): void {
  addMissingColumns(handle, 'users', [
    ['mmr', 'INTEGER NOT NULL DEFAULT 1000'],
  ]);
  addMissingColumns(handle, 'player_roster', [
    ['revive_at', 'INTEGER'],
    ['pets_today', 'INTEGER NOT NULL DEFAULT 0'],
    ['pets_day', 'TEXT'],
    ['listed_at', 'INTEGER'],
    ['evolution_history', 'TEXT'],
    ['equipped_skill_ids', 'TEXT'],
  ]);
  addMissingColumns(handle, 'shop_items', [
    ['class', `TEXT NOT NULL DEFAULT 'product' CHECK (class IN ('product', 'item'))`],
  ]);
}

function addMissingColumns(handle: DatabaseHandle, table: string, columns: ReadonlyArray<readonly [string, string]>): void {
  const existing = new Set(
    handle
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name),
  );
  for (const [name, def] of columns) {
    if (!existing.has(name)) {
      handle.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    }
  }
}

export class SqliteAdapter implements DbAdapter {
  readonly kind = 'sqlite' as const;

  private constructor(private readonly handle: DatabaseHandle) {}

  static async create(): Promise<SqliteAdapter> {
    mkdirSync(dirname(config.paths.db), { recursive: true });
    const handle = new Database(config.paths.db);
    handle.pragma('journal_mode = WAL');
    handle.pragma('synchronous = NORMAL');
    handle.pragma('foreign_keys = ON');
    handle.pragma('busy_timeout = 5000');
    handle.pragma('temp_store = MEMORY');
    handle.pragma('cache_size = -20000');
    const adapter = new SqliteAdapter(handle);
    await adapter.init();
    return adapter;
  }

  async init(): Promise<void> {
    const sql = readFileSync(SCHEMA_PATH, 'utf8');
    this.handle.exec(sql);
    applyColumnMigrations(this.handle);
    await runMigrations(this);
  }

  async close(): Promise<void> {
    this.handle.close();
  }

  private readonly cache = new Map<string, Statement>();

  private prep<T = unknown>(sql: string): Statement<unknown[], T> {
    const hit = this.cache.get(sql);
    if (hit) return hit as Statement<unknown[], T>;
    const s = this.handle.prepare<unknown[], T>(sql);
    this.cache.set(sql, s);
    return s;
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const rows = this.prep<T>(sql).all(...(params as unknown[])) as T[];
    return rows;
  }

  async one<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const row = this.prep<T>(sql).get(...(params as unknown[])) as T | undefined;
    return row ?? null;
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const info = this.prep(sql).run(...(params as unknown[]));
    return {
      changes: typeof info.changes === 'number' ? info.changes : 0,
      lastInsertId:
        typeof info.lastInsertRowid === 'bigint'
          ? Number(info.lastInsertRowid)
          : typeof info.lastInsertRowid === 'number'
            ? info.lastInsertRowid
            : null,
    };
  }

  async exec(sql: string): Promise<void> {
    this.handle.exec(sql);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    this.handle.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(this);
      this.handle.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.handle.exec('ROLLBACK');
      } catch (rollbackErr) {
        log.warn('sqlite.tx.rollback.fail', {
          err: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        });
      }
      throw err;
    }
  }
}
