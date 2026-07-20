/**
 * Fastify auth plugin: /api/auth/register, /login, /logout, /me, /status.
 *
 * First-user-is-admin rule: registration is OPEN by default. The first user
 * to register is auto-flagged `is_admin=1`; every subsequent register is a
 * regular player. Set `ADMIN_BOOTSTRAP=closed` to disable new registrations.
 *
 * All DB access routes through the async DbAdapter (SQLite or Postgres).
 * Every route validates input with Zod. Errors are shaped as
 * { error: string, details?: unknown } and never leak internals.
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, run, tx, type UserRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { hashPassword, verifyPassword, validatePasswordPolicy } from './password.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionCookie,
  resolveSession,
  setSessionCookie,
  checkLoginThrottle,
  recordLoginAttempt,
} from './session.js';
import { config } from '../config.js';
import { seedFarmForUser } from '../farm/engine.js';
import { seedTrainingStationForUser } from '../training/engine.js';

// ============================================================================
// SQL
// ============================================================================
const SQL_COUNT_USERS = `SELECT COUNT(*) AS n FROM users`;
// COLLATE NOCASE not needed in query: users.username is TEXT COLLATE NOCASE
// on SQLite and CITEXT on Postgres, so equality is case-insensitive at the
// column level. Explicit COLLATE NOCASE in the query is invalid on Postgres.
const SQL_SELECT_BY_USERNAME = `SELECT * FROM users WHERE username = ?`;
const SQL_INSERT_USER = `INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_LAST_LOGIN = `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`;
const SQL_INIT_WALLET = `INSERT INTO player_wallet (user_id, credits, streak_day, updated_at) VALUES (?, 0, 0, ?) ON CONFLICT DO NOTHING`;
const SQL_INIT_RESOURCE = `INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT DO NOTHING`;

// ============================================================================
// Input schemas
// ============================================================================
const UsernameSchema = z
  .string()
  .trim()
  .min(3, 'username must be at least 3 characters')
  .max(24, 'username must be 24 characters or fewer')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'username may only contain letters, numbers, dot, underscore, hyphen');

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, 'display name required')
  .max(32, 'display name must be 32 characters or fewer');

const RegisterSchema = z.object({
  username: UsernameSchema,
  displayName: DisplayNameSchema.optional(),
  password: z.string().min(1),
});

const LoginSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1),
});

// ============================================================================
// Public shapes (never expose password_hash)
// ============================================================================

export type PublicUser = {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  onboardingCompleted: boolean;
  mmr: number;
};

function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    isAdmin: u.is_admin === 1,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    onboardingCompleted: u.onboarding_completed_at != null,
    mmr: u.mmr,
  };
}

/** Resolve the client IP via Fastify's `req.ip`, which respects `trustProxy`
 *  (set to `1` in server.ts so only the last hop — our nginx — is trusted).
 *  Reading `X-Forwarded-For[0]` directly is UNSAFE: the first hop is
 *  attacker-controlled and defeated the per-IP login throttle. */
function clientIp(req: FastifyRequest): string | undefined {
  return req.ip;
}

/** Resolve the authenticated user from the session cookie; null if absent. */
export async function currentUser(req: FastifyRequest): Promise<PublicUser | null> {
  const token = readSessionCookie(req);
  const session = await resolveSession(token ?? undefined);
  return session ? toPublic(session.user) : null;
}

