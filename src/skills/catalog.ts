/**
 * Skills catalog CRUD.
 *
 * Persists SkillDefinitions to `skills_catalog` table. Uses the DSL Zod
 * schemas from `./dsl.ts` for validation. Actions[] and tags[] are stored as
 * JSON TEXT columns and marshaled via parseActions/stringifyActions helpers.
 */
import { one, q, run, type SkillCatalogRow } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import {
  parseActions,
  parseTags,
  SkillInputSchema,
  stringifyActions,
  stringifyTags,
  type SkillDefinition,
  type SkillInput,
} from './dsl.js';

const SQL_SELECT_ALL = `SELECT * FROM skills_catalog ORDER BY element, name`;
const SQL_SELECT_BY_ID = `SELECT * FROM skills_catalog WHERE id = ?`;
const SQL_SELECT_BY_NAME = `SELECT * FROM skills_catalog WHERE name = ?`;
const SQL_INSERT = `INSERT INTO skills_catalog (id, name, description, element, energy_cost, cooldown, actions_json, tags_json, animation, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_UPDATE = `UPDATE skills_catalog SET name = ?, description = ?, element = ?, energy_cost = ?, cooldown = ?, actions_json = ?, tags_json = ?, animation = ?, enabled = ?, updated_at = ? WHERE id = ?`;
const SQL_DELETE = `DELETE FROM skills_catalog WHERE id = ?`;

function rowToView(row: SkillCatalogRow): SkillDefinition {
  const view: SkillDefinition = {
    id: row.id,
    name: row.name,
    description: row.description,
    element: row.element,
    energyCost: row.energy_cost,
    cooldown: row.cooldown,
    actions: parseActions(row.actions_json),
    tags: parseTags(row.tags_json),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.animation) view.animation = row.animation;
  return view;
}

export async function listSkills(): Promise<SkillDefinition[]> {
  const rows = await q<SkillCatalogRow>(SQL_SELECT_ALL);
  const views: SkillDefinition[] = [];
  for (const row of rows) {
    try {
      views.push(rowToView(row));
    } catch (err) {
      log.warn('skill.parse.fail', { id: row.id, err: err instanceof Error ? err.message : String(err) });
    }
  }
  return views;
}

export async function getSkill(id: string): Promise<SkillDefinition | null> {
  const row = await one<SkillCatalogRow>(SQL_SELECT_BY_ID, id);
  if (!row) return null;
  try {
    return rowToView(row);
  } catch {
    return null;
  }
}

export type SkillError = 'invalid-dsl' | 'duplicate-name' | 'not-found';

export type SkillOutcome =
  | { ok: true; skill: SkillDefinition }
  | { ok: false; error: SkillError; details?: unknown };

export async function createSkill(input: unknown): Promise<SkillOutcome> {
  const parsed = SkillInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid-dsl', details: parsed.error.issues };
  }
  const data: SkillInput = parsed.data;
  const collision = await one<SkillCatalogRow>(SQL_SELECT_BY_NAME, data.name);
  if (collision) return { ok: false, error: 'duplicate-name' };
  const now = Date.now();
  const id = newId('sk');
  await run(
    SQL_INSERT,
    id,
    data.name,
    data.description ?? '',
    data.element,
    data.energyCost,
    data.cooldown ?? 0,
    stringifyActions(data.actions),
    stringifyTags(data.tags),
    data.animation ?? null,
    data.enabled === false ? 0 : 1,
    now,
    now,
  );
  const created = await getSkill(id);
  if (!created) throw new Error('skill create round-trip failed');
  log.info('skill.create', { id, name: data.name, element: data.element, actions: data.actions.length });
  return { ok: true, skill: created };
}

export async function updateSkill(id: string, input: unknown): Promise<SkillOutcome> {
  const existing = await one<SkillCatalogRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const parsed = SkillInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid-dsl', details: parsed.error.issues };
  const data: SkillInput = parsed.data;
  const nameCollide = await one<SkillCatalogRow>(SQL_SELECT_BY_NAME, data.name);
  if (nameCollide && nameCollide.id !== id) return { ok: false, error: 'duplicate-name' };
  const now = Date.now();
  await run(
    SQL_UPDATE,
    data.name,
    data.description ?? '',
    data.element,
    data.energyCost,
    data.cooldown ?? 0,
    stringifyActions(data.actions),
    stringifyTags(data.tags),
    data.animation ?? null,
    data.enabled === false ? 0 : 1,
    now,
    id,
  );
  const updated = await getSkill(id);
  if (!updated) throw new Error('skill update round-trip failed');
  log.info('skill.update', { id, name: data.name });
  return { ok: true, skill: updated };
}

export async function deleteSkill(id: string): Promise<{ ok: true; id: string } | { ok: false; error: 'not-found' }> {
  const existing = await one<SkillCatalogRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_DELETE, id);
  log.info('skill.delete', { id, name: existing.name });
  return { ok: true, id };
}
