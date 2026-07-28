import type { Catalog, Dungeon, EncounterDigimon, TemplateDigimon } from '@digiworld/shared';
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
  const maxStageRank = stageRank(dungeon.randomMaxStage);
  const allowedElements = dungeon.randomAllowedElements ? new Set(dungeon.randomAllowedElements) : null;
  return digimon.every((mon) => {
    if (mon.level < dungeon.randomMinLevel || mon.level > dungeon.randomMaxLevel) return false;
    const template = templates.get(mon.catalogId);
    if (!template) return false;
    if (stageRank(template.stage) > maxStageRank) return false;
    if (allowedElements && !allowedElements.has(template.element)) return false;
    return true;
  });
}
