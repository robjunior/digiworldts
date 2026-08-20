/**
 * Boot-time seed for the skills_catalog table. Reads every unique skill name
 * from the XML catalog's per-Digimon skillPool (populated by `pnpm scrape
 * --refresh` from grindosaur Special + Attachment Skills) and upserts one
 * row per name into skills_catalog with a minimal deal_damage action.
 *
 * Idempotent: `ON CONFLICT (name) DO NOTHING` preserves any hand-edited row
 * an admin has already tuned via the Skills admin tab.
 */
import { q, run } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import { log } from '../util/log.js';
import { stringifyActions, stringifyTags } from './dsl.js';
import { ELEMENTS } from '../digimon/types.js';
import { Target, ScaleStat } from './dsl.js';
import type { Action } from './dsl.js';

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

// ---------------------------------------------------------------------------
// XML description → DSL actions converter.
// Parses the skill description text to extract target, element, scale, power,
// hit count, accuracy, and crit rate. Falls back to XML attributes when the
// description is not parseable (e.g. flavor text).
// ---------------------------------------------------------------------------

function targetFromPrefix(desc: string): string | null {
  const m = desc.match(/^\[Target:\s*([^\]]+)\]/i);
  if (!m) return null;
  const t = m[1]!.trim().toLowerCase();
  return t === 'all enemies' ? 'enemy_all' : 'primary_target';
}

function parseElementScalePower(desc: string, fallbackElement: string, fallbackPower: number): { element: string | undefined; scale: string; power: number } {
  const m = desc.match(/Performs\s+([a-zA-Z]+)\s+(physical|magic)\s+attack\s+at\s+power\s+(\d+)/i);
  if (!m) return { element: undefined, scale: 'atk', power: fallbackPower };

  const elementWord = m[1]!.toLowerCase();
  const scale = m[2]!.toLowerCase() === 'magic' ? 'int' : 'atk';

  let element: string | undefined;
  if (ELEMENTS.includes(elementWord as (typeof ELEMENTS)[number])) {
    element = elementWord;
  } else {
    element = fallbackElement; // keep existing; falls back to XML element
  }

  const power = parseInt(m[3]!, 10);
  return { element, scale, power };
}

function parseHits(desc: string): number {
  const m = desc.match(/x\s*(\d+)(?:[～~]\d+)?\s*hits/i);
  if (m) return parseInt(m[1]!, 10);
  return 1;
}

function parseAccuracy(desc: string): number | undefined {
  const alwaysMatch = /always\s+hits/i.exec(desc);
  if (alwaysMatch) return 100;
  const m = desc.match(/(\d+)%\s*ACU/i);
  if (m) return parseInt(m[1]!, 10);
  return undefined;
}

function parseCrit(desc: string): number | undefined {
  const m = desc.match(/(\d+)%\s*CRT\s*Rate/i);
  if (m) return parseInt(m[1]!, 10);
  return undefined;
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
    // Strict: no element, accuracy, or crit fields
    if (a.element !== undefined) return false;
    if (a.accuracy !== undefined) return false;
    if (a.crit !== undefined) return false;
    return true;
  } catch {
    return false;
  }
}

function buildActionsFromDescription(
  desc: string,
  fallbackElement: string,
  fallbackPower: number,
): Action[] {
  const target = (targetFromPrefix(desc) ?? 'primary_target') as Target;
  const { element, scale, power } = parseElementScalePower(desc, fallbackElement, fallbackPower);
  const hits = parseHits(desc);
  const accuracy = parseAccuracy(desc);
  const crit = parseCrit(desc);

  const actions: Action[] = [];
  for (let i = 0; i < hits; i++) {
    const action: Action = {
      kind: 'deal_damage' as const,
      target,
      amount: { base: power, scale: scale as ScaleStat, factor: 1.0 },
      element: element as (typeof ELEMENTS)[number] | undefined,
    };
    if (accuracy !== undefined) (action as any).accuracy = accuracy;
    if (crit !== undefined) (action as any).crit = crit;
    actions.push(action);
  }
  return actions;
}

// ---------------------------------------------------------------------------
// End converter.
// ---------------------------------------------------------------------------

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

  // Load existing rows once so we can upgrade legacy placeholder rows
  // without touching admin-tuned ones.
  const existingRows = await q<{ name: string; actions_json: string | null }>(
    'SELECT name, actions_json FROM skills_catalog',
  );
  const existingByName = new Map(existingRows.map((r) => [r.name, r.actions_json]));

  const tagsJson = stringifyTags([]);
  let inserted = 0;
  let upgraded = 0;

  for (const [name, data] of seen) {
    const actions = buildActionsFromDescription(data.description, data.element, data.power);
    const actionsJson = stringifyActions(actions);
    const currentActions = existingByName.get(name);

    if (currentActions !== undefined && isLegacyPlaceholder(currentActions, data.power)) {
      // Upgrade this placeholder row with the new structured actions + element.
      // Preserve any other columns (description, energy_cost, etc. already match).
      await run(
        `UPDATE skills_catalog SET actions_json = ?, element = ?, updated_at = ? WHERE name = ?`,
        actionsJson, data.element, now, name,
      );
      upgraded += 1;
      continue;
    }

    // Insert new row (ON CONFLICT DO NOTHING preserves any admin-tuned row).
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
  log.info('skills.catalog.seed.ok', { uniqueXmlSkills: seen.size, insertedRows: inserted, upgradedRows: upgraded });
}
