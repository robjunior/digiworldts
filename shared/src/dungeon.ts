import type { Element, Stage } from './digimon.js';
import type { TilesetGrant } from './tileset.js';
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

/**
 * Boss loot entry — one row per shop item the boss can drop.
 * Each entry rolls independently on `chance` (0..1). `chance === 1` = guaranteed.
 * `qty` is fixed per drop (no min/max spread — use multiple entries if needed).
 */
export type EncounterLoot = {
  readonly itemId: string;
  readonly qty: number;
  readonly chance: number;
};

export type DungeonTile = {
  readonly x: number;
  readonly y: number;
  /** Global Tile ID (Tiled convention) — indexes into the joined tilesets
   * of this dungeon. Defaults to `1` for tiles created via the admin editor
   * (which paints walkability without a specific sprite). */
  readonly gid: number;
};

export type DungeonEncounter = {
  readonly id: string;
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly label: string | null;
  readonly difficulty: EncounterDifficulty;
  readonly digimon: readonly EncounterDigimon[];
  /**
   * Deprecated single-item reward. Preserved for read-back of legacy encounters
   * created before `loots` shipped. New encounters emit `loots` and leave this null.
   */
  readonly rewardItemId: string | null;
  readonly loots: readonly EncounterLoot[];
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

export type DungeonWarp = {
  readonly id: string;
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly targetDungeonId: string | null;
  readonly label: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DungeonDoor = {
  readonly id: string;
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly keyItemId: string;
  readonly label: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type Dungeon = {
  readonly id: string;
  readonly worldObjectId: string | null;
  readonly questId: string | null;
  readonly parentId: string | null;
  readonly name: string;
  readonly description: string;
  readonly biome: Biome | 'null';
  readonly width: number;
  readonly height: number;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly biomeRegion: string | null;
  readonly randomEncountersEnabled: boolean;
  readonly randomEncounterRate: number;
  readonly randomMinLevel: number;
  readonly randomMaxLevel: number;
  readonly randomMaxStage: Stage;
  readonly randomMinPartySize: number;
  readonly randomMaxPartySize: number;
  readonly randomAllowedElements: readonly Element[] | null;
  readonly unlockRequiresItems: readonly string[] | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type DungeonView = {
  readonly dungeon: Dungeon;
  readonly tiles: readonly DungeonTile[];
  readonly tilesets: readonly TilesetGrant[];
  readonly encounters: readonly DungeonEncounter[];
  readonly items: readonly DungeonItem[];
  readonly warps: readonly DungeonWarp[];
  readonly doors: readonly DungeonDoor[];
  readonly traps: readonly DungeonTrap[];
};

export type UserDungeonRun = {
  readonly userId: string;
  readonly dungeonId: string;
  readonly currentX: number;
  readonly currentY: number;
  readonly defeatedEncounters: readonly string[];
  readonly collectedItems: readonly string[];
  readonly unlockedDoors: readonly string[];
  readonly oneshotTriggeredIds: readonly string[];
  readonly startedAt: number;
  readonly completedAt: number | null;
};

export const TRAP_KINDS = ['damage', 'poison', 'burn', 'energy_drain', 'mood_loss', 'teleport', 'random_encounter'] as const;
export type TrapKind = (typeof TRAP_KINDS)[number];

export type DungeonTrap = {
  readonly id: string;
  readonly dungeonId: string;
  readonly x: number;
  readonly y: number;
  readonly kind: TrapKind;
  readonly severity: number;
  readonly label: string | null;
  readonly createdAt: number;
};

export type TrapTriggered = {
  readonly trapId: string;
  readonly kind: TrapKind;
  readonly severity: number;
  readonly label: string | null;
  readonly dodged: boolean;
  readonly avoidChance: number;
  readonly partyAvgSpd: number;
  readonly effectSummary: string;
  readonly teleportTo?: { readonly x: number; readonly y: number };
  readonly randomEncounter?: readonly EncounterDigimon[];
};

export type DungeonRunView = {
  readonly dungeon: Dungeon;
  readonly run: UserDungeonRun;
  readonly tiles: readonly DungeonTile[];
  readonly tilesets: readonly TilesetGrant[];
  readonly encounters: readonly DungeonEncounter[];
  readonly items: readonly DungeonItem[];
  readonly doors: readonly DungeonDoor[];
};

export type DungeonListResponse = { readonly dungeons: readonly Dungeon[] };
export type DungeonMoveResponse = { readonly run: UserDungeonRun; readonly triggeredEncounterId: string | null; readonly pickedUpItemId: string | null; readonly randomEncounter?: readonly EncounterDigimon[]; readonly warpToDungeonId?: string | null; readonly blockedByDoorId?: string | null; readonly trapTriggered?: TrapTriggered };
export type DungeonCompleteResponse = { readonly run: UserDungeonRun; readonly questCompleted: boolean };
