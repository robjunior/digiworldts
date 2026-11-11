import type {
  SkillVfxPreset,
  SkillVfxPresetListResponse,
  SkillVfxPresetMutationResponse,
} from '@digiworld/shared/skill-vfx';

import { apiFetch } from './api';

const TTL_MS = 30_000;

let cache: Promise<readonly SkillVfxPreset[]> | null = null;
let cacheAt = 0;
let resolvedPresets: readonly SkillVfxPreset[] | null = null;

/**
 * Async load with TTL cache. First access triggers fetch; subsequent calls
 * inside 30 s return the same Promise. `force: true` skips the cache.
 */
export function getSkillVfxPresets(force = false): Promise<readonly SkillVfxPreset[]> {
  const now = Date.now();
  if (force || cache === null || now - cacheAt > TTL_MS) {
    cacheAt = now;
    cache = apiFetch<SkillVfxPresetListResponse>('/api/skill-vfx-presets')
      .then((body) => {
        resolvedPresets = body.presets;
        return body.presets;
      })
      .catch(() => {
        resolvedPresets = [];
        return [] as readonly SkillVfxPreset[];
      });
  }
  return cache;
}

/**
 * Sync lookup by id — returns null if cache not yet warm. On cold-cache miss,
 * fires a background fetch so the SECOND cast of the same skill lands the
 * preset. `SceneManager.playEffect` uses this and silently falls back to the
 * element runner when the return is null (missing preset or cold cache).
 */
export function getSkillVfxPresetSync(id: string): SkillVfxPreset | null {
  if (resolvedPresets === null) {
    void getSkillVfxPresets();
    return null;
  }
  return resolvedPresets.find((p) => p.id === id) ?? null;
}

export function invalidateSkillVfxPresetsCache(): void {
  cache = null;
  cacheAt = 0;
  resolvedPresets = null;
}

export type SkillVfxPresetCreateBody = {
  readonly name: string;
  readonly emitters: SkillVfxPreset['emitters'];
  readonly trajectory: SkillVfxPreset['trajectory'];
  readonly totalDurationMs: number;
  readonly impactAtMs: number;
  readonly element?: SkillVfxPreset['element'];
  readonly attackType?: SkillVfxPreset['attackType'];
  readonly light?: SkillVfxPreset['light'];
};

export type SkillVfxPresetUpdateBody = Partial<SkillVfxPresetCreateBody>;

export async function createSkillVfxPreset(
  body: SkillVfxPresetCreateBody,
): Promise<SkillVfxPresetMutationResponse> {
  const res = await apiFetch<SkillVfxPresetMutationResponse>('/api/admin/skill-vfx-presets', {
    method: 'POST',
    body,
  });
  invalidateSkillVfxPresetsCache();
  return res;
}

export async function updateSkillVfxPreset(
  id: string,
  body: SkillVfxPresetUpdateBody,
): Promise<SkillVfxPresetMutationResponse> {
  const res = await apiFetch<SkillVfxPresetMutationResponse>(
    `/api/admin/skill-vfx-presets/${id}`,
    { method: 'PUT', body },
  );
  invalidateSkillVfxPresetsCache();
  return res;
}

export async function deleteSkillVfxPreset(id: string): Promise<{ ok: true }> {
  const res = await apiFetch<{ ok: true }>(`/api/admin/skill-vfx-presets/${id}`, {
    method: 'DELETE',
  });
  invalidateSkillVfxPresetsCache();
  return res;
}
