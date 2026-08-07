import { run } from '../db/index.js';
import { log } from '../util/log.js';
import { SkillInputSchema, stringifyActions, stringifyTags } from './dsl.js';
import { ALL_SKILL_SEEDS, type SkillSeed } from './seeds/index.js';

const SQL_UPSERT_V2 = `INSERT INTO skills_catalog
  (id, name, description, element, energy_cost, cooldown, actions_json, tags_json, animation, enabled,
   name_pt, description_pt, stage, slot_role, upgrade_of, tier_2, vfx_preset_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (name) DO NOTHING`;

export type SeedV2Result = {
  total: number;
  inserted: number;
  skipped: number;
  validationErrors: Array<{ id: string; issues: unknown }>;
};

export async function seedSkillsCatalogV2(): Promise<SeedV2Result> {
  const result: SeedV2Result = { total: ALL_SKILL_SEEDS.length, inserted: 0, skipped: 0, validationErrors: [] };
  const now = Date.now();

  for (const seed of ALL_SKILL_SEEDS) {
    const check = SkillInputSchema.safeParse({
      name: seed.name,
      description: seed.description,
      element: seed.element,
      energyCost: seed.energyCost,
      cooldown: seed.cooldown,
      actions: seed.actions,
      tags: seed.tags,
      animation: seed.animation,
      enabled: seed.enabled,
    });
    if (!check.success) {
      result.validationErrors.push({ id: seed.id, issues: check.error.issues });
      continue;
    }
    const outcome = await run(
      SQL_UPSERT_V2,
      seed.id,
      seed.name,
      seed.description ?? '',
      seed.element,
      seed.energyCost,
      seed.cooldown ?? 0,
      stringifyActions(seed.actions),
      stringifyTags(seed.tags),
      seed.animation ?? null,
      seed.enabled === false ? 0 : 1,
      seed.name_pt,
      seed.description_pt,
      seed.stage,
      seed.slot_role,
      seed.upgrade_of ?? null,
      seed.tier_2 === true ? 1 : 0,
      null,
      now,
      now,
    );
    if (outcome.changes > 0) result.inserted += 1;
    else result.skipped += 1;
  }

  log.info('skills.catalog.v2.seed', result);
  return result;
}

export function seedSummaryByElement(seeds: readonly SkillSeed[] = ALL_SKILL_SEEDS): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of seeds) counts[s.element] = (counts[s.element] ?? 0) + 1;
  return counts;
}
