/**
 * Facebook OAuth2 provider. Standard authorization-code flow, but with
 * one behavioural quirk that leaks through the provider interface: Facebook
 * does NOT issue refresh_tokens. Its "refresh" is instead the
 * fb_exchange_token grant, which takes the CURRENT access token as input
 * and returns a new (longer-lived) one.
 *
 * exchangeCode chains both steps: it does the code→short-lived exchange
 * and IMMEDIATELY follows up with a short-lived→long-lived exchange so
 * the initial store already has a 60-day token in it. The
 * OAuthTokens.refreshToken slot is populated with the long-lived access
 * token so refreshTokens() can feed it back into fb_exchange_token later.
 * This is a semantic hack on the interface (Discord/Google use a real
 * refresh_token) but it lets Facebook plug in without inventing a new
 * interface method just for its non-standard refresh flow.
 *
 * Endpoints (Graph API v19.0, current as of 2025):
 *   - authorize:  https://www.facebook.com/v19.0/dialog/oauth
 *   - token:      https://graph.facebook.com/v19.0/oauth/access_token
 *   - user info:  https://graph.facebook.com/v19.0/me
 *
 * Scope: `public_profile`. Matches Discord's identify-only choice;
 * public_profile is granted by default without an explicit App Review
 * approval, so this works on a plain new Facebook app.
 */
import { z } from 'zod';

import { config } from '../../config.js';
import { log } from '../../util/log.js';

import type { OAuthProvider, OAuthTokens, OAuthUserInfo } from './types.js';

const API_VERSION = 'v19.0';
const AUTHORIZE_URL = `https://www.facebook.com/${API_VERSION}/dialog/oauth`;
const TOKEN_URL = `https://graph.facebook.com/${API_VERSION}/oauth/access_token`;
const USER_URL = `https://graph.facebook.com/${API_VERSION}/me`;

const DEFAULT_SCOPES = ['public_profile'] as const;
const USER_FIELDS = 'id,name,picture.width(200).height(200)';

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().nonnegative().optional(),
});

const PictureSchema = z.object({
  data: z.object({
    url: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    is_silhouette: z.boolean().optional(),
  }).optional(),
}).optional();

const UserResponseSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  picture: PictureSchema,
  email: z.string().email().optional(),
});

export class FacebookOAuthProvider implements OAuthProvider {
  public readonly id = 'facebook' as const;

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor() {
    if (!config.FACEBOOK_OAUTH_CLIENT_ID || !config.FACEBOOK_OAUTH_CLIENT_SECRET) {
      throw new Error('FacebookOAuthProvider: FACEBOOK_OAUTH_CLIENT_ID and FACEBOOK_OAUTH_CLIENT_SECRET must be set');
    }
    if (!config.FACEBOOK_OAUTH_REDIRECT_URI) {
      throw new Error('FacebookOAuthProvider: FACEBOOK_OAUTH_REDIRECT_URI must be set (e.g. https://your-host/api/auth/oauth/facebook/callback)');
    }
    this.clientId = config.FACEBOOK_OAUTH_CLIENT_ID;
    this.clientSecret = config.FACEBOOK_OAUTH_CLIENT_SECRET;
    this.redirectUri = config.FACEBOOK_OAUTH_REDIRECT_URI;
  }

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: DEFAULT_SCOPES.join(','),
      state,
      auth_type: 'rerequest',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const shortLived = await this.postTokenRequest(new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      code,
    }), 'exchange');
    return this.upgradeToLongLived(shortLived);
  }

  async refreshTokens(currentAccessToken: string): Promise<OAuthTokens> {
    const upgraded = await this.postTokenRequest(new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      fb_exchange_token: currentAccessToken,
    }), 'refresh');
    return {
      accessToken: upgraded.accessToken,
      refreshToken: upgraded.accessToken,
      ...(upgraded.expiresIn !== undefined ? { expiresIn: upgraded.expiresIn } : {}),
      scope: DEFAULT_SCOPES.join(','),
    };
  }

  async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const url = new URL(USER_URL);
    url.searchParams.set('fields', USER_FIELDS);
    url.searchParams.set('access_token', accessToken);
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.warn('oauth.facebook.userinfo.fail', { status: response.status, body: text.slice(0, 200) });
      throw new Error(`Facebook /me returned ${response.status}`);
    }
    const raw = await response.json().catch((err: unknown) => {
      throw new Error(`Facebook /me returned non-JSON: ${err instanceof Error ? err.message : String(err)}`);
    });
    const parsed = UserResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Facebook /me shape unexpected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const user = parsed.data;
    const info: OAuthUserInfo = {
      providerId: user.id,
      username: user.name && user.name.length > 0 ? user.name : `facebook_${user.id.slice(-8)}`,
    };
    const avatarUrl = user.picture?.data?.url;
    if (avatarUrl && avatarUrl.length > 0 && !(user.picture?.data?.is_silhouette === true)) {
      (info as { avatarUrl?: string }).avatarUrl = avatarUrl;
    }
    if (user.email && user.email.length > 0) (info as { email?: string }).email = user.email;
    return info;
  }

  private async upgradeToLongLived(shortLived: OAuthTokens): Promise<OAuthTokens> {
    try {
      const longLived = await this.postTokenRequest(new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        fb_exchange_token: shortLived.accessToken,
      }), 'upgrade');
      return {
        accessToken: longLived.accessToken,
        refreshToken: longLived.accessToken,
        ...(longLived.expiresIn !== undefined ? { expiresIn: longLived.expiresIn } : {}),
        scope: DEFAULT_SCOPES.join(','),
      };
    } catch (err) {
      log.warn('oauth.facebook.upgrade.fail', { err: err instanceof Error ? err.message : String(err) });
      return {
        accessToken: shortLived.accessToken,
        refreshToken: shortLived.accessToken,
        ...(shortLived.expiresIn !== undefined ? { expiresIn: shortLived.expiresIn } : {}),
        scope: DEFAULT_SCOPES.join(','),
      };
    }
  }

  private async postTokenRequest(body: URLSearchParams, kind: 'exchange' | 'refresh' | 'upgrade'): Promise<OAuthTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      log.warn('oauth.facebook.token.fail', { kind, status: response.status, body: text.slice(0, 200) });
      throw new Error(`Facebook OAuth ${kind} returned ${response.status}`);
    }
    const raw = await response.json().catch((err: unknown) => {
      throw new Error(`Facebook OAuth ${kind} returned non-JSON: ${err instanceof Error ? err.message : String(err)}`);
    });
    const parsed = TokenResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Facebook OAuth ${kind} shape unexpected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    const tokens: OAuthTokens = {
      accessToken: parsed.data.access_token,
      scope: DEFAULT_SCOPES.join(','),
    };
    if (parsed.data.expires_in !== undefined) (tokens as { expiresIn?: number }).expiresIn = parsed.data.expires_in;
    return tokens;
  }
}
