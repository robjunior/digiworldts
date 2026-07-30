import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { config } from './config.js';

type QueryParams = readonly unknown[];

let pool: Pool | undefined;

function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    options: '-c search_path=commerce,public',
  });
  return pool;
}

export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: QueryParams,
): Promise<QueryResult<Row>> {
  return getPool().query<Row>(text, params ? [...params] : undefined);
}

export async function tx<Result>(work: (client: PoolClient) => Promise<Result>): Promise<Result> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  const current = pool;
  if (!current) return;
  pool = undefined;
  await current.end();
}
