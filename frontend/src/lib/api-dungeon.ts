import type {
  BattleView,
  DungeonRunView,
  DungeonMoveResponse,
  DungeonCompleteResponse,
  DungeonTriggerActivateResponse,
  DungeonGridNeighborsResponse,
  EncounterDigimon,
} from '@digiworld/shared';
import { apiFetch } from './api';

export async function getDungeon(id: string): Promise<DungeonRunView> {
  return apiFetch<DungeonRunView>(`/api/dungeon/${id}`);
}

export async function getDungeonNeighbors(id: string): Promise<DungeonGridNeighborsResponse> {
  return apiFetch<DungeonGridNeighborsResponse>(`/api/dungeon/${id}/neighbors`);
}

export async function moveInDungeon(id: string, x: number, y: number): Promise<DungeonMoveResponse> {
  return apiFetch<DungeonMoveResponse>(`/api/dungeon/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ x, y }),
  });
}

export async function defeatEncounter(_id: string, _encId: string): Promise<never> {
  throw new Error('defeatEncounter endpoint removed — combat is server-authoritative; win a real battle to mark an encounter defeated.');
}

export async function startEncounter(id: string, encId: string): Promise<{ battle: BattleView }> {
  return apiFetch<{ battle: BattleView }>(`/api/dungeon/${id}/encounter/${encId}/start`, {
    method: 'POST',
  });
}

export async function startRandomEncounter(id: string, digimon: readonly EncounterDigimon[]): Promise<{ battle: BattleView }> {
  return apiFetch<{ battle: BattleView }>(`/api/dungeon/${id}/random-encounter/start`, {
    method: 'POST',
    body: { digimon },
  });
}

export async function completeDungeon(id: string): Promise<DungeonCompleteResponse> {
  return apiFetch<DungeonCompleteResponse>(`/api/dungeon/${id}/complete`, {
    method: 'POST',
  });
}

export async function resetDungeon(id: string): Promise<{ run: DungeonRunView['run'] }> {
  return apiFetch<{ run: DungeonRunView['run'] }>(`/api/dungeon/${id}/reset`, {
    method: 'POST',
  });
}

export function unlockDungeonDoor(dungeonId: string, doorId: string): Promise<{ readonly view: DungeonRunView }> {
  return apiFetch<{ readonly view: DungeonRunView }>(`/api/dungeons/${dungeonId}/doors/${doorId}/unlock`, { method: 'POST' });
}

export function activateDungeonTrigger(dungeonId: string, triggerId: string): Promise<DungeonTriggerActivateResponse> {
  return apiFetch<DungeonTriggerActivateResponse>(`/api/dungeon/${dungeonId}/triggers/${triggerId}/activate`, { method: 'POST' });
}
