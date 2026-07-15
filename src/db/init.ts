/**
 * CLI: initialize (or reset) the SQLite database.
 * Usage:
 *   pnpm db:init           # apply schema, keep existing data
 *   pnpm db:init --reset   # DROP everything and recreate (asks for confirmation)
 *
 * Meant for local dev. Production migrations are applied automatically by
 * `db()` on first open — schema.sql is idempotent (all CREATE ... IF NOT EXISTS).
 */
import { unlinkSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { config } from '../config.js';
import { db, closeDb } from './index.js';
import { log } from '../util/log.js';

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  if (reset) {
    if (existsSync(config.paths.db)) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ans = (await rl.question(`Reset database at ${config.paths.db}? Type YES: `)).trim();
      rl.close();
      if (ans !== 'YES') {
        log.warn('db.init.aborted');
        process.exit(1);
      }
      unlinkSync(config.paths.db);
      const walPath = `${config.paths.db}-wal`;
      const shmPath = `${config.paths.db}-shm`;
      if (existsSync(walPath)) unlinkSync(walPath);
      if (existsSync(shmPath)) unlinkSync(shmPath);
      log.info('db.reset.done', { path: config.paths.db });
    }
  }
  const handle = db();
  const tables = handle
    .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all();
  log.info('db.init.ok', { tables: tables.map((t) => t.name) });
  closeDb();
}

main().catch((err: unknown) => {
  log.error('db.init.fail', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
