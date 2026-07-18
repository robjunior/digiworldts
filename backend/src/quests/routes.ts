import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { partyRating } from '../world/engine.js';
import {
  createQuest,
  createWorldObject,
  deleteQuest,
  deleteWorldObject,
  getWorldObject,
  getQuest,
  importQuest,
  listAvailableQuests,
  listQuests,
  listWorldObjects,
  startQuest,
  updateQuest,
  updateWorldObject,
} from './repo.js';
import { asImportPayload, asQuestPayload, asWorldObjectPayload, QuestImportSchema, QuestInputSchema, WorldObjectInputSchema } from './validation.js';

export const questsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/admin/quests', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ quests: await listQuests() });
  });

  app.get<{ Params: { id: string } }>('/api/admin/quests/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const quest = await getQuest(req.params.id);
    if (!quest) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ quest });
  });

  app.post('/api/admin/quests', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = QuestInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-quest', details: parsed.error.issues });
    const quest = await createQuest(asQuestPayload(parsed.data));
    log.info('admin.quest.create', { adminId: admin.id, id: quest.id, name: quest.name });
    return reply.code(201).send({ quest });
  });

  app.put<{ Params: { id: string } }>('/api/admin/quests/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = QuestInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-quest', details: parsed.error.issues });
    const quest = await updateQuest(req.params.id, asQuestPayload(parsed.data));
    if (!quest) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.quest.update', { adminId: admin.id, id: quest.id });
    return reply.send({ quest });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/quests/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteQuest(req.params.id);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.quest.delete', { adminId: admin.id, id: req.params.id });
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>('/api/admin/quests/:id/export', async (req, reply) => {
    await requireAdmin(req, reply);
    const quest = await getQuest(req.params.id);
    if (!quest) return reply.code(404).send({ error: 'not-found' });
    return reply.send(quest);
  });

  app.post('/api/admin/quests/import', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = QuestImportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-quest', details: parsed.error.issues });
    const quest = await importQuest(asImportPayload(parsed.data));
    log.info('admin.quest.import', { adminId: admin.id, id: quest.id, name: quest.name });
    return reply.send({ quest });
  });

  app.get('/api/quests/available', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const rating = await partyRating(user.id);
    return reply.send({ quests: await listAvailableQuests(user.id, rating.meanLevel) });
  });

  app.post<{ Params: { id: string } }>('/api/quests/:id/start', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await startQuest(user.id, req.params.id);
    if (!result) return reply.code(404).send({ error: 'not-found' });
    return reply.code(201).send(result);
  });

  app.get('/api/world/objects', async (req, reply) => {
    await requireAuth(req, reply);
    return reply.send({ objects: await listWorldObjects() });
  });

  app.get<{ Params: { id: string } }>('/api/admin/world-objects/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const object = await getWorldObject(req.params.id);
    if (!object) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ object });
  });

  app.post('/api/admin/world-objects', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = WorldObjectInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-world-object', details: parsed.error.issues });
    const object = await createWorldObject(asWorldObjectPayload(parsed.data));
    log.info('admin.worldObject.create', { adminId: admin.id, id: object.id, x: object.x, y: object.y });
    return reply.code(201).send({ object });
  });

  app.put<{ Params: { id: string } }>('/api/admin/world-objects/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = WorldObjectInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-world-object', details: parsed.error.issues });
    const object = await updateWorldObject(req.params.id, asWorldObjectPayload(parsed.data));
    if (!object) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.worldObject.update', { adminId: admin.id, id: object.id });
    return reply.send({ object });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/world-objects/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteWorldObject(req.params.id);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.worldObject.delete', { adminId: admin.id, id: req.params.id });
    return reply.send({ ok: true });
  });
};
