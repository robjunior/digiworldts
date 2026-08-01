import type { TemplateDigimon } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

/**
 * Public catalog reader.
 *
 * `GET /api/catalog` is a **user** endpoint — every authenticated player
 * can call it to fetch the current Digimon roster templates. The name
 * "api-catalog" (not "api-admin") reflects that.
 *
 * Admin catalog *writes* live in the standalone admin app
 * (`admin/src/lib/api-admin.ts`, `POST/PUT/DELETE /api/admin/catalog/*`).
 */
export type CatalogResponse = {
  readonly version: string;
  readonly updatedAt: number;
  readonly digimons: readonly TemplateDigimon[];
};

export function getCatalog(): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>('/api/catalog');
}
