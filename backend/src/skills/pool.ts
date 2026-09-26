import { q, type SkillCatalogRow } from '../db/index.js';
import type { Element, Skill, Stage } from '@digiworld/shared/digimon';
import { EQUIPPED_SLOTS_PER_STAGE, SKILLS_PER_DIGIMON } from '@digiworld/shared/digimon';
import { RARITY_RANK, type Rarity } from '@digiworld/shared/item-rarity';
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

/** Share of a stage's equip slots held for skills learned at earlier stages.
 *  A quarter yields 0 at Rookie (nothing earlier exists), 1 at Champion, and
 *  2 at Ultimate and Mega. */
const CARRY_FORWARD_SLOT_SHARE = 0.25;

const CATALOG_ID_PREFIX = 'sk-';

const SQL_SELECT_POOL_BY_ELEMENT = `SELECT * FROM skills_catalog WHERE element = ? AND stage IS NOT NULL AND enabled = 1 AND signature = 0`;

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
 * Fills `EQUIPPED_SLOTS_PER_STAGE[stage]` (4/6/8/10) from the ordered learned
 * pool, reserving a quarter of the slots for skills carried forward from
 * earlier stages.
 *
 * The reserve exists because the archetype rework changed the shape of the
 * pool underneath this function. With the old 6-skills-per-stage grid, a cap
 * of 8 at Ultimate could not be filled by the current tier alone, so 2
 * Champion skills came along for free and a Mega ran 6 Mega + 4 Ultimate.
 * The archetype grid has 9 per stage, which fills Ultimate outright and
 * leaves a single spare slot at Mega — carry-forward disappeared from the
 * default loadout as a side effect, without anyone deciding it should.
 *
 * Reserving the slots restores that continuity deliberately rather than as an
 * accident of arithmetic, and does it without raising the caps, which would
 * hand every mon ~30% more actions per fight and reopen the balance work.
 * The reserve shrinks to fit when fewer older skills exist than slots set
 * aside, which is why a Rookie still equips 4 Rookie skills.
 *
 * `evolutionRarity` (F7): when set to epic or legendary, biases the sort so
 * `tier_2=true` skills float to the front of each stage tier before slot-role
 * ordering. Legendary additionally forces `identity_finisher` roles to the
 * absolute front so they always survive the slice cap. common/uncommon/rare
 * leave the pre-F7 ordering untouched.
 */
export async function getDefaultEquippedForStage(element: Element, stage: Stage, evolutionRarity?: Rarity): Promise<string[]> {
  const currentOrd = STAGE_ORDINAL[stage];
  const rows = await q<SkillCatalogRow>(SQL_SELECT_POOL_BY_ELEMENT, element);
  const rarityRank = evolutionRarity ? RARITY_RANK[evolutionRarity] : -1;
  const filtered = rows.filter((r) => r.stage !== null && STAGE_ORDINAL[r.stage as Stage] <= currentOrd);
  filtered.sort((a, b) => {
    const stageDiff = STAGE_ORDINAL[b.stage as Stage] - STAGE_ORDINAL[a.stage as Stage];
    if (stageDiff !== 0) return stageDiff;
    if (rarityRank >= 4) {
      const idA = a.slot_role === 'identity_finisher' ? 0 : 1;
      const idB = b.slot_role === 'identity_finisher' ? 0 : 1;
      if (idA !== idB) return idA - idB;
    }
    if (rarityRank >= 3) {
      const t2A = a.tier_2 === 1 ? 0 : 1;
      const t2B = b.tier_2 === 1 ? 0 : 1;
      if (t2A !== t2B) return t2A - t2B;
    }
    const roleA = a.slot_role ? (SLOT_ROLE_ORDINAL[a.slot_role] ?? 99) : 99;
    const roleB = b.slot_role ? (SLOT_ROLE_ORDINAL[b.slot_role] ?? 99) : 99;
    return roleA - roleB;
  });
  const cap = EQUIPPED_SLOTS_PER_STAGE[stage];
  const current = filtered.filter((r) => r.stage === stage);
  const older = filtered.filter((r) => r.stage !== stage);
  const reserved = Math.min(Math.floor(cap * CARRY_FORWARD_SLOT_SHARE), older.length);
  const picked = [...current.slice(0, cap - reserved), ...older.slice(0, reserved)];
  // Backfill if the current tier had fewer skills than its share of the cap.
  if (picked.length < cap) {
    for (const row of filtered) {
      if (picked.length >= cap) break;
      if (!picked.includes(row)) picked.push(row);
    }
  }
  return picked.map((r) => r.id);
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
  signature: boolean;
  owner_template_id: string | null;
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

const SQL_SELECT_ALL_CATALOG = `SELECT * FROM skills_catalog WHERE stage IS NOT NULL AND enabled = 1 ORDER BY element, stage, slot_role`;

const SQL_SELECT_SIGNATURES_BY_TEMPLATE = `SELECT * FROM skills_catalog WHERE owner_template_id = ? AND signature = 1 AND enabled = 1 ORDER BY stage, slot_role`;

export async function getSignatureSkillsForTemplate(templateId: string): Promise<CatalogSkillMeta[]> {
  const rows = await q<SkillCatalogRow>(SQL_SELECT_SIGNATURES_BY_TEMPLATE, templateId);
  return rows.map(rowToMeta);
}

export async function getAllCatalogSkillsMeta(): Promise<CatalogSkillMeta[]> {
  const rows = await q<SkillCatalogRow>(SQL_SELECT_ALL_CATALOG);
  return rows.map(rowToMeta);
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
    signature: row.signature === 1,
    owner_template_id: row.owner_template_id,
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
  if (row.vfx_preset_id) skill.vfxPresetId = row.vfx_preset_id;
  return skill;
}

// ----- Seed-only skill pool (replaces XML/scraper skillPool) --------------------------

/** Build a digimon's skill pool from `skills_catalog` only (the seed source of truth),
 *  never from the XML/scraper `template.skillPool`.
 *
 *  Composition per template:
 *    1. own signature skills (`signature = 1 AND owner_template_id = ?`), ordered by
 *       slot_role — these are exclusive to this digimon and always present.
 *    2. generic element+stage skills (`signature = 0`, same element+stage), then
 *       sliced to fill the remaining slots up to `EQUIPPED_SLOTS_PER_STAGE[stage]`.
 *
 *  This is the seed-based replacement for `m.template.skillPool` (which came from the
 *  XML/scraper path and carried skills that don't belong to the mon).
 */
export async function buildSkillPoolFromCatalog(
  templateId: string,
  element: Element,
  stage: Stage,
): Promise<Skill[]> {
  const signatures = await q<SkillCatalogRow>(
    `SELECT * FROM skills_catalog WHERE signature = 1 AND owner_template_id = ? AND enabled = 1 ORDER BY slot_role`,
    templateId,
  );
  const generic = await q<SkillCatalogRow>(
    `SELECT * FROM skills_catalog WHERE element = ? AND stage = ? AND signature = 0 AND enabled = 1 ORDER BY slot_role`,
    element,
    stage,
  );
  const cap = EQUIPPED_SLOTS_PER_STAGE[stage] ?? SKILLS_PER_DIGIMON;
  const pool: Skill[] = [];
  for (const row of signatures) {
    if (pool.length >= cap) break;
    pool.push(rowToSkill(row));
  }
  for (const row of generic) {
    if (pool.length >= cap) break;
    pool.push(rowToSkill(row));
  }
  return pool;
}
