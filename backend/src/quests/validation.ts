import { z } from 'zod';
import type { Quest, QuestObjective, QuestStep, WorldObject } from '@digiworld/shared/quest';
import { ELEMENTS, STAGES } from '@digiworld/shared/digimon';
import { BIOMES } from '@digiworld/shared/quest';

const DialogueIdSchema = z.string().trim().min(1).max(120);

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
  guaranteedNetcore: z.number().int().min(0).max(999_999_999).optional(),
  guaranteedCredits: z.number().int().min(0).max(999_999_999).optional(), // deprecated alias
}).transform(val => {
  if (val.guaranteedCredits !== undefined && val.guaranteedNetcore === undefined) {
    val.guaranteedNetcore = val.guaranteedCredits;
  }
  delete val.guaranteedCredits;
  return val;
});

const QuestStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dialogue'), dialogueId: DialogueIdSchema }),
  z.object({ type: z.literal('battle'), enemies: z.array(EnemyConfigSchema).min(1).max(6), flavor: z.string().max(500).optional() }),
  z.object({ type: z.literal('boss'), enemies: z.array(EnemyConfigSchema).min(1).max(6), bossName: z.string().trim().min(1).max(80), flavor: z.string().trim().min(1).max(500) }),
  z.object({ type: z.literal('loot'), pool: LootPoolSchema }),
]);

const QuestObjectiveSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('travel'),
    biome: z.enum(BIOMES),
    text: z.string().trim().min(1).max(500),
  }),
  z.object({
    kind: z.literal('defeat'),
    biome: z.enum(BIOMES),
    element: z.enum(ELEMENTS).optional(),
    count: z.number().int().min(1).max(999),
    text: z.string().trim().min(1).max(500),
  }),
  z.object({
    kind: z.literal('talk'),
    npcId: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(500),
  }),
  z.object({
    kind: z.literal('collect'),
    itemId: z.string().trim().min(1).max(80),
    qty: z.number().int().min(1).max(999),
    text: z.string().trim().min(1).max(500),
  }),
  z.object({
    kind: z.literal('capture'),
    catalogId: z.string().trim().min(1).max(80).optional(),
    stage: z.enum(STAGES).optional(),
    count: z.number().int().min(1).max(999),
    text: z.string().trim().min(1).max(500),
  }),
]);

export const QuestInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(''),
  requiredLevel: z.number().int().min(1).max(999).default(1),
  introDialogueId: DialogueIdSchema.nullable(),
  steps: z.array(QuestStepSchema).max(200),
  finalReward: LootPoolSchema,
  unlocksQuestIds: z.array(z.string().min(1).max(80)).max(200).default([]),
  objectives: z.array(QuestObjectiveSchema).max(20).optional(),
  giver: z.string().trim().min(1).max(80).optional(),
  rewardText: z.string().trim().min(1).max(200).optional(),
  lockHint: z.string().trim().min(1).max(200).optional(),
  requiredFlags: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  completesFlag: z.string().trim().min(1).max(120).optional(),
});

export const QuestImportSchema = QuestInputSchema.extend({
  id: z.string().min(1).max(80).optional(),
  createdAt: z.number().int().min(0).optional(),
  updatedAt: z.number().int().min(0).optional(),
});

export const WorldObjectInputSchema = z.object({
  x: z.number().int().min(-1_000_000).max(1_000_000),
  y: z.number().int().min(-1_000_000).max(1_000_000),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  kind: z.enum(['mountain', 'tower', 'city', 'ruin', 'shrine', 'obelisk']),
  scale: z.number().min(0.5).max(2).default(1),
  tint: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  questId: z.string().min(1).max(80).optional(),
  dungeonId: z.string().min(1).max(80).optional(),
  passable: z.boolean().default(false),
  label: z.string().trim().min(1).max(120).optional(),
  elements: z.array(z.enum(ELEMENTS)).max(ELEMENTS.length).optional(),
  minLevel: z.number().int().min(1).max(999).optional(),
  maxLevel: z.number().int().min(1).max(999).optional(),
  hiddenUntilFlag: z.string().trim().min(1).max(120).optional(),
}).superRefine((input, ctx) => {
  if (input.minLevel !== undefined && input.maxLevel !== undefined && input.maxLevel < input.minLevel) {
    ctx.addIssue({ code: 'custom', path: ['maxLevel'], message: 'maxLevel must be >= minLevel' });
  }
});

