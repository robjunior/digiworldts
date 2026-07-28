import type { SceneSettings } from '../scene3d/scene';
import { apiFetch } from './api';

export type PerArenaSceneDefaults = Record<string, Partial<SceneSettings>>;

const VALID_ARENA_KEYS = new Set([
  'plant', 'steel', 'water', 'rock', 'dark', 'fire', 'ice', 'field', 'null', 'wind', 'light',
]);

function coerce(raw: unknown): PerArenaSceneDefaults {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const out: PerArenaSceneDefaults = {};
  for (const key of Object.keys(obj)) {
    if (!VALID_ARENA_KEYS.has(key)) continue;
    const value = obj[key];
    if (typeof value === 'object' && value !== null) out[key] = value as Partial<SceneSettings>;
  }
  return out;
}

// TTL bounds worst-case staleness at 30s even without WS invalidation.
// A live broadcast (see backend/src/lobby/ws.ts::scene-defaults-updated) resets
// the cache to null immediately; TTL is the safety net for freshly-loaded tabs
// or clients that missed the WS message during a reconnect.
const TTL_MS = 30_000;

let cache: Promise<PerArenaSceneDefaults> | null = null;
let cacheAt = 0;

export function getSceneDefaults(force = false): Promise<PerArenaSceneDefaults> {
  const now = Date.now();
  if (force || cache === null || now - cacheAt > TTL_MS) {
    cacheAt = now;
    cache = apiFetch<{ defaults: unknown }>('/api/scene/defaults')
      .then((body) => coerce(body.defaults))
      .catch(() => ({}));
  }
  return cache;
}

/** Overwrite the cache with the value the admin just POSTed. Skips a redundant
 *  GET round-trip for the admin who just saved. Other clients get the update
 *  via the WS broadcast → `invalidateSceneDefaultsCache` path. */
export function replaceSceneDefaultsCache(next: PerArenaSceneDefaults): void {
  cache = Promise.resolve(next);
  cacheAt = Date.now();
}

/** Null the cache so the next `getSceneDefaults()` call refetches from the
 *  server. Called from the wsStore when the `scene-defaults-updated` broadcast
 *  arrives, and from the "Reset all local" admin button. */
export function invalidateSceneDefaultsCache(): void {
  cache = null;
  cacheAt = 0;
}
