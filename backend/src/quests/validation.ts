import { z } from 'zod';
import type { DialogueNode, DialogueNodeId, Quest, QuestStep, WorldObject } from '@digiworld/shared/quest';

const DialogueNodeIdSchema = z.string().min(1).max(80).transform((value) => value as DialogueNodeId);

const DialogueChoiceSchema = z.object({
  label: z.string().trim().min(1).max(120),
  nextNodeId: DialogueNodeIdSchema.nullable(),
  requiresItemId: z.string().min(1).max(80).optional(),
  requiresLevel: z.number().int().min(1).max(999).optional(),
});

const DialogueNodeSchema = z.object({
  id: DialogueNodeIdSchema,
  speaker: z.enum(['narrator', 'npc', 'player']),
  speakerName: z.string().trim().min(1).max(80).optional(),
  text: z.string().trim().min(1).max(2_000),
  choices: z.array(DialogueChoiceSchema).max(12),
  nextNodeId: DialogueNodeIdSchema.nullable().optional(),
});

const DialogueTreeSchema = z.object({
  rootNodeId: DialogueNodeIdSchema,
  nodes: z.array(DialogueNodeSchema).min(1).max(500),
});

const EnemyConfigSchema = z.object({
  templateId: z.string().min(1).max(80),
  level: z.number().int().min(1).max(999),
  hpMult: z.number().positive().max(100).optional(),
  atkMult: z.number().positive().max(100).optional(),
  nickname: z.string().trim().min(1).max(80).optional(),
});

const LootItemSchema = z.object({
  itemId: z.string().min(1).max(80),
  weight: z.number().positive().max(1_000_000),
  minQty: z.number().int().min(0).max(999_999),
  maxQty: z.number().int().min(0).max(999_999),
});

const LootPoolSchema = z.object({
  items: z.array(LootItemSchema).max(200),
  pickCount: z.number().int().min(0).max(100),
  guaranteedCredits: z.number().int().min(0).max(999_999_999).optional(),
});

const QuestStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dialogue'), tree: DialogueTreeSchema }),
  z.object({ type: z.literal('battle'), enemies: z.array(EnemyConfigSchema).min(1).max(6), flavor: z.string().max(500).optional() }),
  z.object({ type: z.literal('boss'), enemies: z.array(EnemyConfigSchema).min(1).max(6), bossName: z.string().trim().min(1).max(80), flavor: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('loot'), pool: LootPoolSchema }),
]);

export const QuestInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(''),
  requiredLevel: z.number().int().min(1).max(999).default(1),
  intro: DialogueTreeSchema,
  steps: z.array(QuestStepSchema).max(200),
  finalReward: LootPoolSchema,
  unlocksQuestIds: z.array(z.string().min(1).max(80)).max(200).default([]),
});

export const QuestImportSchema = QuestInputSchema.extend({
  id: z.string().min(1).max(80).optional(),
  createdAt: z.number().int().min(0).optional(),
  updatedAt: z.number().int().min(0).optional(),
});

export const WorldObjectInputSchema = z.object({
  x: z.number().int().min(-1_000_000).max(1_000_000),
  y: z.number().int().min(-1_000_000).max(1_000_000),
  kind: z.enum(['mountain', 'tower', 'city', 'ruin', 'shrine', 'obelisk']),
  scale: z.number().min(0.5).max(2).default(1),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  questId: z.string().min(1).max(80).optional(),
  passable: z.boolean().default(false),
  label: z.string().trim().min(1).max(120).optional(),
});

type QuestInput = z.infer<typeof QuestInputSchema>;
type QuestImportInput = z.infer<typeof QuestImportSchema>;
type WorldObjectInput = z.infer<typeof WorldObjectInputSchema>;

function strictDialogueNode(input: QuestInput['intro']['nodes'][number]): DialogueNode {
  return {
    id: input.id,
    speaker: input.speaker,
    text: input.text,
    choices: input.choices.map((choice) => ({
      label: choice.label,
      nextNodeId: choice.nextNodeId,
      ...(choice.requiresItemId !== undefined ? { requiresItemId: choice.requiresItemId } : {}),
      ...(choice.requiresLevel !== undefined ? { requiresLevel: choice.requiresLevel } : {}),
    })),
    ...(input.speakerName !== undefined ? { speakerName: input.speakerName } : {}),
    ...(input.nextNodeId !== undefined ? { nextNodeId: input.nextNodeId } : {}),
  };
}

function strictLootPool(input: QuestInput['finalReward']): Quest['finalReward'] {
  return {
    items: input.items,
    pickCount: input.pickCount,
    ...(input.guaranteedCredits !== undefined ? { guaranteedCredits: input.guaranteedCredits } : {}),
  };
}

function strictEnemies(input: Extract<QuestInput['steps'][number], { type: 'battle' | 'boss' }>['enemies']): Extract<QuestStep, { type: 'battle' | 'boss' }>['enemies'] {
  return input.map((enemy) => ({
    templateId: enemy.templateId,
    level: enemy.level,
    ...(enemy.hpMult !== undefined ? { hpMult: enemy.hpMult } : {}),
    ...(enemy.atkMult !== undefined ? { atkMult: enemy.atkMult } : {}),
    ...(enemy.nickname !== undefined ? { nickname: enemy.nickname } : {}),
  }));
}

function strictQuestStep(input: QuestInput['steps'][number]): QuestStep {
  switch (input.type) {
    case 'dialogue':
      return { type: 'dialogue', tree: { rootNodeId: input.tree.rootNodeId, nodes: input.tree.nodes.map(strictDialogueNode) } };
    case 'battle':
      return { type: 'battle', enemies: strictEnemies(input.enemies), ...(input.flavor !== undefined ? { flavor: input.flavor } : {}) };
    case 'boss':
      return { type: 'boss', enemies: strictEnemies(input.enemies), bossName: input.bossName, flavor: input.flavor };
    case 'loot':
      return { type: 'loot', pool: strictLootPool(input.pool) };
  }
}

export function asQuestPayload(input: QuestInput): Omit<Quest, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: input.name,
    description: input.description,
    requiredLevel: input.requiredLevel,
    intro: { rootNodeId: input.intro.rootNodeId, nodes: input.intro.nodes.map(strictDialogueNode) },
    steps: input.steps.map(strictQuestStep),
    finalReward: strictLootPool(input.finalReward),
    unlocksQuestIds: input.unlocksQuestIds,
  };
}

export function asWorldObjectPayload(input: WorldObjectInput): Omit<WorldObject, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    x: input.x,
    y: input.y,
    kind: input.kind,
    scale: input.scale,
    passable: input.passable,
    ...(input.tint !== undefined ? { tint: input.tint } : {}),
    ...(input.questId !== undefined ? { questId: input.questId } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
  };
}

export function asImportPayload(input: QuestImportInput): Quest | Omit<Quest, 'id' | 'createdAt' | 'updatedAt'> {
  const payload = asQuestPayload(input);
  if (input.id === undefined || input.createdAt === undefined || input.updatedAt === undefined) return payload;
  return { ...payload, id: input.id, createdAt: input.createdAt, updatedAt: input.updatedAt };
}
