import type { ParticleEmitterConfig, ParticlePresetEntry, ParticlePresetListResponse, ParticlePresetMutationResponse } from '@digiworld/shared/weather';
import { apiFetch } from './api';

const TTL_MS = 30_000;

let cache: Promise<readonly ParticlePresetEntry[]> | null = null;
let cacheAt = 0;

export function getPresets(force = false): Promise<readonly ParticlePresetEntry[]> {
  const now = Date.now();
  if (force || cache === null || now - cacheAt > TTL_MS) {
    cacheAt = now;
    cache = apiFetch<ParticlePresetListResponse>('/api/particle-presets')
      .then((body) => body.presets)
      .catch(() => [] as readonly ParticlePresetEntry[]);
  }
  return cache;
}

export function invalidatePresetsCache(): void {
  cache = null;
  cacheAt = 0;
}

export type PresetCreateBody = {
  readonly name: string;
  readonly emitter: ParticleEmitterConfig;
};

export type PresetUpdateBody = Partial<PresetCreateBody>;

export async function createPreset(body: PresetCreateBody): Promise<ParticlePresetMutationResponse> {
  const res = await apiFetch<ParticlePresetMutationResponse>('/api/admin/particle-presets', { method: 'POST', body });
  invalidatePresetsCache();
  return res;
}

export async function updatePreset(id: string, body: PresetUpdateBody): Promise<ParticlePresetMutationResponse> {
  const res = await apiFetch<ParticlePresetMutationResponse>(`/api/admin/particle-presets/${id}`, { method: 'PUT', body });
  invalidatePresetsCache();
  return res;
}

export async function deletePreset(id: string): Promise<{ ok: true }> {
  const res = await apiFetch<{ ok: true }>(`/api/admin/particle-presets/${id}`, { method: 'DELETE' });
  invalidatePresetsCache();
  return res;
}
