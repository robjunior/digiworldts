import type { PvePlace, PvePlaceInput } from '@digiworld/shared/pve';
import { apiFetch } from './api';

export function getPvePlaces(): Promise<{ places: readonly PvePlace[] }> { return apiFetch('/api/admin/pve/places'); }
export function savePvePlace(input: PvePlaceInput): Promise<{ place: PvePlace }> {
  return apiFetch(`/api/admin/pve/places/${encodeURIComponent(input.id)}`, { method: 'PUT', body: input });
}
export function deletePvePlace(id: string): Promise<{ ok: true }> { return apiFetch(`/api/admin/pve/places/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
