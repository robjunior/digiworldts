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
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { config } from '../config.js';
import { log } from '../util/log.js';
import {
  ATTRIBUTES,
  AILMENTS,
  CONTENT_STATUSES,
  ELEMENTS,
  STAGES,
  type Attribute,
  type Catalog,
  type ContentStatus,
  type Element,
  type EvolveEdge,
  type ResistanceMap,
  type ResistanceMult,
  type Skill,
  type SkillEffect,
  type TemplateDigimon,
} from './types.js';

export type { Catalog, TemplateDigimon, Skill, EvolveEdge, SkillEffect };

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
  '@_vfxPresetId': z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i).optional(),
  effect: SkillEffectZ.optional(),
});

const SkillsZ = z.union([
  z.object({ skill: z.union([SkillZ, z.array(SkillZ)]) }),
  z.object({}).strict(),
]);

const EvolveEntryZ = z.object({
  '@_targetId': z.string().min(1),
  '@_requiredLevel': z.coerce.number().int().nonnegative().optional(),
  '@_requiredMood': z.coerce.number().int().min(0).max(100).optional(),
  '@_requiredAttribute': z.enum(ATTRIBUTES).optional(),
  '@_requiredItemId': z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'requiredItemId must be alphanumeric with -_').optional(),
  '@_requiredItemQty': z.coerce.number().int().min(1).max(999).optional(),
});

const EvolutionsZ = z.union([
  z.object({ evolve: z.union([EvolveEntryZ, z.array(EvolveEntryZ)]) }),
  z.object({}).strict(),
]);

const RESISTANCE_MULTS = [0, 0.5, 1, 1.5, 2] as const;

const ResistanceEntryZ = z.object({
  '@_element': z.enum(ELEMENTS),
  '@_mult': z.coerce.number().refine((v): v is ResistanceMult => (RESISTANCE_MULTS as readonly number[]).includes(v), {
    message: `mult must be one of ${RESISTANCE_MULTS.join(', ')}`,
  }),
});

const ResistancesZ = z.union([
  z.object({ r: z.union([ResistanceEntryZ, z.array(ResistanceEntryZ)]) }),
  z.object({}).strict(),
]);

