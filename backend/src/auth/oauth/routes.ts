/**
 * OAuth2 routes. Provider-agnostic — the Discord specifics live in
 * `./discord.ts` behind the `OAuthProvider` interface. Adding Google or
 * Facebook is a matter of implementing that interface + registering the
 * new provider id in `./registry.ts`.
 *
 * Flow map:
 *
 *   Login  → GET /api/auth/oauth/discord/login?returnTo=...
 *            → 302 to Discord
 *            → user authorizes
 *            → GET /api/auth/oauth/discord/callback?code=&state=
 *                   ├─ matches oauth_tokens          → session, redirect returnTo
 *                   ├─ matches legacy users.discord_id → migrate + session
 *                   └─ no match                      → issue pending, redirect
 *                                                     /oauth/decide?token=...
 *
 *   Link   → GET /api/auth/oauth/discord/link?returnTo=...  (auth required)
 *            → 302 to Discord
 *            → callback resolves state.initiatorUserId
 *                   ├─ already linked to same user   → idempotent success
 *                   ├─ linked to different user      → 302 returnTo?oauth_error=already-linked
 *                   └─ not linked                    → linkIdentity + session
 *
 *   Decide → GET /api/auth/oauth/pending/:token       (preview username/avatar)
 *            POST /api/auth/oauth/decide               (create | link)
 *
 *   Unlink → DELETE /api/auth/oauth/discord            (auth required)
 *
 * Sync with the legacy code-based link (backend/src/auth/discord-link.ts):
 * every write to `oauth_tokens` also mirrors to `users.discord_id`. This
 * lets the Discord bot's existing lookup (`SELECT users WHERE discord_id=?`
 * in backend/src/service/routes.ts) keep working transparently.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { config } from '../../config.js';
import { one, tx, type UserRow } from '../../db/index.js';
import { log } from '../../util/log.js';
import { newId } from '../../util/ids.js';
import { hashPassword, verifyPassword } from '../password.js';
import { createSession, SESSION_COOKIE_NAME, setSessionCookie } from '../session.js';
import { currentUser, requireAuth } from '../routes.js';

import { getProvider, listEnabledProviderIds } from './registry.js';
import {
  consumePending,
  consumeState,
  issuePending,
  issueState,
  readPending,
} from './state.js';
import {
  findByProviderUserId,
  findByUserProvider,
  linkIdentity,
  listByUser,
  unlinkIdentity,
} from './store.js';
import type { OAuthPending, OAuthTokens, OAuthUserInfo } from './types.js';

const ProviderParam = z.object({ provider: z.string().min(1).max(32) }).strict();
const TokenParam = z.object({ token: z.string().min(1).max(128) }).strict();

const StartQuery = z.object({
  returnTo: z.string().max(500).optional(),
}).strict();

const CallbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(500).optional(),
}).strict();

const DecideBody = z.discriminatedUnion('choice', [
  z.object({
    choice: z.literal('create'),
    pendingToken: z.string().min(1).max(128),
  }).strict(),
  z.object({
    choice: z.literal('link'),
    pendingToken: z.string().min(1).max(128),
    username: z.string().trim().min(1).max(40),
    password: z.string().min(1).max(200),
  }).strict(),
]);

const SQL_SELECT_USER_BY_ID = `SELECT * FROM users WHERE id = ?`;
const SQL_SELECT_USER_BY_USERNAME = `SELECT * FROM users WHERE username = ?`;
const SQL_SELECT_USER_BY_DISCORD_ID = `SELECT * FROM users WHERE discord_id = ?`;
const SQL_COUNT_USERS = `SELECT COUNT(*) AS n FROM users`;
const SQL_INSERT_USER = `INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE_LAST_LOGIN = `UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`;
const SQL_SET_USERS_DISCORD_ID = `UPDATE users SET discord_id = ?, updated_at = ? WHERE id = ? AND (discord_id IS NULL OR discord_id = ?)`;
const SQL_CLEAR_USERS_DISCORD_ID = `UPDATE users SET discord_id = NULL, updated_at = ? WHERE id = ? AND discord_id = ?`;

const USERNAME_SAFE = /[^a-z0-9_]/g;

export const oauthPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/auth/oauth/providers', async (_req, reply) => {
    return reply.send({ providers: listEnabledProviderIds() });
  });

  app.get<{ Params: { readonly provider: string }; Querystring: { readonly returnTo?: string } }>(
    '/api/auth/oauth/:provider/login',
    async (req, reply) => {
      const params = ProviderParam.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid-provider' });
      const query = StartQuery.safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: 'invalid-query' });

      const provider = getProvider(params.data.provider);
      if (provider === null) return reply.code(404).send({ error: 'provider-disabled' });

      const returnTo = sanitizeReturnTo(query.data.returnTo);
      const state = await issueState({ provider: provider.id, mode: 'login', ...(returnTo ? { returnTo } : {}) });
      return reply.redirect(provider.authorizationUrl(state.token));
    },
  );

  app.get<{ Params: { readonly provider: string }; Querystring: { readonly returnTo?: string } }>(
    '/api/auth/oauth/:provider/link',
    async (req, reply) => {
      const user = await requireAuth(req, reply);
      const params = ProviderParam.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid-provider' });
      const query = StartQuery.safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: 'invalid-query' });

      const provider = getProvider(params.data.provider);
      if (provider === null) return reply.code(404).send({ error: 'provider-disabled' });

      const returnTo = sanitizeReturnTo(query.data.returnTo);
      const state = await issueState({
        provider: provider.id,
        mode: 'link',
        initiatorUserId: user.id,
        ...(returnTo ? { returnTo } : {}),
      });
      return reply.redirect(provider.authorizationUrl(state.token));
    },
  );

  app.get<{ Params: { readonly provider: string }; Querystring: z.infer<typeof CallbackQuery> }>(
    '/api/auth/oauth/:provider/callback',
    async (req, reply) => {
      const params = ProviderParam.safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid-provider' });
      const query = CallbackQuery.safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: 'invalid-query' });

      const provider = getProvider(params.data.provider);
      if (provider === null) return reply.code(404).send({ error: 'provider-disabled' });

      if (query.data.error) {
        log.warn('oauth.callback.provider-error', {
          provider: provider.id,
          code: query.data.error,
          desc: query.data.error_description,
        });
        return redirectWithError(reply, '/', 'provider-error');
      }

      if (!query.data.code || !query.data.state) {
        return redirectWithError(reply, '/', 'missing-params');
      }

      const state = await consumeState(query.data.state);
      if (state === null || state.provider !== provider.id) {
        return redirectWithError(reply, '/', 'state-expired');
      }

      let tokens: OAuthTokens;
      let userInfo: OAuthUserInfo;
      try {
        tokens = await provider.exchangeCode(query.data.code);
        userInfo = await provider.fetchUserInfo(tokens.accessToken);
      } catch (err) {
        log.warn('oauth.callback.provider-fetch-failed', {
          provider: provider.id,
          err: err instanceof Error ? err.message : String(err),
        });
        return redirectWithError(reply, state.returnTo ?? '/', 'provider-fetch-failed');
      }

      if (state.mode === 'link') {
        return handleLinkCallback(req, reply, provider.id, state.initiatorUserId ?? null, state.returnTo ?? null, userInfo, tokens);
      }
      return handleLoginCallback(req, reply, provider.id, state.returnTo ?? null, userInfo, tokens);
    },
  );

  app.get<{ Params: { readonly token: string } }>('/api/auth/oauth/pending/:token', async (req, reply) => {
    const params = TokenParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid-token' });

    const pending = await readPending(params.data.token);
    if (pending === null) return reply.code(404).send({ error: 'pending-missing' });

    const registrationOpen = config.ADMIN_BOOTSTRAP !== 'closed';
    return reply.send({
      provider: pending.provider,
      providerUsername: pending.providerUsername ?? null,
      providerAvatar: pending.providerAvatar ?? null,
      returnTo: pending.returnTo ?? null,
      canCreate: registrationOpen,
      expiresAt: pending.issuedAt + 10 * 60 * 1000,
    });
  });

  app.post('/api/auth/oauth/decide', async (req, reply) => {
    const body = DecideBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-body', issues: body.error.issues });

    const pending = await consumePending(body.data.pendingToken);
    if (pending === null) return reply.code(410).send({ error: 'pending-expired' });

    if (body.data.choice === 'create') {
      if (config.ADMIN_BOOTSTRAP === 'closed') {
        return reply.code(403).send({
          error: 'registration-closed',
          hint: 'This deployment has ADMIN_BOOTSTRAP=closed. Ask an existing admin to invite you, or use "already have an account" instead.',
        });
      }
      const user = await createUserFromOAuth(pending, req);
      setSessionCookie(reply, user.sessionToken);
      return reply.send({ ok: true, userId: user.userId, returnTo: pending.returnTo ?? '/' });
    }

    const existing = await one<UserRow>(SQL_SELECT_USER_BY_USERNAME, body.data.username);
    if (existing === null) {
      return reply.code(401).send({ error: 'invalid-credentials' });
    }
    const ok = await verifyPassword(existing.password_hash, body.data.password);
    if (!ok) {
      return reply.code(401).send({ error: 'invalid-credentials' });
    }
    const linkResult = await linkExistingUserToProvider(existing.id, pending);
    if (linkResult.error) {
      return reply.code(409).send({ error: linkResult.error });
    }
    const sessionToken = await createUserSessionAndTouch(existing.id, req);
    setSessionCookie(reply, sessionToken);
    return reply.send({ ok: true, userId: existing.id, returnTo: pending.returnTo ?? '/' });
  });

  app.delete<{ Params: { readonly provider: string } }>('/api/auth/oauth/:provider', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const params = ProviderParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid-provider' });

    const existing = await findByUserProvider(user.id, params.data.provider);
    if (existing === null) return reply.code(404).send({ error: 'not-linked' });

    await tx(async (t) => {
      await t.run(`DELETE FROM oauth_tokens WHERE user_id = ? AND provider = ?`, [user.id, params.data.provider]);
      if (params.data.provider === 'discord') {
        await t.run(SQL_CLEAR_USERS_DISCORD_ID, [Date.now(), user.id, existing.provider_user_id]);
      }
    });

    log.info('oauth.unlink', { userId: user.id, provider: params.data.provider });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/oauth/mine', async (req, reply) => {
    const user = await currentUser(req);
    if (user === null) return reply.code(401).send({ error: 'auth-required' });
    const rows = await listByUser(user.id);
    return reply.send({
      identities: rows.map((r) => ({
        provider: r.provider,
        providerUserId: r.provider_user_id,
        providerUsername: r.provider_username,
        providerAvatar: r.provider_avatar,
        scope: r.scope,
        linkedAt: r.linked_at,
      })),
    });
  });
};

async function handleLoginCallback(
  req: FastifyRequest,
  reply: FastifyReply,
  providerId: string,
  returnTo: string | null,
  userInfo: OAuthUserInfo,
  tokens: OAuthTokens,
): Promise<FastifyReply> {
  const existingLink = await findByProviderUserId(providerId, userInfo.providerId);
  if (existingLink !== null) {
    await refreshLinkedIdentity(existingLink.user_id, providerId, userInfo, tokens);
    const sessionToken = await createUserSessionAndTouch(existingLink.user_id, req);
    setSessionCookie(reply, sessionToken);
    log.info('oauth.login.matched', { userId: existingLink.user_id, provider: providerId });
    return reply.redirect(returnTo ?? '/');
  }

  if (providerId === 'discord') {
    const legacyMatch = await one<UserRow>(SQL_SELECT_USER_BY_DISCORD_ID, userInfo.providerId);
    if (legacyMatch !== null) {
      await refreshLinkedIdentity(legacyMatch.id, providerId, userInfo, tokens);
      const sessionToken = await createUserSessionAndTouch(legacyMatch.id, req);
      setSessionCookie(reply, sessionToken);
      log.info('oauth.login.legacy-migrated', { userId: legacyMatch.id, provider: providerId });
      return reply.redirect(returnTo ?? '/');
    }
  }

  const pending = await issuePending({
    provider: providerId,
    providerUserId: userInfo.providerId,
    ...(userInfo.username !== undefined ? { providerUsername: userInfo.username } : {}),
    ...(userInfo.avatarUrl !== undefined ? { providerAvatar: userInfo.avatarUrl } : {}),
    ...(userInfo.email !== undefined ? { providerEmail: userInfo.email } : {}),
    accessToken: tokens.accessToken,
    ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
    ...(tokens.expiresIn !== undefined ? { expiresIn: tokens.expiresIn } : {}),
    scope: tokens.scope,
    ...(returnTo ? { returnTo } : {}),
  });
  log.info('oauth.login.pending', { provider: providerId, providerUserId: userInfo.providerId });
  return reply.redirect(`/oauth/decide?token=${encodeURIComponent(pending.token)}`);
}

async function handleLinkCallback(
  req: FastifyRequest,
  reply: FastifyReply,
  providerId: string,
  initiatorUserId: string | null,
  returnTo: string | null,
  userInfo: OAuthUserInfo,
  tokens: OAuthTokens,
): Promise<FastifyReply> {
  if (initiatorUserId === null) {
    return redirectWithError(reply, returnTo ?? '/', 'link-context-lost');
  }
  const existingLink = await findByProviderUserId(providerId, userInfo.providerId);
  if (existingLink !== null && existingLink.user_id !== initiatorUserId) {
    log.warn('oauth.link.collision', {
      initiatorUserId,
      provider: providerId,
      providerUserId: userInfo.providerId,
      ownerUserId: existingLink.user_id,
    });
    return redirectWithError(reply, returnTo ?? '/', 'already-linked');
  }
  await refreshLinkedIdentity(initiatorUserId, providerId, userInfo, tokens);
  log.info('oauth.link.ok', { userId: initiatorUserId, provider: providerId });
  return reply.redirect(returnTo ?? '/');
}

async function refreshLinkedIdentity(
  userId: string,
  providerId: string,
  userInfo: OAuthUserInfo,
  tokens: OAuthTokens,
): Promise<void> {
  await tx(async (t) => {
    const now = Date.now();
    const expiresAt = tokens.expiresIn !== undefined ? now + tokens.expiresIn * 1000 : null;
    await t.run(
      `INSERT INTO oauth_tokens
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
         updated_at        = excluded.updated_at`,
      [
        userId,
        providerId,
        userInfo.providerId,
        userInfo.username ?? null,
        userInfo.avatarUrl ?? null,
        tokens.accessToken,
        tokens.refreshToken ?? null,
        expiresAt,
        tokens.scope,
        now,
        now,
      ],
    );
    if (providerId === 'discord') {
      await t.run(SQL_SET_USERS_DISCORD_ID, [userInfo.providerId, now, userId, userInfo.providerId]);
    }
  });
}

async function createUserFromOAuth(
  pending: OAuthPending,
  req: FastifyRequest,
): Promise<{ readonly userId: string; readonly sessionToken: string }> {
  const now = Date.now();
  const id = newId('usr');
  const desiredBase = pending.providerUsername ?? `dc_${pending.providerUserId.slice(-8)}`;
  const username = await generateUniqueUsername(desiredBase);
  const displayName = pending.providerUsername && pending.providerUsername.length > 0 ? pending.providerUsername : username;
  const placeholderHash = await hashPassword(randomBytes(48).toString('base64url'));

  const userId = await tx(async (t) => {
    const cntRow = await t.one<{ readonly n: number }>(SQL_COUNT_USERS);
    const isAdmin = cntRow && cntRow.n === 0 ? 1 : 0;
    await t.run(SQL_INSERT_USER, [id, username, displayName, placeholderHash, isAdmin, now, now]);
    const expiresAt = pending.expiresIn !== undefined ? now + pending.expiresIn * 1000 : null;
    await t.run(
      `INSERT INTO oauth_tokens
         (user_id, provider, provider_user_id, provider_username, provider_avatar,
          access_token, refresh_token, expires_at, scope, linked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        pending.provider,
        pending.providerUserId,
        pending.providerUsername ?? null,
        pending.providerAvatar ?? null,
        pending.accessToken,
        pending.refreshToken ?? null,
        expiresAt,
        pending.scope,
        now,
        now,
      ],
    );
    if (pending.provider === 'discord') {
      await t.run(SQL_SET_USERS_DISCORD_ID, [pending.providerUserId, now, id, pending.providerUserId]);
    }
    await t.run(SQL_UPDATE_LAST_LOGIN, [now, now, id]);
    return id;
  });

  const session = await createSession({
    userId,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  log.info('oauth.signup', { userId, provider: pending.provider, username });
  return { userId, sessionToken: session.token };
}

async function linkExistingUserToProvider(
  userId: string,
  pending: OAuthPending,
): Promise<{ readonly error: 'already-linked' | 'user-conflict' | null }> {
  const otherOwner = await findByProviderUserId(pending.provider, pending.providerUserId);
  if (otherOwner !== null && otherOwner.user_id !== userId) return { error: 'already-linked' };

  const existingSameProvider = await findByUserProvider(userId, pending.provider);
  if (existingSameProvider !== null && existingSameProvider.provider_user_id !== pending.providerUserId) {
    return { error: 'user-conflict' };
  }

  await refreshLinkedIdentity(
    userId,
    pending.provider,
    {
      providerId: pending.providerUserId,
      ...(pending.providerUsername !== undefined ? { username: pending.providerUsername } : {}),
      ...(pending.providerAvatar !== undefined ? { avatarUrl: pending.providerAvatar } : {}),
      ...(pending.providerEmail !== undefined ? { email: pending.providerEmail } : {}),
    },
    {
      accessToken: pending.accessToken,
      ...(pending.refreshToken !== undefined ? { refreshToken: pending.refreshToken } : {}),
      ...(pending.expiresIn !== undefined ? { expiresIn: pending.expiresIn } : {}),
      scope: pending.scope,
    },
  );
  return { error: null };
}

async function createUserSessionAndTouch(userId: string, req: FastifyRequest): Promise<string> {
  const user = await one<UserRow>(SQL_SELECT_USER_BY_ID, userId);
  if (user === null) throw new Error(`OAuth login for missing user ${userId}`);
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_UPDATE_LAST_LOGIN, [now, now, userId]);
  });
  const session = await createSession({
    userId,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  return session.token;
}

async function generateUniqueUsername(base: string): Promise<string> {
  const normalized = base.toLowerCase().replace(USERNAME_SAFE, '').slice(0, 30);
  const seed = normalized.length > 0 ? normalized : `dc_${Date.now().toString(36).slice(-6)}`;

  const first = await one<UserRow>(SQL_SELECT_USER_BY_USERNAME, seed);
  if (first === null) return seed;

  for (let i = 2; i <= 30; i++) {
    const candidate = `${seed}_${i}`.slice(0, 40);
    const collision = await one<UserRow>(SQL_SELECT_USER_BY_USERNAME, candidate);
    if (collision === null) return candidate;
  }

  const fallback = `${seed.slice(0, 24)}_${randomBytes(4).toString('hex')}`;
  return fallback;
}

function sanitizeReturnTo(url: string | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith('/')) return null;
  if (url.startsWith('//')) return null;
  if (url.startsWith('/api/')) return null;
  return url;
}

function redirectWithError(reply: FastifyReply, returnTo: string, code: string): FastifyReply {
  const sep = returnTo.includes('?') ? '&' : '?';
  return reply.redirect(`${returnTo}${sep}oauth_error=${encodeURIComponent(code)}`);
}

// Re-export so consumers can import the exact cookie name for tests etc.
export { SESSION_COOKIE_NAME };
