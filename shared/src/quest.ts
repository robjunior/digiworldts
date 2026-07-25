import type { Element } from './digimon.js';

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

export type Quest = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredLevel: number;
  readonly intro: DialogueTree;
  readonly steps: readonly QuestStep[];
  readonly finalReward: LootPool;
  readonly unlocksQuestIds: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type WorldObjectKind = 'mountain' | 'tower' | 'city' | 'ruin' | 'shrine' | 'obelisk' | 'crystal' | 'grove' | 'spring' | 'archway';

export type WorldObject = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind: WorldObjectKind;
  readonly scale: number;
  readonly tint?: string;
  readonly questId?: string;
  readonly passable: boolean;
  readonly label?: string;
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

export type QuestListResponse = { readonly quests: readonly Quest[] };
export type WorldObjectListResponse = { readonly objects: readonly WorldObject[] };
export type QuestProgressResponse = { readonly progress: UserQuestProgress; readonly quest: Quest };
export type WorldObjectAdjacent = { readonly id: string; readonly name: string };

export type QuestElement = Element;