const DigimonZ = z.object({
  // Path-safe id: catalog ids feed `resolve(assetsDir, catalogId)` at boot; a
  // `../` id escapes the assets root and enables arbitrary directory writes.
  // Restrict to lowercase-alnum + `_` + `-` (matches admin/routes.ts custom
  // route regex) so no XML entry can carry a traversal payload.
  '@_id': z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'id must contain only letters, numbers, underscore, hyphen'),
  '@_name': z.string().min(1),
  '@_stage': z.enum(STAGES),
  '@_attribute': z.enum(ATTRIBUTES),
  '@_element': z.enum(ELEMENTS),
  '@_type': z.string().min(1).max(64).optional(),
  '@_wikimonSlug': z.string().optional(),
  // sourceUrl is rendered as `<a href={template.sourceUrl}>` in the admin
  // catalog table — a `javascript:` URI would fire on admin click. Force
  // http(s) scheme so import/XML paths can't smuggle a JS URI past the
  // custom-route regex.
  '@_sourceUrl': z.string().url().regex(/^https?:\/\//i, 'sourceUrl must use http(s) scheme').optional(),
  '@_signatureSkillId': z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i).optional(),
  // Content lifecycle status. Absent on legacy XML ⇒ treated as 'published'
  // (backward compat — existing catalogs predate the attribute entirely).
  '@_status': z.enum(CONTENT_STATUSES).optional(),
  assets: AssetsZ,
  stats: StatsZ,
  resistances: ResistancesZ.optional(),
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
    return p === 'catalog.digimon' || p.endsWith('.skills.skill') || p.endsWith('.evolutions.evolve') || p.endsWith('.resistances.r');
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
  if (raw['@_vfxPresetId']) skill.vfxPresetId = raw['@_vfxPresetId'];
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
  if (raw['@_type']) tpl.type = raw['@_type'];
  if (raw['@_signatureSkillId']) tpl.signatureSkillId = raw['@_signatureSkillId'];
  if (raw['@_status']) tpl.status = raw['@_status'] as ContentStatus;
  if (raw.evolutions && 'evolve' in raw.evolutions) {
    const list = Array.isArray(raw.evolutions.evolve) ? raw.evolutions.evolve : [raw.evolutions.evolve];
    const edges: EvolveEdge[] = list.map((e) => {
      const edge: EvolveEdge = { targetId: e['@_targetId'] };
      if (e['@_requiredLevel'] !== undefined) edge.requiredLevel = e['@_requiredLevel'];
      if (e['@_requiredMood'] !== undefined) edge.requiredMood = e['@_requiredMood'];
      if (e['@_requiredAttribute'] !== undefined) edge.requiredAttribute = e['@_requiredAttribute'] as Attribute;
      if (e['@_requiredItemId'] !== undefined) {
        edge.requiredItemId = e['@_requiredItemId'];
        edge.requiredItemQty = e['@_requiredItemQty'] ?? 1;
      }
      return edge;
    });
    if (edges.length > 0) tpl.evolvesInto = edges;
  }
  if (raw.resistances && 'r' in raw.resistances) {
    const list = Array.isArray(raw.resistances.r) ? raw.resistances.r : [raw.resistances.r];
    if (list.length > 0) {
      const map: ResistanceMap = {};
      for (const r of list) {
        map[r['@_element'] as Element] = r['@_mult'] as ResistanceMult;
      }
      tpl.resistances = map;
    }
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
  if (s.vfxPresetId) out['@_vfxPresetId'] = s.vfxPresetId;
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
  if (t.type) out['@_type'] = t.type;
  if (t.signatureSkillId) out['@_signatureSkillId'] = t.signatureSkillId;
  if (t.status) out['@_status'] = t.status;
  if (t.evolvesInto && t.evolvesInto.length > 0) {
    out.evolutions = {
      evolve: t.evolvesInto.map((edge) => {
        const attrs: Record<string, unknown> = { '@_targetId': edge.targetId };
        if (edge.requiredLevel !== undefined) attrs['@_requiredLevel'] = edge.requiredLevel;
        if (edge.requiredMood !== undefined) attrs['@_requiredMood'] = edge.requiredMood;
        if (edge.requiredAttribute !== undefined) attrs['@_requiredAttribute'] = edge.requiredAttribute;
        if (edge.requiredItemId !== undefined) {
          attrs['@_requiredItemId'] = edge.requiredItemId;
          attrs['@_requiredItemQty'] = edge.requiredItemQty ?? 1;
        }
        return attrs;
      }),
    };
  }
  if (t.resistances) {
    const entries = Object.entries(t.resistances);
    if (entries.length > 0) {
      out.resistances = { r: entries.map(([element, mult]) => ({ '@_element': element, '@_mult': mult })) };
    }
  }
  return out;
}

const MAX_CATALOG_BYTES = 10 * 1024 * 1024;

/**
 * Load the catalog from disk. Returns an EMPTY catalog if the file does not
 * exist yet (fresh install) rather than throwing — the admin seeds it later.
 * Any parse or Zod error is thrown with a readable prefix.
 *
 * Default returns ALL digimons — lookup-by-id callers (roster, evolve,
 * battle) must still resolve templates for owned draft Digimons. Pass
 * `{ publishedOnly: true }` only for player-facing LIST endpoints.
 */
export function loadCatalog(opts?: { publishedOnly?: boolean }): Catalog {
  const path = config.paths.catalogXml;
  if (!existsSync(path)) {
    log.info('catalog.load.missing', { path });
    return { version: '1', updatedAt: 0, digimons: [] };
  }
  const st = statSync(path);
  if (st.size > MAX_CATALOG_BYTES) {
    throw new Error(`catalog XML too large at ${path}: ${st.size} bytes (max ${MAX_CATALOG_BYTES}) — refusing to parse to prevent boot OOM`);
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
  let digimons = arr.map(toTemplate);
  if (opts?.publishedOnly) {
    digimons = digimons.filter((t) => (t.status ?? 'published') !== 'draft');
  }
  const catalog: Catalog = {
    version: check.data.catalog['@_version'],
    updatedAt: check.data.catalog['@_updatedAt'],
    digimons,
  };
  log.info('catalog.load.ok', { path, count: catalog.digimons.length, publishedOnly: opts?.publishedOnly ?? false });
  return catalog;
}

// Monotonic counter for temp filename uniqueness within a single process —
// avoids collisions when saveCatalog is called twice in the same millisecond.
let saveCatalogCounter = 0;

/**
 * Persist the catalog with a real atomic write: write to a unique temp file
 * in the same directory, then rename(2) it over the target path.
 *
 * On POSIX, rename(2) is atomic — a reader sees either the old file or the
 * new one, never a partial write. The per-invocation unique temp name (PID
 * + timestamp + monotonic counter) prevents concurrent writers on the same
 * volume (e.g. multi-process multinode deploys) from clobbering each
 * other's temp files mid-write. On failure the temp is best-effort deleted
 * and the error re-thrown so callers can react.
 */
export function saveCatalog(catalog: Catalog): void {
  const path = config.paths.catalogXml;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.${saveCatalogCounter++}.tmp`;
  const root = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    catalog: {
      '@_version': catalog.version,
      '@_updatedAt': catalog.updatedAt || Date.now(),
      digimon: catalog.digimons.map(fromTemplate),
    },
  };
  const xml = builder.build(root);
  try {
    writeFileSync(tmp, xml, 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch {}
    throw err;
  }
  log.info('catalog.save.ok', { path, count: catalog.digimons.length });
}

/**
 * Parse a raw XML catalog string into a Catalog object.
 * Does not read from disk — useful for validating artifact assets.
 */
export function parseCatalogXml(raw: string, opts?: { publishedOnly?: boolean }): Catalog {
  let parsed: unknown;
  try {
    parsed = parser.parse(raw);
  } catch (err) {
    throw new Error(`catalog XML parse error: ${err instanceof Error ? err.message : String(err)}`);
  }
  const check = RootZ.safeParse(parsed);
  if (!check.success) {
    const detail = check.error.issues
      .slice(0, 6)
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`catalog XML failed validation:\n${detail}`);
  }
  const list = check.data.catalog.digimon ?? [];
  const arr = Array.isArray(list) ? list : [list];
  let digimons = arr.map(toTemplate);
  if (opts?.publishedOnly) {
    digimons = digimons.filter((t) => (t.status ?? 'published') !== 'draft');
  }
  return {
    version: check.data.catalog['@_version'],
    updatedAt: check.data.catalog['@_updatedAt'],
    digimons,
  };
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
const templateIndex = new WeakMap<Catalog, Map<string, TemplateDigimon>>();
export function findTemplate(catalog: Catalog, id: string): TemplateDigimon | undefined {
  let index = templateIndex.get(catalog);
  if (index === undefined) {
    index = new Map<string, TemplateDigimon>();
    for (const t of catalog.digimons) index.set(t.id, t);
    templateIndex.set(catalog, index);
  }
  return index.get(id);
}
