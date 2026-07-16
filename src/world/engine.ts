import { loadCatalog } from '../digimon/xml.js';
import { one, q, run, type RosterRow, type ShopItemRow, type WorldPositionRow } from '../db/index.js';
import type { Element, Stage, TemplateDigimon } from '../digimon/types.js';
import { biomeAt, BIOME_ELEMENT, seedForUser, type Biome } from './biomes.js';

const SQL_SELECT_POSITION = `SELECT * FROM world_position WHERE user_id = ?`;
const SQL_UPSERT_POSITION = `
  INSERT INTO world_position (user_id, world_seed, x, y, steps_taken, last_move_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE
       SET x = excluded.x,
           y = excluded.y,
           steps_taken = excluded.steps_taken,
           last_move_at = excluded.last_move_at,
           updated_at = excluded.updated_at
`;
const SQL_SELECT_PARTY = `SELECT * FROM player_roster WHERE user_id = ? AND status = 'party' ORDER BY slot_index`;
const SQL_SELECT_ENABLED_ITEMS = `SELECT * FROM shop_items WHERE enabled = 1`;

const ENCOUNTER_RATE = 0.18;
const ITEM_DROP_RATE = 0.08;
const RARE_MON_RATE = 0.05;
const BIOME_ELEMENT_PREFERENCE = 0.7;

export type Position = { x: number; y: number; seed: number };

export async function loadOrInitPosition(userId: string): Promise<Position> {
  const row = await one<WorldPositionRow>(SQL_SELECT_POSITION, userId);
  const now = Date.now();
  if (row) return { x: row.x, y: row.y, seed: row.world_seed };
  const seed = seedForUser(userId);
  await run(SQL_UPSERT_POSITION, [userId, seed, 0, 0, 0, now, now]);
  return { x: 0, y: 0, seed };
}

export async function savePosition(userId: string, pos: Position, stepsTaken: number): Promise<void> {
  const now = Date.now();
  await run(SQL_UPSERT_POSITION, [userId, pos.seed, pos.x, pos.y, stepsTaken, now, now]);
}

export async function getStepsTaken(userId: string): Promise<number> {
  const row = await one<WorldPositionRow>(SQL_SELECT_POSITION, userId);
  return row?.steps_taken ?? 0;
}

export type PartyRating = {
  rating: number;
  memberCount: number;
  meanLevel: number;
  dominantStage: Stage;
};

export async function partyRating(userId: string): Promise<PartyRating> {
  const rows = await q<RosterRow>(SQL_SELECT_PARTY, userId);
  if (rows.length === 0) return { rating: 1, memberCount: 0, meanLevel: 1, dominantStage: 'Rookie' };
  const catalog = loadCatalog();
  const templateById = new Map(catalog.digimons.map((t) => [t.id, t] as const));
  let sum = 0;
  let levelSum = 0;
  const stageCounts = new Map<Stage, number>();
  for (const r of rows) {
    const statBonusSum = r.hp_bonus + r.en_bonus + r.atk_bonus + r.def_bonus + r.int_bonus + r.spd_bonus;
    sum += r.level * 10 + statBonusSum;
    levelSum += r.level;
    const tpl = templateById.get(r.catalog_id);
    if (tpl) stageCounts.set(tpl.stage, (stageCounts.get(tpl.stage) ?? 0) + 1);
  }
  let dominantStage: Stage = 'Rookie';
  let bestCount = 0;
  for (const [stage, count] of stageCounts) {
    if (count > bestCount) {
      dominantStage = stage;
      bestCount = count;
    }
  }
  return {
    rating: Math.max(1, Math.round(sum / rows.length)),
    memberCount: rows.length,
    meanLevel: Math.max(1, Math.round(levelSum / rows.length)),
    dominantStage,
  };
}

export type WildMon = {
  catalogId: string;
  name: string;
  element: Element;
  stage: string;
  level: number;
  portrait: string;
  rare: boolean;
};

export type ItemDrop = { itemId: string; name: string; qty: number };

export type Encounter =
  | { kind: 'wild-mon'; mon: WildMon }
  | { kind: 'item'; item: ItemDrop }
  | { kind: 'none' };

function pickTemplateByBiomeAndStage(
  catalog: readonly TemplateDigimon[],
  preferredElement: Element,
  preferredStage: Stage,
): TemplateDigimon | null {
  if (catalog.length === 0) return null;
  const stageMatches = catalog.filter((t) => t.stage === preferredStage);
  const pool = stageMatches.length > 0 ? stageMatches : [...catalog];
  const elementMatches = pool.filter((t) => t.element === preferredElement);
  const finalPool = elementMatches.length > 0 && Math.random() < BIOME_ELEMENT_PREFERENCE ? elementMatches : pool;
  const idx = Math.floor(Math.random() * finalPool.length);
  return finalPool[idx] ?? null;
}

function levelForRating(rating: number, rare: boolean): number {
  const base = Math.max(1, Math.round(rating / 10));
  const variance = Math.floor(Math.random() * 5) - 2;
  const level = base + variance + (rare ? 3 : 0);
  return Math.max(1, Math.min(99, level));
}

export async function generateWildMon(biome: Biome, rating: number, partyStage: Stage): Promise<WildMon | null> {
  const catalog = loadCatalog();
  const preferred = BIOME_ELEMENT[biome];
  const template = pickTemplateByBiomeAndStage(catalog.digimons, preferred, partyStage);
  if (!template) return null;
  const rare = Math.random() < RARE_MON_RATE;
  return {
    catalogId: template.id,
    name: template.name,
    element: template.element,
    stage: template.stage,
    level: levelForRating(rating, rare),
    portrait: template.assets.portrait,
    rare,
  };
}

export async function generateItemDrop(): Promise<ItemDrop | null> {
  const items = await q<ShopItemRow>(SQL_SELECT_ENABLED_ITEMS);
  if (items.length === 0) return null;
  const item = items[Math.floor(Math.random() * items.length)]!;
  return { itemId: item.id, name: item.name, qty: 1 };
}

export async function rollEncounter(biome: Biome, rating: number, partyStage: Stage): Promise<Encounter> {
  const r = Math.random();
  if (r < ENCOUNTER_RATE) {
    const mon = await generateWildMon(biome, rating, partyStage);
    if (mon) return { kind: 'wild-mon', mon };
  }
  return { kind: 'none' };
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function nextPosition(pos: Position, dir: Direction): Position {
  const delta = DIR_DELTA[dir];
  return { seed: pos.seed, x: pos.x + delta.dx, y: pos.y + delta.dy };
}

export function currentBiome(pos: Position): Biome {
  return biomeAt(pos.seed, pos.x, pos.y);
}
