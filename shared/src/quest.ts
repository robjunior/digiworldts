import type { Element } from './digimon.js';
import type { Biome } from './world.js';

export type QuestSpeaker = 'narrator' | 'npc' | 'player';

export type DialogueNodeId = string & { readonly __brand: 'DialogueNodeId' };

export type DialogueChoice = {
  readonly label: string;
  readonly nextNodeId: DialogueNodeId | null;
  readonly requiresItemId?: string;
  readonly requiresLevel?: number;
};

export type DialogueNode = {
  readonly id: DialogueNodeId;
  readonly speaker: QuestSpeaker;
  readonly speakerName?: string;
  readonly text: string;
  readonly choices: readonly DialogueChoice[];
  readonly nextNodeId?: DialogueNodeId | null;
};

export type DialogueTree = {
  readonly rootNodeId: DialogueNodeId;
  readonly nodes: readonly DialogueNode[];
};

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
  readonly guaranteedCredits?: number;
};

export type QuestStep =
  | { readonly type: 'dialogue'; readonly tree: DialogueTree }
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
    };

export type Quest = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredLevel: number;
  readonly intro: DialogueTree;
  readonly steps: readonly QuestStep[];
  readonly finalReward: LootPool;
  readonly unlocksQuestIds: readonly string[];
  readonly objectives?: readonly QuestObjective[];
  readonly giver?: string;
  readonly rewardText?: string;
  readonly lockHint?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type WorldObjectKind = 'mountain' | 'tower' | 'city' | 'ruin' | 'shrine' | 'obelisk';

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
  readonly currentDialogueNodeId: DialogueNodeId | null;
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
