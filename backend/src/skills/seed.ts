/** Boot-time seed for the skills_catalog table. Reads every skill from the
 * per-element seed files in `backend/src/skills/seeds/` (the single source of
 * truth) and upserts one row per skill into skills_catalog.
 *
 * Idempotent: `ON CONFLICT (name) DO NOTHING` preserves any hand-edited row
 * an admin has already tuned via the Skills admin tab.
 */
import { q, run } from '../db/index.js';
import { ALL_SKILL_SEEDS } from './seeds/index.js';
import { log } from '../util/log.js';
import { stringifyActions, stringifyTags } from './dsl.js';

const SQL_UPSERT_SKILL = `INSERT INTO skills_catalog
     (id, name, description, element, energy_cost, cooldown, actions_json, tags_json, animation, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
     ON CONFLICT DO NOTHING`;

export async function seedSkillsCatalogFromXml(): Promise<void> {
  const now = Date.now();
  const existingRows = await q<{ name: string; actions_json: string | null }>(
    'SELECT name, actions_json FROM skills_catalog',
  );
  const existingByName = new Map(existingRows.map((r) => [r.name, r.actions_json]));

  let inserted = 0;
  let upgraded = 0;

  for (const seed of ALL_SKILL_SEEDS) {
    const actions = seed.actions;
    const actionsJson = stringifyActions(actions);
    const currentActions = existingByName.get(seed.name);

    if (currentActions !== undefined && isLegacyPlaceholder(currentActions, seed.energyCost)) {
      await run(
        `UPDATE skills_catalog SET actions_json = ?, element = ?, updated_at = ? WHERE name = ?`,
        actionsJson, seed.element, now, seed.name,
      );
      upgraded += 1;
      continue;
    }

    const result = await run(
      SQL_UPSERT_SKILL,
      seed.id,
      seed.name,
      seed.description ?? '',
      seed.element,
      seed.energyCost,
      seed.cooldown ?? 0,
      actionsJson,
      stringifyTags(seed.tags ?? []),
      now,
      now,
    );
    if (result.changes > 0) inserted += 1;
  }
  log.info('skills.catalog.seed.ok', { uniqueSkills: ALL_SKILL_SEEDS.length, insertedRows: inserted, upgradedRows: upgraded });
}

function isLegacyPlaceholder(actionsJson: string | null, power: number): boolean {
  if (!actionsJson) return false;
  try {
    const parsed = JSON.parse(actionsJson);
    if (!Array.isArray(parsed) || parsed.length !== 1) return false;
    const a = parsed[0];
    if (a.kind !== 'deal_damage') return false;
    if (a.target !== 'primary_target') return false;
    if (a.amount === undefined) return false;
    if (a.amount.base !== power) return false;
    if (a.amount.scale !== 'atk') return false;
    if (Number(a.amount.factor) !== 1) return false;
    if (a.element !== undefined) return false;
    if (a.accuracy !== undefined) return false;
    if (a.crit !== undefined) return false;
    return true;
  } catch {
    return false;
  }
}
