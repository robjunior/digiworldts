/**
 * CRUD over the `oauth_tokens` table. Portable SQL with `?` placeholders —
 * the async DbAdapter translates them to `$1`, `$2`, ... on Postgres.
 *
 * Concurrency: the table's UNIQUE(provider, provider_user_id) constraint
 * doubles as the atomic "one DigiWorld user per Discord ID" guarantee, so
 * two callbacks landing at the same time can't both link the same Discord
 * account to different DigiWorld accounts — one wins, the other's INSERT
 * hits the constraint and we surface `already-linked` cleanly.
 */
import { one, q, run } from '../../db/index.js';
import type { RunResult } from '../../db/adapter.js';

import type { OAuthTokens } from './types.js';

export type OAuthTokenRow = {
  readonly user_id: string;
  readonly provider: string;
  readonly provider_user_id: string;
  readonly provider_username: string | null;
  readonly provider_avatar: string | null;
  readonly access_token: string;
  readonly refresh_token: string | null;
  readonly expires_at: number | null;
  readonly scope: string;
  readonly linked_at: number;
  readonly updated_at: number;
};

const SQL_FIND_BY_PROVIDER_USER = `
  SELECT * FROM oauth_tokens WHERE provider = ? AND provider_user_id = ?
`;

const SQL_FIND_BY_USER_PROVIDER = `
  SELECT * FROM oauth_tokens WHERE user_id = ? AND provider = ?
`;

const SQL_LIST_BY_USER = `
  SELECT * FROM oauth_tokens WHERE user_id = ? ORDER BY provider ASC
`;

const SQL_UPSERT_IDENTITY = `
  INSERT INTO oauth_tokens
    (user_id, provider, provider_user_id, provider_username, provider_avatar,
     access_token, refresh_token, expires_at, scope, linked_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, provider) DO UPDATE SET
    provider_user_id  = excluded.provider_user_id,
    provider_username = excluded.provider_username,
    provider_avatar   = excluded.provider_avatar,
    access_token      = excluded.access_token,
    refresh_token     = excluded.refresh_token,
    expires_at        = excluded.expires_at,
    scope             = excluded.scope,
    updated_at        = excluded.updated_at
`;

const SQL_UPDATE_TOKENS = `
  UPDATE oauth_tokens
     SET access_token = ?, refresh_token = ?, expires_at = ?, scope = ?, updated_at = ?
   WHERE user_id = ? AND provider = ?
`;

const SQL_DELETE_IDENTITY = `
  DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?
`;

export async function findByProviderUserId(
  provider: string,
  providerUserId: string,
): Promise<OAuthTokenRow | null> {
  return one<OAuthTokenRow>(SQL_FIND_BY_PROVIDER_USER, provider, providerUserId);
}

export async function findByUserProvider(
  userId: string,
  provider: string,
): Promise<OAuthTokenRow | null> {
  return one<OAuthTokenRow>(SQL_FIND_BY_USER_PROVIDER, userId, provider);
}

export async function listByUser(userId: string): Promise<readonly OAuthTokenRow[]> {
  return q<OAuthTokenRow>(SQL_LIST_BY_USER, userId);
}

export type LinkIdentityInput = {
  readonly userId: string;
  readonly provider: string;
  readonly providerUserId: string;
  readonly providerUsername?: string;
  readonly providerAvatar?: string;
  readonly tokens: OAuthTokens;
};

export async function linkIdentity(input: LinkIdentityInput): Promise<RunResult> {
  const now = Date.now();
  const expiresAt = input.tokens.expiresIn !== undefined ? now + input.tokens.expiresIn * 1000 : null;
  return run(
    SQL_UPSERT_IDENTITY,
    input.userId,
    input.provider,
    input.providerUserId,
    input.providerUsername ?? null,
    input.providerAvatar ?? null,
    input.tokens.accessToken,
    input.tokens.refreshToken ?? null,
    expiresAt,
    input.tokens.scope,
    now,
    now,
  );
}

export async function updateTokens(
  userId: string,
  provider: string,
  tokens: OAuthTokens,
): Promise<RunResult> {
  const now = Date.now();
  const expiresAt = tokens.expiresIn !== undefined ? now + tokens.expiresIn * 1000 : null;
  return run(
    SQL_UPDATE_TOKENS,
    tokens.accessToken,
    tokens.refreshToken ?? null,
    expiresAt,
    tokens.scope,
    now,
    userId,
    provider,
  );
}

export async function unlinkIdentity(userId: string, provider: string): Promise<RunResult> {
  return run(SQL_DELETE_IDENTITY, userId, provider);
}