type QuestInput = z.infer<typeof QuestInputSchema>;
type QuestImportInput = z.infer<typeof QuestImportSchema>;
type WorldObjectInput = z.infer<typeof WorldObjectInputSchema>;

function strictLootPool(input: QuestInput['finalReward']): Quest['finalReward'] {
  return {
    items: input.items,
    pickCount: input.pickCount,
    ...(input.guaranteedNetcore !== undefined ? { guaranteedNetcore: input.guaranteedNetcore } : {}),
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
      return { type: 'dialogue', dialogueId: input.dialogueId };
    case 'battle':
      return { type: 'battle', enemies: strictEnemies(input.enemies), ...(input.flavor !== undefined ? { flavor: input.flavor } : {}) };
    case 'boss':
      return { type: 'boss', enemies: strictEnemies(input.enemies), bossName: input.bossName, flavor: input.flavor };
    case 'loot':
      return { type: 'loot', pool: strictLootPool(input.pool) };
  }
}

function strictQuestObjective(input: NonNullable<QuestInput['objectives']>[number]): QuestObjective {
  switch (input.kind) {
    case 'travel':
      return { kind: 'travel', biome: input.biome, text: input.text };
    case 'defeat':
      return {
        kind: 'defeat',
        biome: input.biome,
        count: input.count,
        text: input.text,
        ...(input.element !== undefined ? { element: input.element } : {}),
      };
    case 'talk':
      return { kind: 'talk', npcId: input.npcId, text: input.text };
    case 'collect':
      return { kind: 'collect', itemId: input.itemId, qty: input.qty, text: input.text };
    case 'capture':
      return {
        kind: 'capture',
        count: input.count,
        text: input.text,
        ...(input.catalogId !== undefined ? { catalogId: input.catalogId } : {}),
        ...(input.stage !== undefined ? { stage: input.stage } : {}),
      };
  }
}

export function asQuestPayload(input: QuestInput): Omit<Quest, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: input.name,
    description: input.description,
    requiredLevel: input.requiredLevel,
    introDialogueId: input.introDialogueId,
    steps: input.steps.map(strictQuestStep),
    finalReward: strictLootPool(input.finalReward),
    unlocksQuestIds: input.unlocksQuestIds,
    ...(input.objectives !== undefined ? { objectives: input.objectives.map(strictQuestObjective) } : {}),
    ...(input.giver !== undefined ? { giver: input.giver } : {}),
    ...(input.rewardText !== undefined ? { rewardText: input.rewardText } : {}),
    ...(input.lockHint !== undefined ? { lockHint: input.lockHint } : {}),
    ...(input.requiredFlags !== undefined && input.requiredFlags.length > 0 ? { requiredFlags: input.requiredFlags } : {}),
    ...(input.completesFlag !== undefined ? { completesFlag: input.completesFlag } : {}),
    status: 'draft',
  };
}

export function asWorldObjectPayload(input: WorldObjectInput): Omit<WorldObject, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    x: input.x,
    y: input.y,
    lat: input.lat,
    lon: input.lon,
    kind: input.kind,
    scale: input.scale,
    passable: input.passable,
    ...(input.tint !== undefined ? { tint: input.tint } : {}),
    ...(input.questId !== undefined ? { questId: input.questId } : {}),
    ...(input.dungeonId !== undefined ? { dungeonId: input.dungeonId } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.elements !== undefined && input.elements.length > 0 ? { elements: input.elements } : {}),
    ...(input.minLevel !== undefined ? { minLevel: input.minLevel } : {}),
    ...(input.maxLevel !== undefined ? { maxLevel: input.maxLevel } : {}),
    ...(input.hiddenUntilFlag !== undefined ? { hiddenUntilFlag: input.hiddenUntilFlag } : {}),
  };
}

export function asImportPayload(input: QuestImportInput): Quest | Omit<Quest, 'id' | 'createdAt' | 'updatedAt'> {
  const payload = asQuestPayload(input);
  if (input.id === undefined || input.createdAt === undefined || input.updatedAt === undefined) return payload;
  return { ...payload, id: input.id, createdAt: input.createdAt, updatedAt: input.updatedAt };
}
