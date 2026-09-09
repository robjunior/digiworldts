export type Biome = 'forest' | 'lake' | 'desert' | 'storm' | 'foundry' | 'prairie' | 'void' | 'tundra' | 'plateau' | 'swamp' | 'mountain';

export const BIOMES: readonly Biome[] = [
  'forest',
  'lake',
  'desert',
  'storm',
  'foundry',
  'prairie',
  'void',
  'tundra',
  'plateau',
  'swamp',
  'mountain',
] as const;

export type BiomeColorMap = Partial<Readonly<Record<Biome, string>>>;

export type BiomeCoordsMap = Readonly<Record<Biome, { lat: number; lon: number }>>;

export type BiomeAtInput = {
  readonly seed: number;
  readonly x: number;
  readonly y: number;
};

export function biomeAt(seed: number, x: number, y: number): Biome {
  const n = Math.abs((seed * 2654435761 + x * 40503 + y * 12345) >>> 0);
  const biomes = BIOMES as readonly string[];
  return biomes[n % biomes.length] as Biome;
}

export const BIOME_COLOR: BiomeColorMap = {};

export const BIOME_COORDS: BiomeCoordsMap = {
  forest: { lat: 0, lon: 0 },
  lake: { lat: 0, lon: 0 },
  desert: { lat: 0, lon: 0 },
  storm: { lat: 0, lon: 0 },
  foundry: { lat: 0, lon: 0 },
  prairie: { lat: 0, lon: 0 },
  void: { lat: 0, lon: 0 },
  tundra: { lat: 0, lon: 0 },
  plateau: { lat: 0, lon: 0 },
  swamp: { lat: 0, lon: 0 },
  mountain: { lat: 0, lon: 0 },
};

export const BIOME_LABEL: Readonly<Record<Biome, string>> = {
  forest: 'Forest',
  lake: 'Lake',
  desert: 'Desert',
  storm: 'Storm',
  foundry: 'Foundry',
  prairie: 'Prairie',
  void: 'Void',
  tundra: 'Tundra',
  plateau: 'Plateau',
  swamp: 'Swamp',
  mountain: 'Mountain',
};

export type DungeonMoveResult =
  | { ok: true; result: { x: number; y: number; biome: Biome } }
  | { ok: false; error: string };

export type DungeonRemotePlayer = {
  userId: string;
  displayName: string;
  x: number;
  y: number;
  facing: number;
  level: number;
  element: string;
};

export type DungeonMoveResponse = {
  run: boolean;
  triggeredEncounterId: string | null;
  pickedUpItemId: string | null;
  randomEncounter?: string;
  warpToDungeonId?: string;
  trapTriggered?: boolean;
  openedChestId?: string;
  chestContents?: string[];
};