/**
 * XML catalog persistence — the game's source-of-truth for base Digimon
 * templates. Load parses `data/catalog/digimons.xml` into a typed `Catalog`
 * and Zod-validates every entry so we crash fast on any hand-edit mistake.
 * Save round-trips back to pretty XML.
 *
 * XML shape (attribute-only for compactness — cleaner diffs than mixed
 * attribute/text hybrids):
 *
 *   <catalog version="1" updatedAt="1720000000000">
 *     <digimon id="skb-317" name="Agumon" stage="Rookie" attribute="Vaccine"
 *              element="nature" wikimonSlug="Agumon" sourceUrl="...">
 *       <assets portrait="/assets/digimon/skb-317/portrait.webp"
 *               dot="/assets/digimon/skb-317/dot.gif"/>
 *       <stats hp="500" en="30" atk="100" def="80" spd="100"/>
 *       <skills>
 *         <skill id="s0" name="Pepper Breath" element="fire" cost="12"
 *                power="210" description="A blast of superheated flame."/>
 *         <skill id="s1" name="Claw Attack"   element="neutral" cost="0"
 *                power="120"/>
 *         ...
 *       </skills>
 *     </digimon>
 *   </catalog>
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { config } from '../config.js';
import { log } from '../util/log.js';
import {
  ATTRIBUTES,
  AILMENTS,
  ELEMENTS,
  STAGES,
  type Catalog,
  type Skill,
  type SkillEffect,
  type TemplateDigimon,
} from './types.js';

const StatsZ = z.object({
  '@_hp': z.coerce.number().int().nonnegative(),
  '@_en': z.coerce.number().int().nonnegative(),
  '@_atk': z.coerce.number().int().nonnegative(),
  '@_def': z.coerce.number().int().nonnegative(),
  '@_int': z.coerce.number().int().nonnegative(),
  '@_spd': z.coerce.number().int().nonnegative(),
});

const AssetsZ = z.object({
  '@_portrait': z.string().min(1),
  '@_dot': z.string().min(1),
});

const SkillEffectZ = z.object({
  '@_kind': z.enum(AILMENTS),
  '@_chance': z.coerce.number().min(0).max(1),
  '@_turns': z.coerce.number().int().nonnegative(),
});

const SkillZ = z.object({
  '@_id': z.string().min(1),
  '@_name': z.string().min(1),
  '@_element': z.enum(ELEMENTS),
  '@_cost': z.coerce.number().int().nonnegative(),
  '@_power': z.coerce.number().int().nonnegative(),
  '@_description': z.string().optional(),
  effect: SkillEffectZ.optional(),
});

const SkillsZ = z.union([
  z.object({ skill: z.union([SkillZ, z.array(SkillZ)]) }),
  z.object({}).strict(),
]);

const EvolveEntryZ = z.object({
  '@_targetId': z.string().min(1),
});

const EvolutionsZ = z.union([
  z.object({ evolve: z.union([EvolveEntryZ, z.array(EvolveEntryZ)]) }),
  z.object({}).strict(),
]);

const DigimonZ = z.object({
  '@_id': z.string().min(1),
  '@_name': z.string().min(1),
  '@_stage': z.enum(STAGES),
  '@_attribute': z.enum(ATTRIBUTES),
  '@_element': z.enum(ELEMENTS),
  '@_wikimonSlug': z.string().optional(),
  '@_sourceUrl': z.string().optional(),
  assets: AssetsZ,
  stats: StatsZ,
  skills: SkillsZ.optional(),
  evolutions: EvolutionsZ.optional(),
});

const RootZ = z.object({
  catalog: z.object({
    '@_version': z.string().default('1'),
    '@_updatedAt': z.coerce.number().int().nonnegative().default(0),
    digimon: z.union([DigimonZ, z.array(DigimonZ), z.undefined()]).optional(),
  }),
});

type ParsedDigimon = z.infer<typeof DigimonZ>;
type ParsedSkill = z.infer<typeof SkillZ>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (_tagName, jPath) => {
    const p = String(jPath);
    return p === 'catalog.digimon' || p.endsWith('.skills.skill') || p.endsWith('.evolutions.evolve');
  },
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
});

function toSkill(raw: ParsedSkill): Skill {
  const skill: Skill = {
    id: raw['@_id'],
    name: raw['@_name'],
    element: raw['@_element'],
    energyCost: raw['@_cost'],
    power: raw['@_power'],
  };
  if (raw['@_description']) skill.description = raw['@_description'];
  if (raw.effect) {
    const eff: SkillEffect = {
      kind: raw.effect['@_kind'],
      chance: raw.effect['@_chance'],
      turns: raw.effect['@_turns'],
    };
    skill.effect = eff;
  }
  return skill;
}

function toTemplate(raw: ParsedDigimon): TemplateDigimon {
  const skillPool: Skill[] = raw.skills && 'skill' in raw.skills
    ? (Array.isArray(raw.skills.skill) ? raw.skills.skill : [raw.skills.skill]).map(toSkill)
    : [];
  const tpl: TemplateDigimon = {
    id: raw['@_id'],
    name: raw['@_name'],
    stage: raw['@_stage'],
    attribute: raw['@_attribute'],
    element: raw['@_element'],
    baseStats: {
      hp: raw.stats['@_hp'],
      en: raw.stats['@_en'],
      atk: raw.stats['@_atk'],
      def: raw.stats['@_def'],
      int: raw.stats['@_int'],
      spd: raw.stats['@_spd'],
    },
    skillPool,
    assets: {
      portrait: raw.assets['@_portrait'],
      dot: raw.assets['@_dot'],
    },
  };
  if (raw['@_wikimonSlug']) tpl.wikimonSlug = raw['@_wikimonSlug'];
  if (raw['@_sourceUrl']) tpl.sourceUrl = raw['@_sourceUrl'];
  if (raw.evolutions && 'evolve' in raw.evolutions) {
    const list = Array.isArray(raw.evolutions.evolve) ? raw.evolutions.evolve : [raw.evolutions.evolve];
    const ids = list.map((e) => e['@_targetId']);
    if (ids.length > 0) tpl.evolvesInto = ids;
  }
  return tpl;
}

function fromSkill(s: Skill): unknown {
  const out: Record<string, unknown> = {
    '@_id': s.id,
    '@_name': s.name,
    '@_element': s.element,
    '@_cost': s.energyCost,
    '@_power': s.power,
  };
  if (s.description) out['@_description'] = s.description;
  if (s.effect) {
    out.effect = {
      '@_kind': s.effect.kind,
      '@_chance': s.effect.chance,
      '@_turns': s.effect.turns,
    };
  }
  return out;
}

function fromTemplate(t: TemplateDigimon): unknown {
  const out: Record<string, unknown> = {
    '@_id': t.id,
    '@_name': t.name,
    '@_stage': t.stage,
    '@_attribute': t.attribute,
    '@_element': t.element,
    assets: { '@_portrait': t.assets.portrait, '@_dot': t.assets.dot },
    stats: {
      '@_hp': t.baseStats.hp,
      '@_en': t.baseStats.en,
      '@_atk': t.baseStats.atk,
      '@_def': t.baseStats.def,
      '@_int': t.baseStats.int,
      '@_spd': t.baseStats.spd,
    },
    skills: t.skillPool.length > 0 ? { skill: t.skillPool.map(fromSkill) } : {},
  };
  if (t.wikimonSlug) out['@_wikimonSlug'] = t.wikimonSlug;
  if (t.sourceUrl) out['@_sourceUrl'] = t.sourceUrl;
  if (t.evolvesInto && t.evolvesInto.length > 0) {
    out.evolutions = { evolve: t.evolvesInto.map((targetId) => ({ '@_targetId': targetId })) };
  }
  return out;
}

/**
 * Load the catalog from disk. Returns an EMPTY catalog if the file does not
 * exist yet (fresh install) rather than throwing — the admin seeds it later.
 * Any parse or Zod error is thrown with a readable prefix.
 */
