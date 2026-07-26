import type { Dungeon, EncounterDigimon, EncounterSkillOverride, EncounterStatOverride } from '@digiworld/shared';
import { ELEMENTS } from '@digiworld/shared/digimon';
import { BIOMES } from '@digiworld/shared/world';
import { z } from 'zod';

const IdSchema = z.string().trim().min(1).max(80);
const OptionalNullableIdSchema = IdSchema.nullable().optional();

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
  biomeRegion: z.enum(BIOMES).nullable().optional(),
});

export const UpdateDungeonInputSchema = CreateDungeonInputSchema.partial();

export const TileSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
});

export const TilesInputSchema = z.object({
  tiles: z.array(TileSchema).max(20_000),
});

export const CreateEncounterInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
  label: z.string().trim().min(1).max(120).nullable().optional(),
  difficulty: z.enum(['easy', 'normal', 'elite', 'boss']).default('normal'),
  digimon: z.array(EncounterDigimonSchema).min(1).max(6),
});

export const UpdateEncounterInputSchema = CreateEncounterInputSchema.partial();

export const CreateItemInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
  itemId: IdSchema,
  qty: z.number().int().min(1).max(999_999).default(1),
});

export const MoveInputSchema = z.object({
  x: z.number().int().min(0).max(199),
  y: z.number().int().min(0).max(199),
});

export type CreateDungeonInput = z.infer<typeof CreateDungeonInputSchema>;
export type UpdateDungeonInput = z.infer<typeof UpdateDungeonInputSchema>;
export type TileInput = z.infer<typeof TileSchema>;
export type CreateEncounterInput = z.infer<typeof CreateEncounterInputSchema>;
export type UpdateEncounterInput = z.infer<typeof UpdateEncounterInputSchema>;
export type CreateItemInput = z.infer<typeof CreateItemInputSchema>;
export type MoveInput = z.infer<typeof MoveInputSchema>;

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
    name: input.name,
    description: input.description,
    biome: input.biome,
    width: input.width,
    height: input.height,
    spawnX: input.spawnX,
    spawnY: input.spawnY,
    biomeRegion: input.biomeRegion ?? null,
  };
}
