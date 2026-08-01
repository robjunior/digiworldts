/**
 * OAuth provider registry. Built lazily on first access — providers with
 * missing / invalid config throw at construction so the boot fails fast,
 * not on the first user click.
 *
 * When adding Google / Facebook / etc.:
 *   1. Implement the provider class against `OAuthProvider`.
 *   2. Import it here and register it in `buildRegistry`.
 *   3. Add the provider id string as a valid entry for
 *      OAUTH_ENABLED_PROVIDERS in the env (see backend/src/config.ts).
 */
import { config } from '../../config.js';
import { log } from '../../util/log.js';

import { DiscordOAuthProvider } from './discord.js';
import { FacebookOAuthProvider } from './facebook.js';
import { GoogleOAuthProvider } from './google.js';
import type { OAuthProvider } from './types.js';

let registryCache: ReadonlyMap<string, OAuthProvider> | null = null;

function buildRegistry(): ReadonlyMap<string, OAuthProvider> {
  const enabled = new Set(config.OAUTH_ENABLED_PROVIDERS);
  const map = new Map<string, OAuthProvider>();
  if (enabled.has('discord')) {
    map.set('discord', new DiscordOAuthProvider());
  }
  if (enabled.has('google')) {
    map.set('google', new GoogleOAuthProvider());
  }
  if (enabled.has('facebook')) {
    map.set('facebook', new FacebookOAuthProvider());
  }
  log.info('oauth.registry.built', { providers: [...map.keys()] });
  return map;
}

function ensureRegistry(): ReadonlyMap<string, OAuthProvider> {
  if (registryCache === null) registryCache = buildRegistry();
  return registryCache;
}

export function getProvider(id: string): OAuthProvider | null {
  return ensureRegistry().get(id) ?? null;
}

export function listEnabledProviderIds(): readonly string[] {
  return [...ensureRegistry().keys()];
}

export function isProviderEnabled(id: string): boolean {
  return ensureRegistry().has(id);
}

export function resetRegistryForTests(): void {
  registryCache = null;
}
