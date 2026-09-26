import type { QuestWithProgress, QuestsForUserResponse } from '@digiworld/shared/quest';

import { apiFetch } from './api';

export async function getQuests(): Promise<readonly QuestWithProgress[]> {
  const res = await apiFetch<QuestsForUserResponse>('/api/quests');
  return res.quests;
}

export async function acceptQuest(id: string): Promise<QuestWithProgress> {
  const res = await apiFetch<{ readonly quest: QuestWithProgress }>(`/api/quests/${encodeURIComponent(id)}/accept`, { method: 'POST' });
  return res.quest;
}

export type QuestClaimResult = {
  readonly ok: true;
  readonly netcoreGranted: number;
  readonly itemsGranted: readonly { readonly itemId: string; readonly qty: number }[];
  readonly premium: boolean;
  readonly premiumBonus: {
    readonly netcore: number;
    readonly items: readonly { readonly itemId: string; readonly qty: number }[];
  };
};

export async function claimQuest(id: string): Promise<QuestClaimResult> {
  return apiFetch<QuestClaimResult>(`/api/quests/${encodeURIComponent(id)}/claim`, { method: 'POST' });
}
