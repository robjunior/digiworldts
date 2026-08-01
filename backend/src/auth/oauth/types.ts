/**
 * OAuth2 provider abstraction. Discord ships first; Google / Facebook /
 * others plug in by implementing OAuthProvider and getting registered in
 * `registry.ts`. Everything provider-specific — endpoints, grant params,
 * user-info shape — is hidden behind this interface so the routes in
 * `routes.ts` stay provider-agnostic.
 */
import { z } from 'zod';

export type OAuthTokens = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresIn?: number;
  readonly scope: string;
};

export type OAuthUserInfo = {
  readonly providerId: string;
  readonly username?: string;
  readonly email?: string;
  readonly avatarUrl?: string;
  readonly locale?: string;
};

export interface OAuthProvider {
  readonly id: string;
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  refreshTokens(refreshToken: string): Promise<OAuthTokens>;
  fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}

export const OAuthStateSchema = z.object({
  v: z.literal(1),
  provider: z.string().min(1).max(32),
  mode: z.enum(['login', 'link']),
  returnTo: z.string().max(500).optional(),
  initiatorUserId: z.string().min(1).max(80).optional(),
  issuedAt: z.number().int(),
}).strict();

export type OAuthState = z.infer<typeof OAuthStateSchema>;

export const OAuthPendingSchema = z.object({
  v: z.literal(1),
  provider: z.string().min(1).max(32),
  providerUserId: z.string().min(1).max(200),
  providerUsername: z.string().max(200).optional(),
  providerAvatar: z.string().max(500).optional(),
  providerEmail: z.string().max(320).optional(),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresIn: z.number().int().nonnegative().optional(),
  scope: z.string(),
  returnTo: z.string().max(500).optional(),
  issuedAt: z.number().int(),
}).strict();

export type OAuthPending = z.infer<typeof OAuthPendingSchema>;

export type OAuthErrorCode =
  | 'provider-disabled'
  | 'provider-unknown'
  | 'state-missing'
  | 'state-expired'
  | 'pending-missing'
  | 'pending-expired'
  | 'registration-closed'
  | 'auth-required'
  | 'invalid-credentials'
  | 'username-taken'
  | 'already-linked'
  | 'discord-error'
  | 'internal';
