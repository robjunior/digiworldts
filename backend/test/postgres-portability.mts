/**
 * Postgres portability regression test.
 *
 * Runs the full DigiWorld Postgres path (schema-pg.sql + every SQL_* constant
 * in src/) against real PostgreSQL 18.3 via @electric-sql/pglite (in-process
 * WASM build of the actual Postgres C source). No external Postgres daemon
 * required — ~15s per run, safe for CI.
 *
 * Three tiers of validation:
 *   A) `src/db/schema-pg.sql` applies cleanly (schema syntax + types + FKs)
 *   B) Every `const SQL_... = \`...\`` in src/ PREPAREs against the real
 *      schema after translation via `toPgPlaceholders` — validates
 *      SQL syntax, column names, types, and placeholder count in one shot
 *   C) End-to-end insert/select roundtrip on the critical operations
 *      (register, CITEXT login, roster, farm, ON CONFLICT upserts,
 *      transaction commit + rollback)
 *
 * Exits 0 on full pass, 1 on any failure.
 *
 * Run with: `pnpm test:pg-portability`
 */
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { toPgPlaceholders } from '../src/db/adapter.ts';
import { loadMigrations } from '../src/db/migrator.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = join(ROOT, 'src');
const SCHEMA_PATH = join(SRC, 'db/schema-pg.sql');
const MIGRATIONS_DIR = join(SRC, 'db/migrations');

