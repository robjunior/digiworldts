import type { Element } from '../digimon/types.js';

export const BIOMES = ['desert', 'forest', 'lake', 'storm'] as const;
export type Biome = (typeof BIOMES)[number];

export const BIOME_ELEMENT: Record<Biome, Element> = {
  desert: 'fire',
  forest: 'plant',
  lake: 'water',
  storm: 'electricity',
};

export const BIOME_LABEL: Record<Biome, string> = {
  desert: 'Ember Wastes',
  forest: 'Verdant Reach',
  lake: 'Mirror Basin',
  storm: 'Voltcloud',
};

export const BIOME_COLOR: Record<Biome, string> = {
  desert: '#d97b3a',
  forest: '#4a8f4c',
  lake: '#3a7cb8',
  storm: '#8a6ec4',
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
