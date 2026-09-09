/**
 * Admin routes: scraped-list browser + XML catalog editor.
 *
 *   Public (any authed user):
 *     GET  /api/catalog                    → current XML catalog
 *
 *   Admin only (`requireAdmin`):
 *     GET  /api/admin/scraped-list         → paginated scraped_catalog rows
 *     POST /api/admin/scrape/refresh       → re-fetch skullbot list
 *     POST /api/admin/catalog/from-scraped → add a scraped entry to XML (+ enrich via wikimon)
 *     POST /api/admin/catalog/custom       → add a hand-crafted template
 *     PUT  /api/admin/catalog/:id          → edit
 *     DELETE /api/admin/catalog/:id        → remove from XML
 *     POST /api/admin/assets/:id/download  → force re-download portrait+dot for one entry
 *
 * All mutations save the XML atomically and log the actor.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { one, q, run, tx, type CatalogLootRow, type ScrapedRow } from '../db/index.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';
import {
  createBlueprint,
  deleteBlueprint,
  getBlueprint,
  listBlueprints,
  updateBlueprint,
  type BlueprintError,
} from './blueprints.js';
import { applyManifest, buildManifest, type ImpexScope } from './impex.js';
import { activeMatchCount } from '../battle/routes.js';
import { issueResetToken } from '../auth/reset.js';
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  updateSkill,
  type SkillError,
} from '../skills/catalog.js';
import { getAllCatalogSkillsMeta } from '../skills/pool.js';
import { invalidateSkillsCatalogResolver } from '../skills/resolve.js';
import {
  createShopItem,
  deleteShopItem,
  getShopItem,
  listShopItems,
  updateShopItem,
  type ShopItemError,
  createBundle,
  deleteBundle,
  getBundle,
  listBundles,
  updateBundle,
  type BundleError,
} from './shop.js';
import {
  createAdminFarmRecipe,
  deleteAdminFarmRecipe,
  getAdminFarmRecipe,
  listAdminFarmRecipes,
  updateAdminFarmRecipe,
  type AdminFarmRecipeError,
  type AdminFarmRecipeInput,
} from './farm-recipes.js';
import {
  deleteUser,
  getUser,
  listUsers,
  resetUserPassword,
  updateUserCredits,
  updateUserNetcore,
  updateUserFlags,
  type UserError,
} from './users.js';
import {
  deleteRoster,
  getRoster,
  listRosterForUser,
  spawnRoster,
  updateRoster,
  type RosterError,
} from './rosters.js';
import {
  findTemplate,
  loadCatalog,
  removeTemplate,
  saveCatalog,
  upsertTemplate,
} from '../digimon/xml.js';
import {
  ATTRIBUTES,
  AILMENTS,
  ELEMENTS,
  PARTY_SIZE,
  SKILLS_PER_DIGIMON,
  STAGES,
  type Element,
  type EvolveEdge,
  type ResistanceMap,
  type Skill,
  type TemplateDigimon,
} from '../digimon/types.js';
import { attributeToElement, defaultStatsForStage } from '../digimon/element.js';
import { fetchDigimonDetail, fetchListedDigimons, persistScraped, skullbotAssetUrls } from '../scraper/skullbot.js';
import { attackElement, fetchWikimonPage } from '../scraper/wikimon.js';
import { downloadAssetJob, hasLocalAssets } from '../scraper/assets.js';
import { MAX_ENERGY } from '../digimon/types.js';

// ============================================================================
// Zod input schemas
// ============================================================================

const SkillInputSchema = z.object({
  id: z.string().min(1).max(24),
  name: z.string().trim().min(1).max(48),
  element: z.enum(ELEMENTS),
  energyCost: z.number().int().min(0).max(MAX_ENERGY),
  power: z.number().int().min(0).max(9999),
  description: z.string().max(400).optional(),
  effect: z
    .object({
      kind: z.enum(AILMENTS),
      chance: z.number().min(0).max(1),
      turns: z.number().int().min(1).max(9),
    })
    .optional(),
});

const StatsInputSchema = z.object({
  hp: z.number().int().min(1).max(99_999),
  en: z.number().int().min(1).max(MAX_ENERGY),
  atk: z.number().int().min(1).max(9_999),
  def: z.number().int().min(1).max(9_999),
  int: z.number().int().min(1).max(9_999),
  spd: z.number().int().min(1).max(9_999),
});

const AssetsInputSchema = z.object({
  portrait: z.string().min(1).max(400),
  dot: z.string().min(1).max(400),
});

const EvolveEdgeInputSchema = z.object({
  targetId: z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/i, 'targetId must be alphanumeric with -_'),
  requiredLevel: z.number().int().min(0).max(999).optional(),
  requiredMood: z.number().int().min(0).max(100).optional(),
  requiredAttribute: z.enum(ATTRIBUTES).optional(),
  requiredItemId: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'requiredItemId must be alphanumeric with -_').optional(),
  requiredItemQty: z.number().int().min(1).max(999).optional(),
});

const ResistanceMultZ = z.union([z.literal(0), z.literal(0.5), z.literal(1), z.literal(1.5), z.literal(2)]);
const ResistanceMapInputSchema = z.object({
  fire: ResistanceMultZ,
  water: ResistanceMultZ,
  plant: ResistanceMultZ,
  ice: ResistanceMultZ,
  electricity: ResistanceMultZ,
  earth: ResistanceMultZ,
  steel: ResistanceMultZ,
  wind: ResistanceMultZ,
  light: ResistanceMultZ,
  dark: ResistanceMultZ,
  null: ResistanceMultZ,
}).partial();

const TemplateInputSchema = z.object({
  id: z.string().min(3).max(48).regex(/^[a-z0-9_-]+$/i, 'id must be alphanumeric with -_'),
  name: z.string().trim().min(1).max(48),
  stage: z.enum(STAGES),
  attribute: z.enum(ATTRIBUTES),
  element: z.enum(ELEMENTS),
  type: z.string().min(1).max(64).optional(),
  baseStats: StatsInputSchema,
  skillPool: z.array(SkillInputSchema).min(1).max(SKILLS_PER_DIGIMON),
  assets: AssetsInputSchema,
  sourceUrl: z.string().url().optional(),
  wikimonSlug: z.string().optional(),
  evolvesInto: z.array(EvolveEdgeInputSchema).max(24).optional(),
  resistances: ResistanceMapInputSchema.optional(),
});

type ParsedTemplate = z.infer<typeof TemplateInputSchema>;
type ParsedSkill = z.infer<typeof SkillInputSchema>;

// Zod's .optional() yields `T | undefined`; our canonical Skill/TemplateDigimon
// types use exact-optional `field?: T` under `exactOptionalPropertyTypes`.
// The two normalize helpers below convert the loose Zod output into strict
// canonical shape by only setting keys whose value is not undefined.
function toStrictSkill(raw: ParsedSkill): Skill {
  const out: Skill = {
    id: raw.id,
    name: raw.name,
    element: raw.element,
    energyCost: raw.energyCost,
    power: raw.power,
  };
  if (raw.description !== undefined) out.description = raw.description;
  if (raw.effect !== undefined) out.effect = raw.effect;
  return out;
}

function toStrictTemplate(raw: ParsedTemplate): TemplateDigimon {
  const out: TemplateDigimon = {
    id: raw.id,
    name: raw.name,
    stage: raw.stage,
    attribute: raw.attribute,
    element: raw.element,
    baseStats: raw.baseStats,
    skillPool: raw.skillPool.map(toStrictSkill),
    assets: raw.assets,
  };
  if (raw.type !== undefined) out.type = raw.type;
  if (raw.sourceUrl !== undefined) out.sourceUrl = raw.sourceUrl;
  if (raw.wikimonSlug !== undefined) out.wikimonSlug = raw.wikimonSlug;
  if (raw.evolvesInto !== undefined && raw.evolvesInto.length > 0) {
    out.evolvesInto = raw.evolvesInto.map((edge) => {
      const e: EvolveEdge = { targetId: edge.targetId };
      if (edge.requiredLevel !== undefined) e.requiredLevel = edge.requiredLevel;
      if (edge.requiredMood !== undefined) e.requiredMood = edge.requiredMood;
      if (edge.requiredAttribute !== undefined) e.requiredAttribute = edge.requiredAttribute;
      if (edge.requiredItemId !== undefined) {
        e.requiredItemId = edge.requiredItemId;
        e.requiredItemQty = edge.requiredItemQty ?? 1;
      }
      return e;
    });
  }
  if (raw.resistances !== undefined && Object.keys(raw.resistances).length > 0) {
    const map: ResistanceMap = {};
    for (const [el, mult] of Object.entries(raw.resistances)) {
      if (mult !== undefined) map[el as Element] = mult;
    }
    out.resistances = map;
  }
  return out;
}

const FromScrapedSchema = z.object({
  skullbotId: z.number().int().positive(),
  enrich: z.boolean().default(true),
});

// ============================================================================
// SQL
// ============================================================================
const SQL_SELECT_SCRAPED_BY_ID = `SELECT * FROM scraped_catalog WHERE skullbot_id = ?`;
const SQL_MARK_IN_CATALOG = `UPDATE scraped_catalog SET in_catalog = ? WHERE skullbot_id = ?`;
const SQL_SEARCH_SCRAPED = `SELECT * FROM scraped_catalog
     WHERE (CAST(? AS TEXT) IS NULL OR LOWER(name) LIKE LOWER(?))
       AND (CAST(? AS TEXT) IS NULL OR stage = ?)
       AND (CAST(? AS TEXT) IS NULL OR attribute = ?)
     ORDER BY skullbot_id
     LIMIT ? OFFSET ?`;
const SQL_COUNT_SCRAPED = `SELECT COUNT(*) AS n FROM scraped_catalog
     WHERE (CAST(? AS TEXT) IS NULL OR LOWER(name) LIKE LOWER(?))
       AND (CAST(? AS TEXT) IS NULL OR stage = ?)
       AND (CAST(? AS TEXT) IS NULL OR attribute = ?)`;

// ============================================================================
// Helpers
// ============================================================================

function skillsFromWikimon(
  attacks: Array<{ name: string; description?: string | undefined }>,
  fallbackElement: TemplateDigimon['element'],
): Skill[] {
  const chosen: Skill[] = [];
  const seen = new Set<string>();
  for (const a of attacks) {
    if (chosen.length >= SKILLS_PER_DIGIMON) break;
    const key = a.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = chosen.length;
    const skill: Skill = {
      id: `s${idx}`,
      name: a.name.slice(0, 40),
      element: attackElement(a as { name: string; description?: string }, fallbackElement),
      energyCost: idx === 0 ? 0 : Math.min(MAX_ENERGY, 6 + idx * 10 + (idx === 3 ? 8 : 0)),
      power: idx === 0 ? 100 : 140 + idx * 80,
    };
    if (a.description) skill.description = a.description;
    chosen.push(skill);
  }
  while (chosen.length < SKILLS_PER_DIGIMON) {
    const idx = chosen.length;
    chosen.push({
      id: `s${idx}`,
      name: idx === 0 ? 'Slash' : idx === 1 ? 'Focus Strike' : idx === 2 ? 'Rampage' : 'Overdrive',
      element: fallbackElement,
      energyCost: idx === 0 ? 0 : Math.min(MAX_ENERGY, 8 + idx * 10),
      power: idx === 0 ? 100 : 140 + idx * 80,
    });
  }
  return chosen;
}

function buildTemplateFromScraped(
  row: ScrapedRow,
  attacks: Array<{ name: string; description?: string | undefined }>,
  evolvesInto: readonly string[],
): TemplateDigimon {
  const attribute = row.attribute as TemplateDigimon['attribute'];
  const stage = row.stage as TemplateDigimon['stage'];
  const element = attributeToElement(attribute);
  const catalogId = `skb-${row.skullbot_id}`;
  const tpl: TemplateDigimon = {
    id: catalogId,
    name: row.name,
    stage,
    attribute,
    element,
    baseStats: defaultStatsForStage(stage),
    skillPool: [],  // skills sourced from skills_catalog (seeds), not from XML/scraper
    assets: {
      portrait: `/assets/digimon/${catalogId}/portrait.webp`,
      dot: `/assets/digimon/${catalogId}/dot.gif`,
    },
    sourceUrl: `https://api.skullbot.fr/digimon/${row.skullbot_id}`,
  };
  if (row.wikimon_slug) tpl.wikimonSlug = row.wikimon_slug;
  if (evolvesInto.length > 0) tpl.evolvesInto = evolvesInto.map((targetId) => ({ targetId }));
  return tpl;
}

// ============================================================================
// Plugin
// ============================================================================

export const adminPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  // -------- PUBLIC: catalog read (any authed user) --------------------------
  // Default = published only (player-facing). Admin frontend passes
  // `?includeDrafts=1` so the CatalogTable can edit drafts.
  app.get<{ Querystring: { includeDrafts?: string } }>('/api/catalog', async (req, reply) => {
    await requireAuth(req, reply);
    const includeDrafts = req.query.includeDrafts === '1';
    const catalog = loadCatalog({ publishedOnly: !includeDrafts });
    return reply.send(catalog);
  });

  // -------- ADMIN: scraped list browser -------------------------------------
  app.get<{
    Querystring: { search?: string; stage?: string; attribute?: string; limit?: string; offset?: string };
  }>('/api/admin/scraped-list', async (req, reply) => {
    await requireAdmin(req, reply);
    const { search, stage, attribute } = req.query;
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit ?? '50', 10) || 50));
    const offset = Math.max(0, Number.parseInt(req.query.offset ?? '0', 10) || 0);
    const searchLike = search && search.length ? `%${search}%` : null;
    const stageFilter = stage && (STAGES as readonly string[]).includes(stage) ? stage : null;
    const attrFilter = attribute && (ATTRIBUTES as readonly string[]).includes(attribute) ? attribute : null;
    const totalRow = await one<{ n: number }>(
      SQL_COUNT_SCRAPED,
      searchLike, searchLike,
      stageFilter, stageFilter,
      attrFilter, attrFilter,
    );
    const total = totalRow?.n ?? 0;
    const rows = await q<ScrapedRow>(
      SQL_SEARCH_SCRAPED,
      searchLike, searchLike,
      stageFilter, stageFilter,
      attrFilter, attrFilter,
      limit, offset,
    );
    return reply.send({ total, offset, limit, entries: rows });
  });

  // -------- ADMIN: refresh scraped list from skullbot -----------------------
  app.post('/api/admin/scrape/refresh', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const entries = await fetchListedDigimons();
    if (entries.length === 0) {
      return reply.code(502).send({ error: 'upstream returned nothing' });
    }
    const n = await persistScraped(entries);
    log.info('admin.scrape.refresh', { adminId: admin.id, entries: n });
    return reply.send({ entries: n });
  });

  // -------- ADMIN: add from scraped ----------------------------------------
  app.post('/api/admin/catalog/from-scraped', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = FromScrapedSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const row = await one<ScrapedRow>(SQL_SELECT_SCRAPED_BY_ID, parsed.data.skullbotId);
    if (!row) return reply.code(404).send({ error: 'scraped entry not found — refresh the list first' });

    let attacks: Array<{ name: string; description?: string | undefined }> = [];
    let evolvesInto: string[] = [];
    if (parsed.data.enrich) {
      const slug = row.wikimon_slug ?? row.name.replace(/\s+/g, '_');
      const page = await fetchWikimonPage(slug);
      if (page) attacks = page.attacks;
      const detail = await fetchDigimonDetail(row.skullbot_id);
      if (detail) evolvesInto = detail.evolvesInto.map((e) => `skb-${e.skullbot_id}`);
    }

    const template = buildTemplateFromScraped(row, attacks, evolvesInto);
    const catalog = loadCatalog();
    const updated = upsertTemplate(catalog, template);
    saveCatalog(updated);
    await run(SQL_MARK_IN_CATALOG, 1, row.skullbot_id);

    if (!hasLocalAssets(template.id)) {
      const job = { catalogId: template.id, portraitUrl: row.portrait_url, dotUrl: row.dot_url };
      const result = await downloadAssetJob(job);
      log.info('admin.catalog.add.assets', { adminId: admin.id, id: template.id, ...result });
    }

    log.info('admin.catalog.add.from-scraped', {
      adminId: admin.id,
      id: template.id,
      skills: template.skillPool.length,
    });
    return reply.send({ template });
  });

  // -------- ADMIN: add a custom hand-crafted template -----------------------
  app.post('/api/admin/catalog/custom', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = TemplateInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid template', details: parsed.error.issues });
    const catalog = loadCatalog();
    if (findTemplate(catalog, parsed.data.id)) {
      return reply.code(409).send({ error: 'id already exists — use PUT to edit' });
    }
    const template = toStrictTemplate(parsed.data);
    saveCatalog(upsertTemplate(catalog, template));
    log.info('admin.catalog.add.custom', { adminId: admin.id, id: template.id });
    return reply.code(201).send({ template });
  });

  // -------- ADMIN: edit an existing entry (full replacement) ---------------
  app.put<{ Params: { id: string } }>('/api/admin/catalog/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const catalog = loadCatalog();
    const existing = findTemplate(catalog, req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not in catalog' });
    const parsed = TemplateInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid template', details: parsed.error.issues });
    if (parsed.data.id !== existing.id) {
      return reply.code(400).send({ error: 'cannot change id via PUT — delete and re-create' });
    }
    const template = toStrictTemplate(parsed.data);
    saveCatalog(upsertTemplate(catalog, template));
    log.info('admin.catalog.edit', { adminId: admin.id, id: template.id });
    return reply.send({ template });
  });

  // -------- ADMIN: delete -----------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/admin/catalog/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const catalog = loadCatalog();
    if (!findTemplate(catalog, req.params.id)) return reply.code(404).send({ error: 'not in catalog' });
    saveCatalog(removeTemplate(catalog, req.params.id));
    log.info('admin.catalog.delete', { adminId: admin.id, id: req.params.id });
    return reply.send({ ok: true });
  });

  // -------- ADMIN: force asset download for one entry -----------------------
  app.post<{ Params: { id: string } }>('/api/admin/assets/:id/download', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const catalog = loadCatalog();
    const tpl = findTemplate(catalog, req.params.id);
    if (!tpl) return reply.code(404).send({ error: 'not in catalog' });
    const skb = /^skb-(\d+)$/.exec(tpl.id);
    let portraitUrl: string;
    let dotUrl: string;
    if (skb && skb[1]) {
      const skbId = Number(skb[1]);
      const row = await one<ScrapedRow>(SQL_SELECT_SCRAPED_BY_ID, skbId);
      if (row) {
        portraitUrl = row.portrait_url;
        dotUrl = row.dot_url;
      } else {
        const urls = skullbotAssetUrls(skbId);
        portraitUrl = urls.portrait;
        dotUrl = urls.dot;
      }
    } else if (/^https?:\/\//.test(tpl.assets.portrait) && /^https?:\/\//.test(tpl.assets.dot)) {
      portraitUrl = tpl.assets.portrait;
      dotUrl = tpl.assets.dot;
    } else {
      return reply.code(400).send({ error: 'no downloadable URLs recorded for this entry' });
    }
    const result = await downloadAssetJob({ catalogId: tpl.id, portraitUrl, dotUrl });
    log.info('admin.assets.download', { adminId: admin.id, id: tpl.id, result });
    return reply.send({ result });
  });

  const BlueprintInputSchema = z.object({
    name: z.string().trim().min(2).max(48),
    description: z.string().max(240).optional(),
    buildingType: z.enum(['resource_generator', 'training', 'training_premium']),
    resource: z.enum(['Meat', 'Bits', 'Data']).nullable().optional(),
    ratePerHour: z.number().int().min(0).max(9_999).optional(),
    capacity: z.number().int().min(0).max(99_999).optional(),
    upgradeCost: z.number().int().min(1).max(999_999).optional(),
    starterSeed: z.boolean().optional(),
    shopPrice: z.number().int().min(1).max(99_999).nullable().optional(),
    enabled: z.boolean().optional(),
  });

  function statusForBlueprintError(err: BlueprintError): number {
    if (err === 'not-found') return 404;
    if (err === 'duplicate-name') return 409;
    return 400;
  }

  app.get('/api/admin/blueprints', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ blueprints: await listBlueprints() });
  });

  app.get<{ Params: { id: string } }>('/api/admin/blueprints/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const bp = await getBlueprint(req.params.id);
    if (!bp) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ blueprint: bp });
  });

  app.post('/api/admin/blueprints', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = BlueprintInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await createBlueprint(parsed.data);
    if (!result.ok) return reply.code(statusForBlueprintError(result.error)).send({ error: result.error });
    log.info('admin.blueprint.create', { adminId: admin.id, id: result.blueprint.id, name: result.blueprint.name });
    return reply.code(201).send(result);
  });

  app.put<{ Params: { id: string } }>('/api/admin/blueprints/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = BlueprintInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await updateBlueprint(req.params.id, parsed.data);
    if (!result.ok) return reply.code(statusForBlueprintError(result.error)).send({ error: result.error });
    log.info('admin.blueprint.update', { adminId: admin.id, id: result.blueprint.id });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/blueprints/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteBlueprint(req.params.id);
    if (!result.ok) return reply.code(statusForBlueprintError(result.error)).send({ error: result.error });
    log.info('admin.blueprint.delete', { adminId: admin.id, id: req.params.id });
    return reply.send(result);
  });

  app.get('/api/admin/stats', async (req, reply) => {
    await requireAdmin(req, reply);
    const catalog = loadCatalog();
    const userRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM users');
    // Battle state lives in the Cluster (Redis or in-process), not SQL — see
    // src/battle/routes.ts. The legacy `active_matches` table was dropped by
    // migration 001; live counts come from `battle:snap:*` cluster keys.
    const activeMatches = await activeMatchCount();
    const bpRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM building_blueprints');
    const buildingRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM farm_buildings');
    const rosterRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM player_roster');
    return reply.send({
      users: userRow?.n ?? 0,
      activeMatches,
      catalogTemplates: catalog.digimons.length,
      buildingBlueprints: bpRow?.n ?? 0,
      totalPlayerBuildings: buildingRow?.n ?? 0,
      totalPlayerMons: rosterRow?.n ?? 0,
    });
  });

  const ScopeSchema = z.enum(['all', 'items', 'blueprints', 'catalog', 'scraped']);

  app.get<{ Querystring: { scope?: string } }>('/api/admin/export', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const raw = req.query.scope ?? 'all';
    const parsed = ScopeSchema.safeParse(raw);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-scope', valid: ['all', 'items', 'blueprints', 'catalog', 'scraped'] });
    const manifest = await buildManifest(parsed.data as ImpexScope);
    const filename = `digiworld-export-${parsed.data}-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    log.info('admin.impex.export', { adminId: admin.id, scope: parsed.data, sizes: {
      items: manifest.entities.items?.length,
      blueprints: manifest.entities.blueprints?.length,
      catalog: manifest.entities.catalog?.digimons.length,
      scraped: manifest.entities.scraped?.length,
    } });
    return reply.send(manifest);
  });

  app.post('/api/admin/import', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await applyManifest(req.body);
    if (!result.ok) {
      log.warn('admin.impex.import.fail', { adminId: admin.id, error: result.error });
      return reply.code(400).send({ error: result.error, details: result.details });
    }
    log.info('admin.impex.import.ok', { adminId: admin.id, summary: result.summary });
    return reply.send(result);
  });

  function statusForSkillError(err: SkillError): number {
    if (err === 'not-found') return 404;
    if (err === 'duplicate-name') return 409;
    return 400;
  }

  app.get('/api/admin/skills', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ skills: await listSkills() });
  });

  app.get('/api/admin/skills-catalog', async (req, reply) => {
    await requireAdmin(req, reply);
    const skills = await getAllCatalogSkillsMeta();
    return reply.send({ skills });
  });

  app.get<{ Params: { id: string } }>('/api/admin/skills/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const sk = await getSkill(req.params.id);
    if (!sk) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ skill: sk });
  });

  app.post('/api/admin/skills', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await createSkill(req.body);
    if (!result.ok) return reply.code(statusForSkillError(result.error)).send({ error: result.error, details: result.details });
    invalidateSkillsCatalogResolver();
    log.info('admin.skill.create', { adminId: admin.id, id: result.skill.id, name: result.skill.name, actions: result.skill.actions.length });
    return reply.code(201).send(result);
  });

  app.put<{ Params: { id: string } }>('/api/admin/skills/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateSkill(req.params.id, req.body);
    if (!result.ok) return reply.code(statusForSkillError(result.error)).send({ error: result.error, details: result.details });
    invalidateSkillsCatalogResolver();
    log.info('admin.skill.update', { adminId: admin.id, id: result.skill.id });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/skills/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteSkill(req.params.id);
    if (!result.ok) return reply.code(statusForSkillError(result.error)).send({ error: result.error });
    invalidateSkillsCatalogResolver();
    log.info('admin.skill.delete', { adminId: admin.id, id: req.params.id });
    return reply.send(result);
  });

  // ==========================================================================
  // SHOP ITEMS — admin CRUD
  // ==========================================================================

  function statusForShopItemError(err: ShopItemError): number {
    if (err === 'not-found') return 404;
    if (err === 'duplicate-name') return 409;
    return 400;
  }

  app.get<{ Querystring: { item_type?: string; item_type_in?: string; item_type_not_in?: string } }>('/api/admin/shop', async (req, reply) => {
    await requireAdmin(req, reply);
    const q = req.query;
    const filter: {
      itemType?: string;
      itemTypeIn?: readonly string[];
      itemTypeNotIn?: readonly string[];
    } = {};
    if (typeof q.item_type === 'string' && q.item_type.trim().length > 0) filter.itemType = q.item_type.trim();
    if (typeof q.item_type_in === 'string' && q.item_type_in.trim().length > 0) filter.itemTypeIn = q.item_type_in.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (typeof q.item_type_not_in === 'string' && q.item_type_not_in.trim().length > 0) filter.itemTypeNotIn = q.item_type_not_in.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    return reply.send({ items: await listShopItems(filter) });
  });

  app.get<{ Params: { id: string } }>('/api/admin/shop/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const item = await getShopItem(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ item });
  });

  app.post('/api/admin/shop', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await createShopItem(req.body as never);
    if (!result.ok) return reply.code(statusForShopItemError(result.error)).send({ error: result.error });
    log.info('admin.shop.create', { adminId: admin.id, id: result.item.id, name: result.item.name });
    return reply.code(201).send(result);
  });

  app.put<{ Params: { id: string } }>('/api/admin/shop/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateShopItem(req.params.id, req.body as never);
    if (!result.ok) return reply.code(statusForShopItemError(result.error)).send({ error: result.error });
    log.info('admin.shop.update', { adminId: admin.id, id: result.item.id });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/shop/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteShopItem(req.params.id);
    if (!result.ok) return reply.code(statusForShopItemError(result.error)).send({ error: result.error });
    log.info('admin.shop.delete', { adminId: admin.id, id: req.params.id });
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/api/admin/shop/:id/publish', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const item = await getShopItem(req.params.id);
    if (!item) return reply.code(404).send({ error: 'not-found' });
    if (item.status === 'published') {
      return reply.code(409).send({ error: 'already-published', message: 'Shop item is already published' });
    }
    const published = await updateShopItem(req.params.id, { ...item, status: 'published' });
    log.info('admin.shop.publish', { adminId: admin.id, id: item.id });
    return reply.send({ item: published });
  });

  function statusForBundleError(err: BundleError): number {
    if (err === 'not-found' || err === 'invalid-item-ref') return 404;
    if (err === 'currency-mismatch' || err === 'duplicate-item') return 409;
    return 400;
  }

  app.get('/api/admin/shop/bundles', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ bundles: await listBundles() });
  });

  app.get<{ Params: { id: string } }>('/api/admin/shop/bundles/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const bundle = await getBundle(req.params.id);
    if (!bundle) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ bundle });
  });

  app.post('/api/admin/shop/bundles', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await createBundle(req.body as never);
    if (!result.ok) return reply.code(statusForBundleError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.shop.bundle.create', { adminId: admin.id, id: result.bundle.id, name: result.bundle.name });
    return reply.code(201).send(result);
  });

  app.put<{ Params: { id: string } }>('/api/admin/shop/bundles/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateBundle(req.params.id, req.body as never);
    if (!result.ok) return reply.code(statusForBundleError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.shop.bundle.update', { adminId: admin.id, id: result.bundle.id });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/shop/bundles/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteBundle(req.params.id);
    if (!result.ok) return reply.code(statusForBundleError(result.error)).send({ error: result.error });
    log.info('admin.shop.bundle.delete', { adminId: admin.id, id: req.params.id });
    return reply.send(result);
  });

  // ==========================================================================
  // FARM RECIPES — admin CRUD (F8)
  // ==========================================================================

  function statusForFarmRecipeError(err: AdminFarmRecipeError): number {
    if (err === 'not-found') return 404;
    return 400;
  }

  app.get('/api/admin/farm-recipes', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ recipes: await listAdminFarmRecipes() });
  });

  app.get<{ Params: { id: string } }>('/api/admin/farm-recipes/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const recipe = await getAdminFarmRecipe(req.params.id);
    if (!recipe) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ recipe });
  });

  app.post('/api/admin/farm-recipes', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await createAdminFarmRecipe(req.body as AdminFarmRecipeInput);
    if (!result.ok) return reply.code(statusForFarmRecipeError(result.error)).send({ error: result.error });
    log.info('admin.farm-recipe.route.create', { adminId: admin.id, id: result.recipe.id });
    return reply.code(201).send(result);
  });

  app.put<{ Params: { id: string } }>('/api/admin/farm-recipes/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateAdminFarmRecipe(req.params.id, req.body as AdminFarmRecipeInput);
    if (!result.ok) return reply.code(statusForFarmRecipeError(result.error)).send({ error: result.error });
    log.info('admin.farm-recipe.route.update', { adminId: admin.id, id: result.recipe.id });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/farm-recipes/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteAdminFarmRecipe(req.params.id);
    if (!result.ok) return reply.code(statusForFarmRecipeError(result.error)).send({ error: result.error });
    log.info('admin.farm-recipe.route.delete', { adminId: admin.id, id: req.params.id });
    return reply.send(result);
  });

  // ==========================================================================
  // USERS — admin management
  // ==========================================================================

  function statusForUserError(err: UserError): number {
    if (err === 'not-found') return 404;
    return 400;
  }

  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>('/api/admin/users', async (req, reply) => {
    await requireAdmin(req, reply);
    const limit = req.query.limit ? Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50)) : 50;
    const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset, 10) || 0) : 0;
    const result = await listUsers(req.query.q, limit, offset);
    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const user = await getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ user });
  });

  app.patch<{ Params: { id: string }; Body: { isAdmin?: boolean; disabled?: boolean } }>('/api/admin/users/:id/flags', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (req.params.id === admin.id && (req.body.isAdmin === false || req.body.disabled === true)) {
      return reply.code(400).send({ error: 'cannot-modify-self', message: 'You cannot demote or disable yourself.' });
    }
    const result = await updateUserFlags(req.params.id, req.body ?? {});
    if (!result.ok) return reply.code(statusForUserError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.user.flags', { adminId: admin.id, targetId: req.params.id, ...req.body });
    return reply.send(result);
  });

  app.patch<{ Params: { id: string }; Body: { credits: number } }>('/api/admin/users/:id/credits', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateUserCredits(req.params.id, req.body?.credits);
    if (!result.ok) return reply.code(statusForUserError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.user.credits', { adminId: admin.id, targetId: req.params.id, credits: req.body.credits });
    return reply.send(result);
  });

  app.patch<{ Params: { id: string }; Body: { netcore: number } }>('/api/admin/users/:id/netcore', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateUserNetcore(req.params.id, req.body?.netcore);
    if (!result.ok) return reply.code(statusForUserError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.user.netcore', { adminId: admin.id, targetId: req.params.id, netcore: req.body.netcore });
    return reply.send(result);
  });

  app.post<{ Params: { id: string }; Body: { password: string } }>('/api/admin/users/:id/reset-password', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const password = req.body?.password;
    if (typeof password !== 'string') return reply.code(400).send({ error: 'invalid-input' });
    const result = await resetUserPassword(req.params.id, password);
    if (!result.ok) return reply.code(statusForUserError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.user.resetPassword', { adminId: admin.id, targetId: req.params.id });
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-token', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const user = await getUser(req.params.id);
    if (!user) return reply.code(404).send({ error: 'not-found' });
    const { token, expiresAt } = await issueResetToken(user.id);
    log.info('admin.user.resetToken.issued', { adminId: admin.id, targetId: user.id });
    return reply.send({ token, expiresAt, url: `/reset?token=${token}` });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (req.params.id === admin.id) {
      return reply.code(400).send({ error: 'cannot-modify-self', message: 'You cannot delete yourself.' });
    }
    const result = await deleteUser(req.params.id);
    if (!result.ok) return reply.code(statusForUserError(result.error)).send({ error: result.error });
    log.info('admin.user.delete', { adminId: admin.id, targetId: req.params.id });
    return reply.send(result);
  });

  // ==========================================================================
  // ROSTER — admin management of any player's mons
  // ==========================================================================

  function statusForRosterError(err: RosterError): number {
    if (err === 'not-found' || err === 'user-not-found' || err === 'catalog-not-found') return 404;
    return 400;
  }

  app.get<{ Params: { userId: string } }>('/api/admin/users/:userId/roster', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ roster: await listRosterForUser(req.params.userId) });
  });

  app.get<{ Params: { monId: string } }>('/api/admin/roster/:monId', async (req, reply) => {
    await requireAdmin(req, reply);
    const mon = await getRoster(req.params.monId);
    if (!mon) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ mon });
  });

  app.patch<{ Params: { monId: string } }>('/api/admin/roster/:monId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateRoster(req.params.monId, req.body as never);
    if (!result.ok) return reply.code(statusForRosterError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.roster.update', { adminId: admin.id, monId: req.params.monId });
    return reply.send(result);
  });

  app.post<{ Params: { userId: string }; Body: { catalogId: string; nickname?: string; level?: number } }>('/api/admin/users/:userId/roster/spawn', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const body = req.body ?? {} as { catalogId?: string; nickname?: string; level?: number };
    if (!body.catalogId) return reply.code(400).send({ error: 'invalid-input', message: 'catalogId required' });
    const spawnPayload: {
      userId: string;
      catalogId: string;
      nickname?: string;
      level?: number;
    } = { userId: req.params.userId, catalogId: body.catalogId };
    if (body.nickname !== undefined) spawnPayload.nickname = body.nickname;
    if (body.level !== undefined) spawnPayload.level = body.level;
    const result = await spawnRoster(spawnPayload);
    if (!result.ok) return reply.code(statusForRosterError(result.error)).send({ error: result.error, message: result.message });
    log.info('admin.roster.spawn', { adminId: admin.id, userId: req.params.userId, catalogId: body.catalogId });
    return reply.code(201).send(result);
  });

  app.delete<{ Params: { monId: string } }>('/api/admin/roster/:monId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteRoster(req.params.monId);
    if (!result.ok) return reply.code(statusForRosterError(result.error)).send({ error: result.error });
    log.info('admin.roster.delete', { adminId: admin.id, monId: req.params.monId });
    return reply.send(result);
  });

  // ==========================================================================
  // CATALOG LOOT — per-mon drop table
  //   GET  /api/admin/catalog-loot/:catalogId → { catalogId, entries }
  //   PUT  /api/admin/catalog-loot/:catalogId → replace all entries for that mon
  // ==========================================================================

  const SQL_LIST_LOOT = `SELECT * FROM catalog_loot_entries WHERE catalog_id = ? ORDER BY drop_pct DESC, item_id`;
  const SQL_DELETE_LOOT_FOR_MON = `DELETE FROM catalog_loot_entries WHERE catalog_id = ?`;
  const SQL_INSERT_LOOT_ENTRY = `INSERT INTO catalog_loot_entries (id, catalog_id, item_id, drop_pct, qty_min, qty_max, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;

  const LootEntryInputSchema = z.object({
    itemId: z.string().min(1).max(64),
    dropPct: z.number().int().min(0).max(100),
    qtyMin: z.number().int().min(1).max(999).default(1),
    qtyMax: z.number().int().min(1).max(999).default(1),
  }).refine((entry) => entry.qtyMax >= entry.qtyMin, { message: 'qtyMax must be >= qtyMin', path: ['qtyMax'] });

  const LootTableInputSchema = z.object({
    entries: z.array(LootEntryInputSchema).max(20),
  });

  const lootRowToView = (row: CatalogLootRow): { id: string; itemId: string; dropPct: number; qtyMin: number; qtyMax: number; updatedAt: number } => ({
    id: row.id,
    itemId: row.item_id,
    dropPct: row.drop_pct,
    qtyMin: row.qty_min,
    qtyMax: row.qty_max,
    updatedAt: row.updated_at,
  });

  app.get<{ Params: { catalogId: string } }>('/api/admin/catalog-loot/:catalogId', async (req, reply) => {
    await requireAdmin(req, reply);
    const rows = await q<CatalogLootRow>(SQL_LIST_LOOT, req.params.catalogId);
    return reply.send({ catalogId: req.params.catalogId, entries: rows.map(lootRowToView) });
  });

  app.put<{ Params: { catalogId: string } }>('/api/admin/catalog-loot/:catalogId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = LootTableInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    }
    const catalogId = req.params.catalogId;
    const now = Date.now();
    await tx(async (t) => {
      await t.run(SQL_DELETE_LOOT_FOR_MON, [catalogId]);
      for (const entry of parsed.data.entries) {
        const id = newId('loot');
        await t.run(SQL_INSERT_LOOT_ENTRY, [id, catalogId, entry.itemId, entry.dropPct, entry.qtyMin, entry.qtyMax, now]);
      }
    });
    log.info('admin.loot.update', { adminId: admin.id, catalogId, entries: parsed.data.entries.length });
    const rows = await q<CatalogLootRow>(SQL_LIST_LOOT, catalogId);
    return reply.send({ ok: true, catalogId, entries: rows.map(lootRowToView) });
  });
};
