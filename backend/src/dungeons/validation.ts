import type { Dungeon, EncounterDigimon, EncounterSkillOverride, EncounterStatOverride } from '@digiworld/shared';
import { ELEMENTS, STAGES } from '@digiworld/shared/digimon';
import { BIOMES } from '@digiworld/shared/world';
import { z } from 'zod';

const IdSchema = z.string().trim().min(1).max(80);
const OptionalNullableIdSchema = IdSchema.nullable().optional();
const RandomAllowedElementsSchema = z.array(z.enum(ELEMENTS)).max(ELEMENTS.length).nullable();
const RandomEncounterSettingsShape = {
  randomEncountersEnabled: z.boolean().default(false),
  randomEncounterRate: z.number().min(0).max(1).default(0.12),
  randomMinLevel: z.number().int().min(1).max(999).default(1),
  randomMaxLevel: z.number().int().min(1).max(999).default(5),
  randomMaxStage: z.enum(STAGES).default('Rookie'),
  randomMinPartySize: z.number().int().min(1).max(3).default(1),
  randomMaxPartySize: z.number().int().min(1).max(3).default(1),
  randomAllowedElements: RandomAllowedElementsSchema.default(null),
} as const;

function refineRandomEncounterSettings(input: { readonly randomMinLevel?: number | undefined; readonly randomMaxLevel?: number | undefined; readonly randomMinPartySize?: number | undefined; readonly randomMaxPartySize?: number | undefined }, ctx: z.RefinementCtx): void {
  if (input.randomMinLevel !== undefined && input.randomMaxLevel !== undefined && input.randomMaxLevel < input.randomMinLevel) {
    ctx.addIssue({ code: 'custom', path: ['randomMaxLevel'], message: 'randomMaxLevel must be >= randomMinLevel' });
  }
  if (input.randomMinPartySize !== undefined && input.randomMaxPartySize !== undefined && input.randomMaxPartySize < input.randomMinPartySize) {
    ctx.addIssue({ code: 'custom', path: ['randomMaxPartySize'], message: 'randomMaxPartySize must be >= randomMinPartySize' });
  }
}

export const EncounterStatOverrideSchema = z.object({
  hp: z.number().int().min(0).max(9_999_999).optional(),
  en: z.number().int().min(0).max(9_999_999).optional(),
  atk: z.number().int().min(0).max(9_999_999).optional(),
  def: z.number().int().min(0).max(9_999_999).optional(),
  int: z.number().int().min(0).max(9_999_999).optional(),
  spd: z.number().int().min(0).max(9_999_999).optional(),
});

export const EncounterSkillOverrideSchema = z.object({
  name: z.string().trim().min(1).max(120),
  element: z.enum(ELEMENTS),
  cost: z.number().int().min(0).max(999_999),
  power: z.number().int().min(0).max(9_999_999),
  description: z.string().trim().max(500).optional(),
});

export const EncounterDigimonSchema = z.object({
  catalogId: IdSchema,
  level: z.number().int().min(1).max(999),
  nickname: z.string().trim().min(1).max(80).optional(),
  statOverride: EncounterStatOverrideSchema.optional(),
  skillsOverride: z.array(EncounterSkillOverrideSchema).max(4).optional(),
});

export const CreateDungeonInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).default(''),
  biome: z.union([z.enum(BIOMES), z.literal('null')]),
  width: z.number().int().min(1).max(200),
  height: z.number().int().min(1).max(200),
  spawnX: z.number().int().min(0).max(199).default(0),
  spawnY: z.number().int().min(0).max(199).default(0),
  worldObjectId: OptionalNullableIdSchema,
  questId: OptionalNullableIdSchema,
  parentId: OptionalNullableIdSchema,
  biomeRegion: z.enum(BIOMES).nullable().optional(),
  ...RandomEncounterSettingsShape,
}).superRefine(refineRandomEncounterSettings);

export const UpdateDungeonInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2_000).optional(),
  biome: z.union([z.enum(BIOMES), z.literal('null')]).optional(),
  width: z.number().int().min(1).max(200).optional(),
  height: z.number().int().min(1).max(200).optional(),
  spawnX: z.number().int().min(0).max(199).optional(),
  spawnY: z.number().int().min(0).max(199).optional(),
  worldObjectId: OptionalNullableIdSchema,
  questId: OptionalNullableIdSchema,
  parentId: OptionalNullableIdSchema,
  biomeRegion: z.enum(BIOMES).nullable().optional(),
  randomEncountersEnabled: z.boolean().optional(),
  randomEncounterRate: z.number().min(0).max(1).optional(),
  randomMinLevel: z.number().int().min(1).max(999).optional(),
  randomMaxLevel: z.number().int().min(1).max(999).optional(),
  randomMaxStage: z.enum(STAGES).optional(),
  randomMinPartySize: z.number().int().min(1).max(3).optional(),
  randomMaxPartySize: z.number().int().min(1).max(3).optional(),
  randomAllowedElements: RandomAllowedElementsSchema.optional(),
}).superRefine(refineRandomEncounterSettings);

export const TileSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
});

export const TilesInputSchema = z.object({
  tiles: z.array(TileSchema).max(20_000),
});

