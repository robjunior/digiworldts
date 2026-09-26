/**
 * Direct-message chat + friend-request smoke test.
 *
 * Proves the exact wire contract the lobby chat relies on:
 *   1. A direct message ({ type:'chat', toUserId }) reaches ONLY sender +
 *      recipient — never the global `chat:global` fanout, never a bystander.
 *   2. A plain message still fans out to every connected client (General tab).
 *   3. POST /api/friends/request accepts { userId } (presence rows carry an id,
 *      not a username) and still accepts { username }.
 *
 * The cluster runs in-process (CLUSTER=memory) — no Redis needed.
 *
 * Run: pnpm --filter @digiworld/backend test:dm-chat
 * Needs the Node version better-sqlite3 was built for (v26 here — check with
 * `fnm exec --using v26.5.0 ...` when the shell's default Node differs).
 */
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import test from 'node:test';

import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { WebSocket } from 'ws';

import { hashPassword } from '../src/auth/password.js';
import { createSession } from '../src/auth/session.js';
import { closeCluster } from '../src/cluster/index.js';
import { closeDbAdapter, getDb } from '../src/db/adapter.js';
import { one, run } from '../src/db/index.js';
import { lobbyPlugin, stopLobbyLoops } from '../src/lobby/ws.js';
import { friendsPlugin } from '../src/social/friends.js';
import { newId } from '../src/util/ids.js';

type Frame = Record<string, unknown>;

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dm-chat-smoke.db';
const COOKIE_NAME = 'digiworld_sid';

/**
 * A fresh DB cannot be migrated in this repo right now: migrations that created
 * `dungeons` / `dungeon_tiles` were pruned from src/db/migrations, so 068 dies
 * with "no such table: dungeons" (pre-existing, unrelated to chat). When the
 * local dev DB exists we take a consistent VACUUM INTO snapshot of it (a plain
 * file copy would miss its -wal sidecar) and let the migrator run only when it
 * does not.
 */
const SEED_DB = resolve(process.cwd(), 'data/digiworld.db');

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Client = {
  readonly userId: string;
  readonly ws: WebSocket;
  readonly frames: Frame[];
};

