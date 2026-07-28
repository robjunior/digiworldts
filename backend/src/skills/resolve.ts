/**
 * Resolves a Digimon's XML-embedded skills against the admin-editable
 * `skills_catalog` DB table. Match key = case-insensitive trimmed skill name.
 *
 * When a match exists, the catalog row wins on: element, energyCost, power
 * (extracted from actions_json's deal_damage.amount.base), description, and
 * display name. If no match, the XML skill is returned untouched so existing
 * mons keep fighting even before their skills are curated into the catalog.
 *
 * Cached in memory with a 30s TTL. Admin skill CRUD calls
 * `invalidateSkillsCatalogResolver()` so edits show up immediately.
 */
import { q } from '../db/index.js';
import type { Element, Skill } from '../digimon/types.js';

type SkillsCatalogRow = {
  readonly name: string;
  readonly element: string;
  readonly energy_cost: number;
  readonly actions_json: string;
  readonly description: string | null;
};

type ResolvedOverride = {
  readonly name: string;
  readonly element: Element;
  readonly energyCost: number;
  readonly power: number;
  readonly description: string | null;
};

export type SkillsCatalogResolver = ReadonlyMap<string, ResolvedOverride>;

const TTL_MS = 30_000;
const SQL_LOAD = `SELECT name, element, energy_cost, actions_json, description FROM skills_catalog WHERE enabled = 1`;

let cache: { readonly at: number; readonly map: SkillsCatalogResolver } | null = null;

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function extractPowerFromActionsJson(json: string | null): number {
  if (json === null || json === '') return 0;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return 0;
    for (const action of parsed) {
      if (typeof action !== 'object' || action === null) continue;
      const kind = (action as { kind?: unknown }).kind;
      if (kind !== 'deal_damage') continue;
      const amount = (action as { amount?: unknown }).amount;
      if (typeof amount !== 'object' || amount === null) continue;
      const base = (amount as { base?: unknown }).base;
      if (typeof base === 'number' && Number.isFinite(base)) return base;
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function getSkillsCatalogResolver(): Promise<SkillsCatalogResolver> {
  const now = Date.now();
  if (cache !== null && now - cache.at < TTL_MS) return cache.map;
  const rows = await q<SkillsCatalogRow>(SQL_LOAD);
  const map = new Map<string, ResolvedOverride>();
  for (const row of rows) {
    const key = normalizeName(row.name);
    if (map.has(key)) continue;
    map.set(key, {
      name: row.name,
      element: row.element as Element,
      energyCost: row.energy_cost,
      power: extractPowerFromActionsJson(row.actions_json),
      description: row.description,
    });
  }
  cache = { at: now, map };
  return map;
}

export function invalidateSkillsCatalogResolver(): void {
  cache = null;
}

export function resolveSkillFromCatalog(xmlSkill: Skill, resolver: SkillsCatalogResolver): Skill {
  const override = resolver.get(normalizeName(xmlSkill.name));
  if (override === undefined) return xmlSkill;
  const description = override.description ?? xmlSkill.description;
  const resolved: Skill = {
    id: xmlSkill.id,
    name: override.name,
    element: override.element,
    energyCost: override.energyCost,
    power: override.power,
  };
  if (description !== undefined && description !== null) resolved.description = description;
  if (xmlSkill.effect !== undefined) resolved.effect = xmlSkill.effect;
  if (xmlSkill.actions !== undefined) resolved.actions = xmlSkill.actions;
  return resolved;
}