type SqlConstant = { file: string; name: string; sql: string };
type Check = { name: string; ok: boolean; err?: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function scanSqlConstants(): SqlConstant[] {
  const re = /const\s+(SQL_[A-Z_0-9]+)\s*=\s*`([\s\S]*?)`/g;
  const out: SqlConstant[] = [];
  for (const f of walk(SRC)) {
    const raw = readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      out.push({ file: f.replace(SRC + '/', ''), name: m[1]!, sql: m[2]!.trim() });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const constants = scanSqlConstants();
  const db = new PGlite({ extensions: { citext } });
  await db.waitReady;
  await db.exec('CREATE EXTENSION IF NOT EXISTS citext');

  console.log('─── Tier A: apply schema-pg.sql ───');
  try {
    await db.exec(schema);
    console.log(`  ✓ ${schema.split('\n').length} lines applied cleanly`);
  } catch (e) {
    console.log(`  ✗ schema failed: ${(e as Error).message}`);
    process.exit(1);
  }
  // Baseline schema applied; now apply every numbered migration in order
  // (dialect-filtered — SQLite-only migrations are skipped) so PREPARE-time
  // table lookups see the full post-migrator shape.
  const migrations = loadMigrations('postgres');
  for (const m of migrations) {
    try {
      await db.exec(m.sql);
    } catch (e) {
      console.log(`  ✗ migration ${m.filename} failed: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  if (migrations.length > 0) {
    console.log(`  ✓ ${migrations.length} migration${migrations.length === 1 ? '' : 's'} applied: ${migrations.map((m) => m.filename).join(', ')}`);
  }
  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const names = tables.rows.map((r) => r.table_name);
  console.log(`  ✓ ${names.length} tables: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` … +${names.length - 8}` : ''}`);

  console.log(`\n─── Tier B: PREPARE ${constants.length} SQL_* constants ───`);
  const failures: Array<{ file: string; name: string; err: string }> = [];
  let prepared = 0;
  let skipped = 0;
  for (let i = 0; i < constants.length; i++) {
    const { file, name, sql } = constants[i]!;
    const translated = toPgPlaceholders(sql);
    const firstWord = translated.trim().split(/\s+/)[0]!.toUpperCase();
    if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH'].includes(firstWord)) {
      skipped += 1;
      continue;
    }
    const stmtName = `s${i}`;
    try {
      await db.exec(`PREPARE ${stmtName} AS ${translated}`);
      await db.exec(`DEALLOCATE ${stmtName}`);
      prepared += 1;
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0]!.slice(0, 140);
      failures.push({ file, name, err: msg });
    }
  }
  console.log(`  ✓ ${prepared}/${constants.length - skipped} DML constants prepared cleanly${skipped ? ` (${skipped} non-DML skipped)` : ''}`);
  if (failures.length) {
    console.log(`  ✗ ${failures.length} PREPARE failures:`);
    for (const f of failures.slice(0, 20)) {
      console.log(`    · ${f.file}:${f.name} — ${f.err}`);
    }
  }

  console.log(`\n─── Tier C: end-to-end roundtrip on critical ops ───`);
  const now = Date.now();
  const checks: Check[] = [];
  const runCheck = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); checks.push({ name, ok: true }); }
    catch (e) { checks.push({ name, ok: false, err: (e as Error).message.split('\n')[0]!.slice(0, 140) }); }
  };

  const userId = 'usr_pgtest';
  const monId = 'mon_pgtest';
  const catalogId = 'skb-pgtest';

  await runCheck('insert scraped_catalog', async () => {
    await db.query(
      `INSERT INTO scraped_catalog(skullbot_id, name, stage, attribute, portrait_url, dot_url, wikimon_slug, raw_json, scraped_at, in_catalog)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [1, 'PGtestMon', 'Rookie', 'Data', 'http://x/p', 'http://x/d', 'PGtestMon', '{}', now, 1],
    );
  });

  const grabConst = (relPath: string, name: string): string | null => {
    const raw = readFileSync(join(SRC, relPath), 'utf8');
    const m = raw.match(new RegExp(`const\\s+${name}\\s*=\\s*\`([\\s\\S]*?)\``));
    return m ? toPgPlaceholders(m[1]!) : null;
  };

  const insertUser = grabConst('auth/routes.ts', 'SQL_INSERT_USER');
  if (insertUser) {
    await runCheck('insert user (real SQL_INSERT_USER)', async () => {
      await db.query(insertUser, [userId, 'pgtestuser', 'PGtest User', 'hash', 0, now, now]);
    });
  } else {
    checks.push({ name: 'find SQL_INSERT_USER', ok: false, err: 'constant not found' });
  }

  const selectByUsername = grabConst('auth/routes.ts', 'SQL_SELECT_BY_USERNAME');
  if (selectByUsername) {
    await runCheck('select user by username (CITEXT case-insensitive)', async () => {
      const r = await db.query<{ id: string }>(selectByUsername, ['PGTESTUSER']);
      if (r.rows[0]?.id !== userId) throw new Error(`no case-insensitive match: ${JSON.stringify(r.rows)}`);
    });
  }

  await runCheck('insert session', async () => {
    await db.query(
      `INSERT INTO sessions(token, user_id, created_at, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
      ['tok-pgtest', userId, now, now + 86_400_000, 'test', '127.0.0.1'],
    );
  });

  await runCheck('insert player_roster mon', async () => {
    await db.query(
      `INSERT INTO player_roster(id, user_id, catalog_id, nickname, level, xp, hp_bonus, atk_bonus, def_bonus, spd_bonus, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [monId, userId, catalogId, 'MyMon', 5, 0, 0, 0, 0, 0, 'party', now, now],
    );
  });

  await runCheck('insert farm_building', async () => {
    await db.query(
      `INSERT INTO farm_buildings(id, user_id, kind, resource, level, rate_per_hour, capacity, produced, last_touch, upgrade_cost, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      ['bld_pgtest', userId, 'Meat Farm', 'Meat', 1, 10, 100, 0, now, 250, now],
    );
  });

  await runCheck('insert shop_items', async () => {
    await db.query(
      `INSERT INTO shop_items(id, name, description, price_credits, kind, payload, enabled, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['small_potion', 'Small Potion', '25% HP', 100, 'hp_pct', '{"magnitude":0.25}', 1, now],
    );
  });

  const upsertInv = grabConst('social/shop.ts', 'SQL_UPSERT_INVENTORY');
  if (upsertInv) {
    await runCheck('upsert inventory (SQL_UPSERT_INVENTORY, ON CONFLICT DO UPDATE fires + additive)', async () => {
      await db.query(upsertInv, [userId, 'small_potion', 3, now]);
      await db.query(upsertInv, [userId, 'small_potion', 2, now + 1]);
      const r = await db.query<{ qty: number }>(`SELECT qty FROM player_inventory WHERE user_id=$1 AND item_id=$2`, [userId, 'small_potion']);
      if (r.rows[0]?.qty !== 5) throw new Error(`qty = ${r.rows[0]?.qty}, expected 5`);
    });
  }

  const addCred = grabConst('battle/routes.ts', 'SQL_ADD_CREDITS');
  if (addCred) {
    await runCheck('add credits (SQL_ADD_CREDITS, ON CONFLICT DO UPDATE fires + additive)', async () => {
      await db.query(addCred, [userId, 60, now]);
      await db.query(addCred, [userId, 25, now + 1]);
      const r = await db.query<{ credits: number }>(`SELECT credits FROM player_wallet WHERE user_id=$1`, [userId]);
      if (r.rows[0]?.credits !== 85) throw new Error(`credits = ${r.rows[0]?.credits}, expected 85`);
    });
  }

  const upsertRes = grabConst('farm/engine.ts', 'SQL_UPSERT_RESOURCE');
  if (upsertRes) {
    await runCheck('upsert resources (SQL_UPSERT_RESOURCE, ON CONFLICT DO UPDATE fires + additive)', async () => {
      await db.query(upsertRes, [userId, 'Meat', 50, now]);
      await db.query(upsertRes, [userId, 'Meat', 30, now + 1]);
      const r = await db.query<{ amount: number }>(`SELECT amount FROM resources WHERE user_id=$1 AND resource=$2`, [userId, 'Meat']);
      if (r.rows[0]?.amount !== 80) throw new Error(`amount = ${r.rows[0]?.amount}, expected 80`);
    });
  }

  const searchScraped = grabConst('admin/routes.ts', 'SQL_SEARCH_SCRAPED');
  if (searchScraped) {
    await runCheck('search scraped (SQL_SEARCH_SCRAPED, case-insensitive LOWER+LIKE)', async () => {
      const r = await db.query<{ name: string }>(searchScraped, ['pgtest', '%PGTEST%', null, null, null, null, 10, 0]);
      if (!r.rows.some((row) => row.name === 'PGtestMon')) throw new Error(`no match: ${JSON.stringify(r.rows)}`);
    });
  }

  await runCheck('insert pending_buff', async () => {
    await db.query(
      `INSERT INTO pending_buffs(id, user_id, mon_id, effect_kind, magnitude, source_item, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ['buff_pgtest', userId, monId, 'xp_mult', 1.5, 'small_potion', now],
    );
  });

  await runCheck('transaction commit + rollback semantics', async () => {
    await db.exec('BEGIN');
    await db.query(`UPDATE player_wallet SET credits = credits - $1 WHERE user_id = $2`, [10, userId]);
    await db.exec('COMMIT');
    const afterCommit = await db.query<{ credits: number }>(`SELECT credits FROM player_wallet WHERE user_id=$1`, [userId]);
    if (afterCommit.rows[0]?.credits !== 75) throw new Error(`after commit credits=${afterCommit.rows[0]?.credits}, expected 75`);
    await db.exec('BEGIN');
    await db.query(`UPDATE player_wallet SET credits = credits - $1 WHERE user_id = $2`, [50, userId]);
    await db.exec('ROLLBACK');
    const afterRollback = await db.query<{ credits: number }>(`SELECT credits FROM player_wallet WHERE user_id=$1`, [userId]);
    if (afterRollback.rows[0]?.credits !== 75) throw new Error(`after rollback credits=${afterRollback.rows[0]?.credits}, expected 75`);
  });

  for (const c of checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.err ? ' — ' + c.err : ''}`);
  }
  const passed = checks.filter((c) => c.ok).length;
  await db.close();

  const bad = failures.length > 0 || passed !== checks.length;
  console.log(`\n═══ ${passed}/${checks.length} roundtrip checks passed, ${prepared}/${constants.length - skipped} PREPARE succeeded, ${failures.length} PREPARE failures ═══`);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error('validator crashed:', e); process.exit(1); });
