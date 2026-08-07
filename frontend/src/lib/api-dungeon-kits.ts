import type {
  EnterDungeonResponse,
  Kit,
  KitInput,
  KitListResponse,
  KitResponse,
} from '@digiworld/shared/dungeon';

import { apiFetch } from './api';

export type { Kit, KitInput, KitListResponse, KitResponse, EnterDungeonResponse };

export function listKits(): Promise<KitListResponse> {
  return apiFetch<KitListResponse>('/api/dungeon/kits');
}

export function createKit(input: KitInput): Promise<KitResponse> {
  return apiFetch<KitResponse>('/api/dungeon/kits', { method: 'POST', body: input });
}

export function updateKit(kitId: string, input: KitInput): Promise<KitResponse> {
  return apiFetch<KitResponse>(`/api/dungeon/kits/${encodeURIComponent(kitId)}`, {
    method: 'PUT',
    body: input,
  });
}

export function deleteKit(kitId: string): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>(`/api/dungeon/kits/${encodeURIComponent(kitId)}`, {
    method: 'DELETE',
  });
}

export function enterDungeon(
  dungeonId: string,
  input: { readonly kitId?: string },
): Promise<EnterDungeonResponse> {
  return apiFetch<EnterDungeonResponse>(
    `/api/dungeon/${encodeURIComponent(dungeonId)}/enter`,
    { method: 'POST', body: input },
  );
}
