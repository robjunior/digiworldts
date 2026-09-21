import { apiFetch } from './api';

/** Booster rarity + status mirror backend/src/boosters/types.ts and the seed schema. */
export const BOOSTER_RARITIES = ['common', 'uncommon', 'rare', 'ultra-rare'] as const;
export type BoosterRarity = (typeof BOOSTER_RARITIES)[number];

export const BOOSTER_STATUSES = ['draft', 'review', 'published', 'archived'] as const;
export type BoosterStatus = (typeof BOOSTER_STATUSES)[number];

/** Seed-file shape (camelCase; the file is the source of truth). */
export type BoosterSeed = {
  $schema: string;
  code: string;
  name: string;
  set: string;
  releaseDate: string;
  description?: string;
  status: BoosterStatus;
  tags?: string[];
  digimonPool: BoosterDigimonEntry[];
  itemPool: BoosterItemEntry[];
};

export type BoosterDigimonEntry = {
  ref: string;
  digimonId: string;
  parentRef: string | null;
  rarity: BoosterRarity;
  weight: number;
  order: number;
};

export type BoosterItemEntry = {
  ref: string;
  itemId: string;
  rarity: BoosterRarity;
  weight: number;
  order: number;
};

/** Runtime booster view returned by GET /api/boosters. */
export type BoosterSummary = {
  code: string;
  name: string;
  set: string;
  releaseDate: string;
  description?: string;
  status: BoosterStatus;
  tags: string[];
  seedHash: string;
  loadedAt: number;
};

export type BoosterDetail = {
  booster: BoosterSummary;
  digimonPool: Array<{
    id: string;
    ref: string;
    digimon_id: string;
    parent_node_id: string | null;
    rarity: BoosterRarity;
    weight: number;
    order: number;
  }>;
  itemPool: Array<{
    id: string;
    ref: string;
    item_id: string;
    rarity: BoosterRarity;
    weight: number;
    order: number;
  }>;
};

export type CatalogEvolution = {
  targetId: string;
  name: string;
  stage?: string;
  attribute?: string;
  element?: string;
  requiredLevel?: number;
  requiredItemId?: string;
};

export async function fetchBoosters(): Promise<BoosterSummary[]> {
  const res = await apiFetch<{ boosters: BoosterSummary[] }>('/api/boosters');
  return res.boosters;
}

export async function fetchBooster(code: string): Promise<BoosterDetail> {
  return apiFetch<BoosterDetail>(`/api/boosters/${encodeURIComponent(code)}`);
}

export async function fetchCatalogEvolutions(id: string): Promise<{ digimonId: string; name: string; evolutions: CatalogEvolution[] }> {
  return apiFetch<{ digimonId: string; name: string; evolutions: CatalogEvolution[] }>(
    `/api/catalog/digimon/${encodeURIComponent(id)}/evolutions`,
  );
}