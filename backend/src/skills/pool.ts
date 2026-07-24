import { q, type SkillCatalogRow } from '../db/index.js';
import type { Element, Skill, Stage } from '@digiworld/shared/digimon';
import { parseActions } from './dsl.js';

const STAGE_ORDINAL: Record<Stage, number> = {
  Baby: 0,
  'In-Training': 1,
  Rookie: 2,
  Champion: 3,
  Ultimate: 4,
  Mega: 5,
};

const CATALOG_ID_PREFIX = 'sk-';

const SQL_SELECT_POOL_BY_ELEMENT = `SELECT * FROM skills_catalog WHERE element = ? AND stage IS NOT NULL AND enabled = 1`;

/** True when the id references a v2 catalog skill (vs a wikimon inline slot). */
export function isCatalogSkillId(id: string): boolean {
  return id.startsWith(CATALOG_ID_PREFIX);
}

/**
 * Catalog skill IDs a Digimon of (element, stage) has learned.
 * Carry-forward: includes all stages with ordinal ≤ current stage's ordinal.
 * Rookie Fire = 6 skills; Champion Fire = 12; Ultimate Fire = 18; Mega Fire = 24.
 */
export async function getLearnedPoolIds(element: Element, stage: Stage): Promise<string[]> {
  const currentOrd = STAGE_ORDINAL[stage];
  const rows = await q<SkillCatalogRow>(SQL_SELECT_POOL_BY_ELEMENT, element);
  return rows
    .filter((r) => r.stage !== null && STAGE_ORDINAL[r.stage as Stage] <= currentOrd)
    .map((r) => r.id);
}

/**
 * Batch-fetch catalog skills by id and materialize as Skill objects.
 * `.actions` is populated so the engine's DSL runtime path fires
 * (see engine.ts::applyAction hybrid branch).
 * Non-catalog IDs in the input are silently skipped.
 */
export async function resolveCatalogSkills(ids: readonly string[]): Promise<Skill[]> {
  const catalogIds = Array.from(new Set(ids.filter(isCatalogSkillId)));
  if (catalogIds.length === 0) return [];
  const placeholders = catalogIds.map(() => '?').join(', ');
  const sql = `SELECT * FROM skills_catalog WHERE id IN (${placeholders})`;
  const rows = await q<SkillCatalogRow>(sql, ...catalogIds);
  return rows.map(rowToSkill);
}

function rowToSkill(row: SkillCatalogRow): Skill {
  const skill: Skill = {
    id: row.id,
    name: row.name,
    element: row.element as Element,
    energyCost: row.energy_cost,
    power: 0,
    actions: parseActions(row.actions_json),
  };
  if (row.description) skill.description = row.description;
  return skill;
}
