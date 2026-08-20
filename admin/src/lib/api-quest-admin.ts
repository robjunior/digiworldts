import type { Quest, QuestListResponse } from '@digiworld/shared';

import { apiFetch } from './api';

export type QuestAdminBody = Omit<Quest, 'id' | 'createdAt' | 'updatedAt'>;

export function listAdminQuests(): Promise<QuestListResponse> {
  return apiFetch<QuestListResponse>('/api/admin/quests');
}

export function getAdminQuest(id: string): Promise<{ readonly quest: Quest }> {
  return apiFetch<{ readonly quest: Quest }>(`/api/admin/quests/${id}`);
}

export function createAdminQuest(body: QuestAdminBody): Promise<{ readonly quest: Quest }> {
  return apiFetch<{ readonly quest: Quest }>('/api/admin/quests', {
    method: 'POST',
    body,
  });
}

export function updateAdminQuest(id: string, body: QuestAdminBody): Promise<{ readonly quest: Quest }> {
  return apiFetch<{ readonly quest: Quest }>(`/api/admin/quests/${id}`, {
    method: 'PUT',
    body,
  });
}

export function deleteAdminQuest(id: string): Promise<{ readonly ok: boolean }> {
  return apiFetch<{ readonly ok: boolean }>(`/api/admin/quests/${id}`, {
    method: 'DELETE',
  });
}

export function exportAdminQuest(id: string): Promise<Quest> {
  return apiFetch<Quest>(`/api/admin/quests/${id}/export`);
}

export function importAdminQuest(payload: Quest | QuestAdminBody): Promise<{ readonly quest: Quest }> {
  return apiFetch<{ readonly quest: Quest }>('/api/admin/quests/import', {
    method: 'POST',
    body: payload,
  });
}

export function publishQuest(id: string): Promise<{ readonly quest: Quest }> {
  return apiFetch<{ readonly quest: Quest }>(`/api/admin/quests/${id}/publish`, {
    method: 'POST',
  });
}

export type QuestHistoryEntry = {
  readonly version: number;
  readonly status: 'draft' | 'published';
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly definition: Quest;
};

export function getQuestHistory(id: string): Promise<{ readonly history: readonly QuestHistoryEntry[] }> {
  return apiFetch<{ readonly history: readonly QuestHistoryEntry[] }>(`/api/admin/quests/${id}/history`);
}
