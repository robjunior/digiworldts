/**
 * Boot-time seed for the skills_catalog table. Reads every unique skill name
 * from the XML catalog's per-Digimon skillPool (populated by `pnpm scrape
 * --refresh` from grindosaur Special + Attachment Skills) and upserts one
 * row per name into skills_catalog with a minimal deal_damage action.
 *
 * Idempotent: `ON CONFLICT (name) DO NOTHING` preserves any hand-edited row
 * an admin has already tuned via the Skills admin tab.
 */
import { run } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import { log } from '../util/log.js';
import { stringifyActions, stringifyTags } from './dsl.js';

const SQL_UPSERT_SKILL = `INSERT INTO skills_catalog
     (id, name, description, element, energy_cost, cooldown, actions_json, tags_json, animation, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, 1, ?, ?)
     ON CONFLICT DO NOTHING`;

function idForSkillName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `sk-${slug}`;
}

export async function seedSkillsCatalogFromXml(): Promise<void> {
  const catalog = loadCatalog();
  const now = Date.now();
  const seen = new Map<string, { element: string; energyCost: number; power: number; description: string }>();
  for (const mon of catalog.digimons) {
    for (const skill of mon.skillPool) {
      if (seen.has(skill.name)) continue;
      seen.set(skill.name, {
        element: skill.element,
        energyCost: Math.max(0, Math.floor(skill.energyCost)),
        power: Math.max(0, Math.floor(skill.power)),
        description: skill.description ?? '',
      });
    }
  }
  const tagsJson = stringifyTags([]);
  let inserted = 0;
  for (const [name, data] of seen) {
    const actionsJson = stringifyActions([
      {
        kind: 'deal_damage',
        target: 'primary_target',
        amount: { base: data.power, scale: 'atk', factor: 1.0 },
      },
    ]);
    const result = await run(
      SQL_UPSERT_SKILL,
      idForSkillName(name),
      name,
      data.description,
      data.element,
      data.energyCost,
      actionsJson,
      tagsJson,
      now,
      now,
    );
    if (result.changes > 0) inserted += 1;
  }
  log.info('skills.catalog.seed.ok', { uniqueXmlSkills: seen.size, insertedRows: inserted });
}
