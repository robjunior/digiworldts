import type { Element } from '@digiworld/shared/digimon';
import type { SceneEntity, SceneListResponse } from '@digiworld/shared/scene';

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

export type SceneCreateBody = {
  readonly name: string;
  readonly elements: readonly Element[];
  readonly kind?: 'arena' | 'lobby';
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
