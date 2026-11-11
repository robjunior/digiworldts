import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PvePlaceInput } from '@digiworld/shared/pve';
import { STAGES } from '@digiworld/shared/digimon';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { deletePvePlace, listPvePlaces, readPveWorld, savePvePartyPreferences, startPveEncounter, upsertPvePlace } from './pve.js';

const PoolEntry = z.object({ catalogId: z.string().min(1), weight: z.number().positive().finite() });
const PlaceInput = z.object({
  id: z.string().min(3).max(48).regex(/^[a-z0-9_-]+$/i),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500),
  x: z.number().finite(), y: z.number().finite(),
  minWildLevel: z.number().int().min(1).max(999).optional(), maxWildLevel: z.number().int().min(1).max(999).optional(),
  minWildStage: z.enum(STAGES).optional(), maxWildStage: z.enum(STAGES).optional(),
  wildCountMin: z.number().int().min(1).max(3).optional(), wildCountMax: z.number().int().min(1).max(3).optional(),
  levelVarianceMin: z.number().min(0.1).max(3).optional(), levelVarianceMax: z.number().min(0.1).max(3).optional(),
  xpMultiplier: z.number().min(0).max(100).optional(), bitsMultiplier: z.number().min(0).max(100).optional(),
  explorePool: z.array(PoolEntry), expeditionPool: z.array(PoolEntry), enabled: z.boolean().optional(),
});
const PartyInput = z.object({ mode: z.enum(['explore', 'expedition']), party: z.array(z.string().min(1)).max(3) });

export const pveWorldPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/world', async (req, reply) => {
    const user = await requireAuth(req, reply);
    return reply.send(await readPveWorld(user.id));
  });

  app.put('/api/world/party', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = PartyInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-party', details: parsed.error.issues });
    try { return reply.send({ preferences: await savePvePartyPreferences(user.id, parsed.data.mode, parsed.data.party) }); }
    catch { return reply.code(400).send({ error: 'invalid-party' }); }
  });

  app.post('/api/world/pve/start', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = z.object({
      placeId: z.string().min(1),
      mode: z.enum(['explore', 'expedition']),
      hours: z.number().int().min(1).max(8).optional(),
      exclude: z.array(z.string().min(1)).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-encounter' });
    const result = await startPveEncounter(user.id, parsed.data.placeId, parsed.data.mode, parsed.data.hours ?? 1, parsed.data.exclude);
    return result.ok ? reply.send(result) : reply.code(result.error === 'already-in-battle' ? 409 : 400).send(result);
  });

  app.get('/api/admin/pve/places', async (_req, reply) => {
    await requireAdmin(_req, reply);
    return reply.send({ places: await listPvePlaces(true) });
  });
  app.put('/api/admin/pve/places/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const parsed = PlaceInput.safeParse({ ...(req.body as object), id: (req.params as { id: string }).id });
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-place', details: parsed.error.issues });
    try {
      const input = {
        id: parsed.data.id,
        name: parsed.data.name,
        description: parsed.data.description,
        x: parsed.data.x,
        y: parsed.data.y,
        explorePool: parsed.data.explorePool,
        expeditionPool: parsed.data.expeditionPool,
      } as PvePlaceInput;
      if (parsed.data.minWildLevel !== undefined) Object.assign(input, { minWildLevel: parsed.data.minWildLevel });
      if (parsed.data.maxWildLevel !== undefined) Object.assign(input, { maxWildLevel: parsed.data.maxWildLevel });
      if (parsed.data.minWildStage !== undefined) Object.assign(input, { minWildStage: parsed.data.minWildStage });
      if (parsed.data.maxWildStage !== undefined) Object.assign(input, { maxWildStage: parsed.data.maxWildStage });
      for (const key of ['wildCountMin', 'wildCountMax', 'levelVarianceMin', 'levelVarianceMax', 'xpMultiplier', 'bitsMultiplier'] as const) if (parsed.data[key] !== undefined) Object.assign(input, { [key]: parsed.data[key] });
      if (parsed.data.enabled !== undefined) Object.assign(input, { enabled: parsed.data.enabled });
      return reply.send({ place: await upsertPvePlace(input) });
    }
    catch { return reply.code(400).send({ error: 'invalid-place' }); }
  });
  app.delete('/api/admin/pve/places/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const deleted = await deletePvePlace((req.params as { id: string }).id);
    return deleted ? reply.send({ ok: true }) : reply.code(404).send({ error: 'not-found' });
  });
};
