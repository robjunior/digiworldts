import type { TemplateDigimon } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

export type DigdexEntry = {
  readonly catalogId: string;
  readonly met: boolean;
  readonly template: TemplateDigimon | null;
};

export type DigdexResponse = {
  readonly entries: readonly DigdexEntry[];
  readonly totalCount: number;
  readonly metCount: number;
};

export function getDigdex(): Promise<DigdexResponse> {
  return apiFetch<DigdexResponse>('/api/digdex');
}
