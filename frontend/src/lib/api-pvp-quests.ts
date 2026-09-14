import type {
  PvpQuestPeriod,
  PvpQuestWithProgress,
  PvpQuestTemplate,
} from '@digiworld/shared/pvp-quest';

import { apiFetch } from './api';

export interface PvpQuestWindow {
  readonly period: PvpQuestPeriod;
  readonly windowId: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly quests: PvpQuestWithProgress[];
}

export interface PvpQuestsResponse {
  readonly periods: PvpQuestWindow[];
}

export async function getPvpQuests(): Promise<PvpQuestsResponse> {
  return apiFetch<PvpQuestsResponse>('/api/pvp-quests');
}

export async function getPvpQuestsForPeriod(
  period: PvpQuestPeriod,
): Promise<PvpQuestWindow> {
  return apiFetch<PvpQuestWindow>(`/api/pvp-quests/${period}`);
}

export interface ClaimPvpQuestResult {
  readonly ok: boolean;
  readonly alreadyClaimed: boolean;
  readonly reward: {
    readonly kind: string;
    readonly amount?: number;
    readonly itemId?: string;
    readonly qty?: number;
    readonly cosmeticId?: string;
  } | null;
}

export async function claimPvpQuest(
  period: PvpQuestPeriod,
  windowId: string,
  instanceId: string,
): Promise<ClaimPvpQuestResult> {
  return apiFetch<ClaimPvpQuestResult>(
    `/api/pvp-quests/${period}/${encodeURIComponent(windowId)}/${encodeURIComponent(instanceId)}/claim`,
    { method: 'POST' },
  );
}

export interface AdminPreviewBoard {
  readonly period: PvpQuestPeriod;
  readonly windowId: string;
  readonly quests: PvpQuestTemplate[];
}

export async function previewPvpQuests(
  period: PvpQuestPeriod,
  count?: number,
): Promise<AdminPreviewBoard> {
  return apiFetch<AdminPreviewBoard>('/api/admin/pvp-quests/preview', {
    method: 'POST',
    body: JSON.stringify({ period, count }),
  });
}

export async function regeneratePvpQuests(
  period: PvpQuestPeriod,
): Promise<{ period: PvpQuestPeriod; windowId: string; count: number }> {
  return apiFetch<{ period: PvpQuestPeriod; windowId: string; count: number }>(
    `/api/admin/pvp-quests/${period}/regenerate`,
    { method: 'POST' },
  );
}

/** Human-readable reward description for a PvP quest reward declaration. */
export function formatPvpQuestReward(reward: PvpQuestWithProgress['reward']): string {
  switch (reward.kind) {
    case 'netcore':
      return `${reward.amount} NetCore`;
    case 'credits':
      return `${reward.amount} Bits`;
    case 'item':
      return `${reward.qty}× Item`;
    case 'battle_item':
      return `${reward.qty}× Battle Item`;
    case 'pvp_points':
      return `${reward.amount} PvP Points`;
    case 'xp':
      return `${reward.amount} XP`;
    case 'cosmetic':
      return reward.cosmeticId;
    default:
      return 'Reward';
  }
}
