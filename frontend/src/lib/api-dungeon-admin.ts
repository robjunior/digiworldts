import type { Dungeon, DungeonListResponse, DungeonView, DungeonTile, DungeonEncounter, DungeonItem, EncounterDigimon, WorldObjectListResponse, WorldObject, WorldObjectKind } from '@digiworld/shared';
import { ApiError, apiFetch } from './api';

export async function listAdminDungeons(): Promise<DungeonListResponse> {
  return apiFetch<DungeonListResponse>('/api/admin/dungeons');
}

export async function createAdminDungeon(body: { name: string; description?: string; biome: string; width: number; height: number; spawnX?: number; spawnY?: number; worldObjectId?: string; questId?: string }): Promise<{ dungeon: Dungeon }> {
  return apiFetch<{ dungeon: Dungeon }>('/api/admin/dungeons', {
    method: 'POST',
    body,
  });
}

export async function getAdminDungeon(id: string): Promise<DungeonView> {
  return apiFetch<DungeonView>(`/api/admin/dungeons/${id}`);
}

export async function updateAdminDungeon(id: string, body: Partial<Omit<Dungeon, 'id' | 'createdAt' | 'updatedAt'>>): Promise<{ dungeon: Dungeon }> {
  return apiFetch<{ dungeon: Dungeon }>(`/api/admin/dungeons/${id}`, {
    method: 'PUT',
    body,
  });
}

export async function deleteAdminDungeon(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/admin/dungeons/${id}`, {
    method: 'DELETE',
  });
}

export async function putAdminDungeonTiles(id: string, tiles: readonly { x: number; y: number }[]): Promise<{ tiles: readonly DungeonTile[] }> {
  return apiFetch<{ tiles: readonly DungeonTile[] }>(`/api/admin/dungeons/${id}/tiles`, {
    method: 'PUT',
    body: { tiles },
  });
}

export async function createAdminEncounter(id: string, body: { x: number; y: number; label?: string; difficulty?: 'easy' | 'normal' | 'elite' | 'boss'; digimon: readonly EncounterDigimon[] }): Promise<{ encounter: DungeonEncounter }> {
  return apiFetch<{ encounter: DungeonEncounter }>(`/api/admin/dungeons/${id}/encounters`, {
    method: 'POST',
    body,
  });
}

export async function updateAdminEncounter(id: string, encId: string, body: Partial<Omit<DungeonEncounter, 'id' | 'dungeonId' | 'createdAt' | 'updatedAt'>>): Promise<{ encounter: DungeonEncounter }> {
  return apiFetch<{ encounter: DungeonEncounter }>(`/api/admin/dungeons/${id}/encounters/${encId}`, {
    method: 'PUT',
    body,
  });
}

export async function deleteAdminEncounter(id: string, encId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/admin/dungeons/${id}/encounters/${encId}`, {
    method: 'DELETE',
  });
}

export async function createAdminItem(id: string, body: { x: number; y: number; itemId: string; qty?: number }): Promise<{ item: DungeonItem }> {
  return apiFetch<{ item: DungeonItem }>(`/api/admin/dungeons/${id}/items`, {
    method: 'POST',
    body,
  });
}

export async function deleteAdminItem(id: string, itemId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/admin/dungeons/${id}/items/${itemId}`, {
    method: 'DELETE',
  });
}

export async function listAdminWorldObjects(): Promise<WorldObjectListResponse> {
  return apiFetch<WorldObjectListResponse>('/api/world/objects'); // this is what World uses
}

export async function createAdminWorldObject(body: { x: number; y: number; kind: WorldObjectKind; scale: number; passable: boolean; label?: string; tint?: string; questId?: string; dungeonId?: string }): Promise<{ object: WorldObject }> {
  return apiFetch<{ object: WorldObject }>('/api/admin/world-objects', {
    method: 'POST',
    body,
  });
}

export async function updateAdminWorldObject(id: string, body: Partial<Omit<WorldObject, 'id' | 'createdAt' | 'updatedAt'>>): Promise<{ object: WorldObject }> {
  return apiFetch<{ object: WorldObject }>(`/api/admin/world-objects/${id}`, {
    method: 'PUT',
    body,
  });
}

export async function deleteAdminWorldObject(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/admin/world-objects/${id}`, {
    method: 'DELETE',
  });
}
