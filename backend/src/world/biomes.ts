import type { Element } from '../digimon/types.js';

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

export const BIOME_ELEMENT: Record<Biome, Element> = {
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

export const BIOME_COLOR: Record<Biome, string> = {
  desert: '#d97b3a',
  forest: '#4a8f4c',
  lake: '#3a7cb8',
  storm: '#8a6ec4',
  tundra: '#a8dceb',
  mountain: '#8b6f47',
  foundry: '#7c8b96',
  plateau: '#b8ceb0',
  prairie: '#f2e8b0',
  swamp: '#3a2e48',
  void: '#2a2a2f',
};

const BLOCK_SIZE = 8;

function hash32(seed: number, x: number, y: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ x, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ y, 0x27d4eb2f);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

export function biomeAt(seed: number, x: number, y: number): Biome {
  const bx = Math.floor(x / BLOCK_SIZE);
  const by = Math.floor(y / BLOCK_SIZE);
  const idx = hash32(seed, bx, by) % BIOMES.length;
  return BIOMES[idx]!;
}

export function seedForUser(userId: string): number {
  let h = 0x1f2a3b4c;
  for (let i = 0; i < userId.length; i++) {
    h = Math.imul(h ^ userId.charCodeAt(i), 0x9e3779b1);
    h = h ^ (h >>> 15);
  }
  return h >>> 0;
}

export type TileView = { x: number; y: number; biome: Biome };

export function tilesAround(seed: number, cx: number, cy: number, radius: number): TileView[] {
  const tiles: TileView[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      tiles.push({ x, y, biome: biomeAt(seed, x, y) });
    }
  }
  return tiles;
}
