export const BIOMES = [
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
export type Biome = (typeof BIOMES)[number];

export const ARENA_FILES = [
  'plant.glb',
  'steel.glb',
  'water.glb',
  'rock.glb',
  'dark.glb',
  'fire.glb',
  'ice.glb',
  'field.glb',
  'null.glb',
  'wind.glb',
  'light.glb',
] as const;
export type ArenaFile = string;

export type BiomeSceneConfig = {
  file: ArenaFile;
  /** Kept loose at shared boundary; backend Zod validates on write, frontend casts on read. */
  settings: Record<string, unknown>;
};

export type PerBiomeSceneDefaults = Partial<Record<Biome, BiomeSceneConfig>>;