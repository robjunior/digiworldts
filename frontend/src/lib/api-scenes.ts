import type { Element } from '@digiworld/shared/digimon';
import type { SceneEntity, SceneListResponse } from '@digiworld/shared/scene';
import { DEFAULT_LOBBY_SCENE, LOBBY_SCENE_NAME, DEFAULT_WORLD_SCENE, WORLD_SCENE_NAME, type LobbySceneSettings, type WorldSceneSettings } from '@digiworld/scene3d/scene';

import { apiFetch } from './api';

const TTL_MS = 30_000;

let cache: Promise<readonly SceneEntity[]> | null = null;
let cacheAt = 0;

export function getScenes(force = false): Promise<readonly SceneEntity[]> {
  const now = Date.now();
  if (force || cache === null || now - cacheAt > TTL_MS) {
    cacheAt = now;
    cache = apiFetch<SceneListResponse>('/api/scene/scenes')
      .then((body) => body.scenes)
      .catch(() => [] as readonly SceneEntity[]);
  }
  return cache;
}

export function invalidateScenesCache(): void {
  cache = null;
  cacheAt = 0;
}

/**
 * Resolve the Lobby backdrop settings: the SceneEntity configured for the
 * lobby — `kind === 'lobby'` first, falling back to the scene named "Lobby"
 * (case-insensitive) — merged over {@link DEFAULT_LOBBY_SCENE}. Returns the
 * built-in defaults when no scene has been created yet, so the lobby always
 * renders.
 */
export async function getLobbyScene(): Promise<LobbySceneSettings> {
  // The admin editor runs in a separate SPA/process, so its cache cannot
  // invalidate this module's cache. Force the authoritative read here; the
  // React query controls the refresh cadence on the lobby page.
  const scenes = await getScenes(true);
  const lobby = scenes.find((s) => s.kind === 'lobby')
    ?? scenes.find((s) => s.name.trim().toLowerCase() === LOBBY_SCENE_NAME.toLowerCase());
  const stored = (lobby?.settings as Readonly<Record<string, unknown>> | undefined)?.lobby;
  if (!stored || typeof stored !== 'object') return DEFAULT_LOBBY_SCENE;
  return { ...DEFAULT_LOBBY_SCENE, ...(stored as Partial<LobbySceneSettings>) };
}

/** The SceneEntity currently configured as the lobby backdrop (kind or name). */
export async function getLobbySceneEntity(): Promise<SceneEntity | null> {
  const scenes = await getScenes(true);
  return scenes.find((s) => s.kind === 'lobby')
    ?? scenes.find((s) => s.name.trim().toLowerCase() === LOBBY_SCENE_NAME.toLowerCase())
    ?? null;
}

/**
 * Resolve the World backdrop settings: the SceneEntity with `kind === 'world'`
 * (falling back to the one named "World"), merged over DEFAULT_WORLD_SCENE.
 * Returns the built-in defaults when no world scene has been created, so the
 * world page always renders its globe.
 */
export async function getWorldScene(): Promise<WorldSceneSettings> {
  const scenes = await getScenes(true);
  const world = scenes.find((s) => s.kind === 'world')
    ?? scenes.find((s) => s.name.trim().toLowerCase() === WORLD_SCENE_NAME.toLowerCase());
  const stored = (world?.settings as Readonly<Record<string, unknown>> | undefined)?.world;
  if (!stored || typeof stored !== 'object') return DEFAULT_WORLD_SCENE;
  return { ...DEFAULT_WORLD_SCENE, ...(stored as Partial<WorldSceneSettings>) };
}

/** The SceneEntity currently configured as the world backdrop (kind or name). */
export async function getWorldSceneEntity(): Promise<SceneEntity | null> {
  const scenes = await getScenes(true);
  return scenes.find((s) => s.kind === 'world')
    ?? scenes.find((s) => s.name.trim().toLowerCase() === WORLD_SCENE_NAME.toLowerCase())
    ?? null;
}

export type SceneCreateBody = {
  readonly name: string;
  readonly elements: readonly Element[];
  readonly kind?: 'arena' | 'lobby' | 'world';
  readonly settings: Readonly<Record<string, unknown>>;
  readonly useGlbSettings?: boolean;
};

export type SceneUpdateBody = Partial<SceneCreateBody>;

export async function listScenes(): Promise<SceneListResponse> {
  return apiFetch<SceneListResponse>('/api/scene/scenes');
}

export async function createScene(body: SceneCreateBody): Promise<{ ok: true; scene: SceneEntity }> {
  const res = await apiFetch<{ ok: true; scene: SceneEntity }>('/api/admin/scenes', { method: 'POST', body });
  invalidateScenesCache();
  return res;
}

export async function updateScene(id: string, body: SceneUpdateBody): Promise<{ ok: true; scene: SceneEntity }> {
  const res = await apiFetch<{ ok: true; scene: SceneEntity }>(`/api/admin/scenes/${id}`, { method: 'PUT', body });
  invalidateScenesCache();
  return res;
}

export async function copyScene(id: string): Promise<{ ok: true; scene: SceneEntity }> {
  const res = await apiFetch<{ ok: true; scene: SceneEntity }>(`/api/admin/scenes/${id}/copy`, { method: 'POST' });
  invalidateScenesCache();
  return res;
}

export async function deleteScene(id: string): Promise<{ ok: true }> {
  const res = await apiFetch<{ ok: true }>(`/api/admin/scenes/${id}`, { method: 'DELETE' });
  invalidateScenesCache();
  return res;
}
