import type { Stage } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

export type AdventureMemberView = {
  readonly monId: string;
  readonly nickname: string;
  readonly catalogId: string;
  readonly level: number;
  readonly stage: Stage | 'Unknown';
  readonly reviveAt: number | null;
};

export type AdventureEncounter = {
  readonly index: number;
  readonly wildLevel: number;
  readonly outcome: 'win' | 'loss';
  readonly meat: number;
  readonly bits: number;
  readonly data: number;
  readonly credits: number;
  readonly xpPerMon: number;
  readonly koMonId: string | null;
};

export type AdventureXpDelta = {
  readonly monId: string;
  readonly xpGained: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly gainedLevels: number;
};

export type AdventureReport = {
  readonly encounters: readonly AdventureEncounter[];
  readonly wins: number;
  readonly losses: number;
  readonly totals: { readonly meat: number; readonly bits: number; readonly data: number; readonly netcore: number };
  readonly xpDeltas: readonly AdventureXpDelta[];
  readonly koedMonIds: readonly string[];
};

export type AdventureView = {
  readonly id: string;
  readonly startedAt: number;
  readonly distanceMs: number;
  readonly finishesAt: number;
  readonly remainingMs: number;
  readonly ready: boolean;
  readonly meatSpent: number;
  readonly party: readonly AdventureMemberView[];
  readonly collectedAt: number | null;
  readonly report: AdventureReport | null;
};

export type AdventureConfigView = {
  readonly minHours: number;
  readonly maxHours: number;
  readonly meatPerHour: number;
  readonly encountersPerHour: number;
  readonly partySize: number;
};

export type AdventurePageView = {
  readonly active: AdventureView | null;
  readonly lastCollected: AdventureView | null;
  readonly meatOwned: number;
  readonly config: AdventureConfigView;
};

export type StartAdventureResult = {
  readonly ok: true;
  readonly adventure: AdventureView;
  readonly meatOwned: number;
};

export type CollectAdventureResult = {
  readonly ok: true;
  readonly adventure: AdventureView;
};

export function getAdventure(): Promise<AdventurePageView> {
  return apiFetch<AdventurePageView>('/api/adventure');
}

export function startAdventure(monIds: readonly string[], hours: number): Promise<StartAdventureResult> {
  return apiFetch<StartAdventureResult>('/api/adventure/start', { method: 'POST', body: { monIds, hours } });
}

export function collectAdventure(): Promise<CollectAdventureResult> {
  return apiFetch<CollectAdventureResult>('/api/adventure/collect', { method: 'POST' });
}