export const EncounterLootSchema = z.object({
  itemId: IdSchema,
  qty: z.number().int().min(1).max(999_999),
  chance: z.number().min(0).max(1),
});

export const CreateEncounterInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
  label: z.string().trim().min(1).max(120).nullable().optional(),
  difficulty: z.enum(['easy', 'normal', 'elite', 'boss']).default('normal'),
  digimon: z.array(EncounterDigimonSchema).min(1).max(6),
  loots: z.array(EncounterLootSchema).max(32).optional(),
});

export const UpdateEncounterInputSchema = CreateEncounterInputSchema.partial();

export const CreateItemInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
  itemId: IdSchema,
  qty: z.number().int().min(1).max(999_999).default(1),
});

export const CreateWarpInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
  targetDungeonId: IdSchema.nullable().optional(),
  label: z.string().trim().min(1).max(120).nullable().optional(),
});

export const UpdateWarpInputSchema = z.object({
  targetDungeonId: IdSchema.nullable().optional(),
  label: z.string().trim().min(1).max(120).nullable().optional(),
});

export const DoorInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
  keyItemId: IdSchema,
  label: z.string().trim().min(1).max(120).nullable().optional(),
});

export const UpdateDoorInputSchema = DoorInputSchema.partial();

export const TrapInputSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  kind: z.enum(['damage', 'poison', 'burn', 'energy_drain', 'mood_loss', 'teleport', 'random_encounter']),
  severity: z.number().int().min(1).max(100),
  label: z.string().trim().max(80).nullable().optional(),
});
export const UpdateTrapInputSchema = TrapInputSchema.partial();
export type TrapInput = z.infer<typeof TrapInputSchema>;
export type UpdateTrapInput = z.infer<typeof UpdateTrapInputSchema>;

export const MoveInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
});

export const StartRandomEncounterInputSchema = z.object({
  digimon: z.array(EncounterDigimonSchema).min(1).max(3),
});

export type CreateDungeonInput = z.infer<typeof CreateDungeonInputSchema>;
export type UpdateDungeonInput = z.infer<typeof UpdateDungeonInputSchema>;
export type TileInput = z.infer<typeof TileSchema>;
export type CreateEncounterInput = z.infer<typeof CreateEncounterInputSchema>;
export type UpdateEncounterInput = z.infer<typeof UpdateEncounterInputSchema>;
export type CreateItemInput = z.infer<typeof CreateItemInputSchema>;
export type CreateWarpInput = z.infer<typeof CreateWarpInputSchema>;
export type UpdateWarpInput = z.infer<typeof UpdateWarpInputSchema>;
export type DoorInput = z.infer<typeof DoorInputSchema>;
export type UpdateDoorInput = z.infer<typeof UpdateDoorInputSchema>;
export type MoveInput = z.infer<typeof MoveInputSchema>;
export type StartRandomEncounterInput = z.infer<typeof StartRandomEncounterInputSchema>;

export function asStatOverride(input: z.infer<typeof EncounterStatOverrideSchema>): EncounterStatOverride {
  return {
    ...(input.hp !== undefined ? { hp: input.hp } : {}),
    ...(input.en !== undefined ? { en: input.en } : {}),
    ...(input.atk !== undefined ? { atk: input.atk } : {}),
    ...(input.def !== undefined ? { def: input.def } : {}),
    ...(input.int !== undefined ? { int: input.int } : {}),
    ...(input.spd !== undefined ? { spd: input.spd } : {}),
  };
}

export function asSkillOverride(input: z.infer<typeof EncounterSkillOverrideSchema>): EncounterSkillOverride {
  return {
    name: input.name,
    element: input.element,
    cost: input.cost,
    power: input.power,
    ...(input.description !== undefined ? { description: input.description } : {}),
  };
}

export function asEncounterDigimon(input: z.infer<typeof EncounterDigimonSchema>): EncounterDigimon {
  return {
    catalogId: input.catalogId,
    level: input.level,
    ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
    ...(input.statOverride !== undefined ? { statOverride: asStatOverride(input.statOverride) } : {}),
    ...(input.skillsOverride !== undefined ? { skillsOverride: input.skillsOverride.map(asSkillOverride) } : {}),
  };
}

export function asCreateDungeonPayload(input: CreateDungeonInput): Omit<Dungeon, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    worldObjectId: input.worldObjectId ?? null,
    questId: input.questId ?? null,
    parentId: input.parentId ?? null,
    name: input.name,
    description: input.description,
    biome: input.biome,
    width: input.width,
    height: input.height,
    spawnX: input.spawnX,
    spawnY: input.spawnY,
    biomeRegion: input.biomeRegion ?? null,
    unlockRequiresItems: null,
    randomEncountersEnabled: input.randomEncountersEnabled,
    randomEncounterRate: input.randomEncounterRate,
    randomMinLevel: input.randomMinLevel,
    randomMaxLevel: input.randomMaxLevel,
    randomMaxStage: input.randomMaxStage,
    randomMinPartySize: input.randomMinPartySize,
    randomMaxPartySize: input.randomMaxPartySize,
    randomAllowedElements: input.randomAllowedElements,
  };
}
