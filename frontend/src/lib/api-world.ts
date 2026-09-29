import type { PveWorldResponse, PvePartyPreferences } from '@digiworld/shared/pve';
import type { WorldObjectKind } from '@digiworld/shared/quest';
import { apiFetch } from './api';

export type WorldObject = {
  readonly id: string; readonly x: number; readonly y: number; readonly lat: number; readonly lon: number;
  readonly kind: WorldObjectKind; readonly scale: number; readonly tint?: string; readonly questId?: string;
  readonly dungeonId?: string; readonly passable: boolean; readonly label?: string;
};

export type WorldDirection = 'up' | 'down' | 'left' | 'right';
export type BiomeMeta = { readonly biome: string; readonly label: string; readonly element: string; readonly color: string };
export type WorldTile = { readonly x: number; readonly y: number; readonly biome: string; readonly color: string };
export type WorldPosition = { readonly x: number; readonly y: number; readonly seed: number; readonly biome: BiomeMeta; readonly tiles: readonly WorldTile[] };
export type PartyRating = { readonly rating: number; readonly memberCount: number; readonly meanLevel: number; readonly dominantStage: string; readonly maxStage: string; readonly digiratingTotal: number; readonly digiratingAvg: number };
export type WorldEncounter = { readonly kind: 'none' } | { readonly kind: 'item'; readonly item: { readonly itemId: string; readonly name: string; readonly qty: number } };

export function getPveWorld(): Promise<PveWorldResponse> { return apiFetch<PveWorldResponse>('/api/world'); }
export function savePveParty(mode: 'explore' | 'expedition', party: readonly string[]): Promise<{ preferences: PvePartyPreferences }> {
  return apiFetch<{ preferences: PvePartyPreferences }>('/api/world/party', { method: 'PUT', body: { mode, party } });
}
export function startPveEncounter(placeId: string, mode: 'explore' | 'expedition', hours = 1, exclude?: readonly string[]): Promise<{ ok: true; matchId: string }> {
  return apiFetch<{ ok: true; matchId: string }>('/api/world/pve/start', { method: 'POST', body: { placeId, mode, hours, ...(exclude && exclude.length > 0 ? { exclude } : {}) } });
}

