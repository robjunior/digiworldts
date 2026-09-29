import type { TemplateDigimon } from '@digiworld/shared/digimon';
import type {
  CollectHatchResponse,
  HatchStartResponse,
  MixHatchResponse,
  NurseryDataResponse,
  NurseryPendingResponse,
  PendingHatchEntry,
  SpeciesDataEntry,
  NurseryPenMon,
  NurseryPenStage,
  NurseryChain,
  NurseryView,
  GraduateResponse,
  PetPenMonResponse,
  FeedPenMonResponse,
} from '@digiworld/shared/nursery';

import { apiFetch } from './api';

export type {
  NurseryPenMon,
  NurseryPenStage,
  NurseryChain,
  NurseryView,
  GraduateResponse,
  PetPenMonResponse,
  FeedPenMonResponse,
  SpeciesDataEntry,
  PendingHatchEntry
};

export function getNursery(): Promise<NurseryView> {
  return apiFetch<NurseryView>('/api/nursery');
}

export function petNurseryMon(monId: string): Promise<PetPenMonResponse> {
  return apiFetch<PetPenMonResponse>(`/api/nursery/pet/${encodeURIComponent(monId)}`, { method: 'POST' });
}

export function feedNurseryMon(monId: string): Promise<FeedPenMonResponse> {
  return apiFetch<FeedPenMonResponse>(`/api/nursery/feed/${encodeURIComponent(monId)}`, { method: 'POST' });
}

export function graduatePenMon(monId: string): Promise<GraduateResponse> {
  return apiFetch<GraduateResponse>(`/api/nursery/graduate/${encodeURIComponent(monId)}`, { method: 'POST' });
}

export function getSpeciesData(): Promise<NurseryDataResponse> {
  return apiFetch<NurseryDataResponse>('/api/nursery/data');
}

export function getPendingHatches(): Promise<NurseryPendingResponse> {
  return apiFetch<NurseryPendingResponse>('/api/nursery/pending');
}

export function startDirectHatch(catalogId: string): Promise<HatchStartResponse> {
  return apiFetch<HatchStartResponse>(`/api/nursery/hatch/${encodeURIComponent(catalogId)}`, { method: 'POST' });
}

export function startMixHatch(catalogIds?: readonly string[]): Promise<MixHatchResponse> {
  if (catalogIds && catalogIds.length > 0) {
    return apiFetch<MixHatchResponse>('/api/nursery/hatch/mix', {
      method: 'POST',
      body: { catalogIds },
    });
  }
  return apiFetch<MixHatchResponse>('/api/nursery/hatch/mix', { method: 'POST' });
}

export function collectPendingHatch(hatchId: string): Promise<CollectHatchResponse> {
  return apiFetch<CollectHatchResponse>(`/api/nursery/pending/${encodeURIComponent(hatchId)}/collect`, { method: 'POST' });
}
