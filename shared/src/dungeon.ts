import type { Element } from './digimon.js';
import type { Biome } from './world.js';

export type EncounterDifficulty = 'easy' | 'normal' | 'elite' | 'boss';

export type EncounterStatOverride = {
  readonly hp?: number;
  readonly en?: number;
  readonly atk?: number;
  readonly def?: number;
  readonly int?: number;
  readonly spd?: number;
};

export type EncounterSkillOverride = {
  readonly name: string;
  readonly element: Element;
  readonly cost: number;
  readonly power: number;
  readonly description?: string;
};

export type EncounterDigimon = {
  readonly catalogId: string;
  readonly level: number;
  readonly nickname?: string;
  readonly statOverride?: EncounterStatOverride;
  readonly skillsOverride?: readonly EncounterSkillOverride[];
};

export type DungeonTile = {
  readonly x: number;
  readonly y: number;
};

export type DungeonEncounter = {
  readonly id: string;
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly difficulty: EncounterDifficulty;
  readonly digimon: readonly EncounterDigimon[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DungeonItem = {
  readonly id: string;
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly itemId: string;
  readonly qty: number;
  readonly createdAt: number;
};

export type Dungeon = {
  readonly id: string;
  readonly worldObjectId: string | null;
  readonly questId: string | null;
  readonly name: string;
  readonly description: string;
  readonly biome: Biome | 'null';
  readonly width: number;
  readonly height: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly biomeRegion: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DungeonView = {
  readonly dungeon: Dungeon;
  readonly tiles: readonly DungeonTile[];
  readonly encounters: readonly DungeonEncounter[];
  readonly items: readonly DungeonItem[];
};

export type UserDungeonRun = {
  readonly userId: string;
  readonly dungeonId: string;
  readonly currentX: number;
  readonly currentY: number;
  readonly defeatedEncounters: readonly string[];
  readonly collectedItems: readonly string[];
  readonly startedAt: number;
  readonly completedAt: number | null;
};

export type DungeonRunView = {
  readonly dungeon: Dungeon;
  readonly run: UserDungeonRun;
  readonly tiles: readonly DungeonTile[];
  readonly encounters: readonly DungeonEncounter[];
  readonly items: readonly DungeonItem[];
};

export type DungeonListResponse = { readonly dungeons: readonly Dungeon[] };
export type DungeonMoveResponse = { readonly run: UserDungeonRun; readonly triggeredEncounterId: string | null; readonly pickedUpItemId: string | null };
export type DungeonCompleteResponse = { readonly run: UserDungeonRun; readonly questCompleted: boolean };
