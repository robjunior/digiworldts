import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchEnabledProviders, oauthLinkUrl, oauthLoginUrl } from '../../lib/api-oauth';

type OAuthButtonsProps = {
  readonly mode: 'login' | 'link';
  readonly returnTo?: string;
  readonly label?: string;
};

const OAUTH_PROVIDERS_QUERY_KEY = ['oauth', 'providers'] as const;

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  discord: 'Discord',
};

export function OAuthButtons({ mode, returnTo, label }: OAuthButtonsProps): JSX.Element | null {
  const query = useQuery({
    queryKey: OAUTH_PROVIDERS_QUERY_KEY,
    queryFn: fetchEnabledProviders,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const providers = query.data?.providers ?? [];
  if (query.isLoading || providers.length === 0) return null;

  const verb = mode === 'link' ? 'Vincular' : 'Continuar com';

  return (
    <div className="oauth-buttons" aria-label={mode === 'link' ? 'Vincular conta OAuth' : 'Entrar via OAuth'}>
      {label !== undefined ? <div className="oauth-divider"><span>{label}</span></div> : null}
      {providers.map((provider) => {
        const providerLabel = PROVIDER_LABELS[provider] ?? provider;
        const href = mode === 'link' ? oauthLinkUrl(provider, returnTo) : oauthLoginUrl(provider, returnTo);
        return (
          <a
            key={provider}
            className={`oauth-btn oauth-btn--${provider}`}
            href={href}
            data-provider={provider}
          >
            {provider === 'discord' ? <DiscordMark /> : null}
            <span>{verb} {providerLabel}</span>
          </a>
        );
      })}
    </div>
  );
}

function DiscordMark(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.445.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.086-2.157-2.42 0-1.334.956-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42zm7.975 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42z"/>
    </svg>
  );
}
