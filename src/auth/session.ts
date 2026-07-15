/**
 * Session + login-throttling on top of the Cluster abstraction.
 *
 * Storage layout (works identically on memory or Redis):
 *   session:{token}         → JSON { userId, createdAt, expiresAt, userAgent, ip }
 *   usessions:{userId}      → ZSET member=token, score=expiresAt (for revoke-all)
 *   loginfail:user:{name}   → counter (TTL 15min)
 *   loginfail:ip:{ip}       → counter (TTL 15min)
 *
 * Every operation is async so any node in the cluster can authenticate any
 * cookie. Sliding renewal: on resolve past half-life we bump the TTL.
 *
 * The user row itself is still read from the DB (users table) for the
 * returned SessionInfo — that lookup stays sync via better-sqlite3 until
 * the async DbAdapter refactor lands across route files.
 */
import { config } from '../config.js';
import { getCluster } from '../cluster/index.js';
import { one, type UserRow } from '../db/index.js';
import { newSessionToken } from '../util/ids.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
// Side-effect import: augments FastifyReply with setCookie/clearCookie and
// FastifyRequest with .cookies. Runtime plugin is registered in server.ts.
import type {} from '@fastify/cookie';

export const SESSION_COOKIE_NAME = 'digiworld_sid';

const TTL_MS = config.SESSION_TTL_HOURS * 60 * 60 * 1000;
const TTL_SEC = Math.ceil(TTL_MS / 1000);
const RENEW_THRESHOLD_MS = Math.floor(TTL_MS / 2);

const K_SESSION = (token: string): string => `session:${token}`;
const K_USER_SESSIONS = (userId: string): string => `usessions:${userId}`;
const K_LOGIN_FAIL_USER = (name: string): string => `loginfail:user:${name.toLowerCase()}`;
const K_LOGIN_FAIL_IP = (ip: string): string => `loginfail:ip:${ip}`;

const SQL_SELECT_USER_BY_ID = `SELECT * FROM users WHERE id = ?`;

type StoredSession = {
  userId: string;
  createdAt: number;
  expiresAt: number;
  userAgent: string | null;
  ip: string | null;
};

// ============================================================================
// Public API
// ============================================================================

export type CreateSessionInput = {
  userId: string;
  userAgent?: string | undefined;
  ip?: string | undefined;
};

export type SessionInfo = {
  token: string;
  user: UserRow;
  expiresAt: number;
};

export async function createSession(input: CreateSessionInput): Promise<SessionInfo> {
  const cluster = await getCluster();
  const token = newSessionToken();
  const now = Date.now();
  const expiresAt = now + TTL_MS;
  const stored: StoredSession = {
    userId: input.userId,
    createdAt: now,
    expiresAt,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
  };
  await cluster.set(K_SESSION(token), JSON.stringify(stored), TTL_SEC);
  await cluster.zadd(K_USER_SESSIONS(input.userId), expiresAt, token);
  const user = await one<UserRow>(SQL_SELECT_USER_BY_ID, input.userId);
  if (!user) throw new Error(`session created for unknown user ${input.userId}`);
  return { token, user, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<SessionInfo | null> {
  if (!token || token.length !== 64) return null;
  const cluster = await getCluster();
  const raw = await cluster.get(K_SESSION(token));
  if (!raw) return null;
  let stored: StoredSession;
  try { stored = JSON.parse(raw) as StoredSession; }
  catch { await cluster.del(K_SESSION(token)); return null; }
  const now = Date.now();
  if (stored.expiresAt < now) {
    await cluster.del(K_SESSION(token));
    await cluster.zrem(K_USER_SESSIONS(stored.userId), token);
    return null;
  }
  const user = await one<UserRow>(SQL_SELECT_USER_BY_ID, stored.userId);
  if (!user || user.disabled === 1) {
    await cluster.del(K_SESSION(token));
    return null;
  }
  let expiresAt = stored.expiresAt;
  if (stored.expiresAt - now < RENEW_THRESHOLD_MS) {
    expiresAt = now + TTL_MS;
    stored.expiresAt = expiresAt;
    await cluster.set(K_SESSION(token), JSON.stringify(stored), TTL_SEC);
    await cluster.zadd(K_USER_SESSIONS(user.id), expiresAt, token);
  }
  return { token, user, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  const cluster = await getCluster();
  const raw = await cluster.get(K_SESSION(token));
  if (raw) {
    try {
      const stored = JSON.parse(raw) as StoredSession;
      await cluster.zrem(K_USER_SESSIONS(stored.userId), token);
    } catch {}
  }
  await cluster.del(K_SESSION(token));
}

export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  const cluster = await getCluster();
  const tokens = await cluster.zrange(K_USER_SESSIONS(userId), 0, -1);
  for (const t of tokens) await cluster.del(K_SESSION(t.member));
  await cluster.del(K_USER_SESSIONS(userId));
}

/** No-op — cluster TTLs expire keys automatically. Kept for API parity. */
export async function pruneExpired(): Promise<number> {
  return 0;
}

// ============================================================================
// Cookie helpers (still sync — no I/O)
// ============================================================================

const IS_PROD = config.NODE_ENV === 'production';

function cookieOpts(): { path: string; httpOnly: boolean; sameSite: 'lax'; secure: boolean; maxAge: number } {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: TTL_SEC };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, cookieOpts());
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

export function readSessionCookie(req: FastifyRequest): string | null {
  const raw = req.cookies?.[SESSION_COOKIE_NAME];
  if (!raw) return null;
  return typeof raw === 'string' ? raw : String(raw);
}

// ============================================================================
// Login throttling (cluster counters with TTL — replaces the SQL sliding window)
// ============================================================================

const WINDOW_SEC = 15 * 60;
const MAX_ATTEMPTS_PER_USER = 8;
const MAX_ATTEMPTS_PER_IP = 20;

export async function recordLoginAttempt(username: string, ip: string | undefined, success: boolean): Promise<void> {
  if (success) return;
  const cluster = await getCluster();
  const userKey = K_LOGIN_FAIL_USER(username);
  const current = await cluster.get(userKey);
  const n = current ? Number(current) + 1 : 1;
  await cluster.set(userKey, String(n), WINDOW_SEC);
  if (ip) {
    const ipKey = K_LOGIN_FAIL_IP(ip);
    const cur = await cluster.get(ipKey);
    const m = cur ? Number(cur) + 1 : 1;
    await cluster.set(ipKey, String(m), WINDOW_SEC);
  }
}

export type ThrottleCheck = { allowed: true } | { allowed: false; reason: string; retryInSec: number };

export async function checkLoginThrottle(username: string, ip: string | undefined): Promise<ThrottleCheck> {
  const cluster = await getCluster();
  const byUser = Number((await cluster.get(K_LOGIN_FAIL_USER(username))) ?? '0');
  if (byUser >= MAX_ATTEMPTS_PER_USER) {
    return { allowed: false, reason: 'too many failed attempts for this account', retryInSec: WINDOW_SEC };
  }
  if (ip) {
    const byIp = Number((await cluster.get(K_LOGIN_FAIL_IP(ip))) ?? '0');
    if (byIp >= MAX_ATTEMPTS_PER_IP) {
      return { allowed: false, reason: 'too many failed attempts from your address', retryInSec: WINDOW_SEC };
    }
  }
  return { allowed: true };
}

/** No-op — cluster TTLs expire counters automatically. Kept for API parity. */
export async function pruneOldLoginAttempts(): Promise<number> {
  return 0;
}
