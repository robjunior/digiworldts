import type { Dungeon, DungeonDoor, DungeonListResponse, DungeonView, DungeonTile, DungeonEncounter, DungeonItem, DungeonWarp, EncounterDigimon, WorldObjectListResponse, WorldObject, WorldObjectKind, EncounterLoot } from '@digiworld/shared';
import type { Element } from '@digiworld/shared/digimon';
import { apiFetch } from './api';

type AdminDungeonRandomFields = Pick<Dungeon, 'randomEncountersEnabled' | 'randomEncounterRate' | 'randomMinLevel' | 'randomMaxLevel' | 'randomMaxStage' | 'randomMinPartySize' | 'randomMaxPartySize' | 'randomAllowedElements'>;

export type AdminDungeonCreateBody = Pick<Dungeon, 'name' | 'biome' | 'width' | 'height'> & Partial<Pick<Dungeon, 'description' | 'spawnX' | 'spawnY'>> & Partial<AdminDungeonRandomFields> & {
  readonly biomeRegion?: Dungeon['biomeRegion'];
  readonly worldObjectId?: string | null;
  readonly questId?: string | null;
  readonly parentId?: string | null;
};

export type AdminDungeonUpdateBody = Partial<Omit<Dungeon, 'id' | 'createdAt' | 'updatedAt'>>;

export async function listAdminDungeons(): Promise<DungeonListResponse> {
  return apiFetch<DungeonListResponse>('/api/admin/dungeons');
}

export async function createAdminDungeon(body: AdminDungeonCreateBody): Promise<{ dungeon: Dungeon }> {
  return apiFetch<{ dungeon: Dungeon }>('/api/admin/dungeons', {
    method: 'POST',
    body,
  });
}

export async function getAdminDungeon(id: string): Promise<DungeonView> {
  return apiFetch<DungeonView>(`/api/admin/dungeons/${id}`);
}

export async function updateAdminDungeon(id: string, body: AdminDungeonUpdateBody): Promise<{ dungeon: Dungeon }> {
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

export async function putAdminDungeonTiles(id: string, tiles: readonly DungeonTile[]): Promise<{ tiles: readonly DungeonTile[] }> {
  return apiFetch<{ tiles: readonly DungeonTile[] }>(`/api/admin/dungeons/${id}/tiles`, {
    method: 'PUT',
    body: { tiles },
  });
}

export async function createAdminEncounter(id: string, body: { x: number; y: number; label?: string; difficulty?: 'easy' | 'normal' | 'elite' | 'boss'; digimon: readonly EncounterDigimon[]; loots: readonly EncounterLoot[] }): Promise<{ encounter: DungeonEncounter }> {
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

export async function createAdminWarp(id: string, body: { x: number; y: number; targetDungeonId?: string | null; label?: string | null }): Promise<DungeonView> {
  return apiFetch<DungeonView>(`/api/admin/dungeons/${id}/warps`, {
    method: 'POST',
    body,
  });
}

export async function updateAdminWarp(id: string, warpId: string, body: Partial<Pick<DungeonWarp, 'targetDungeonId' | 'label'>>): Promise<DungeonView> {
  return apiFetch<DungeonView>(`/api/admin/dungeons/${id}/warps/${warpId}`, {
    method: 'PUT',
    body,
  });
}

export async function deleteAdminWarp(id: string, warpId: string): Promise<DungeonView> {
  return apiFetch<DungeonView>(`/api/admin/dungeons/${id}/warps/${warpId}`, {
    method: 'DELETE',
  });
}

export function createAdminDoor(dungeonId: string, body: { readonly x: number; readonly y: number; readonly keyItemId: string; readonly label?: string | null }): Promise<{ readonly view: DungeonView }> {
  return apiFetch<{ readonly view: DungeonView }>(`/api/admin/dungeons/${dungeonId}/doors`, { method: 'POST', body });
}

export function updateAdminDoor(dungeonId: string, doorId: string, body: Partial<Pick<DungeonDoor, 'x' | 'y' | 'keyItemId' | 'label'>>): Promise<{ readonly view: DungeonView }> {
  return apiFetch<{ readonly view: DungeonView }>(`/api/admin/dungeons/${dungeonId}/doors/${doorId}`, { method: 'PUT', body });
}

export function deleteAdminDoor(dungeonId: string, doorId: string): Promise<{ readonly ok: boolean }> {
  return apiFetch<{ readonly ok: boolean }>(`/api/admin/dungeons/${dungeonId}/doors/${doorId}`, { method: 'DELETE' });
}

import type { TrapKind } from '@digiworld/shared';

export function createAdminTrap(dungeonId: string, body: { readonly x: number; readonly y: number; readonly kind: TrapKind; readonly severity: number; readonly label?: string | null }): Promise<{ readonly view: DungeonView }> {
  return apiFetch<{ readonly view: DungeonView }>(`/api/admin/dungeons/${dungeonId}/traps`, { method: 'POST', body });
}

export function updateAdminTrap(dungeonId: string, trapId: string, body: { readonly x?: number; readonly y?: number; readonly kind?: TrapKind; readonly severity?: number; readonly label?: string | null }): Promise<{ readonly view: DungeonView }> {
  return apiFetch<{ readonly view: DungeonView }>(`/api/admin/dungeons/${dungeonId}/traps/${trapId}`, { method: 'PUT', body });
}

export function deleteAdminTrap(dungeonId: string, trapId: string): Promise<{ readonly view: DungeonView }> {
  return apiFetch<{ readonly view: DungeonView }>(`/api/admin/dungeons/${dungeonId}/traps/${trapId}`, { method: 'DELETE' });
}

export async function listAdminWorldObjects(): Promise<WorldObjectListResponse> {
  return apiFetch<WorldObjectListResponse>('/api/world/objects'); // this is what World uses
}

export async function createAdminWorldObject(body: { x: number; y: number; lat: number; lon: number; kind: WorldObjectKind; scale: number; passable: boolean; label?: string; tint?: string; questId?: string; dungeonId?: string; elements?: readonly Element[]; minLevel?: number; maxLevel?: number }): Promise<{ object: WorldObject }> {
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

export type ImportTiledNewBody = {
  readonly tiledJson: unknown;
  readonly name: string;
  readonly biome: Dungeon['biome'];
  readonly description?: string;
};

export type ImportTiledResponse = {
  readonly dungeon: Dungeon;
  readonly warnings: readonly string[];
};

export type ImportTiledReplaceResponse = {
  readonly view: DungeonView;
  readonly warnings: readonly string[];
};

export async function importAdminDungeonTiled(body: ImportTiledNewBody): Promise<ImportTiledResponse> {
  return apiFetch<ImportTiledResponse>('/api/admin/dungeons/import-tiled', {
    method: 'POST',
    body,
  });
}

export async function importAdminDungeonTiledReplace(dungeonId: string, tiledJson: unknown): Promise<ImportTiledReplaceResponse> {
  return apiFetch<ImportTiledReplaceResponse>(`/api/admin/dungeons/${encodeURIComponent(dungeonId)}/import-tiled`, {
    method: 'POST',
    body: { tiledJson },
  });
}
