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

export const BIOME_LABEL: Record<Biome, string> = {
  desert: 'Ember Wastes',
  forest: 'Verdant Reach',
  lake: 'Mirror Basin',
  storm: 'Voltcloud',
  tundra: 'Frostspire',
  mountain: 'Stoneridge',
  foundry: 'Rustworks',
  plateau: 'Skyshear',
  prairie: 'Solaris Fields',
  swamp: 'Nightveil',
  void: 'The Static',
};

export const BIOME_ELEMENT: Record<Biome, string> = {
  desert: 'fire',
  forest: 'plant',
  lake: 'water',
  storm: 'electricity',
  tundra: 'ice',
  mountain: 'earth',
  foundry: 'steel',
  plateau: 'wind',
  prairie: 'light',
  swamp: 'dark',
  void: 'null',
};

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
export type ArenaFile = (typeof ARENA_FILES)[number];

export type BiomeSceneConfig = {
  file: ArenaFile;
  /** Kept loose at shared boundary; backend Zod validates on write, frontend casts on read. */
  settings: Record<string, unknown>;
};

export type PerBiomeSceneDefaults = Partial<Record<Biome, BiomeSceneConfig>>;

export type WorldRegion = {
  readonly biome: Biome;
  readonly label: string;
  readonly element: string;
  readonly danger: number;
  readonly lat: number;
  readonly lon: number;
  readonly dungeonId: string | null;
  readonly scouted: boolean;
};

export type WorldRegionsResponse = { readonly regions: readonly WorldRegion[] };