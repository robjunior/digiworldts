import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../auth/routes.js';
import { log } from '../util/log.js';
import { getGameSettings, updateGameSettings } from './engine.js';

export const gameSettingsPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/game-settings', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ settings: await getGameSettings() });
  });

  app.put<{ Body: { xpRate?: number } }>('/api/admin/game-settings', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const body = req.body ?? {};
    if (typeof body.xpRate !== 'number') {
      return reply.code(400).send({ error: 'invalid-input', message: 'xpRate must be a number' });
    }
    const result = await updateGameSettings({ xpRate: body.xpRate });
    if (!result.ok) {
      return reply.code(400).send({ error: result.error, message: result.message });
    }
    log.info('admin.game.settings.update', { adminId: admin.id, xpRate: result.value.xpRate });
    return reply.send({ settings: result.value });
  });
};
