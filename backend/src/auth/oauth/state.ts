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
import { randomBytes } from 'node:crypto';

import { getCluster } from '../../cluster/index.js';

import { OAuthPendingSchema, OAuthStateSchema, type OAuthPending, type OAuthState } from './types.js';

const TTL_SEC = 10 * 60;

const K_STATE = (token: string): string => `oauth:state:${token}`;
const K_PENDING = (token: string): string => `oauth:pending:${token}`;

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
