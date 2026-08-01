/**
 * Google OAuth2 provider. Standard authorization-code flow with refresh
 * tokens gated on `access_type=offline` + `prompt=consent`.
 *
 * Endpoints:
 *   - authorize:  https://accounts.google.com/o/oauth2/v2/auth
 *   - token:      https://oauth2.googleapis.com/token
 *   - user info:  https://www.googleapis.com/oauth2/v2/userinfo
 *
 * Scopes: `openid profile`. Same minimalist choice as Discord — enough
 * to identify the user by their Google sub + display name + avatar,
 * no email. Add `'email'` if a future feature needs it.
 *
 * Google only issues a refresh_token when BOTH `access_type=offline`
 * AND `prompt=consent` are present on the initial authorize URL. Without
 * the second, Google skips the consent screen for a repeat user and
 * silently omits the refresh_token — the DB row then has no refresh
 * credential and the user has to re-auth every hour.
 */
import { z } from 'zod';

import { config } from '../../config.js';
import { log } from '../../util/log.js';

import type { OAuthProvider, OAuthTokens, OAuthUserInfo } from './types.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USER_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const DEFAULT_SCOPES = ['openid', 'profile'] as const;

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().nonnegative().optional(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

const UserResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  picture: z.string().optional(),
  locale: z.string().optional(),
  email: z.string().email().optional(),
});

export class GoogleOAuthProvider implements OAuthProvider {
  public readonly id = 'google' as const;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor() {
    if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new Error('GoogleOAuthProvider: GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set');
    }
    if (!config.GOOGLE_OAUTH_REDIRECT_URI) {
      throw new Error('GoogleOAuthProvider: GOOGLE_OAUTH_REDIRECT_URI must be set (e.g. https://your-host/api/auth/oauth/google/callback)');
    }
    this.clientId = config.GOOGLE_OAUTH_CLIENT_ID;
    this.clientSecret = config.GOOGLE_OAUTH_CLIENT_SECRET;
    this.redirectUri = config.GOOGLE_OAUTH_REDIRECT_URI;
  }

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: DEFAULT_SCOPES.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
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
      log.warn('oauth.google.userinfo.fail', { status: response.status, body: text.slice(0, 200) });
      throw new Error(`Google /userinfo returned ${response.status}`);
    }
    const raw = await response.json().catch((err: unknown) => {
      throw new Error(`Google /userinfo returned non-JSON: ${err instanceof Error ? err.message : String(err)}`);
    });
    const parsed = UserResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Google /userinfo shape unexpected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const user = parsed.data;
    const displayName = user.name && user.name.length > 0
      ? user.name
      : `${user.given_name ?? ''} ${user.family_name ?? ''}`.trim() || `google_${user.id.slice(-8)}`;
    const info: OAuthUserInfo = {
      providerId: user.id,
      username: displayName,
    };
    if (user.picture && user.picture.length > 0) (info as { avatarUrl?: string }).avatarUrl = user.picture;
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
      log.warn('oauth.google.token.fail', { kind, status: response.status, body: text.slice(0, 200) });
      throw new Error(`Google OAuth ${kind} returned ${response.status}`);
    }
    const raw = await response.json().catch((err: unknown) => {
      throw new Error(`Google OAuth ${kind} returned non-JSON: ${err instanceof Error ? err.message : String(err)}`);
    });
    const parsed = TokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Google OAuth ${kind} shape unexpected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const tokens: OAuthTokens = {
      accessToken: parsed.data.access_token,
      scope: parsed.data.scope ?? DEFAULT_SCOPES.join(' '),
    };
    if (parsed.data.refresh_token) (tokens as { refreshToken?: string }).refreshToken = parsed.data.refresh_token;
    if (parsed.data.expires_in !== undefined) (tokens as { expiresIn?: number }).expiresIn = parsed.data.expires_in;
    return tokens;
  }
}