/** Guard: require any authenticated user. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<PublicUser> {
  const user = await currentUser(req);
  if (!user) {
    reply.code(401).send({ error: 'not authenticated' });
    throw new Error('unauthenticated');
  }
  return user;
}

/** Guard: require an admin. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<PublicUser> {
  const user = await requireAuth(req, reply);
  if (!user.isAdmin) {
    reply.code(403).send({ error: 'admin only' });
    throw new Error('not-admin');
  }
  return user;
}

// ============================================================================
// Plugin
// ============================================================================
export const authPlugin: FastifyPluginAsync = async (app: FastifyInstance): Promise<void> => {
  app.post('/api/auth/register', async (req, reply) => {
    if (config.ADMIN_BOOTSTRAP === 'closed') {
      return reply.code(403).send({ error: 'registration is closed on this server' });
    }

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid registration', details: parsed.error.issues });
    }
    const { username, displayName, password } = parsed.data;
    const policy = validatePasswordPolicy(password);
    if (!policy.ok) return reply.code(400).send({ error: policy.reason });

    const existing = await one<UserRow>(SQL_SELECT_BY_USERNAME, username);
    if (existing) return reply.code(409).send({ error: 'username is taken' });

    const now = Date.now();
    const id = newId('usr');
    const hash = await hashPassword(password);

    // First-user-is-admin race defense (H2). Count MUST be read inside the
    // tx that inserts, and the check MUST be serialized across concurrent
    // register requests. SQLite: BEGIN IMMEDIATE (used by SqliteAdapter)
    // already serializes writers. Postgres: default READ COMMITTED lets
    // two concurrent txs both see count=0; take a session-wide advisory
    // lock (bound to the tx) to serialize on the specific bootstrap key.
    // No unique index needed — admin promotion via /api/admin/users/:id/flags
    // stays legal because the constraint doesn't exist post-bootstrap.
    await tx(async (t) => {
      if (t.kind === 'postgres') {
        await t.run('SELECT pg_advisory_xact_lock(?)', [424242]);
      }
      const cnt = await t.one<{ n: number }>(SQL_COUNT_USERS);
      const isAdmin: 0 | 1 = (cnt?.n ?? 0) === 0 ? 1 : 0;
      await t.run(SQL_INSERT_USER, [id, username, displayName ?? username, hash, isAdmin, now, now]);
      await t.run(SQL_INIT_WALLET, [id, now]);
      for (const res of ['Meat', 'Bits', 'Data'] as const) {
        await t.run(SQL_INIT_RESOURCE, [id, res, now]);
      }
    });

    const user = await one<UserRow>(SQL_SELECT_BY_USERNAME, username);
    if (!user) return reply.code(500).send({ error: 'failed to load newly created user' });

    const session = await createSession({ userId: user.id, userAgent: req.headers['user-agent'], ip: clientIp(req) });
    setSessionCookie(reply, session.token);
    await run(SQL_UPDATE_LAST_LOGIN, now, now, user.id);

    // Best-effort seed. Register must still succeed if catalog is empty.
    try {
      await seedFarmForUser(user.id);
    } catch (err) {
      log.warn('auth.register.seed-farm.fail', { userId: user.id, err: err instanceof Error ? err.message : String(err) });
    }
    try {
      await seedTrainingStationForUser(user.id);
    } catch (err) {
      log.warn('auth.register.seed-training.fail', { userId: user.id, err: err instanceof Error ? err.message : String(err) });
    }

    log.info('auth.register.ok', { userId: user.id, isAdmin: user.is_admin === 1 });
    return reply.code(201).send({ user: toPublic(user) });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid login', details: parsed.error.issues });
    }
    const { username, password } = parsed.data;
    const ip = clientIp(req);

    const throttle = await checkLoginThrottle(username, ip);
    if (!throttle.allowed) {
      return reply
        .code(429)
        .header('Retry-After', String(throttle.retryInSec))
        .send({ error: throttle.reason });
    }

    const user = await one<UserRow>(SQL_SELECT_BY_USERNAME, username);
    // Always run a hash op even for missing users to blunt timing side-channel.
    const stored = user?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$aaaaaaaaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const ok = await verifyPassword(stored, password);
    if (!user || !ok || user.disabled === 1) {
      await recordLoginAttempt(username, ip, false);
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    const now = Date.now();
    await run(SQL_UPDATE_LAST_LOGIN, now, now, user.id);
    const session = await createSession({ userId: user.id, userAgent: req.headers['user-agent'], ip });
    setSessionCookie(reply, session.token);
    await recordLoginAttempt(username, ip, true);

    log.info('auth.login.ok', { userId: user.id });
    return reply.send({ user: toPublic(user) });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = readSessionCookie(req);
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'not authenticated' });
    const registrationOpen = config.ADMIN_BOOTSTRAP !== 'closed';
    return reply.send({ user, registrationOpen });
  });

  app.get('/api/auth/status', async (_req, reply) => {
    const existingCountRow = await one<{ n: number }>(SQL_COUNT_USERS);
    const existingCount = existingCountRow?.n ?? 0;
    const registrationOpen = config.ADMIN_BOOTSTRAP !== 'closed';
    return reply.send({ userCount: existingCount, registrationOpen });
  });
};