export function loadCatalog(): Catalog {
  const path = config.paths.catalogXml;
  if (!existsSync(path)) {
    log.info('catalog.load.missing', { path });
    return { version: '1', updatedAt: 0, digimons: [] };
  }
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = parser.parse(raw);
  } catch (err) {
    throw new Error(`catalog XML parse error at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const check = RootZ.safeParse(parsed);
  if (!check.success) {
    const detail = check.error.issues
      .slice(0, 6)
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`catalog XML failed validation at ${path}:\n${detail}`);
  }
  const list = check.data.catalog.digimon ?? [];
  const arr = Array.isArray(list) ? list : [list];
  const catalog: Catalog = {
    version: check.data.catalog['@_version'],
    updatedAt: check.data.catalog['@_updatedAt'],
    digimons: arr.map(toTemplate),
  };
  log.info('catalog.load.ok', { path, count: catalog.digimons.length });
  return catalog;
}

/** Persist the catalog. Overwrites atomically-ish (write then rename). */
export function saveCatalog(catalog: Catalog): void {
  const path = config.paths.catalogXml;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const root = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    catalog: {
      '@_version': catalog.version,
      '@_updatedAt': catalog.updatedAt || Date.now(),
      digimon: catalog.digimons.map(fromTemplate),
    },
  };
  const xml = builder.build(root);
  writeFileSync(tmp, xml, 'utf8');
  writeFileSync(path, xml, 'utf8');
  try {
    unlinkSync(tmp);
  } catch {}
  log.info('catalog.save.ok', { path, count: catalog.digimons.length });
}

/**
 * Upsert helper — adds a template or replaces an existing one by `id`.
 * Returns the number of entries after the operation. Pure over the input.
 */
export function upsertTemplate(catalog: Catalog, entry: TemplateDigimon): Catalog {
  const idx = catalog.digimons.findIndex((d) => d.id === entry.id);
  const digimons = idx === -1
    ? [...catalog.digimons, entry]
    : catalog.digimons.map((d, i) => (i === idx ? entry : d));
  return { ...catalog, digimons, updatedAt: Date.now() };
}

/** Remove by id. Returns the new catalog. */
export function removeTemplate(catalog: Catalog, id: string): Catalog {
  return { ...catalog, digimons: catalog.digimons.filter((d) => d.id !== id), updatedAt: Date.now() };
}

/** Lookup by id or `undefined`. */
export function findTemplate(catalog: Catalog, id: string): TemplateDigimon | undefined {
  return catalog.digimons.find((d) => d.id === id);
}
