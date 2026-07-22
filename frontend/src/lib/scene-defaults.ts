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

let cache: Promise<PerArenaSceneDefaults> | null = null;

export function getSceneDefaults(): Promise<PerArenaSceneDefaults> {
  if (cache === null) {
    cache = apiFetch<{ defaults: unknown }>('/api/scene/defaults')
      .then((body) => coerce(body.defaults))
      .catch(() => ({}));
  }
  return cache;
}

export function invalidateSceneDefaults(next: PerArenaSceneDefaults): void {
  cache = Promise.resolve(next);
}
