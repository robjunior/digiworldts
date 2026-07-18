import type { TemplateDigimon } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

export type NurseryMon = {
  readonly id: string;
  readonly catalogId: string;
  readonly nickname: string;
  readonly level: number;
  readonly mood: number;
  readonly petsToday: number;
  readonly canPet: boolean;
  readonly template: TemplateDigimon | null;
};

export type NurseryView = {
  readonly mons: readonly NurseryMon[];
  readonly meat: number;
  readonly maxPetsPerDay: number;
  readonly petMoodDelta: number;
  readonly feedMoodDelta: number;
  readonly feedMeatCost: number;
};

export type PetResponse = {
  readonly ok: true;
  readonly mood: number;
  readonly petsToday: number;
  readonly maxPetsPerDay: number;
};

export type FeedResponse = {
  readonly ok: true;
  readonly mood: number;
  readonly meat: number;
};

export function getNursery(): Promise<NurseryView> {
  return apiFetch<NurseryView>('/api/nursery');
}

export function petNurseryMon(monId: string): Promise<PetResponse> {
  return apiFetch<PetResponse>(`/api/nursery/pet/${encodeURIComponent(monId)}`, { method: 'POST' });
}

export function feedNurseryMon(monId: string): Promise<FeedResponse> {
  return apiFetch<FeedResponse>(`/api/nursery/feed/${encodeURIComponent(monId)}`, { method: 'POST' });
}
