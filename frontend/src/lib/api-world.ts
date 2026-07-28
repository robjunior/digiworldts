import type { Action, BattleView } from '@digiworld/shared/battle';
import type { Element, Stage } from '@digiworld/shared/digimon';
import type { WorldObjectKind } from '@digiworld/shared/quest';
import type { WorldRegion, WorldRegionsResponse } from '@digiworld/shared/world';

import { ApiError, apiFetch } from './api';

export const WORLD_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type WorldDirection = (typeof WORLD_DIRECTIONS)[number];

export const WORLD_BIOMES = [
  'desert',
  'forest',
  'lake',
  'storm',
  'tundra',
  'mountain',
  'foundry',
  'plateau',
  'prairie',
  'swamp',
  'void',
] as const;
export type WorldBiome = (typeof WORLD_BIOMES)[number];

export type BiomeMeta = {
  readonly biome: WorldBiome;
  readonly label: string;
  readonly element: Element;
  readonly color: string;
};

export type WorldTile = {
  readonly x: number;
  readonly y: number;
  readonly biome: WorldBiome;
  readonly color: string;
};

export type { WorldObjectKind };

// PHASE 8 TODO: promote to @digiworld/shared/quest once sister agent lands.
export type WorldObject = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly lat: number;
  readonly lon: number;
  readonly kind: WorldObjectKind;
  readonly scale: number;
  readonly tint?: string;
  readonly questId?: string;
  readonly dungeonId?: string;
  readonly passable: boolean;
  readonly label?: string;
};

export type WorldObjectsResponse = {
  readonly objects: readonly WorldObject[];
};

export type WorldPosition = {
  readonly x: number;
  readonly y: number;
  readonly seed: number;
  readonly biome: BiomeMeta;
  readonly tiles: readonly WorldTile[];
};

export type PartyRating = {
  readonly rating: number;
  readonly memberCount: number;
  readonly meanLevel: number;
  readonly dominantStage: Stage;
  readonly maxStage: Stage;
  readonly digiratingTotal: number;
  readonly digiratingAvg: number;
};

export type WildMon = {
  readonly catalogId: string;
  readonly name: string;
  readonly element: Element;
  readonly stage: Stage;
  readonly level: number;
  readonly portrait: string;
  readonly rare: boolean;
};

export type ItemDrop = {
  readonly itemId: string;
  readonly name: string;
  readonly qty: number;
};

export type WorldEncounter =
  | { readonly kind: 'none' }
  | { readonly kind: 'item'; readonly item: ItemDrop }
  | { readonly kind: 'wild-mon'; readonly mons: readonly WildMon[] };

export type WorldState = {
  readonly position: WorldPosition;
  readonly partyRating: PartyRating;
  readonly steps: number;
  readonly viewRadius: number;
  readonly battleActive: boolean;
};

export type WorldMoveResponse = {
  readonly position: WorldPosition;
  readonly partyRating: PartyRating;
  readonly steps: number;
  readonly encounter: WorldEncounter;
  readonly battle: BattleView | null;
  readonly battleStartError: string | null;
};

export type WorldBattleResponse = {
  readonly battle: BattleView;
};

export type StatSnapshot = {
  readonly hp: number;
  readonly en: number;
  readonly atk: number;
  readonly def: number;
  readonly int: number;
  readonly spd: number;
};

export type XpAward = {
  readonly monId: string;
  readonly catalogId: string;
  readonly nickname: string;
  readonly delta: number;
  readonly previousLevel: number;
  readonly newLevel: number;
  readonly gainedLevels: number;
  readonly xpBefore: number;
  readonly xpAfter: number;
  readonly xpFloor: number;
  readonly xpNext: number;
  readonly xpFloorBefore: number;
  readonly xpNextBefore: number;
  readonly defeated: boolean;
  readonly statsBefore: StatSnapshot;
  readonly statsAfter: StatSnapshot;
};

export type WorldBattleActResponse = {
  readonly battle: BattleView;
  readonly ended: boolean;
  readonly capturedMonId?: string;
  readonly xpAwards?: readonly XpAward[];
  readonly itemDrops?: readonly ItemDrop[];
  readonly creditsGained?: number;
  readonly bitsGained?: number;
};

export function getWorldState(): Promise<WorldState> {
  return apiFetch<WorldState>('/api/world/state');
}

export async function getWorldObjects(): Promise<WorldObjectsResponse> {
  try {
    return await apiFetch<WorldObjectsResponse>('/api/world/objects');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { objects: [] };
    }
    throw error;
  }
}

export function moveInWorld(dir: WorldDirection): Promise<WorldMoveResponse> {
  return apiFetch<WorldMoveResponse>('/api/world/move', { method: 'POST', body: { dir } });
}

export async function getWorldBattleView(): Promise<BattleView> {
  const response = await apiFetch<WorldBattleResponse>('/api/world/battle');
  return response.battle;
}

export function actInWorldBattle(action: Action): Promise<WorldBattleActResponse> {
  return apiFetch<WorldBattleActResponse>('/api/world/battle/act', { method: 'POST', body: { action } });
}

export function getBiomes(): readonly WorldBiome[] {
  return WORLD_BIOMES;
}

export async function getWorldRegions(): Promise<readonly WorldRegion[]> {
  const response = await apiFetch<WorldRegionsResponse>('/api/world/regions');
  return response.regions;
}
