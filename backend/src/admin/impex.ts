/**
 * Admin import/export engine.
 *
 * Exports a Manifest = { version, exportedAt, entities: {items?, blueprints?, catalog?, scraped?} }
 * as a serializable JSON blob. Import validates the manifest via Zod, then
 * upserts each entity by ID (MERGE semantics: existing ids get UPDATED, new
 * ids get INSERTED). Unrelated rows are never touched.
 *
 *   Excluded on purpose: user data (users, player_roster, player_wallet,
 *   player_inventory, sessions, matches, pending_buffs, resources,
 *   farm_buildings, training_sessions). Those are player-owned and must
 *   not be clobbered by admin content restore.
 *
 * Skills catalog: not yet in scope this ship (Skills Editor Phase 1 comes next).
 */
import { z } from 'zod';
import { one, q, run, type ScrapedRow } from '../db/index.js';
import { log } from '../util/log.js';
import { loadCatalog, saveCatalog } from '../digimon/xml.js';
import type { Catalog, Element, EvolveEdge, ResistanceMap, TemplateDigimon } from '../digimon/types.js';
import { AILMENTS, ATTRIBUTES, ELEMENTS, MAX_ENERGY, SKILLS_PER_DIGIMON, STAGES } from '../digimon/types.js';

export type ImpexScope = 'all' | 'items' | 'blueprints' | 'catalog' | 'scraped';

const MANIFEST_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Shop item shape (mirrors shop_items table columns 1:1 for round-tripping)
// ---------------------------------------------------------------------------
const ShopItemManifestSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  description: z.string().max(400).default(''),
  price_credits: z.number().int().min(0),
  kind: z.string().min(1).max(32),
  payload: z.string().max(4000).default('{}'),
  enabled: z.union([z.literal(0), z.literal(1)]).default(1),
  created_at: z.number().int().optional(),
});
type ShopItemManifest = z.infer<typeof ShopItemManifestSchema>;

// ---------------------------------------------------------------------------
// Blueprint shape (denormalized from BlueprintView; keys use snake_case for DB)
// ---------------------------------------------------------------------------
const BlueprintManifestSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(48),
  description: z.string().max(240).default(''),
  building_type: z.enum(['resource_generator', 'training', 'training_premium']),
  resource: z.enum(['Meat', 'Bits', 'Data']).nullable().default(null),
  rate_per_hour: z.number().int().min(0).default(0),
  capacity: z.number().int().min(0).default(0),
  upgrade_cost: z.number().int().min(1).default(500),
  starter_seed: z.union([z.literal(0), z.literal(1)]).default(0),
  shop_price: z.number().int().min(1).nullable().default(null),
  enabled: z.union([z.literal(0), z.literal(1)]).default(1),
  created_at: z.number().int().optional(),
});
type BlueprintManifest = z.infer<typeof BlueprintManifestSchema>;

// ---------------------------------------------------------------------------
// Scraped catalog row (mirrors scraped_catalog columns)
// ---------------------------------------------------------------------------
const ScrapedManifestSchema = z.object({
  skullbot_id: z.number().int().positive(),
  name: z.string().min(1),
  stage: z.string().min(1),
  attribute: z.string().min(1),
  portrait_url: z.string().min(1),
  dot_url: z.string().min(1),
  wikimon_slug: z.string().nullable().default(null),
  raw_json: z.string().default('{}'),
  scraped_at: z.number().int().optional(),
  in_catalog: z.union([z.literal(0), z.literal(1)]).default(0),
});
type ScrapedManifest = z.infer<typeof ScrapedManifestSchema>;

// ---------------------------------------------------------------------------
// Catalog manifest.
//
// SECURITY: previously used `z.array(z.record(z.string(), z.unknown()))` here
// and deferred validation to the next boot's `loadCatalog()`. That let a
// hostile admin persist a Zod-invalid or path-traversal payload (id "../x"
// / sourceUrl "javascript:…" / assets URLs pointing at internal hosts) into
// `digimons.xml`; on next restart `loadCatalog` threw and the process died,
// or the verifier fetched attacker URLs. Every entry is now validated with
// the SAME strict schema the /custom + PUT admin routes use, so the import
// path can't smuggle unvalidated shapes to disk.
// ---------------------------------------------------------------------------
const ManifestSkillSchema = z.object({
  id: z.string().min(1).max(24),
  name: z.string().trim().min(1).max(48),
  element: z.enum(ELEMENTS),
  energyCost: z.number().int().min(0).max(MAX_ENERGY),
  power: z.number().int().min(0).max(9_999),
  description: z.string().max(400).optional(),
  effect: z
    .object({
      kind: z.enum(AILMENTS),
      chance: z.number().min(0).max(1),
      turns: z.number().int().min(1).max(9),
    })
    .optional(),
});

