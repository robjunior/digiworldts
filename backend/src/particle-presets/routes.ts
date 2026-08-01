import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { ParticleEmitterConfig } from '@digiworld/shared/weather';

import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { ParticleEmitterConfigZ } from '../scenes/routes.js';
import {
  createParticlePreset,
  deleteParticlePreset,
  getParticlePreset,
  listParticlePresets,
  updateParticlePreset,
} from './store.js';

const PresetCreateZ = z.object({
  name: z.string().trim().min(1).max(120),
  emitter: ParticleEmitterConfigZ,
}).strict();

const PresetUpdateZ = PresetCreateZ.partial();

export const particlePresetsPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/particle-presets', async (req, reply) => {
    await requireAuth(req, reply);
    const presets = await listParticlePresets();
    return reply.send({ presets });
  });

  app.post('/api/admin/particle-presets', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = PresetCreateZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const preset = await createParticlePreset({
      name: parsed.data.name,
      emitter: parsed.data.emitter,
    });
    log.info('admin.particle-preset.create', { adminId: admin.id, presetId: preset.id, name: preset.name });
    return reply.code(201).send({ ok: true, preset });
  });

  app.put<{ Params: { id: string } }>('/api/admin/particle-presets/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = PresetUpdateZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const patch: { name?: string; emitter?: ParticleEmitterConfig } = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.emitter !== undefined) patch.emitter = parsed.data.emitter;
    const preset = await updateParticlePreset(req.params.id, patch);
    if (preset === null) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.particle-preset.update', { adminId: admin.id, presetId: preset.id });
    return reply.send({ ok: true, preset });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/particle-presets/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const existing = await getParticlePreset(req.params.id);
    if (existing === null) return reply.code(404).send({ error: 'not-found' });
    const ok = await deleteParticlePreset(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.particle-preset.delete', { adminId: admin.id, presetId: req.params.id });
    return reply.send({ ok: true });
  });
};
