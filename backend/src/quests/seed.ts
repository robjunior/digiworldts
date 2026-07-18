import { one, run } from '../db/index.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';
import type { WorldObjectKind } from '@digiworld/shared/quest';

const SQL_COUNT_WORLD_OBJECTS = 'SELECT COUNT(*) AS n FROM world_objects';
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

const DEFAULT_SEEDS: readonly Seed[] = [
  { x:  3, y: -2, kind: 'mountain', scale: 1.4, tint: '#7a5c3f', passable: 0, label: 'Rocky Peak' },
  { x: -4, y: -3, kind: 'mountain', scale: 1.0, tint: '#8a6d4e', passable: 0, label: 'North Ridge' },
  { x:  5, y:  3, kind: 'tower',    scale: 1.0, tint: '#6b7280', passable: 0, label: 'Watchtower' },
  { x: -5, y:  2, kind: 'tower',    scale: 1.2, tint: '#7a8592', passable: 0, label: 'Signal Spire' },
  { x:  0, y: -6, kind: 'city',     scale: 1.3, tint: '#b9884a', passable: 0, label: 'Mecha Ruins' },
  { x:  6, y: -5, kind: 'shrine',   scale: 1.0, tint: '#c8a24a', passable: 1, label: 'Ancient Shrine' },
  { x: -3, y:  5, kind: 'ruin',     scale: 1.0, tint: '#9aa0a6', passable: 1, label: 'Fallen Columns' },
  { x:  2, y:  6, kind: 'obelisk',  scale: 1.0, tint: '#3f4552', passable: 0, label: 'Dark Obelisk' },
];

export async function seedDefaultWorldObjects(): Promise<void> {
  const existing = await one<{ n: number }>(SQL_COUNT_WORLD_OBJECTS);
  if ((existing?.n ?? 0) > 0) {
    return;
  }
  const now = Date.now();
  for (const seed of DEFAULT_SEEDS) {
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
  }
  log.info('quests.world-objects.seeded', { count: DEFAULT_SEEDS.length });
}
