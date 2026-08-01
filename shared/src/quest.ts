import type { Element, Stage } from './digimon.js';
import type { Biome } from './world.js';

export type EnemyConfig = {
  readonly templateId: string;
  readonly level: number;
  readonly hpMult?: number;
  readonly atkMult?: number;
  readonly nickname?: string;
};

export type LootItem = {
  readonly itemId: string;
  readonly weight: number;
  readonly minQty: number;
  readonly maxQty: number;
};

export type LootPool = {
  readonly items: readonly LootItem[];
  readonly pickCount: number;
  readonly guaranteedNetcore?: number;
};

export type QuestStep =
  | { readonly type: 'dialogue'; readonly dialogueId: string }
  | { readonly type: 'battle'; readonly enemies: readonly EnemyConfig[]; readonly flavor?: string }
  | { readonly type: 'boss'; readonly enemies: readonly EnemyConfig[]; readonly bossName: string; readonly flavor: string }
  | { readonly type: 'loot'; readonly pool: LootPool };

export type QuestObjective =
  | {
      readonly kind: 'travel';
      readonly biome: Biome;
      readonly text: string;
    }
  | {
      readonly kind: 'defeat';
      readonly biome: Biome;
      readonly element?: Element;
      readonly count: number;
      readonly text: string;
    }
  | {
      readonly kind: 'talk';
      readonly npcId: string;
      readonly text: string;
    }
  | {
      readonly kind: 'collect';
      readonly itemId: string;
      readonly qty: number;
      readonly text: string;
    }
  | {
      readonly kind: 'capture';
      readonly catalogId?: string;
      readonly stage?: Stage;
      readonly count: number;
      readonly text: string;
    };

export type Quest = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredLevel: number;
  readonly introDialogueId: string | null;
  readonly steps: readonly QuestStep[];
  readonly finalReward: LootPool;
  readonly unlocksQuestIds: readonly string[];
  readonly objectives?: readonly QuestObjective[];
  readonly giver?: string;
  readonly rewardText?: string;
  readonly lockHint?: string;
  /** AND-gated: every flag must be set on the user for the quest to appear + accept. */
  readonly requiredFlags?: readonly string[];
  /** Set on the user automatically when this quest is claimed (not accepted). */
  readonly completesFlag?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type WorldObjectKind = 'mountain' | 'tower' | 'city' | 'ruin' | 'shrine' | 'obelisk' | 'crystal' | 'grove' | 'spring' | 'archway';

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
  readonly elements?: readonly Element[];
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type UserQuestProgress = {
  readonly userId: string;
  readonly questId: string;
  readonly currentStepIndex: number;
  readonly currentDialogueNodeId: string | null;
  readonly choicesMade: Readonly<Record<string, string>>;
  readonly startedAt: number;
  readonly completedAt: number | null;
};

export type QuestObjectiveProgress = {
  readonly counter: number;
  readonly doneAt: number | null;
};

export type UserQuestState = 'available' | 'active' | 'completed' | 'claimed' | 'locked';

export type QuestWithProgress = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredLevel: number;
  readonly introDialogueId: string | null;
  readonly giver: string;
  readonly rewardText: string;
  readonly lockHint: string | null;
  readonly objectives: readonly (QuestObjective & QuestObjectiveProgress)[];
  readonly state: UserQuestState;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly claimedAt: number | null;
};

export type QuestListResponse = { readonly quests: readonly Quest[] };
export type QuestsForUserResponse = { readonly quests: readonly QuestWithProgress[] };
export type WorldObjectListResponse = { readonly objects: readonly WorldObject[] };
export type QuestProgressResponse = { readonly progress: UserQuestProgress; readonly quest: Quest };
export type WorldObjectAdjacent = { readonly id: string; readonly name: string };

export type QuestElement = Element;
