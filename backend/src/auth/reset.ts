/**
 * Admin-issued password-reset tokens on top of the Cluster.
 *
 * Storage:
 *   reset:{token}         → JSON { userId, issuedAt, expiresAt } (TTL 15 min)
 *   reset:fail:ip:{ip}    → counter (TTL 15 min) — IP-scoped rate limit
 *
 * Flow:
 *   1. Admin calls POST /api/admin/users/:id/reset-token → { token, expiresAt, url }
 *   2. Admin conveys the token to the user via any out-of-band channel.
 *   3. User POSTs to /api/auth/reset-consume { token, newPassword }.
 *   4. Backend validates + hashes + updates users.password_hash + revokes all
 *      sessions for that user + deletes the token (single-use).
 *
 * Why admin-issued instead of email flow: MVP has no SMTP, and this doesn't
 * assume users have email on file. Complements the existing hard-reset in
 * admin/users.ts (where admin picks the password directly) — this flow lets
 * the user pick their own password so the admin never learns it.
 */
import { getCluster } from '../cluster/index.js';
import { newSessionToken } from '../util/ids.js';

const TOKEN_TTL_SEC = 15 * 60;
const IP_ATTEMPT_WINDOW_SEC = 15 * 60;
const IP_MAX_ATTEMPTS = 10;

const K_TOKEN = (token: string): string => `reset:${token}`;
const K_IP_ATTEMPTS = (ip: string): string => `reset:fail:ip:${ip}`;

export type StoredResetToken = {
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

export async function issueResetToken(userId: string): Promise<{ token: string; expiresAt: number }> {
  const cluster = await getCluster();
  const token = newSessionToken();
  const now = Date.now();
  const expiresAt = now + TOKEN_TTL_SEC * 1000;
  const stored: StoredResetToken = { userId, issuedAt: now, expiresAt };
  await cluster.set(K_TOKEN(token), JSON.stringify(stored), TOKEN_TTL_SEC);
  return { token, expiresAt };
}

export async function resolveResetToken(token: string): Promise<StoredResetToken | null> {
  if (typeof token !== 'string' || token.length !== 64) return null;
  const cluster = await getCluster();
  const raw = await cluster.get(K_TOKEN(token));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredResetToken;
    if (parsed.expiresAt < Date.now()) {
      await cluster.del(K_TOKEN(token));
      return null;
    }
    return parsed;
  } catch {
    await cluster.del(K_TOKEN(token));
    return null;
  }
}

export async function consumeResetToken(token: string): Promise<void> {
  const cluster = await getCluster();
  await cluster.del(K_TOKEN(token));
}

export type ResetThrottleCheck = { allowed: true } | { allowed: false; retryInSec: number };

export async function checkResetThrottle(ip: string | undefined): Promise<ResetThrottleCheck> {
  if (!ip) return { allowed: true };
  const cluster = await getCluster();
  const raw = await cluster.get(K_IP_ATTEMPTS(ip));
  const n = raw ? Number(raw) : 0;
  if (n >= IP_MAX_ATTEMPTS) {
    return { allowed: false, retryInSec: IP_ATTEMPT_WINDOW_SEC };
  }
  return { allowed: true };
}

export async function recordResetAttempt(ip: string | undefined, success: boolean): Promise<void> {
  if (!ip || success) return;
  const cluster = await getCluster();
  const key = K_IP_ATTEMPTS(ip);
  const raw = await cluster.get(key);
  const n = raw ? Number(raw) + 1 : 1;
  await cluster.set(key, String(n), IP_ATTEMPT_WINDOW_SEC);
}
