/**
 * Friends: symmetric graph stored asymmetrically so we can model pending
 * requests. Row semantics (see schema.sql):
 *   (requester_id, addressee_id, status)
 *     status = 'pending'   — request sent, addressee hasn't decided
 *     status = 'accepted'  — mutual friends
 *     status = 'blocked'   — requester blocked addressee
 *
 * Online status is derived at read time by asking the lobby WS registry,
 * which exports `isOnline(userId)` — kept as a callback to avoid a hard
 * cyclic import between lobby and social.
 *
 * Routes:
 *   GET  /api/friends            → { friends, incoming, outgoing }
 *   POST /api/friends/request    → { username }
 *   POST /api/friends/accept     → { userId }
 *   POST /api/friends/remove     → { userId }
 *   POST /api/friends/block      → { userId }
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { one, q, run, tx, type FriendshipRow, type UserRow } from '../db/index.js';
import { log } from '../util/log.js';

let isOnlineFn: (userId: string) => boolean = () => false;
export function setOnlineChecker(fn: (userId: string) => boolean): void {
  isOnlineFn = fn;
}

const SQL_SELECT_USER_BY_USERNAME = `SELECT * FROM users WHERE username = ?`;
const SQL_SELECT_USER_BY_ID = `SELECT * FROM users WHERE id = ?`;
const SQL_INSERT_FRIENDSHIP = `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`;
const SQL_UPSERT_FRIENDSHIP = `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(requester_id, addressee_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`;
const SQL_DELETE_FRIENDSHIP = `DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`;
const SQL_UPDATE_STATUS = `UPDATE friendships SET status = ?, updated_at = ? WHERE requester_id = ? AND addressee_id = ?`;
const SQL_SELECT_BY_USER = `SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ?`;

export type FriendView = {
  userId: string;
  displayName: string;
  online: boolean;
  since: number;
};

export type RequestView = {
  userId: string;
  displayName: string;
  at: number;
};

const RequestSchema = z.object({ username: z.string().trim().min(3).max(24) });
const IdSchema = z.object({ userId: z.string().min(3) });

function otherOf(row: FriendshipRow, me: string): string {
  return row.requester_id === me ? row.addressee_id : row.requester_id;
}

const SQL_BLOCKED_IDS = `SELECT requester_id, addressee_id FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'blocked'`;

/** Every user blocked by `userId` in either direction of the friendship row. */
export async function listBlockedUserIds(userId: string): Promise<string[]> {
  const rows = await q<Pick<FriendshipRow, 'requester_id' | 'addressee_id'>>(SQL_BLOCKED_IDS, userId, userId);
  return rows.map((row) => (row.requester_id === userId ? row.addressee_id : row.requester_id));
}

export const friendsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/friends', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const rows = await q<FriendshipRow>(SQL_SELECT_BY_USER, me.id, me.id);
    const friends: FriendView[] = [];
    const incoming: RequestView[] = [];
    const outgoing: RequestView[] = [];
    for (const r of rows) {
      const otherId = otherOf(r, me.id);
      const other = await one<UserRow>(SQL_SELECT_USER_BY_ID, otherId);
      if (!other) continue;
      if (r.status === 'accepted') {
        friends.push({
          userId: other.id,
          displayName: other.display_name,
          online: isOnlineFn(other.id),
          since: r.updated_at,
        });
      } else if (r.status === 'pending') {
        if (r.addressee_id === me.id) {
          incoming.push({ userId: other.id, displayName: other.display_name, at: r.created_at });
        } else {
          outgoing.push({ userId: other.id, displayName: other.display_name, at: r.created_at });
        }
      }
    }
    return reply.send({ friends, incoming, outgoing });
  });

  app.post('/api/friends/request', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const now = Date.now();
    const target = await one<UserRow>(SQL_SELECT_USER_BY_USERNAME, parsed.data.username);
    // Return the SAME `{status:'pending'}` shape for nonexistent-user and
    // blocked-relationship cases so this endpoint isn't a username-existence
    // oracle. Self-request keeps its 400 for legit UX.
    if (!target) return reply.send({ status: 'pending' });
    if (target.id === me.id) return reply.code(400).send({ error: 'cannot befriend yourself' });
    const blocked = await one<FriendshipRow>(
      `SELECT * FROM friendships WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) AND status = 'blocked'`,
      me.id, target.id, target.id, me.id,
    );
    if (blocked) {
      log.info('friends.request.blocked', { from: me.id, to: target.id });
      return reply.send({ status: 'pending' });
    }
    // If the target already sent us a pending request, accepting it upgrades to mutual.
    const existing = await one<FriendshipRow>(
      `SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ?`,
      target.id, me.id,
    );
    if (existing?.status === 'pending') {
      await run(SQL_UPDATE_STATUS, 'accepted', now, target.id, me.id);
      log.info('friends.accepted-on-reciprocate', { a: me.id, b: target.id });
      return reply.send({ status: 'accepted' });
    }
    try {
      await run(SQL_INSERT_FRIENDSHIP, me.id, target.id, 'pending', now, now);
    } catch {
      return reply.send({ status: 'pending' });
    }
    return reply.send({ status: 'pending' });
  });

  app.post('/api/friends/accept', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = IdSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const info = await run(SQL_UPDATE_STATUS, 'accepted', Date.now(), parsed.data.userId, me.id);
    if (info.changes === 0) {
      return reply.code(404).send({ error: 'no pending request from that user' });
    }
    return reply.send({ status: 'accepted' });
  });

  app.post('/api/friends/remove', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = IdSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    await tx(async (t) => {
      await t.run(SQL_DELETE_FRIENDSHIP, [me.id, parsed.data.userId, parsed.data.userId, me.id]);
    });
    return reply.send({ ok: true });
  });

  app.post('/api/friends/block', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = IdSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const now = Date.now();
    await tx(async (t) => {
      await t.run(SQL_DELETE_FRIENDSHIP, [me.id, parsed.data.userId, parsed.data.userId, me.id]);
      await t.run(SQL_UPSERT_FRIENDSHIP, [me.id, parsed.data.userId, 'blocked', now, now]);
    });
    return reply.send({ ok: true });
  });
};
