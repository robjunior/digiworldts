import { one, run } from '../db/index.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';
import type { WorldObjectKind } from '@digiworld/shared/quest';
import { BIOME_COLOR, type Biome } from '../world/biomes.js';

const SQL_SELECT_WORLD_OBJECT_BY_LABEL = `SELECT id FROM world_objects WHERE label = ? LIMIT 1`;
const SQL_INSERT_WORLD_OBJECT = `INSERT INTO world_objects (id, x, y, kind, scale, tint, quest_id, passable, label, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

type Seed = {
  readonly x: number;
  readonly y: number;
  readonly kind: WorldObjectKind;
  readonly scale: number;
  readonly tint: string | null;
  readonly passable: 0 | 1;
  readonly label: string;
};

function biomeSeed(x: number, y: number, kind: WorldObjectKind, scale: number, biome: Biome, passable: 0 | 1, label: string): Seed {
  return { x, y, kind, scale, tint: BIOME_COLOR[biome], passable, label };
}

const DEFAULT_SEEDS: readonly Seed[] = [
  { x:  3, y: -2, kind: 'mountain', scale: 1.4, tint: '#7a5c3f', passable: 0, label: 'Rocky Peak' },
  { x: -4, y: -3, kind: 'mountain', scale: 1.0, tint: '#8a6d4e', passable: 0, label: 'North Ridge' },
  { x:  5, y:  3, kind: 'tower',    scale: 1.0, tint: '#6b7280', passable: 0, label: 'Watchtower' },
  { x: -5, y:  2, kind: 'tower',    scale: 1.2, tint: '#7a8592', passable: 0, label: 'Signal Spire' },
  { x:  0, y: -6, kind: 'city',     scale: 1.3, tint: '#b9884a', passable: 0, label: 'Mecha Ruins' },
  { x:  6, y: -5, kind: 'shrine',   scale: 1.0, tint: '#c8a24a', passable: 1, label: 'Ancient Shrine' },
  { x: -3, y:  5, kind: 'ruin',     scale: 1.0, tint: '#9aa0a6', passable: 1, label: 'Fallen Columns' },
  { x:  2, y:  6, kind: 'obelisk',  scale: 1.0, tint: '#3f4552', passable: 0, label: 'Dark Obelisk' },
  biomeSeed( 12, -8, 'ruin',     1.1, 'desert',     1, 'Sunspire Ruin'),
  biomeSeed(-11,  7, 'grove',    1.2, 'forest',     1, 'Grove of the Verdant Heart'),
  biomeSeed( 10, 10, 'spring',   1.0, 'lake',       1, 'Mirror Shrine'),
  biomeSeed(-12, -9, 'tower',    1.3, 'storm',      0, 'Voltcloud Tower'),
  biomeSeed( 14,  4, 'crystal',  1.4, 'tundra',     0, 'Frostspire Pillar'),
  biomeSeed(  8, 12, 'city',     1.2, 'foundry',    0, 'Rustworks Foundry'),
  biomeSeed(-14, -4, 'archway',  1.2, 'plateau',    1, 'Skyshear Watchtower'),
  biomeSeed( -8,-12, 'shrine',   1.0, 'prairie',    1, 'Solaris Shrine'),
  biomeSeed( 15, -3, 'obelisk',  1.3, 'swamp',      0, 'Nightveil Monolith'),
  biomeSeed(  0, 14, 'ruin',     1.1, 'void',       1, 'Static Ruin'),
  biomeSeed(-15,  0, 'mountain', 1.5, 'mountain',   0, 'Stoneridge Summit'),
];

export async function seedDefaultWorldObjects(): Promise<void> {
  const now = Date.now();
  let inserted = 0;
  for (const seed of DEFAULT_SEEDS) {
    const existing = await one<{ id: string }>(SQL_SELECT_WORLD_OBJECT_BY_LABEL, seed.label);
    if (existing) continue;
    await run(SQL_INSERT_WORLD_OBJECT, [
      newId('wob'),
      seed.x, seed.y,
      seed.kind,
      seed.scale,
      seed.tint,
      null,
      seed.passable,
      seed.label,
      now, now,
    ]);
    inserted++;
  }
  if (inserted > 0) {
    log.info('quests.world-objects.seeded', { inserted, total: DEFAULT_SEEDS.length });
  }
}
