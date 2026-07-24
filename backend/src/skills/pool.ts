import { q, type SkillCatalogRow } from '../db/index.js';
import type { Element, Skill, Stage } from '@digiworld/shared/digimon';
import { EQUIPPED_SLOTS_PER_STAGE } from '@digiworld/shared/digimon';
import { parseActions } from './dsl.js';

const STAGE_ORDINAL: Record<Stage, number> = {
  Baby: 0,
  'In-Training': 1,
  Rookie: 2,
  Champion: 3,
  Ultimate: 4,
  Mega: 5,
};

const SLOT_ROLE_ORDINAL: Record<string, number> = {
  primary_attack: 0,
  sustain_dot: 1,
  control: 2,
  buff_support: 3,
  utility: 4,
  identity_finisher: 5,
};

const CATALOG_ID_PREFIX = 'sk-';

const SQL_SELECT_POOL_BY_ELEMENT = `SELECT * FROM skills_catalog WHERE element = ? AND stage IS NOT NULL AND enabled = 1`;

export function isCatalogSkillId(id: string): boolean {
  return id.startsWith(CATALOG_ID_PREFIX);
}

/**
 * Catalog skill IDs a Digimon of (element, stage) has learned.
 *
 * Carry-forward: includes all stages with ordinal ≤ current stage's ordinal.
 * Rookie Fire = 6, Champion Fire = 12, Ultimate Fire = 18, Mega Fire = 24.
 *
 * Sorted newest-stage-first (Mega → Ultimate → Champion → Rookie), then by
 * canonical slot-role order (primary_attack < sustain_dot < control <
 * buff_support < utility < identity_finisher). This ordering makes the first
 * `EQUIPPED_SLOTS_PER_STAGE[stage]` IDs a sensible default equip: the mon's
 * current-stage skills come before prior-stage carry-forwards.
 */
export async function getLearnedPoolIds(element: Element, stage: Stage): Promise<string[]> {
  const currentOrd = STAGE_ORDINAL[stage];
  const rows = await q<SkillCatalogRow>(SQL_SELECT_POOL_BY_ELEMENT, element);
  const filtered = rows.filter((r) => r.stage !== null && STAGE_ORDINAL[r.stage as Stage] <= currentOrd);
  filtered.sort((a, b) => {
    const stageDiff = STAGE_ORDINAL[b.stage as Stage] - STAGE_ORDINAL[a.stage as Stage];
    if (stageDiff !== 0) return stageDiff;
    const roleA = a.slot_role ? (SLOT_ROLE_ORDINAL[a.slot_role] ?? 99) : 99;
    const roleB = b.slot_role ? (SLOT_ROLE_ORDINAL[b.slot_role] ?? 99) : 99;
    return roleA - roleB;
  });
  return filtered.map((r) => r.id);
}

/**
 * Default equipped skill IDs for a freshly-evolved (or freshly-seeded) mon.
 * Slices `EQUIPPED_SLOTS_PER_STAGE[stage]` (4/6/8/10) off the front of the
 * ordered learned pool.
 *
 * Concrete result for Fire (with all 264 skills seeded):
 * - Rookie (cap 4): pa/sd/ct/bs from Rookie tier (drops utility + identity_finisher)
 * - Champion (cap 6): all 6 Champion role skills (pa/sd/ct/bs/ut/id)
 * - Ultimate (cap 8): 6 Ultimate + Champion pa + Champion sd
 * - Mega (cap 10): 6 Mega + Ultimate pa/sd/ct/bs
 */
export async function getDefaultEquippedForStage(element: Element, stage: Stage): Promise<string[]> {
  const ordered = await getLearnedPoolIds(element, stage);
  const cap = EQUIPPED_SLOTS_PER_STAGE[stage];
  return ordered.slice(0, cap);
}

export type CatalogSkillMeta = {
  id: string;
  name: string;
  name_pt: string;
  description: string | null;
  description_pt: string | null;
  element: Element;
  energyCost: number;
  cooldown: number;
  stage: Stage;
  slot_role: string | null;
  tier_2: boolean;
  upgrade_of: string | null;
};

export async function getLearnedPoolMeta(element: Element, stage: Stage): Promise<CatalogSkillMeta[]> {
  const currentOrd = STAGE_ORDINAL[stage];
  const rows = await q<SkillCatalogRow>(SQL_SELECT_POOL_BY_ELEMENT, element);
  const filtered = rows.filter((r) => r.stage !== null && STAGE_ORDINAL[r.stage as Stage] <= currentOrd);
  filtered.sort((a, b) => {
    const stageDiff = STAGE_ORDINAL[b.stage as Stage] - STAGE_ORDINAL[a.stage as Stage];
    if (stageDiff !== 0) return stageDiff;
    const roleA = a.slot_role ? (SLOT_ROLE_ORDINAL[a.slot_role] ?? 99) : 99;
    const roleB = b.slot_role ? (SLOT_ROLE_ORDINAL[b.slot_role] ?? 99) : 99;
    return roleA - roleB;
  });
  return filtered.map(rowToMeta);
}

function rowToMeta(row: SkillCatalogRow): CatalogSkillMeta {
  return {
    id: row.id,
    name: row.name,
    name_pt: row.name_pt,
    description: row.description || null,
    description_pt: row.description_pt,
    element: row.element as Element,
    energyCost: row.energy_cost,
    cooldown: row.cooldown,
    stage: row.stage as Stage,
    slot_role: row.slot_role,
    tier_2: row.tier_2 === 1,
    upgrade_of: row.upgrade_of,
  };
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
  if (row.name_pt) skill.name_pt = row.name_pt;
  if (row.description_pt) skill.description_pt = row.description_pt;
  if (row.cooldown > 0) skill.cooldown = row.cooldown;
  return skill;
}
