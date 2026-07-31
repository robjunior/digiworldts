import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import assert, { strictEqual } from 'node:assert';
import { linkPlugin } from '../src/link/routes.ts';
import { authPlugin } from '../src/auth/routes.ts';
import { issueDiscordLinkCode, consumeDiscordLinkCode, hashDiscordLinkCode, normalizeDiscordLinkCode } from '../src/auth/discord-link.ts';
import { createSession, SESSION_COOKIE_NAME } from '../src/auth/session.ts';
import { hashPassword } from '../src/auth/password.ts';
import { closeCluster, getCluster } from '../src/cluster/index.ts';
import { closeDb, one, run } from '../src/db/index.ts';
import { closeDbAdapter, getDb } from '../src/db/adapter.ts';
import { config } from '../src/config.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-discord-link-test.db';
for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(file)) unlinkSync(file);
}

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL: ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function insertUser(id: string, username: string, discordId: string | null = null): Promise<void> {
  const now = Date.now();
  const passwordHash = await hashPassword('password-1234');
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at, discord_id) VALUES (?,?,?,?,?,?,?,?)',
    [id, username, username, passwordHash, 0, now, now, discordId],
  );
}

async function issueFor(userId: string): Promise<string> {
  return (await issueDiscordLinkCode(userId)).code;
}

async function linkedDiscord(userId: string): Promise<string | null> {
  return (await one<{ readonly discord_id: string | null }>('SELECT discord_id FROM users WHERE id = ?', userId))?.discord_id ?? null;
}

