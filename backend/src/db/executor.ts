import type { DbAdapter, RunResult } from './adapter.js';
import { one, run } from './index.js';

/**
 * The subset of DbAdapter a repo needs to run inside someone else's
 * transaction. Postgres requires the whole transaction on one connection, so a
 * function that ignores the handle and reaches for the global run() would sit
 * outside the transaction and silently survive a rollback.
 */
export type DbExecutor = Pick<DbAdapter, 'run' | 'one'>;

export function execRun(ex: DbExecutor | undefined, sql: string, params: readonly unknown[]): Promise<RunResult> {
  return ex === undefined ? run(sql, ...params) : ex.run(sql, params);
}

export function execOne<TRow>(ex: DbExecutor | undefined, sql: string, params: readonly unknown[]): Promise<TRow | null> {
  return ex === undefined ? one<TRow>(sql, ...params) : ex.one<TRow>(sql, params);
}
