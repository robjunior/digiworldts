/**
 * Farm HTTP routes. All require an authenticated user. Engine calls are
 * async since the DbAdapter refactor — every one gets `await`.
 *
 *   GET  /api/farm                       → farm buildings view (balances + credits + buildings)
 *   POST /api/farm/collect               → collect every farm building at once
 *   POST /api/farm/collect/:id           → collect one farm building
 *   POST /api/farm/upgrade/:id           → spend credits to raise a farm building's tier
 *   GET  /api/farm/recipes               → factory page: recipes + owned/available factories + balances
 *   POST /api/farm/factories/buy         → { type: med|chip|rare } buy a new factory with resources
 *   POST /api/farm/craft                 → { factoryId, recipeId, auto? } queue an item on a factory
 *   POST /api/farm/craft/cancel/:jobId   → cancel a specific queued/active job, refund resources
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import {
  buyFactory,
  cancelJob,
  collectAllBuildings,
  collectBuilding,
  queueItem,
  readFactoryPage,
  readFarm,
  upgradeBuilding,
  upgradeFactory,
} from './engine.js';

const CraftSchema = z.object({
  factoryId: z.string().min(1),
  recipeId: z.string().min(1),
  auto: z.boolean().optional(),
  count: z.number().int().min(1).max(100).optional(),
});

const BuyFactorySchema = z.object({
  type: z.enum(['med', 'chip', 'rare']),
});

export const farmPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/farm', async (req, reply) => {
    const user = await requireAuth(req, reply);
    return reply.send(await readFarm(user.id));
  });

  app.get('/api/farm/recipes', async (req, reply) => {
    const user = await requireAuth(req, reply);
    return reply.send(await readFactoryPage(user.id));
  });

  app.post('/api/farm/factories/buy', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = BuyFactorySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid-input',
        message: parsed.error.issues[0]?.message ?? 'type required',
      });
    }
    const result = await buyFactory(user.id, parsed.data.type);
    if (!result.ok) {
      const status =
        result.error === 'invalid-type' ? 400
        : result.error === 'already-owned' ? 409
        : result.error === 'insufficient-resources' ? 402
        : 400;
      return reply.code(status).send({
        error: result.error,
        ...(result.missing ? { missing: result.missing } : {}),
      });
    }
    return reply.send(result);
  });

  app.post('/api/farm/craft', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = CraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid-input',
        message: parsed.error.issues[0]?.message ?? 'factoryId + recipeId required',
      });
    }
    const opts: { auto?: boolean; count?: number } = {};
    if (parsed.data.auto === true) opts.auto = true;
    if (typeof parsed.data.count === 'number') opts.count = parsed.data.count;
    const result = await queueItem(user.id, parsed.data.factoryId, parsed.data.recipeId, opts);
    if (!result.ok) {
      const status =
        result.error === 'factory-not-found' || result.error === 'recipe-not-found' ? 404
        : result.error === 'item-missing' ? 404
        : result.error === 'category-mismatch' ? 400
        : result.error === 'invalid-count' ? 400
        : result.error === 'queue-full' ? 409
        : result.error === 'insufficient-resources' ? 402
        : result.error === 'premium-required' ? 403
        : 400;
      const payload: Record<string, unknown> = { error: result.error };
      if (result.missing) payload.missing = result.missing;
      if (typeof result.queueRemainingCapMs === 'number') payload.queueRemainingCapMs = result.queueRemainingCapMs;
      return reply.code(status).send(payload);
    }
    return reply.send(result);
  });

  app.post<{ Params: { jobId: string } }>('/api/farm/craft/cancel/:jobId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const { jobId } = req.params;
    if (!jobId || typeof jobId !== 'string') return reply.code(400).send({ error: 'jobId required' });
    const result = await cancelJob(user.id, jobId);
    if (!result.ok) {
      return reply.code(404).send({ error: result.error });
    }
    return reply.send(result);
  });

  app.post('/api/farm/collect', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await collectAllBuildings(user.id);
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/api/farm/collect/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const { id } = req.params;
    if (!id || typeof id !== 'string') return reply.code(400).send({ error: 'building id required' });
    const result = await collectBuilding(user.id, id);
    if (!result) return reply.code(404).send({ error: 'building not found' });
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/api/farm/upgrade/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const { id } = req.params;
    if (!id || typeof id !== 'string') return reply.code(400).send({ error: 'building id required' });
    const result = await upgradeBuilding(user.id, id);
    if ('error' in result) {
      const status = result.error === 'not-found' ? 404 : 402;
      const payload: { error: string; needed?: number } = { error: result.error };
      if (typeof result.needed === 'number') payload.needed = result.needed;
      return reply.code(status).send(payload);
    }
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>('/api/farm/factory/upgrade/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const { id } = req.params;
    if (!id || typeof id !== 'string') return reply.code(400).send({ error: 'factory id required' });
    const result = await upgradeFactory(user.id, id);
    if (!result.ok) {
      const status =
        result.error === 'factory-not-found' ? 404
        : result.error === 'max-level' ? 409
        : result.error === 'insufficient-bits' ? 402
        : 400;
      const payload: { error: string; needed?: number } = { error: result.error };
      if (typeof result.needed === 'number') payload.needed = result.needed;
      return reply.code(status).send(payload);
    }
    return reply.send(result);
  });
};
