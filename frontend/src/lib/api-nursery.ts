import type { TemplateDigimon } from '@digiworld/shared/digimon';
import type {
  CollectHatchResponse,
  HatchStartResponse,
  MixHatchResponse,
  NurseryDataResponse,
  NurseryPendingResponse,
  PendingHatchEntry,
  SpeciesDataEntry,
} from '@digiworld/shared/nursery';

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

export type { SpeciesDataEntry, PendingHatchEntry };

export function getSpeciesData(): Promise<NurseryDataResponse> {
  return apiFetch<NurseryDataResponse>('/api/nursery/data');
}

export function getPendingHatches(): Promise<NurseryPendingResponse> {
  return apiFetch<NurseryPendingResponse>('/api/nursery/pending');
}

export function startDirectHatch(catalogId: string): Promise<HatchStartResponse> {
  return apiFetch<HatchStartResponse>(`/api/nursery/hatch/${encodeURIComponent(catalogId)}`, { method: 'POST' });
}

export function startMixHatch(): Promise<MixHatchResponse> {
  return apiFetch<MixHatchResponse>('/api/nursery/hatch/mix', { method: 'POST' });
}

export function collectPendingHatch(hatchId: string): Promise<CollectHatchResponse> {
  return apiFetch<CollectHatchResponse>(`/api/nursery/pending/${encodeURIComponent(hatchId)}/collect`, { method: 'POST' });
}