const ManifestStatsSchema = z.object({
  hp: z.number().int().min(1).max(99_999),
  en: z.number().int().min(1).max(MAX_ENERGY),
  atk: z.number().int().min(1).max(9_999),
  def: z.number().int().min(1).max(9_999),
  int: z.number().int().min(1).max(9_999),
  spd: z.number().int().min(1).max(9_999),
});

const ManifestAssetsSchema = z.object({
  portrait: z.string().min(1).max(400),
  dot: z.string().min(1).max(400),
});

const ManifestEvolveEdgeSchema = z.object({
  targetId: z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/i),
  requiredLevel: z.number().int().min(0).max(999).optional(),
  requiredMood: z.number().int().min(0).max(100).optional(),
  requiredAttribute: z.enum(ATTRIBUTES).optional(),
});

const ManifestResistanceMultZ = z.union([z.literal(0), z.literal(0.5), z.literal(1), z.literal(1.5), z.literal(2)]);
const ManifestResistanceMapSchema = z.object({
  fire: ManifestResistanceMultZ,
  water: ManifestResistanceMultZ,
  plant: ManifestResistanceMultZ,
  ice: ManifestResistanceMultZ,
  electricity: ManifestResistanceMultZ,
  earth: ManifestResistanceMultZ,
  steel: ManifestResistanceMultZ,
  wind: ManifestResistanceMultZ,
  light: ManifestResistanceMultZ,
  dark: ManifestResistanceMultZ,
  null: ManifestResistanceMultZ,
}).partial();

const ManifestTemplateSchema = z.object({
  id: z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/i, 'id must be alphanumeric with -_'),
  name: z.string().trim().min(1).max(48),
  stage: z.enum(STAGES),
  attribute: z.enum(ATTRIBUTES),
  element: z.enum(ELEMENTS),
  type: z.string().min(1).max(64).optional(),
  baseStats: ManifestStatsSchema,
  skillPool: z.array(ManifestSkillSchema).min(1).max(SKILLS_PER_DIGIMON),
  assets: ManifestAssetsSchema,
  sourceUrl: z.string().url().regex(/^https?:\/\//i, 'sourceUrl must use http(s) scheme').optional(),
  wikimonSlug: z.string().max(64).optional(),
  evolvesInto: z.array(ManifestEvolveEdgeSchema).max(24).optional(),
  resistances: ManifestResistanceMapSchema.optional(),
});
type ManifestTemplate = z.infer<typeof ManifestTemplateSchema>;

const CatalogManifestSchema = z.object({
  version: z.string(),
  updatedAt: z.number().int(),
  digimons: z.array(ManifestTemplateSchema),
});

function toStrictManifestTemplate(raw: ManifestTemplate): TemplateDigimon {
  const skillPool = raw.skillPool.map((skill) => {
    const out: TemplateDigimon['skillPool'][number] = {
      id: skill.id,
      name: skill.name,
      element: skill.element,
      energyCost: skill.energyCost,
      power: skill.power,
    };
    if (skill.description !== undefined) out.description = skill.description;
    if (skill.effect !== undefined) out.effect = skill.effect;
    return out;
  });
  const tpl: TemplateDigimon = {
    id: raw.id,
    name: raw.name,
    stage: raw.stage,
    attribute: raw.attribute,
    element: raw.element,
    baseStats: raw.baseStats,
    skillPool,
    assets: raw.assets,
  };
  if (raw.type !== undefined) tpl.type = raw.type;
  if (raw.sourceUrl !== undefined) tpl.sourceUrl = raw.sourceUrl;
  if (raw.wikimonSlug !== undefined) tpl.wikimonSlug = raw.wikimonSlug;
  if (raw.evolvesInto !== undefined && raw.evolvesInto.length > 0) {
    tpl.evolvesInto = raw.evolvesInto.map((edge) => {
      const out: EvolveEdge = { targetId: edge.targetId };
      if (edge.requiredLevel !== undefined) out.requiredLevel = edge.requiredLevel;
      if (edge.requiredMood !== undefined) out.requiredMood = edge.requiredMood;
      if (edge.requiredAttribute !== undefined) out.requiredAttribute = edge.requiredAttribute;
      return out;
    });
  }
  if (raw.resistances !== undefined && Object.keys(raw.resistances).length > 0) {
    const map: ResistanceMap = {};
    for (const [el, mult] of Object.entries(raw.resistances)) {
      if (mult !== undefined) map[el as Element] = mult;
    }
    tpl.resistances = map;
  }
  return tpl;
}

