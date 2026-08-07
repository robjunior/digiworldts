/**
 * Short-lived OAuth artifacts stored in the cluster KV.
 *
 * Two distinct token kinds — do not conflate them:
 *
 *   `oauth:state:{token}`     issued BEFORE the Discord round-trip. CSRF
 *                             protection: the same token must come back on
 *                             the callback. Also carries the flow context
 *                             (login vs link, where to redirect after).
 *                             Consumed single-use in the callback.
 *
 *   `oauth:pending:{token}`   issued AFTER a successful Discord callback
 *                             when the identified provider account is not
 *                             yet linked to any DigiWorld user. The
 *                             frontend previews the token (username +
 *                             avatar preview) then POSTs back with the
 *                             user's decision (create new / link existing).
 *                             Consumed single-use on decision.
 *
 * Both share the same 10-minute TTL and the same secure-random token shape
 * so a leak / URL log of one is exactly as bad as a leak of the other:
 * ten minutes of window and no cross-issuance.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../../config.js';
import { getCluster } from '../../cluster/index.js';

import { OAuthPendingSchema, OAuthStateSchema, type OAuthPending, type OAuthState } from './types.js';

const TTL_SEC = 10 * 60;

const K_STATE = (token: string): string => `oauth:state:${token}`;
const K_PENDING = (token: string): string => `oauth:pending:${token}`;

const STATE_COOKIE_NAME = 'digiworld_oauth_state';
const STATE_COOKIE_PATH = '/api/auth/oauth';

function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export type IssuedState = { readonly token: string; readonly expiresAt: number };

export async function issueState(input: Omit<OAuthState, 'v' | 'issuedAt'>): Promise<IssuedState> {
  const cluster = await getCluster();
  const token = newOpaqueToken();
  const now = Date.now();
  const state: OAuthState = { v: 1, issuedAt: now, ...input };
  await cluster.set(K_STATE(token), JSON.stringify(state), TTL_SEC);
  return { token, expiresAt: now + TTL_SEC * 1000 };
}

export async function consumeState(token: string): Promise<OAuthState | null> {
  const cluster = await getCluster();
  const raw = await cluster.get(K_STATE(token));
  if (raw === null) return null;
  await cluster.del(K_STATE(token));
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = OAuthStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type IssuedPending = { readonly token: string; readonly expiresAt: number };

export async function issuePending(input: Omit<OAuthPending, 'v' | 'issuedAt'>): Promise<IssuedPending> {
  const cluster = await getCluster();
  const token = newOpaqueToken();
  const now = Date.now();
  const pending: OAuthPending = { v: 1, issuedAt: now, ...input };
  await cluster.set(K_PENDING(token), JSON.stringify(pending), TTL_SEC);
  return { token, expiresAt: now + TTL_SEC * 1000 };
}

export async function readPending(token: string): Promise<OAuthPending | null> {
  const cluster = await getCluster();
  const raw = await cluster.get(K_PENDING(token));
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = OAuthPendingSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function consumePending(token: string): Promise<OAuthPending | null> {
  const pending = await readPending(token);
  if (pending === null) return null;
  const cluster = await getCluster();
  await cluster.del(K_PENDING(token));
  return pending;
}

/**
 * Bind the state token to the initiating browser with a signed HttpOnly
 * cookie. The callback must present the same token in BOTH the URL `state`
 * param AND this cookie — mismatch = CSRF, reject.
 *
 * SameSite=Lax lets the cookie ride the provider's top-level 302 back to
 * us (OAuth callbacks are GETs, so Lax is sufficient); Strict would drop
 * the cookie on the cross-site redirect and break the flow entirely.
 */
export function attachStateCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(STATE_COOKIE_NAME, token, {
    path: STATE_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: TTL_SEC,
    signed: true,
  });
}

/**
 * Constant-time verify that the request's state-binding cookie matches the
 * URL-supplied state token. Returns false on any mismatch, missing cookie,
 * or invalid signature — the caller must reject the request in all cases.
 */
export function verifyStateCookie(req: FastifyRequest, urlState: string): boolean {
  const raw = req.cookies[STATE_COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) return false;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return false;
  const a = Buffer.from(unsigned.value, 'utf8');
  const b = Buffer.from(urlState, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function clearStateCookie(reply: FastifyReply): void {
  reply.clearCookie(STATE_COOKIE_NAME, { path: STATE_COOKIE_PATH });
}
