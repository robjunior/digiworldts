import type { Stage } from './digimon.js';

export type PveMode = 'explore' | 'expedition';

export type PvePoolEntry = {
  readonly catalogId: string;
  readonly weight: number;
};

export type PvePlace = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly x: number;
  readonly y: number;
  readonly explorePool: readonly PvePoolEntry[];
  readonly expeditionPool: readonly PvePoolEntry[];
  readonly minWildLevel: number;
  readonly maxWildLevel: number;
  readonly minWildStage: Stage;
  readonly maxWildStage: Stage;
  readonly wildCountMin: number;
  readonly wildCountMax: number;
  readonly levelVarianceMin: number;
  readonly levelVarianceMax: number;
  readonly xpMultiplier: number;
  readonly bitsMultiplier: number;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type PvePartyPreferences = {
  readonly exploreParty: readonly string[];
  readonly expeditionParty: readonly string[];
};

export type PveWorldResponse = {
  readonly places: readonly PvePlace[];
  readonly preferences: PvePartyPreferences;
};

export type PvePlaceInput = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly x: number;
  readonly y: number;
  readonly explorePool: readonly PvePoolEntry[];
  readonly expeditionPool: readonly PvePoolEntry[];
  readonly minWildLevel?: number;
  readonly maxWildLevel?: number;
  readonly minWildStage?: Stage;
  readonly maxWildStage?: Stage;
  readonly wildCountMin?: number;
  readonly wildCountMax?: number;
  readonly levelVarianceMin?: number;
  readonly levelVarianceMax?: number;
  readonly xpMultiplier?: number;
  readonly bitsMultiplier?: number;
  readonly enabled?: boolean;
};

export type PveEvolutionDrop = {
  readonly catalogId: string;
  readonly stage: Stage;
  readonly itemId: string;
  readonly fragments: number;
};

export const PVE_FRAGMENT_RECIPE_QTY = 5;
export const PVE_INITIAL_CRAFT_MS = 30 * 60 * 1000;

export function evolutionFragmentDrops(
  defeatedCatalogId: string,
  defeatedStage: Stage,
  nextEvolutionIds: readonly string[],
): readonly PveEvolutionDrop[] {
  const ids = defeatedStage === 'Rookie'
    ? nextEvolutionIds
    : [defeatedCatalogId, ...nextEvolutionIds];
  return [...new Set(ids)].map((catalogId) => ({
    catalogId,
    stage: defeatedStage,
    itemId: `itm-fragment-${catalogId}`,
    fragments: 1,
  }));
}
