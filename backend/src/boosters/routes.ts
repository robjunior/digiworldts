/**
 * Booster API plugin.
 *
 * Boosters are READ-ONLY at runtime: they are curated in seed files and
 * populated into the DB by the content-deploy pipeline. There is NO write
 * endpoint here (the editor writes seed files, not the DB). The runtime DB is
 * a cache of the last deploy (see boosters/pipeline.ts).
 *
 * Routes:
 *   GET /api/boosters                 → admin: all boosters; public: published only
 *   GET /api/boosters/:code           → one booster + its digimon pool tree + item pool
 *   GET /api/catalog/digimon/:id/evolutions → global-graph evolution SUGGESTIONS
 *                                           (grafo global; the booster's own
 *                                            parent->child is independent of it)
 */
import type { FastifyPluginAsync } from 'fastify';
import { loadCatalog } from '../digimon/xml.js';
import { q, one } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/routes.js';

type BoosterRow = {
  id: string;
  code: string;
  name: string;
  set: string;
  release_date: string;
  description: string | null;
  status: string;
  tags: string | null;
  seed_hash: string;
  loaded_at: number;
};

type NodeRow = {
  id: string;
  booster_id: string;
  ref: string;
  digimon_id: string;
  parent_node_id: string | null;
  rarity: string;
  weight: number;
  order: number;
};

type ItemRow = {
  id: string;
  booster_id: string;
  ref: string;
  item_id: string;
  rarity: string;
  weight: number;
  order: number;
};

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function boosterView(r: BoosterRow) {
  return {
    code: r.code,
    name: r.name,
    set: r.set,
    releaseDate: r.release_date,
    description: r.description ?? undefined,
    status: r.status,
    tags: parseTags(r.tags),
    seedHash: r.seed_hash,
    loadedAt: r.loaded_at,
  };
}

export const boosterPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  // Admin sees all statuses; public sees only published. Admin branch needs
  // requireAdmin (which itself calls requireAuth).
  app.get('/api/boosters', async (req, reply) => {
    let rows: BoosterRow[];
    try {
      await requireAdmin(req, reply);
      rows = await q<BoosterRow>(`SELECT * FROM boosters ORDER BY code`);
    } catch {
      // Not admin → public, published-only (requireAdmin throws on non-admin).
      await requireAuth(req, reply);
      rows = await q<BoosterRow>(`SELECT * FROM boosters WHERE status = 'published' ORDER BY code`);
    }
    return reply.send({ boosters: rows.map(boosterView) });
  });

  app.get<{ Params: { code: string } }>('/api/boosters/:code', async (req, reply) => {
    let isAdmin = false;
    try {
      await requireAdmin(req, reply);
      isAdmin = true;
    } catch {
      await requireAuth(req, reply);
    }
    const booster = await one<BoosterRow>('SELECT * FROM boosters WHERE code = ?', req.params.code);
    if (!booster) return reply.code(404).send({ error: 'booster not found' });
    if (!isAdmin && booster.status !== 'published') return reply.code(404).send({ error: 'booster not found' });
    const nodes = await q<NodeRow>(
      'SELECT * FROM booster_digimon_nodes WHERE booster_id = ? ORDER BY "order", id',
      booster.id,
    );
    const items = await q<ItemRow>(
      'SELECT * FROM booster_item_entries WHERE booster_id = ? ORDER BY "order", id',
      booster.id,
    );
    return reply.send({
      booster: boosterView(booster),
      digimonPool: nodes,
      itemPool: items,
    });
  });

  // Global-graph evolution suggestion — the catalog XML's evolvesInto edges.
  // The EQUITOR uses these as candidates only; the booster's own parent->child
  // curation never derives from them (see spec §9).
  app.get<{ Params: { id: string } }>('/api/catalog/digimon/:id/evolutions', async (req, reply) => {
    await requireAuth(req, reply);
    const catalog = loadCatalog();
    const source = catalog.digimons.find((d) => d.id === req.params.id);
    if (!source) return reply.code(404).send({ error: 'digimon not found' });
    const byId = new Map(catalog.digimons.map((d) => [d.id, d]));
    const suggestions = (source.evolvesInto ?? []).map((e) => {
      const target = byId.get(e.targetId);
      return {
        targetId: e.targetId,
        name: target?.name ?? e.targetId,
        stage: target?.stage ?? undefined,
        attribute: target?.attribute ?? undefined,
        element: target?.element ?? undefined,
        requiredLevel: e.requiredLevel,
        requiredItemId: e.requiredItemId,
      };
    });
    return reply.send({ digimonId: source.id, name: source.name, evolutions: suggestions });
  });
};