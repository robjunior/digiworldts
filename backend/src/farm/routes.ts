/**
 * Farm HTTP routes. All require an authenticated user. Engine calls are
 * async since the DbAdapter refactor — every one gets `await`.
 *
 *   GET  /api/farm                     → full farm view (balances + credits + buildings)
 *   POST /api/farm/collect             → collect every building at once
 *   POST /api/farm/collect/:id         → collect one building
 *   POST /api/farm/upgrade/:id         → spend credits to raise a building's tier
 *   GET  /api/farm/recipes             → list craftable recipes + can-craft + active job
 *   POST /api/farm/craft               → { recipeId } start a timed crafting job
 *   POST /api/farm/craft/collect       → deliver finished item to inventory
 *   POST /api/farm/craft/cancel        → cancel active job + refund resources
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import {
  cancelCraftingJob,
  collectAllBuildings,
  collectBuilding,
  collectCraftedItem,
  readFarm,
  readRecipes,
  startCraft,
  upgradeBuilding,
} from './engine.js';

const CraftSchema = z.object({ recipeId: z.string().min(1) });

export const farmPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/farm', async (req, reply) => {
    const user = await requireAuth(req, reply);
    return reply.send(await readFarm(user.id));
  });

  app.get('/api/farm/recipes', async (req, reply) => {
    const user = await requireAuth(req, reply);
    return reply.send(await readRecipes(user.id));
  });

  app.post('/api/farm/craft', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = CraftSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', message: parsed.error.issues[0]?.message ?? 'recipeId required' });
    const result = await startCraft(user.id, parsed.data.recipeId);
    if (!result.ok) {
      const status =
        result.error === 'not-found' ? 404
        : result.error === 'insufficient-resources' ? 402
        : result.error === 'busy' ? 409
        : 409;
      return reply.code(status).send({ error: result.error, ...(result.missing ? { missing: result.missing } : {}) });
    }
    return reply.send(result);
  });

  app.post('/api/farm/craft/collect', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await collectCraftedItem(user.id);
    if (!result.ok) {
      const status = result.error === 'no-active-job' ? 404 : 409;
      return reply.code(status).send({ error: result.error });
    }
    return reply.send(result);
  });

  app.post('/api/farm/craft/cancel', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await cancelCraftingJob(user.id);
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
};
