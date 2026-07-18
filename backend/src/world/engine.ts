import { loadCatalog } from '../digimon/xml.js';
import { one, q, run, type RosterRow, type ShopItemRow, type WorldPositionRow } from '../db/index.js';
import type { BaseStats, Element, Stage, TemplateDigimon } from '../digimon/types.js';
import { EVOLUTION_LEVELS } from '../digimon/types.js';
import { MAX_LEVEL, scaleStatsForLevel, STAGE_MULTIPLIER } from '../digimon/element.js';
import { applyGrowth } from '../progression/xp.js';
import { findTemplate } from '../digimon/xml.js';
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
const RARE_BUDGET_BOOST = 1.30;
const LEVEL_FLOOR_OFFSET = 3;

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
  maxStage: Stage;
  digiratingTotal: number;
  digiratingAvg: number;
};

const ZERO_BONUS: BaseStats = { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 };

function sumStats(stats: BaseStats): number {
  return stats.hp + stats.en + stats.atk + stats.def + stats.int + stats.spd;
}

export function digirating(template: TemplateDigimon, level: number, bonus: BaseStats): number {
  return sumStats(scaleStatsForLevel(template.baseStats, level, bonus));
}

export async function partyRating(userId: string): Promise<PartyRating> {
  const rows = await q<RosterRow>(SQL_SELECT_PARTY, userId);
  if (rows.length === 0) {
    return { rating: 1, memberCount: 0, meanLevel: 1, dominantStage: 'Rookie', maxStage: 'Rookie', digiratingTotal: 0, digiratingAvg: 0 };
  }
  const catalog = loadCatalog();
  const templateById = new Map(catalog.digimons.map((t) => [t.id, t] as const));
  let sum = 0;
  let levelSum = 0;
  let digiratingSum = 0;
  const stageCounts = new Map<Stage, number>();
  let maxStage: Stage = 'Rookie';
  let maxStageRank = STAGE_MULTIPLIER['Rookie'];
  for (const r of rows) {
    const bonus: BaseStats = { hp: r.hp_bonus, en: r.en_bonus, atk: r.atk_bonus, def: r.def_bonus, int: r.int_bonus, spd: r.spd_bonus };
    sum += r.level * 10 + sumStats(bonus);
    levelSum += r.level;
    const tpl = templateById.get(r.catalog_id);
    if (tpl) {
      stageCounts.set(tpl.stage, (stageCounts.get(tpl.stage) ?? 0) + 1);
      digiratingSum += digirating(tpl, r.level, bonus);
      const rank = STAGE_MULTIPLIER[tpl.stage];
      if (rank > maxStageRank) {
        maxStage = tpl.stage;
        maxStageRank = rank;
      }
    }
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
    maxStage,
    digiratingTotal: digiratingSum,
    digiratingAvg: Math.round(digiratingSum / rows.length),
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
  | { kind: 'wild-mon'; mons: WildMon[] }
  | { kind: 'item'; item: ItemDrop }
  | { kind: 'none' };

const STAGE_CASCADE: readonly Stage[] = ['Mega', 'Ultimate', 'Champion', 'Rookie', 'In-Training', 'Baby'];

function stageMinLevel(stage: Stage): number {
  return Math.max(1, EVOLUTION_LEVELS[stage] ?? 0);
}

function pickTemplateForBudget(
  catalog: readonly TemplateDigimon[],
  preferredElement: Element,
  preferredStage: Stage,
  budget: number,
  levelFloor: number,
): { template: TemplateDigimon; effectiveStage: Stage } | null {
  if (catalog.length === 0) return null;
  const startIdx = STAGE_CASCADE.indexOf(preferredStage);
  const chain = startIdx >= 0 ? STAGE_CASCADE.slice(startIdx) : [preferredStage];
  let fallbackStagePool: TemplateDigimon[] | null = null;
  for (const stage of chain) {
    const stageMatches = catalog.filter((t) => t.stage === stage);
    if (stageMatches.length === 0) continue;
    if (fallbackStagePool === null) fallbackStagePool = stageMatches;
    const stageFloor = Math.max(levelFloor, stageMinLevel(stage));
    const affordable = stageMatches.filter((t) => {
      const growth = applyGrowth(ZERO_BONUS, stage, Math.max(0, stageFloor - 1));
      return digirating(t, stageFloor, growth) <= budget;
    });
    if (affordable.length === 0) continue;
    const elementMatches = affordable.filter((t) => t.element === preferredElement);
    const finalPool = elementMatches.length > 0 && Math.random() < BIOME_ELEMENT_PREFERENCE ? elementMatches : affordable;
    const idx = Math.floor(Math.random() * finalPool.length);
    const template = finalPool[idx];
    if (template) return { template, effectiveStage: stage };
  }
  if (fallbackStagePool !== null) {
    const template = [...fallbackStagePool].sort((a, b) => sumStats(a.baseStats) - sumStats(b.baseStats))[0];
    if (template) return { template, effectiveStage: template.stage as Stage };
  }
  return null;
}

export function levelForBudget(template: TemplateDigimon, budget: number, minLevel: number): number {
  const stage = template.stage as Stage;
  const stageFloor = Math.max(minLevel, stageMinLevel(stage));
  const floorDr = digirating(template, stageFloor, applyGrowth(ZERO_BONUS, stage, stageFloor - 1));
  let lo = floorDr <= budget ? stageFloor : Math.max(1, stageFloor);
  let hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const growth = applyGrowth(ZERO_BONUS, stage, mid - 1);
    if (digirating(template, mid, growth) <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(lo, stageFloor);
}

const WILD_PARTY_SIZE_WEIGHTS = [0, 0.35, 0.35, 0.30] as const;

function rollWildPartySize(): number {
  const r = Math.random();
  let acc = 0;
  for (let n = 1; n <= 3; n++) {
    acc += WILD_PARTY_SIZE_WEIGHTS[n]!;
    if (r < acc) return n;
  }
  return 1;
}

export async function generateWildParty(biome: Biome, rating: PartyRating): Promise<WildMon[]> {
  const catalog = loadCatalog();
  const preferred = BIOME_ELEMENT[biome];
  const size = rollWildPartySize();
  const stagePool = catalog.digimons.filter((t) => t.stage === rating.maxStage);
  const pool = stagePool.length > 0 ? stagePool : [...catalog.digimons];
  const stageFloor = stageMinLevel(rating.maxStage);
  const minStageDr = pool.reduce((min, t) => {
    const growth = applyGrowth(ZERO_BONUS, rating.maxStage, Math.max(0, stageFloor - 1));
    return Math.min(min, digirating(t, stageFloor, growth));
  }, Number.MAX_SAFE_INTEGER);
  const perMonBudget = Math.max(rating.digiratingAvg, minStageDr);
  const levelFloor = Math.max(1, rating.meanLevel - LEVEL_FLOOR_OFFSET);
  const mons: WildMon[] = [];
  for (let i = 0; i < size; i++) {
    const rare = Math.random() < RARE_MON_RATE;
    const budget = perMonBudget * (rare ? RARE_BUDGET_BOOST : 1);
    const pick = pickTemplateForBudget(catalog.digimons, preferred, rating.maxStage, budget, levelFloor);
    if (!pick) break;
    const level = levelForBudget(pick.template, budget, levelFloor);
    mons.push({
      catalogId: pick.template.id,
      name: pick.template.name,
      element: pick.template.element,
      stage: pick.template.stage,
      level,
      portrait: pick.template.assets.portrait,
      rare,
    });
  }
  return mons;
}

export async function generateItemDrop(): Promise<ItemDrop | null> {
  const items = await q<ShopItemRow>(SQL_SELECT_ENABLED_ITEMS);
  if (items.length === 0) return null;
  const item = items[Math.floor(Math.random() * items.length)]!;
  return { itemId: item.id, name: item.name, qty: 1 };
}

export async function rollEncounter(biome: Biome, rating: PartyRating): Promise<Encounter> {
  const r = Math.random();
  if (r < ENCOUNTER_RATE) {
    const mons = await generateWildParty(biome, rating);
    if (mons.length > 0) return { kind: 'wild-mon', mons };
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
