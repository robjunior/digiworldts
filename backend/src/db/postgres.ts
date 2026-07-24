/**
 * PgAdapter — Postgres via `pg.Pool`.
 *
 *   - Placeholders translated `?` → `$1, $2, …` via `toPgPlaceholders`.
 *   - Each `query`/`run`/`one` grabs a client from the shared pool and
 *     releases it on completion. Transactions pin ONE client for the whole
 *     callback so BEGIN/COMMIT stay coherent.
 *   - `lastInsertId` is best-effort: for INSERTs without `RETURNING id` it
 *     comes back `null`. All our tables use app-generated TEXT ids anyway
 *     (only `login_attempts` uses BIGSERIAL, and its id isn't referenced).
 *
 * Schema is loaded from `data/schema-pg.sql` (Postgres dialect — see the
 * neighbour file for the translation from SQLite).
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { log } from '../util/log.js';
import { toPgPlaceholders, type DbAdapter, type RunResult } from './adapter.js';
import { runMigrations } from './migrator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, 'schema-pg.sql');

// Coerce Postgres BIGINT / INT8 to JS number. Our BIGINT columns hold ms
// timestamps and small counts; both fit inside Number.MAX_SAFE_INTEGER for
// the foreseeable future. Without this, `SELECT COUNT(*)` returns "0" as a
// string and every `count === 0` / arithmetic comparison in the codebase
// silently misbehaves (register race check, xp math, etc.).
const PG_INT8_OID = 20;
pg.types.setTypeParser(PG_INT8_OID, (v: string) => (v === null ? null : Number(v)));

const PREPARED_CACHE_LIMIT = 256;
const preparedCache = new Map<string, string>();
function preparedName(text: string): string {
  const cached = preparedCache.get(text);
  if (cached !== undefined) {
    preparedCache.delete(text);
    preparedCache.set(text, cached);
    return cached;
  }
  if (preparedCache.size >= PREPARED_CACHE_LIMIT) {
    const oldest = preparedCache.keys().next().value;
    if (oldest !== undefined) preparedCache.delete(oldest);
  }
  const name = `dw_${createHash('sha1').update(text).digest('hex').slice(0, 24)}`;
  preparedCache.set(text, name);
  return name;
}

type ClientLike = pg.PoolClient | pg.Pool;

export class PgAdapter implements DbAdapter {
  readonly kind = 'postgres' as const;

  private constructor(private readonly pool: pg.Pool, private readonly pinned: pg.PoolClient | null = null) {}

  static async create(url: string): Promise<PgAdapter> {
    const pool = new pg.Pool({
      connectionString: url,
      max: Number.parseInt(process.env.PG_POOL_MAX ?? '20', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => {
      log.warn('pg.pool.error', { err: err instanceof Error ? err.message : String(err) });
    });
    const adapter = new PgAdapter(pool);
    await adapter.init();
    return adapter;
  }

  private client(): ClientLike {
    return this.pinned ?? this.pool;
  }

  async init(): Promise<void> {
    const sql = readFileSync(SCHEMA_PATH, 'utf8');
    await this.exec(sql);
    await runMigrations(this);
  }

  async close(): Promise<void> {
    if (this.pinned) return;
    await this.pool.end();
  }

  async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const text = toPgPlaceholders(sql);
    const res = await this.client().query({ name: preparedName(text), text, values: params as unknown[] });
    return res.rows as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    const text = toPgPlaceholders(sql);
    const res = await this.client().query({ name: preparedName(text), text, values: params as unknown[] });
    const first = res.rows[0] as Record<string, unknown> | undefined;
    const idCandidate = first && (first['id'] ?? first['user_id']);
    return {
      changes: res.rowCount ?? 0,
      lastInsertId: typeof idCandidate === 'number' ? idCandidate : null,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.client().query(sql);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    if (this.pinned) return fn(this);
    const client = await this.pool.connect();
    const tx = new PgAdapter(this.pool, client);
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        log.warn('pg.tx.rollback.fail', {
          err: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        });
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
