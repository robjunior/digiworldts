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
import { one, q, run, type ScrapedRow } from '../db/index.js';
import { log } from '../util/log.js';
import {
  createBlueprint,
  deleteBlueprint,
  getBlueprint,
  listBlueprints,
  updateBlueprint,
  type BlueprintError,
} from './blueprints.js';
import { applyManifest, buildManifest, type ImpexScope } from './impex.js';
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  updateSkill,
  type SkillError,
} from '../skills/catalog.js';
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

const TemplateInputSchema = z.object({
  id: z.string().min(3).max(48).regex(/^[a-z0-9_-]+$/i, 'id must be alphanumeric with -_'),
  name: z.string().trim().min(1).max(48),
  stage: z.enum(STAGES),
  attribute: z.enum(ATTRIBUTES),
  element: z.enum(ELEMENTS),
  baseStats: StatsInputSchema,
  skillPool: z.array(SkillInputSchema).min(1).max(SKILLS_PER_DIGIMON),
  assets: AssetsInputSchema,
  sourceUrl: z.string().url().optional(),
  wikimonSlug: z.string().optional(),
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
  if (raw.sourceUrl !== undefined) out.sourceUrl = raw.sourceUrl;
  if (raw.wikimonSlug !== undefined) out.wikimonSlug = raw.wikimonSlug;
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
  evolvesInto: string[],
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
    skillPool: skillsFromWikimon(attacks, element),
    assets: {
      portrait: `/assets/digimon/${catalogId}/portrait.webp`,
      dot: `/assets/digimon/${catalogId}/dot.gif`,
    },
    sourceUrl: `https://api.skullbot.fr/digimon/${row.skullbot_id}`,
  };
  if (row.wikimon_slug) tpl.wikimonSlug = row.wikimon_slug;
  if (evolvesInto.length > 0) tpl.evolvesInto = evolvesInto;
  return tpl;
}

// ============================================================================
// Plugin
// ============================================================================

export const adminPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  // -------- PUBLIC: catalog read (any authed user) --------------------------
  app.get('/api/catalog', async (req, reply) => {
    await requireAuth(req, reply);
    const catalog = loadCatalog();
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
    const matchRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM active_matches');
    const bpRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM building_blueprints');
    const buildingRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM farm_buildings');
    const rosterRow = await one<{ n: number }>('SELECT COUNT(*) AS n FROM player_roster');
    return reply.send({
      users: userRow?.n ?? 0,
      activeMatches: matchRow?.n ?? 0,
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
    log.info('admin.skill.create', { adminId: admin.id, id: result.skill.id, name: result.skill.name, actions: result.skill.actions.length });
    return reply.code(201).send(result);
  });

  app.put<{ Params: { id: string } }>('/api/admin/skills/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await updateSkill(req.params.id, req.body);
    if (!result.ok) return reply.code(statusForSkillError(result.error)).send({ error: result.error, details: result.details });
    log.info('admin.skill.update', { adminId: admin.id, id: result.skill.id });
    return reply.send(result);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/skills/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteSkill(req.params.id);
    if (!result.ok) return reply.code(statusForSkillError(result.error)).send({ error: result.error });
    log.info('admin.skill.delete', { adminId: admin.id, id: req.params.id });
    return reply.send(result);
  });
};
