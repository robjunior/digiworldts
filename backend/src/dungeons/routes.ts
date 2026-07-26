import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import {
  completeRun,
  createDungeon,
  createEncounter,
  createItem,
  defeatEncounter,
  deleteDungeon,
  deleteEncounter,
  deleteItem,
  getDungeonView,
  listDungeons,
  moveRun,
  replaceTiles,
  resetRun,
  startOrGetRun,
  updateDungeon,
  updateEncounter,
} from './repo.js';
import {
  asCreateDungeonPayload,
  CreateDungeonInputSchema,
  CreateEncounterInputSchema,
  CreateItemInputSchema,
  MoveInputSchema,
  TilesInputSchema,
  UpdateDungeonInputSchema,
  UpdateEncounterInputSchema,
} from './validation.js';

export const dungeonsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/admin/dungeons', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ dungeons: await listDungeons() });
  });

  app.post('/api/admin/dungeons', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = CreateDungeonInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-dungeon', details: parsed.error.issues });
    const dungeon = await createDungeon(asCreateDungeonPayload(parsed.data));
    log.info('admin.dungeon.create', { adminId: admin.id, id: dungeon.id, name: dungeon.name });
    return reply.code(201).send({ dungeon });
  });

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send(view);
  });

  app.put<{ Params: { id: string } }>('/api/admin/dungeons/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateDungeonInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-dungeon', details: parsed.error.issues });
    const dungeon = await updateDungeon(req.params.id, parsed.data);
    if (!dungeon) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.update', { adminId: admin.id, id: dungeon.id });
    return reply.send({ dungeon });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/dungeons/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteDungeon(req.params.id);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.delete', { adminId: admin.id, id: req.params.id });
    return reply.send({ ok: true });
  });

  app.put<{ Params: { id: string } }>('/api/admin/dungeons/:id/tiles', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = TilesInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-tiles', details: parsed.error.issues });
    const tiles = await replaceTiles(req.params.id, parsed.data.tiles);
    if (!tiles) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.tiles.replace', { adminId: admin.id, id: req.params.id, count: tiles.length });
    return reply.send({ tiles });
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/encounters', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = CreateEncounterInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-encounter', details: parsed.error.issues });
    const encounter = await createEncounter(req.params.id, parsed.data);
    if (encounter === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (encounter === 'conflict') return reply.code(409).send({ error: 'encounter-position-conflict' });
    log.info('admin.dungeon.encounter.create', { adminId: admin.id, dungeonId: req.params.id, id: encounter.id });
    return reply.code(201).send({ encounter });
  });

  app.put<{ Params: { id: string; encId: string } }>('/api/admin/dungeons/:id/encounters/:encId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateEncounterInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-encounter', details: parsed.error.issues });
    const encounter = await updateEncounter(req.params.id, req.params.encId, parsed.data);
    if (encounter === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (encounter === 'conflict') return reply.code(409).send({ error: 'encounter-position-conflict' });
    log.info('admin.dungeon.encounter.update', { adminId: admin.id, dungeonId: req.params.id, id: encounter.id });
    return reply.send({ encounter });
  });

  app.delete<{ Params: { id: string; encId: string } }>('/api/admin/dungeons/:id/encounters/:encId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteEncounter(req.params.id, req.params.encId);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.encounter.delete', { adminId: admin.id, dungeonId: req.params.id, id: req.params.encId });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/items', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = CreateItemInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-item', details: parsed.error.issues });
    const item = await createItem(req.params.id, parsed.data);
    if (item === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (item === 'conflict') return reply.code(409).send({ error: 'item-position-conflict' });
    log.info('admin.dungeon.item.create', { adminId: admin.id, dungeonId: req.params.id, id: item.id });
    return reply.code(201).send({ item });
  });

  app.delete<{ Params: { id: string; itemId: string } }>('/api/admin/dungeons/:id/items/:itemId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteItem(req.params.id, req.params.itemId);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.item.delete', { adminId: admin.id, dungeonId: req.params.id, id: req.params.itemId });
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>('/api/dungeon/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const view = await startOrGetRun(user.id, req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send(view);
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/move', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = MoveInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-move', details: parsed.error.issues });
    const moved = await moveRun(user.id, req.params.id, parsed.data.x, parsed.data.y);
    if (moved.kind === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (moved.kind === 'blocked') return reply.code(400).send({ error: 'not-walkable' });
    if (moved.kind === 'not-adjacent') return reply.code(400).send({ error: 'not-adjacent' });
    if (moved.kind === 'ok') return reply.send({ run: moved.run, triggeredEncounterId: moved.triggeredEncounterId, pickedUpItemId: moved.pickedUpItemId });
    return reply.code(500).send({ error: 'internal error' });
  });

  app.post<{ Params: { id: string; encId: string } }>('/api/dungeon/:id/encounter/:encId/defeat', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const run = await defeatEncounter(user.id, req.params.id, req.params.encId);
    if (!run) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ run });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/complete', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const completed = await completeRun(user.id, req.params.id);
    if (!completed) return reply.code(404).send({ error: 'not-found' });
    return reply.send(completed);
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/reset', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const run = await resetRun(user.id, req.params.id);
    if (!run) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ run });
  });
};
