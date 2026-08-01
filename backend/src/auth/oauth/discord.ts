/**
 * Discord OAuth2 provider. Implements the vendor-agnostic {@link OAuthProvider}
 * interface with Discord's authorization-code + refresh-token flow.
 *
 * Endpoints (public docs — https://discord.com/developers/docs/topics/oauth2):
 *   - authorize:  https://discord.com/api/oauth2/authorize
 *   - token:      https://discord.com/api/oauth2/token
 *   - user info:  https://discord.com/api/users/@me
 *
 * Scope: `identify` only. The user's second answer in the OAuth design brief
 * was "identify + refresh_token"; refresh_token is not a scope but a natural
 * output of the code grant, so the actual scope requested is just `identify`.
 * When the design later wants email, add `'email'` to the scope array and
 * bump README.
 *
 * Token responses are parsed through Zod so a shape change on Discord's side
 * fails fast at the boundary instead of silently propagating undefined.
 */
import { z } from 'zod';

import { config } from '../../config.js';
import { log } from '../../util/log.js';

import type { OAuthProvider, OAuthTokens, OAuthUserInfo } from './types.js';

const AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';

const DEFAULT_SCOPES = ['identify'] as const;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().nonnegative().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string(),
});

const UserResponseSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  discriminator: z.string().optional(),
  global_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  locale: z.string().optional(),
  email: z.string().email().nullable().optional(),
});

export class DiscordOAuthProvider implements OAuthProvider {
  public readonly id = 'discord' as const;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor() {
    if (!config.DISCORD_OAUTH_CLIENT_ID || !config.DISCORD_OAUTH_CLIENT_SECRET) {
      throw new Error('DiscordOAuthProvider: DISCORD_OAUTH_CLIENT_ID and DISCORD_OAUTH_CLIENT_SECRET must be set');
    }
    if (!config.DISCORD_OAUTH_REDIRECT_URI) {
      throw new Error('DiscordOAuthProvider: DISCORD_OAUTH_REDIRECT_URI must be set (e.g. https://your-host/api/auth/oauth/discord/callback)');
    }
    this.clientId = config.DISCORD_OAUTH_CLIENT_ID;
    this.clientSecret = config.DISCORD_OAUTH_CLIENT_SECRET;
    this.redirectUri = config.DISCORD_OAUTH_REDIRECT_URI;
  }

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: DEFAULT_SCOPES.join(' '),
      state,
      prompt: 'consent',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
    });
    return this.postTokenRequest(body, 'exchange');
  }

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.postTokenRequest(body, 'refresh');
  }

  async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch(USER_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.warn('oauth.discord.userinfo.fail', { status: response.status, body: text.slice(0, 200) });
      throw new Error(`Discord /users/@me returned ${response.status}`);
    }
    const raw = await response.json().catch((err: unknown) => {
      throw new Error(`Discord /users/@me returned non-JSON: ${err instanceof Error ? err.message : String(err)}`);
    });
    const parsed = UserResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Discord /users/@me shape unexpected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const user = parsed.data;
    const displayName = user.global_name && user.global_name.length > 0 ? user.global_name : user.username;
    const info: OAuthUserInfo = {
      providerId: user.id,
      username: displayName,
    };
    const avatarUrl = buildAvatarUrl(user.id, user.avatar ?? null, user.discriminator ?? null);
    if (avatarUrl !== null) (info as { avatarUrl?: string }).avatarUrl = avatarUrl;
    if (user.email && user.email.length > 0) (info as { email?: string }).email = user.email;
    if (user.locale && user.locale.length > 0) (info as { locale?: string }).locale = user.locale;
    return info;
  }

  private async postTokenRequest(body: URLSearchParams, kind: 'exchange' | 'refresh'): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.warn('oauth.discord.token.fail', { kind, status: response.status, body: text.slice(0, 200) });
      throw new Error(`Discord OAuth ${kind} returned ${response.status}`);
    }
    const raw = await response.json().catch((err: unknown) => {
      throw new Error(`Discord OAuth ${kind} returned non-JSON: ${err instanceof Error ? err.message : String(err)}`);
    });
    const parsed = TokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Discord OAuth ${kind} shape unexpected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const tokens: OAuthTokens = {
      accessToken: parsed.data.access_token,
      scope: parsed.data.scope,
    };
    if (parsed.data.refresh_token) (tokens as { refreshToken?: string }).refreshToken = parsed.data.refresh_token;
    if (parsed.data.expires_in !== undefined) (tokens as { expiresIn?: number }).expiresIn = parsed.data.expires_in;
    return tokens;
  }
}

function buildAvatarUrl(userId: string, avatarHash: string | null, discriminator: string | null): string | null {
  if (avatarHash !== null && avatarHash.length > 0) {
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
  }
  if (discriminator !== null && discriminator !== '0' && /^\d+$/.test(discriminator)) {
    const bucket = Number.parseInt(discriminator, 10) % 5;
    return `https://cdn.discordapp.com/embed/avatars/${bucket}.png`;
  }
  try {
    const bucket = Number((BigInt(userId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${bucket}.png`;
  } catch {
    return null;
  }
}
