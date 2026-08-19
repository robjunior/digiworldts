import { one, q, run } from '../db/index.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';
import type { Quest, WorldObjectKind } from '@digiworld/shared/quest';
import { BIOME_COLOR, BIOME_COORDS, biomeAt, type Biome } from '../world/biomes.js';

const SQL_COUNT_WORLD_OBJECTS = 'SELECT COUNT(*) AS n FROM world_objects';
const SQL_WORLD_OBJECTS_MISSING_COORDS = `SELECT id, x, y FROM world_objects WHERE lat = 0 AND lon = 0`;
const SQL_BACKFILL_WORLD_OBJECT_COORDS = `UPDATE world_objects SET lat = ?, lon = ?, updated_at = ? WHERE id = ? AND lat = 0 AND lon = 0`;
const SQL_INSERT_WORLD_OBJECT = `INSERT INTO world_objects (id, x, y, lat, lon, kind, scale, tint, quest_id, passable, label, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_GET_QUEST_BY_ID = `SELECT id FROM quests WHERE id = ?`;
const SQL_INSERT_QUEST = `INSERT INTO quests (id, name, description, required_level, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;

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
  await backfillWorldObjectLatLon();
  const existing = await one<{ n: number }>(SQL_COUNT_WORLD_OBJECTS);
  if ((existing?.n ?? 0) > 0) {
    return;
  }
  const now = Date.now();
  let inserted = 0;
  for (const seed of DEFAULT_SEEDS) {
    const coords = seededLatLon(seed.x, seed.y, seed.label);
    await run(SQL_INSERT_WORLD_OBJECT, [
      newId('wob'),
      seed.x, seed.y,
      coords.lat,
      coords.lon,
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

async function backfillWorldObjectLatLon(): Promise<void> {
  const rows = await q<{ readonly id: string; readonly x: number; readonly y: number }>(SQL_WORLD_OBJECTS_MISSING_COORDS);
  if (rows.length === 0) return;
  const now = Date.now();
  for (const row of rows) {
    const coords = seededLatLon(row.x, row.y, row.id);
    await run(SQL_BACKFILL_WORLD_OBJECT_COORDS, coords.lat, coords.lon, now, row.id);
  }
  log.info('quests.world-objects.coords-backfilled', { count: rows.length });
}

function seededLatLon(x: number, y: number, label: string): { readonly lat: number; readonly lon: number } {
  const coords = BIOME_COORDS[biomeAt(0x1f2a3b4c, x, y)];
  const jitter = ((hashString(label) % 100) - 50) / 10;
  return { lat: clamp(coords.lat + jitter, -90, 90), lon: clamp(coords.lon + jitter, -180, 180) };
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Intro copy carried over from the pre-Twine seed; source for authoring the .twee files. */
export const SEED_INTRO_TEXT: Readonly<Record<string, string>> = {
  'embers-root': 'Head to the Ember Wastes and see what has the caravans spooked.',
  'basin-root': 'Head down to Mirror Basin and take samples of any Water-type.',
  'highwind-root': 'Climb up to the plateau and thin the Wind-type flocks.',
  'circuit-root': 'Enter the storm under the thunderhead and see if you can reach the foundry.',
  'firstscout-root': 'Head down to the prairie and get a feel for the calm end of the map.',
  'static-root': 'The Static waits. If you go in, you come out changed or not at all.',
};

const DEFAULT_QUESTS: readonly (Omit<Quest, 'createdAt' | 'updatedAt'>)[] = [
  {
    id: 'qst-embers',
    name: 'Embers on the Ridge',
    description: 'Survey the [[desert]] and clear Fire-types stalking the dune line.',
    requiredLevel: 1,
    introDialogueId: 'embers-root',
    steps: [],
    finalReward: { items: [], pickCount: 0, guaranteedNetcore: 140 },
    unlocksQuestIds: [],
    objectives: [
      { kind: 'travel', biome: 'desert', text: 'Travel to [[desert]] and survey the dune line' },
      { kind: 'defeat', biome: 'desert', element: 'fire', count: 5, text: 'Defeat [[desert]] Fire-types' },
    ],
    giver: 'Tamer Guild',
    rewardText: '320 XP · 140 NetCore',
    status: 'draft',
  },
  {
    id: 'qst-basin',
    name: 'Still Waters',
    description: 'The Nursery wants readings from the [[lake]] before sunset.',
    requiredLevel: 1,
    introDialogueId: 'basin-root',
    steps: [],
    finalReward: { items: [], pickCount: 0, guaranteedNetcore: 90 },
    unlocksQuestIds: [],
    objectives: [
      { kind: 'defeat', biome: 'lake', element: 'water', count: 3, text: 'Analyse [[lake]] Water-types' },
      { kind: 'travel', biome: 'forest', text: 'Carry the sample to [[forest]]' },
    ],
    giver: 'Nursery',
    rewardText: '260 XP · Water Data +20%',
    status: 'draft',
  },
  {
    id: 'qst-highwind',
    name: 'Chasing the Highwind',
    description: 'The Skyshear plateau has stirred — Wind-types are riding the currents.',
    requiredLevel: 3,
    introDialogueId: 'highwind-root',
    steps: [],
    finalReward: { items: [], pickCount: 0, guaranteedNetcore: 200 },
    unlocksQuestIds: [],
    objectives: [
      { kind: 'travel', biome: 'plateau', text: 'Reach the currents of [[plateau]]' },
      { kind: 'defeat', biome: 'plateau', element: 'wind', count: 4, text: 'Down 4 Wind-types over [[plateau]]' },
    ],
    giver: 'The World',
    rewardText: '410 XP · 200 NetCore',
    status: 'draft',
  },
  {
    id: 'qst-circuit',
    name: 'The Long Circuit',
    description: 'Chart a path from Voltcloud to the Rustworks for the Guild.',
    requiredLevel: 5,
    introDialogueId: 'circuit-root',
    steps: [],
    finalReward: { items: [], pickCount: 0, guaranteedNetcore: 380 },
    unlocksQuestIds: [],
    objectives: [
      { kind: 'travel', biome: 'storm', text: 'Enter [[storm]] under the thunderhead' },
      { kind: 'defeat', biome: 'storm', element: 'electricity', count: 6, text: 'Beat 6 Electric-types in [[storm]]' },
      { kind: 'travel', biome: 'foundry', text: 'Deliver the charge to [[foundry]]' },
    ],
    giver: 'Tamer Guild',
    rewardText: '560 XP · Rare Chip',
    status: 'draft',
  },
  {
    id: 'qst-firstscout',
    name: 'First Scout',
    description: 'Every tamer starts with a walk through Solaris Fields.',
    requiredLevel: 1,
    introDialogueId: 'firstscout-root',
    steps: [],
    finalReward: { items: [], pickCount: 0, guaranteedNetcore: 120 },
    unlocksQuestIds: [],
    objectives: [
      { kind: 'travel', biome: 'prairie', text: 'Scout the calm of [[prairie]]' },
    ],
    giver: 'Tamer Guild',
    rewardText: '120 XP · claimed',
    status: 'draft',
  },
  {
    id: 'qst-static',
    name: 'Into the Static',
    description: 'A tear in the map has opened. Someone brave enough will need to look.',
    requiredLevel: 30,
    introDialogueId: 'static-root',
    steps: [],
    finalReward: { items: [], pickCount: 0, guaranteedNetcore: 1200 },
    unlocksQuestIds: [],
    objectives: [
      { kind: 'travel', biome: 'void', text: 'Breach [[void]] — the tear in the map' },
    ],
    giver: '???',
    rewardText: '1200 XP · ???',
    lockHint: 'Reach Tamer Lv 30 to unlock',
    status: 'draft',
  },
];

export async function seedDefaultQuests(): Promise<void> {
  const now = Date.now();
  let inserted = 0;
  for (const questSpec of DEFAULT_QUESTS) {
    const existing = await one<{ id: string }>(SQL_GET_QUEST_BY_ID, questSpec.id);
    if (existing) continue;
    const quest: Quest = { ...questSpec, createdAt: now, updatedAt: now };
    await run(SQL_INSERT_QUEST, quest.id, quest.name, quest.description, quest.requiredLevel, JSON.stringify(quest), now, now);
    inserted += 1;
  }
  if (inserted > 0) log.info('quests.default.seeded', { insertedRows: inserted, defaultsAvailable: DEFAULT_QUESTS.length });
}