async function main(): Promise<void> {
  process.env.DB_PATH = DB_PATH;
  seedMigrationLedgerSkips();
  await getDb();
  await insertUser('usr_link_a', 'link_a');
  await insertUser('usr_link_b', 'link_b');
  await insertUser('usr_link_c', 'link_c', 'discord-existing-game');
  await insertUser('usr_link_d', 'link_d', 'discord-existing-other');

  await check('code issuance requires auth', async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyCookie, { secret: config.SESSION_SECRET });
    await app.register(linkPlugin);
    const response = await app.inject({ method: 'GET', url: '/api/link/discord/code' });
    strictEqual(response.statusCode, 401);
    assert(!response.body.includes('DW-'));
    await app.close();
  });

  await check('authenticated route issues minimal HTML code', async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyCookie, { secret: config.SESSION_SECRET });
    await app.register(authPlugin);
    await app.register(linkPlugin);
    const session = await createSession({ userId: 'usr_link_a' });
    const cookie = `${SESSION_COOKIE_NAME}=${app.signCookie(session.token)}`;
    const response = await app.inject({ method: 'GET', url: '/api/link/discord/code', headers: { cookie } });
    strictEqual(response.statusCode, 200);
    strictEqual(response.headers['cache-control'], 'no-store');
    strictEqual(response.headers['referrer-policy'], 'no-referrer');
    assert(/DW-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/.test(response.body));
    await app.close();
  });

  await check('issued code resolves to correct userId', async () => {
    const code = await issueFor('usr_link_a');
    const result = await consumeDiscordLinkCode({ discordId: 'discord-a', code });
    assert(result.kind === 'linked');
    strictEqual(result.userId, 'usr_link_a');
    strictEqual(await linkedDiscord('usr_link_a'), 'discord-a');
  });

  await check('expired code returns 410', async () => {
    const code = 'DW-0000-0000-0000-0000-0000';
    const hash = hashDiscordLinkCode(normalizeDiscordLinkCode(code));
    const cluster = await getCluster();
    await cluster.set(`discordlink:code:${hash}`, JSON.stringify({ v: 1, userId: 'usr_link_b', issuedAt: 1, expiresAt: 2 }), 300);
    const result = await consumeDiscordLinkCode({ discordId: 'discord-expired', code });
    assert(result.kind === 'error');
    strictEqual(result.status, 410);
    strictEqual(result.code, 'link-code-expired');
  });

  await check('replay returns 410 after first consume', async () => {
    const code = await issueFor('usr_link_b');
    const first = await consumeDiscordLinkCode({ discordId: 'discord-b', code });
    assert(first.kind === 'linked');
    const second = await consumeDiscordLinkCode({ discordId: 'discord-b', code });
    assert(second.kind === 'error');
    strictEqual(second.status, 410);
  });

  await check('concurrent consumption links once', async () => {
    await insertUser('usr_link_concurrent', 'link_concurrent');
    const code = await issueFor('usr_link_concurrent');
    const results = await Promise.all([
      consumeDiscordLinkCode({ discordId: 'discord-concurrent', code }),
      consumeDiscordLinkCode({ discordId: 'discord-concurrent', code }),
    ]);
    const successCount = results.filter((result) => result.kind === 'linked').length;
    const terminalCount = results.filter((result) => result.kind === 'error' && (result.status === 409 || result.status === 410)).length;
    strictEqual(successCount, 1);
    strictEqual(terminalCount, 1);
    strictEqual(await linkedDiscord('usr_link_concurrent'), 'discord-concurrent');
  });

  await check('discord already linked to another game user returns 409', async () => {
    await insertUser('usr_link_discord_conflict', 'link_discord_conflict');
    const code = await issueFor('usr_link_discord_conflict');
    const result = await consumeDiscordLinkCode({ discordId: 'discord-existing-other', code });
    assert(result.kind === 'error');
    strictEqual(result.status, 409);
    strictEqual(result.code, 'discord-already-linked');
  });

  await check('game user already linked to another Discord returns 409', async () => {
    const code = await issueFor('usr_link_c');
    const result = await consumeDiscordLinkCode({ discordId: 'discord-new-game-conflict', code });
    assert(result.kind === 'error');
    strictEqual(result.status, 409);
    strictEqual(result.code, 'game-user-already-linked');
  });

  await check('same-pair re-link is idempotent', async () => {
    const code = await issueFor('usr_link_c');
    const result = await consumeDiscordLinkCode({ discordId: 'discord-existing-game', code });
    assert(result.kind === 'linked');
    strictEqual(result.alreadyLinked, true);
  });

  await check('unique race conflict does not surface 500', async () => {
    await insertUser('usr_race_a', 'race_a');
    await insertUser('usr_race_b', 'race_b');
    const codeA = await issueFor('usr_race_a');
    const codeB = await issueFor('usr_race_b');
    const first = await consumeDiscordLinkCode({ discordId: 'discord-race', code: codeA });
    const second = await consumeDiscordLinkCode({ discordId: 'discord-race', code: codeB });
    assert(first.kind === 'linked');
    assert(second.kind === 'error');
    strictEqual(second.status, 409);
  });

  await check('11th failed attempt returns 429', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = await consumeDiscordLinkCode({ discordId: 'discord-throttle', code: `DW-FFFF-FFFF-FFFF-FFFF-FF${String(attempt).padStart(2, '0')}` });
      assert(result.kind === 'error');
      strictEqual(result.status, 410);
    }
    const blocked = await consumeDiscordLinkCode({ discordId: 'discord-throttle', code: 'DW-EEEE-EEEE-EEEE-EEEE-EEEE' });
    assert(blocked.kind === 'error');
    strictEqual(blocked.status, 429);
    strictEqual(blocked.code, 'link-code-rate-limited');
  });

  await closeCluster();
  await closeDbAdapter();
  try { closeDb(); } catch {}
  for (const file of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(file)) unlinkSync(file);
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

function seedMigrationLedgerSkips(): void {
  const handle = new Database(DB_PATH);
  try {
    handle.exec(readFileSync(resolve('src/db/schema.sql'), 'utf8'));
    handle.exec('ALTER TABLE users ADD COLUMN discord_id TEXT');
    handle.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id) WHERE discord_id IS NOT NULL');
    handle.exec('CREATE TABLE IF NOT EXISTS schema_versions (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');
    const insert = handle.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)');
    const now = Date.now();
    for (const filename of readdirSync(resolve('src/db/migrations'))) {
      if (!filename.endsWith('.sql') || filename.endsWith('.pg.sql')) continue;
      const version = filename.endsWith('.sqlite.sql')
        ? filename.slice(0, -'.sqlite.sql'.length)
        : filename.slice(0, -'.sql'.length);
      insert.run(version, now);
    }
  } finally {
    handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('FATAL:', error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
