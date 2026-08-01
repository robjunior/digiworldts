import { apiFetch } from './api';

export type EnabledProvidersResponse = { readonly providers: readonly string[] };

export type OAuthPendingPreview = {
  readonly provider: string;
  readonly providerUsername: string | null;
  readonly providerAvatar: string | null;
  readonly returnTo: string | null;
  readonly canCreate: boolean;
  readonly expiresAt: number;
};

export type OAuthDecideRequest =
  | { readonly choice: 'create'; readonly pendingToken: string }
  | { readonly choice: 'link'; readonly pendingToken: string; readonly username: string; readonly password: string };

export type OAuthDecideResponse = {
  readonly ok: true;
  readonly userId: string;
  readonly returnTo: string;
};

export type OAuthIdentity = {
  readonly provider: string;
  readonly providerUserId: string;
  readonly providerUsername: string | null;
  readonly providerAvatar: string | null;
  readonly scope: string;
  readonly linkedAt: number;
};

export type OAuthIdentitiesResponse = { readonly identities: readonly OAuthIdentity[] };

export async function fetchEnabledProviders(): Promise<EnabledProvidersResponse> {
  return apiFetch<EnabledProvidersResponse>('/api/auth/oauth/providers');
}

export async function fetchPendingPreview(token: string): Promise<OAuthPendingPreview> {
  return apiFetch<OAuthPendingPreview>(`/api/auth/oauth/pending/${encodeURIComponent(token)}`);
}

export async function submitDecision(body: OAuthDecideRequest): Promise<OAuthDecideResponse> {
  return apiFetch<OAuthDecideResponse>('/api/auth/oauth/decide', {
    method: 'POST',
    body,
  });
}

export async function unlinkProvider(provider: string): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>(`/api/auth/oauth/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
  });
}

export async function fetchLinkedIdentities(): Promise<OAuthIdentitiesResponse> {
  return apiFetch<OAuthIdentitiesResponse>('/api/auth/oauth/mine');
}

export function oauthLoginUrl(provider: string, returnTo?: string): string {
  const params = new URLSearchParams();
  if (returnTo !== undefined && returnTo.length > 0) params.set('returnTo', returnTo);
  const qs = params.toString();
  return `/api/auth/oauth/${encodeURIComponent(provider)}/login${qs.length > 0 ? `?${qs}` : ''}`;
}

export function oauthLinkUrl(provider: string, returnTo?: string): string {
  const params = new URLSearchParams();
  if (returnTo !== undefined && returnTo.length > 0) params.set('returnTo', returnTo);
  const qs = params.toString();
  return `/api/auth/oauth/${encodeURIComponent(provider)}/link${qs.length > 0 ? `?${qs}` : ''}`;
}
