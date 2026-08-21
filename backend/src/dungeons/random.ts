import type { Catalog, Dungeon, DungeonZone, EncounterDigimon, TemplateDigimon, WildPool, WildPoolRollParams } from '@digiworld/shared';
import { STAGES } from '@digiworld/shared/digimon';

const STAGE_RANK = new Map(STAGES.map((stage, index) => [stage, index] as const));

function stageRank(stage: TemplateDigimon['stage']): number {
  return STAGE_RANK.get(stage) ?? 0;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickOne<T>(items: readonly T[]): T | null {
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function randomEncounterPool(dungeon: Dungeon, catalog: Catalog): readonly TemplateDigimon[] {
  const maxStageRank = stageRank(dungeon.randomMaxStage);
  const allowedElements = dungeon.randomAllowedElements ? new Set(dungeon.randomAllowedElements) : null;
  return catalog.digimons.filter((entry) => {
    if (stageRank(entry.stage) > maxStageRank) return false;
    if (allowedElements && !allowedElements.has(entry.element)) return false;
    return true;
  });
}

export function rollRandomEncounter(dungeon: Dungeon, catalog: Catalog): readonly EncounterDigimon[] | null {
  if (!dungeon.randomEncountersEnabled) return null;
  if (Math.random() >= dungeon.randomEncounterRate) return null;
  const pool = randomEncounterPool(dungeon, catalog);
  if (pool.length === 0) return null;
  const partySize = randomInt(dungeon.randomMinPartySize, dungeon.randomMaxPartySize);
  const mons: EncounterDigimon[] = [];
  for (let index = 0; index < partySize; index += 1) {
    const pick = pickOne(pool);
    if (!pick) break;
    mons.push({ catalogId: pick.id, level: randomInt(dungeon.randomMinLevel, dungeon.randomMaxLevel) });
  }
  return mons.length > 0 ? mons : null;
}

export function randomEncounterMatchesDungeonConfig(dungeon: Dungeon, catalog: Catalog, digimon: readonly EncounterDigimon[]): boolean {
  if (digimon.length < dungeon.randomMinPartySize || digimon.length > dungeon.randomMaxPartySize) return false;
  const templates = new Map(catalog.digimons.map((entry) => [entry.id, entry] as const));
  // When a curated pool is active, the legacy filter's stage/element limits
  // do NOT apply — those entries were curated on purpose and rollFromPool no
  // longer filters them. Only the level + party-size bounds gate the
  // client-supplied encounter (anti-cheat). Zone-pool encounters also flow
  // through here and are accepted under the same level bounds.
  const curatedPoolActive = dungeon.randomPool.length > 0;
  const maxStageRank = stageRank(dungeon.randomMaxStage);
  const allowedElements = dungeon.randomAllowedElements ? new Set(dungeon.randomAllowedElements) : null;
  return digimon.every((mon) => {
    if (mon.level < dungeon.randomMinLevel || mon.level > dungeon.randomMaxLevel) return false;
    const template = templates.get(mon.catalogId);
    if (!template) return false;
    if (curatedPoolActive) return true;
    if (stageRank(template.stage) > maxStageRank) return false;
    if (allowedElements && !allowedElements.has(template.element)) return false;
    return true;
  });
}

function findEnclosingZone(zones: readonly DungeonZone[], x: number, y: number): DungeonZone | null {
  const covering = zones.filter((z) => x >= z.x && x < z.x + z.width && y >= z.y && y < z.y + z.height);
  if (covering.length === 0) return null;
  return covering.reduce((a, b) => (a.width * a.height <= b.width * b.height ? a : b));
}

function dungeonWideParams(dungeon: Dungeon): WildPoolRollParams {
  return {
    encounterRate: dungeon.randomEncounterRate,
    minLevel: dungeon.randomMinLevel,
    maxLevel: dungeon.randomMaxLevel,
    maxStage: dungeon.randomMaxStage,
    minPartySize: dungeon.randomMinPartySize,
    maxPartySize: dungeon.randomMaxPartySize,
    allowedElements: dungeon.randomAllowedElements ?? [],
  };
}

function mergeRollParams(base: WildPoolRollParams, overrides: Partial<WildPoolRollParams> | undefined): WildPoolRollParams {
  if (!overrides) return base;
  return { ...base, ...overrides };
}

function rollFromPool(pool: WildPool, params: WildPoolRollParams, catalog: Catalog): readonly EncounterDigimon[] | null {
  if (pool.length === 0) return null;
  if (Math.random() >= params.encounterRate) return null;
  // Curated pool entries always roll. The legacy filter's `allowedElements`
  // / `maxStage` only gate the branch-4 fallback (rollRandomEncounter), never
  // the curated pool — otherwise a mismatched filter silently emptied the
  // pool (random encounter "does nothing"). Per-entry level fallbacks still
  // inherit from params when the entry omits them.
  const templates = new Map(catalog.digimons.map((entry) => [entry.id, entry] as const));
  const partySize = randomInt(params.minPartySize, params.maxPartySize);
  const mons: EncounterDigimon[] = [];
  for (let index = 0; index < partySize; index += 1) {
    const entry = pickOne(pool);
    if (!entry) break;
    const template = templates.get(entry.catalogId);
    if (!template) continue;
    const minLevel = entry.minLevel ?? params.minLevel;
    const maxLevel = entry.maxLevel ?? params.maxLevel;
    mons.push({ catalogId: template.id, level: randomInt(minLevel, maxLevel) });
  }
  return mons.length > 0 ? mons : null;
}

export function rollDungeonEncounter(
  dungeon: Dungeon,
  zones: readonly DungeonZone[],
  playerPos: { readonly x: number; readonly y: number },
  catalog: Catalog,
): readonly EncounterDigimon[] | null {
  if (!dungeon.randomEncountersEnabled) return null;
  const zone = findEnclosingZone(zones, playerPos.x, playerPos.y);
  if (zone?.safe) return null;
  if (zone && zone.pool.length > 0) {
    const params = mergeRollParams(dungeonWideParams(dungeon), zone.rollOverrides);
    return rollFromPool(zone.pool, params, catalog);
  }
  if (dungeon.randomPool.length > 0) {
    return rollFromPool(dungeon.randomPool, dungeonWideParams(dungeon), catalog);
  }
  return rollRandomEncounter(dungeon, catalog);
}