// ---------------------------------------------------------------------------
// Top-level manifest
// ---------------------------------------------------------------------------
const ManifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  exportedAt: z.number().int(),
  entities: z.object({
    items: z.array(ShopItemManifestSchema).optional(),
    blueprints: z.array(BlueprintManifestSchema).optional(),
    catalog: CatalogManifestSchema.optional(),
    scraped: z.array(ScrapedManifestSchema).optional(),
  }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// ===========================================================================
// Build manifest (export)
// ===========================================================================
export async function buildManifest(scope: ImpexScope): Promise<Manifest> {
  const want = (kind: ImpexScope): boolean => scope === 'all' || scope === kind;
  const entities: Manifest['entities'] = {};

  if (want('items')) {
    const rows = await q<ShopItemManifest>('SELECT id, name, description, price_credits, kind, payload, enabled, created_at FROM shop_items ORDER BY price_credits');
    entities.items = rows;
  }

  if (want('blueprints')) {
    const rows = await q<BlueprintManifest>('SELECT id, name, description, building_type, resource, rate_per_hour, capacity, upgrade_cost, starter_seed, shop_price, enabled, created_at FROM building_blueprints ORDER BY building_type, name');
    entities.blueprints = rows;
  }

  if (want('catalog')) {
    const cat = loadCatalog();
    entities.catalog = {
      version: cat.version,
      updatedAt: cat.updatedAt,
      digimons: cat.digimons as unknown as ManifestTemplate[],
    };
  }

  if (want('scraped')) {
    const rows = await q<ScrapedManifest>('SELECT skullbot_id, name, stage, attribute, portrait_url, dot_url, wikimon_slug, raw_json, scraped_at, in_catalog FROM scraped_catalog ORDER BY skullbot_id');
    entities.scraped = rows;
  }

  return { version: MANIFEST_VERSION, exportedAt: Date.now(), entities };
}

// ===========================================================================
// Apply manifest (import)
// ===========================================================================
export type ApplySummary = {
  items?: EntityResult;
  blueprints?: EntityResult;
  catalog?: { created: number; updated: number; unchanged: number };
  scraped?: EntityResult;
};

type EntityResult = { created: number; updated: number; skipped: number; errors: string[] };

const SQL_UPSERT_ITEM = `INSERT INTO shop_items (id, name, description, price_credits, kind, payload, enabled, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    price_credits = excluded.price_credits,
    kind = excluded.kind,
    payload = excluded.payload,
    enabled = excluded.enabled`;

const SQL_ITEM_EXISTS = `SELECT id FROM shop_items WHERE id = ?`;
const SQL_BLUEPRINT_EXISTS = `SELECT id FROM building_blueprints WHERE id = ?`;
const SQL_BLUEPRINT_BY_NAME = `SELECT id FROM building_blueprints WHERE name = ? AND id != ?`;

const SQL_UPSERT_BLUEPRINT = `INSERT INTO building_blueprints (id, name, description, building_type, resource, rate_per_hour, capacity, upgrade_cost, starter_seed, shop_price, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    building_type = excluded.building_type,
    resource = excluded.resource,
    rate_per_hour = excluded.rate_per_hour,
    capacity = excluded.capacity,
    upgrade_cost = excluded.upgrade_cost,
    starter_seed = excluded.starter_seed,
    shop_price = excluded.shop_price,
    enabled = excluded.enabled,
    updated_at = excluded.updated_at`;

const SQL_UPSERT_SCRAPED = `INSERT INTO scraped_catalog (skullbot_id, name, stage, attribute, portrait_url, dot_url, wikimon_slug, raw_json, scraped_at, in_catalog)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(skullbot_id) DO UPDATE SET
    name = excluded.name,
    stage = excluded.stage,
    attribute = excluded.attribute,
    portrait_url = excluded.portrait_url,
    dot_url = excluded.dot_url,
    wikimon_slug = excluded.wikimon_slug,
    raw_json = excluded.raw_json,
    scraped_at = excluded.scraped_at,
    in_catalog = excluded.in_catalog`;

export async function applyManifest(raw: unknown): Promise<{ ok: true; summary: ApplySummary } | { ok: false; error: string; details?: unknown }> {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'invalid-manifest', details: parsed.error.issues };
  }
  const manifest = parsed.data;
  const now = Date.now();
  const summary: ApplySummary = {};

  if (manifest.entities.items) {
    const result: EntityResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (const item of manifest.entities.items) {
      try {
        const existing = await one<{ id: string }>(SQL_ITEM_EXISTS, item.id);
        await run(SQL_UPSERT_ITEM, item.id, item.name, item.description, item.price_credits, item.kind, item.payload, item.enabled, item.created_at ?? now);
        if (existing) result.updated += 1; else result.created += 1;
      } catch (e) {
        result.skipped += 1;
        result.errors.push(`item ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    summary.items = result;
  }

  if (manifest.entities.blueprints) {
    const result: EntityResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (const bp of manifest.entities.blueprints) {
      try {
        const nameCollision = await one<{ id: string }>(SQL_BLUEPRINT_BY_NAME, bp.name, bp.id);
        if (nameCollision) {
          result.skipped += 1;
          result.errors.push(`blueprint ${bp.id} (${bp.name}): name already taken by different id ${nameCollision.id}`);
          continue;
        }
        const existing = await one<{ id: string }>(SQL_BLUEPRINT_EXISTS, bp.id);
        await run(SQL_UPSERT_BLUEPRINT, bp.id, bp.name, bp.description, bp.building_type, bp.resource, bp.rate_per_hour, bp.capacity, bp.upgrade_cost, bp.starter_seed, bp.shop_price, bp.enabled, bp.created_at ?? now, now);
        if (existing) result.updated += 1; else result.created += 1;
      } catch (e) {
        result.skipped += 1;
        result.errors.push(`blueprint ${bp.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    summary.blueprints = result;
  }

  if (manifest.entities.catalog) {
    const current = loadCatalog();
    const existingIds = new Set(current.digimons.map((d) => d.id));
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const catalogErrors: string[] = [];
    const newDigimons: TemplateDigimon[] = [...current.digimons];
    for (const rawEntry of manifest.entities.catalog.digimons) {
      const validated = ManifestTemplateSchema.safeParse(rawEntry);
      if (!validated.success) {
        const label = typeof (rawEntry as { id?: unknown }).id === 'string' ? String((rawEntry as { id: string }).id) : '<no-id>';
        catalogErrors.push(`digimon ${label}: ${validated.error.issues[0]?.message ?? 'invalid shape'}`);
        continue;
      }
      const t = toStrictManifestTemplate(validated.data);
      const idx = newDigimons.findIndex((d) => d.id === t.id);
      if (idx === -1) {
        newDigimons.push(t);
        created += 1;
      } else {
        const before = JSON.stringify(newDigimons[idx]);
        const after = JSON.stringify(t);
        newDigimons[idx] = t;
        if (before === after) unchanged += 1; else updated += 1;
      }
      existingIds.delete(t.id);
    }
    if (catalogErrors.length > 0) {
      return { ok: false, error: 'invalid-catalog-entries', details: catalogErrors };
    }
    const nextCatalog: Catalog = { version: current.version, updatedAt: now, digimons: newDigimons };
    saveCatalog(nextCatalog);
    summary.catalog = { created, updated, unchanged };
  }

  if (manifest.entities.scraped) {
    const result: EntityResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    for (const sc of manifest.entities.scraped) {
      try {
        const existing = await one<{ skullbot_id: number }>('SELECT skullbot_id FROM scraped_catalog WHERE skullbot_id = ?', sc.skullbot_id);
        await run(SQL_UPSERT_SCRAPED, sc.skullbot_id, sc.name, sc.stage, sc.attribute, sc.portrait_url, sc.dot_url, sc.wikimon_slug, sc.raw_json, sc.scraped_at ?? now, sc.in_catalog);
        if (existing) result.updated += 1; else result.created += 1;
      } catch (e) {
        result.skipped += 1;
        result.errors.push(`scraped ${sc.skullbot_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    summary.scraped = result;
  }

  log.info('admin.impex.import', { summary });
  return { ok: true, summary };
}
