import type {
  DungeonRunView,
  DungeonMoveResponse,
  DungeonCompleteResponse,
} from '@digiworld/shared';
import { apiFetch } from './api';

export async function getDungeon(id: string): Promise<DungeonRunView> {
  return apiFetch<DungeonRunView>(`/api/dungeon/${id}`);
}

export async function moveInDungeon(id: string, x: number, y: number): Promise<DungeonMoveResponse> {
  return apiFetch<DungeonMoveResponse>(`/api/dungeon/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ x, y }),
  });
}

export async function defeatEncounter(id: string, encId: string): Promise<{ run: DungeonRunView['run'] }> {
  return apiFetch<{ run: DungeonRunView['run'] }>(`/api/dungeon/${id}/encounter/${encId}/defeat`, {
    method: 'POST',
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
