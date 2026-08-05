import type { FastifyPluginAsync } from 'fastify';

import { SkillVfxPresetWriteZ } from '@digiworld/shared/skill-vfx';

import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import {
  createSkillVfxPreset,
  deleteSkillVfxPreset,
  getSkillVfxPreset,
  listSkillVfxPresets,
  updateSkillVfxPreset,
} from './store.js';

const PresetCreateZ = SkillVfxPresetWriteZ;
const PresetUpdateZ = SkillVfxPresetWriteZ.partial();

export const skillVfxPresetsPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/skill-vfx-presets', async (req, reply) => {
    await requireAuth(req, reply);
    const presets = await listSkillVfxPresets();
    return reply.send({ presets });
  });

  app.get<{ Params: { id: string } }>('/api/skill-vfx-presets/:id', async (req, reply) => {
    await requireAuth(req, reply);
    const preset = await getSkillVfxPreset(req.params.id);
    if (preset === null) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ preset });
  });

  app.post('/api/admin/skill-vfx-presets', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = PresetCreateZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const preset = await createSkillVfxPreset(parsed.data);
    log.info('admin.skill-vfx.create', { adminId: admin.id, presetId: preset.id, name: preset.name });
    return reply.code(201).send({ ok: true, preset });
  });

  app.put<{ Params: { id: string } }>('/api/admin/skill-vfx-presets/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = PresetUpdateZ.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', issues: parsed.error.issues });
    }
    const preset = await updateSkillVfxPreset(req.params.id, parsed.data);
    if (preset === null) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.skill-vfx.update', { adminId: admin.id, presetId: preset.id });
    return reply.send({ ok: true, preset });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/skill-vfx-presets/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const existing = await getSkillVfxPreset(req.params.id);
    if (existing === null) return reply.code(404).send({ error: 'not-found' });
    const ok = await deleteSkillVfxPreset(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.skill-vfx.delete', { adminId: admin.id, presetId: req.params.id });
    return reply.send({ ok: true });
  });
};