async function connect(port: number, cookie: string, userId: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
  const frames: Frame[] = [];
  ws.on('message', (raw: unknown) => {
    try {
      frames.push(JSON.parse(String(raw)) as Frame);
    } catch {
      /* non-JSON frame — ignore */
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  // The server answers `hello` with `welcome` (same handshake the frontend
  // performs on open) — presence fanout proves auth, welcome proves the session
  // resolved to the expected user.
  ws.send(JSON.stringify({ type: 'hello' }));
  return { userId, ws, frames };
}

function findFrame(frames: readonly Frame[], pred: (f: Frame) => boolean): Frame | undefined {
  return frames.find(pred);
}

async function waitForFrame(
  client: Client,
  pred: (f: Frame) => boolean,
  label: string,
): Promise<Frame> {
  const deadline = Date.now() + 4_000;
  for (;;) {
    const hit = findFrame(client.frames, pred);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `timeout waiting for "${label}" on ${client.userId}; saw=${JSON.stringify(client.frames)}`,
      );
    }
    await sleep(20);
  }
}

const isChat = (f: Frame): boolean => f.type === 'chat';

async function main(): Promise<void> {
  console.log(`DM chat smoke test — DB_PATH=${DB_PATH}\n`);

  const fs = await import('node:fs');
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  if (fs.existsSync(SEED_DB)) {
    const { default: Database } = await import('better-sqlite3');
    const seed = new Database(SEED_DB, { readonly: true });
    try {
      seed.exec(`VACUUM INTO '${DB_PATH}'`);
    } finally {
      seed.close();
    }
  }
  await getDb();

  const app = Fastify();
  await app.register(fastifyCookie, {
    secret: 'test-secret-that-is-at-least-32-chars-long',
    hook: 'onRequest',
  });
  await app.register(fastifyWebsocket);
  await app.register(friendsPlugin);
  await app.register(lobbyPlugin);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;

  async function createUser(prefix: string): Promise<{ id: string; username: string; cookie: string }> {
    const id = newId('usr');
    // RequestSchema caps usernames at 24 chars, so build a short one.
    const username = `${prefix}${Math.random().toString(36).slice(2, 9)}`;
    const pwd = await hashPassword('pass');
    const now = Date.now();
    await run(
      `INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, username, username, pwd, now, now],
    );
    const sess = await createSession({ userId: id, userAgent: 'test', ip: '127.0.0.1' });
    const signed = app.signCookie(sess.token);
    return { id, username, cookie: `${COOKIE_NAME}=${signed}` };
  }

  const alice = await createUser('alice');
  const bob = await createUser('bob');
  const carol = await createUser('carol');

  const a = await connect(port, alice.cookie, alice.id);
  const b = await connect(port, bob.cookie, bob.id);
  const c = await connect(port, carol.cookie, carol.id);

  try {
    await waitForFrame(a, (f) => f.type === 'welcome', 'welcome A');
    await waitForFrame(b, (f) => f.type === 'welcome', 'welcome B');
    await waitForFrame(c, (f) => f.type === 'welcome', 'welcome C');
    check('all three clients authenticated and welcomed', true);

    // ---------------------------------------------------------------- 1) DM
    console.log('\n=== 1) direct message (toUserId) ===');
    a.ws.send(JSON.stringify({ type: 'chat', text: 'dm-1', toUserId: bob.id }));

    const aDm = await waitForFrame(
      a,
      (f) => isChat(f) && f.text === 'dm-1',
      'DM echo to sender',
    );
    const bDm = await waitForFrame(
      b,
      (f) => isChat(f) && f.text === 'dm-1',
      'DM delivery to recipient',
    );
    check('sender receives its own DM echo', aDm.toUserId === bob.id, `toUserId=${String(aDm.toUserId)}`);
    check('recipient receives the DM', bDm.from === alice.id && bDm.toUserId === bob.id, JSON.stringify(bDm));

    await sleep(300); // give a global fanout time to land if the routing regressed
    check(
      'bystander receives no DM frame',
      findFrame(c.frames, (f) => isChat(f) && f.text === 'dm-1') === undefined,
      `carol saw=${JSON.stringify(c.frames.filter(isChat))}`,
    );

    // ------------------------------------------------------------ 2) General
    console.log('\n=== 2) General message still broadcasts ===');
    a.ws.send(JSON.stringify({ type: 'chat', text: 'general-1' }));
    const cGeneral = await waitForFrame(
      c,
      (f) => isChat(f) && f.text === 'general-1',
      'General broadcast to bystander',
    );
    check(
      'bystander receives General chat',
      cGeneral.toUserId === undefined && cGeneral.from === alice.id,
      JSON.stringify(cGeneral),
    );
    const aGeneral = await waitForFrame(a, (f) => isChat(f) && f.text === 'general-1', 'General echo');
    check('sender sees own General message without toUserId', aGeneral.toUserId === undefined);

    // ------------------------------------------------- 3) friend request by id
    console.log('\n=== 3) POST /api/friends/request { userId } ===');
    const byId = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { cookie: alice.cookie },
      payload: { userId: bob.id },
    });
    check('request by userId returns 200 + pending', byId.statusCode === 200 && byId.json().status === 'pending', `${byId.statusCode} ${byId.body}`);
    const row = await one<{ requester_id: string; addressee_id: string; status: string }>(
      `SELECT requester_id, addressee_id, status FROM friendships WHERE requester_id = ? AND addressee_id = ?`,
      alice.id,
      bob.id,
    );
    check('friendship row is pending for the exact target id', row?.status === 'pending' && row?.addressee_id === bob.id, JSON.stringify(row));

    const byUsername = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { cookie: carol.cookie },
      payload: { username: alice.username },
    });
    check('request by username still works', byUsername.statusCode === 200 && byUsername.json().status === 'pending', `${byUsername.statusCode} ${byUsername.body}`);

    const selfReq = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { cookie: alice.cookie },
      payload: { userId: alice.id },
    });
    check('self-request by userId is rejected 400', selfReq.statusCode === 400, String(selfReq.statusCode));

    const badReq = await app.inject({
      method: 'POST',
      url: '/api/friends/request',
      headers: { cookie: alice.cookie },
      payload: { nope: true },
    });
    check('invalid body is rejected 400', badReq.statusCode === 400, String(badReq.statusCode));
  } finally {
    for (const client of [a, b, c]) {
      try {
        client.ws.close();
      } catch {
        /* already closed */
      }
    }
    stopLobbyLoops();
    await app.close();
    await closeCluster();
    await closeDbAdapter();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
