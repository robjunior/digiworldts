import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import {
  completeRun,
  createDungeon,
  createEncounter,
  createDoor,
  createItem,
  createWarp,
  defeatEncounter,
  deleteDungeon,
  deleteDoor,
  deleteEncounter,
  deleteItem,
  deleteWarp,
  getEncounter,
  getDungeon,
  getRun,
  getDungeonView,
  listDungeons,
  moveRun,
  replaceTiles,
  resetRun,
  startOrGetRun,
  unlockDoor,
  updateDoor,
  updateDungeon,
  updateEncounter,
  updateWarp,
} from './repo.js';
import { createTrap, deleteTrap, listTraps, updateTrap } from './traps.js';
import {
  asCreateDungeonPayload,
  CreateDungeonInputSchema,
  DoorInputSchema,
  CreateEncounterInputSchema,
  CreateItemInputSchema,
  CreateWarpInputSchema,
  MoveInputSchema,
  StartRandomEncounterInputSchema,
  TilesInputSchema,
  TrapInputSchema,
  UpdateDungeonInputSchema,
  UpdateDoorInputSchema,
  UpdateEncounterInputSchema,
  UpdateTrapInputSchema,
  UpdateWarpInputSchema,
  asEncounterDigimon,
} from './validation.js';
import { loadCatalog, findTemplate } from '../digimon/xml.js';
import { setPveDungeonContext, startPveBattleFromEncounter } from '../world/pve-battle.js';
import type { WildMon } from '../world/engine.js';
import { randomEncounterMatchesDungeonConfig } from './random.js';

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

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/warps', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = CreateWarpInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-warp', details: parsed.error.issues });
    const warp = await createWarp(req.params.id, parsed.data);
    if (warp === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (warp === 'conflict') return reply.code(409).send({ error: 'warp-position-conflict' });
    log.info('admin.dungeon.warp.create', { adminId: admin.id, dungeonId: req.params.id, id: warp.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.code(201).send(view);
  });

  app.put<{ Params: { id: string; warpId: string } }>('/api/admin/dungeons/:id/warps/:warpId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateWarpInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-warp', details: parsed.error.issues });
    const warp = await updateWarp(req.params.id, req.params.warpId, parsed.data);
    if (warp === 'not-found') return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.warp.update', { adminId: admin.id, dungeonId: req.params.id, id: warp.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send(view);
  });

  app.delete<{ Params: { id: string; warpId: string } }>('/api/admin/dungeons/:id/warps/:warpId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteWarp(req.params.id, req.params.warpId);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.warp.delete', { adminId: admin.id, dungeonId: req.params.id, id: req.params.warpId });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send(view);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/doors', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = DoorInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-door', details: parsed.error.issues });
    const door = await createDoor(req.params.id, parsed.data);
    if (door === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (door === 'conflict') return reply.code(409).send({ error: 'door-position-conflict' });
    log.info('admin.dungeon.door.create', { adminId: admin.id, dungeonId: req.params.id, id: door.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.code(201).send({ view });
  });

  app.put<{ Params: { id: string; doorId: string } }>('/api/admin/dungeons/:id/doors/:doorId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateDoorInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-door', details: parsed.error.issues });
    const door = await updateDoor(req.params.id, req.params.doorId, parsed.data);
    if (door === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (door === 'conflict') return reply.code(409).send({ error: 'door-position-conflict' });
    log.info('admin.dungeon.door.update', { adminId: admin.id, dungeonId: req.params.id, id: door.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ view });
  });

  app.delete<{ Params: { id: string; doorId: string } }>('/api/admin/dungeons/:id/doors/:doorId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteDoor(req.params.id, req.params.doorId);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.door.delete', { adminId: admin.id, dungeonId: req.params.id, id: req.params.doorId });
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>('/api/dungeon/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const view = await startOrGetRun(user.id, req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    const biome = view.dungeon.biomeRegion;
    if (biome !== null) {
      const { bumpTravelObjectives } = await import('../quests/repo.js');
      bumpTravelObjectives(user.id, biome as import('@digiworld/shared/world').Biome).catch((err) => {
        log.warn('quests.travel.bump.failed', { userId: user.id, biome, err: err instanceof Error ? err.message : String(err) });
      });
    }
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
    if (moved.kind === 'blocked-by-door') return reply.send({ run: moved.run, triggeredEncounterId: null, pickedUpItemId: null, blockedByDoorId: moved.doorId });
    if (moved.kind === 'ok') return reply.send({ run: moved.run, triggeredEncounterId: moved.triggeredEncounterId, pickedUpItemId: moved.pickedUpItemId, ...(moved.randomEncounter ? { randomEncounter: moved.randomEncounter } : {}), ...(moved.warpToDungeonId !== undefined ? { warpToDungeonId: moved.warpToDungeonId } : {}), ...(moved.trapTriggered ? { trapTriggered: moved.trapTriggered } : {}) });
    return reply.code(500).send({ error: 'internal error' });
  });

  app.post<{ Params: { id: string; doorId: string } }>('/api/dungeons/:id/doors/:doorId/unlock', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const unlocked = await unlockDoor(user.id, req.params.id, req.params.doorId);
    if (unlocked.ok) return reply.send({ view: unlocked.view });
    if (unlocked.error === 'missing-key') return reply.code(400).send({ error: 'missing-key', keyItemId: unlocked.keyItemId });
    if (unlocked.error === 'no-run') return reply.code(404).send({ error: 'no-run' });
    return reply.code(404).send({ error: 'not-found' });
  });

  app.post<{ Params: { id: string; encId: string } }>('/api/dungeon/:id/encounter/:encId/start', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const run = await getRun(user.id, req.params.id);
    if (!run) return reply.code(404).send({ error: 'not-found' });
    const encounter = await getEncounter(req.params.id, req.params.encId);
    if (!encounter) return reply.code(404).send({ error: 'not-found' });
    if (run.defeatedEncounters.includes(encounter.id)) {
      return reply.code(409).send({ error: 'encounter-already-defeated' });
    }

    const catalog = loadCatalog();
    const wilds: WildMon[] = encounter.digimon.flatMap((mon) => {
      const template = findTemplate(catalog, mon.catalogId);
      if (!template) return [];
      return [{
        catalogId: mon.catalogId,
        name: mon.nickname ?? template.name,
        element: template.element,
        stage: template.stage,
        level: mon.level,
        portrait: template.assets.portrait,
        rare: encounter.difficulty === 'elite' || encounter.difficulty === 'boss',
        ...(mon.statOverride ? { statOverride: mon.statOverride } : {}),
        ...(mon.skillsOverride ? { skillsOverride: mon.skillsOverride } : {}),
      }];
    });
    if (wilds.length !== encounter.digimon.length) return reply.code(500).send({ error: 'catalog-missing' });

    const started = await startPveBattleFromEncounter(user.id, wilds);
    if (!started.ok) {
      if (started.error === 'party-invalid') {
        return reply.code(409).send({ error: 'party-invalid', message: 'Assign 3 alive Digimon to your party first.' });
      }
      if (started.error === 'catalog-missing') return reply.code(500).send({ error: 'catalog-missing' });
      if (started.error === 'battle-in-progress') return reply.code(409).send({ error: 'battle-in-progress' });
      return reply.code(500).send({ error: 'internal error' });
    }
    setPveDungeonContext(user.id, req.params.id, req.params.encId);
    return reply.send({ battle: started.view });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/random-encounter/start', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const run = await getRun(user.id, req.params.id);
    if (!run) return reply.code(404).send({ error: 'not-found' });
    const dungeon = await getDungeon(req.params.id);
    if (!dungeon) return reply.code(404).send({ error: 'not-found' });
    const parsed = StartRandomEncounterInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-random-encounter', details: parsed.error.issues });
    const catalog = loadCatalog();
    const digimon = parsed.data.digimon.map(asEncounterDigimon);
    if (!dungeon.randomEncountersEnabled || !randomEncounterMatchesDungeonConfig(dungeon, catalog, digimon)) {
      return reply.code(400).send({ error: 'invalid-random-encounter' });
    }
    const wilds: WildMon[] = digimon.flatMap((mon) => {
      const template = findTemplate(catalog, mon.catalogId);
      if (!template) return [];
      return [{
        catalogId: mon.catalogId,
        name: mon.nickname ?? template.name,
        element: template.element,
        stage: template.stage,
        level: mon.level,
        portrait: template.assets.portrait,
        rare: false,
        ...(mon.statOverride ? { statOverride: mon.statOverride } : {}),
        ...(mon.skillsOverride ? { skillsOverride: mon.skillsOverride } : {}),
      }];
    });
    if (wilds.length !== digimon.length) return reply.code(500).send({ error: 'catalog-missing' });
    const started = await startPveBattleFromEncounter(user.id, wilds);
    if (!started.ok) {
      if (started.error === 'party-invalid') return reply.code(409).send({ error: 'party-invalid', message: 'Assign 3 alive Digimon to your party first.' });
      if (started.error === 'catalog-missing') return reply.code(500).send({ error: 'catalog-missing' });
      if (started.error === 'battle-in-progress') return reply.code(409).send({ error: 'battle-in-progress' });
      return reply.code(500).send({ error: 'internal error' });
    }
    return reply.send({ battle: started.view });
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

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id/traps', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ traps: await listTraps(req.params.id) });
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/traps', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = TrapInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-trap', details: parsed.error.issues });
    const trap = await createTrap(req.params.id, { x: parsed.data.x, y: parsed.data.y, kind: parsed.data.kind, severity: parsed.data.severity, label: parsed.data.label ?? null });
    if (trap === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (trap === 'conflict') return reply.code(409).send({ error: 'trap-position-conflict' });
    log.info('admin.dungeon.trap.create', { adminId: admin.id, dungeonId: req.params.id, id: trap.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.code(201).send({ view });
  });

  app.put<{ Params: { id: string; trapId: string } }>('/api/admin/dungeons/:id/traps/:trapId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateTrapInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-trap', details: parsed.error.issues });
    const trap = await updateTrap(req.params.id, req.params.trapId, parsed.data);
    if (trap === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (trap === 'conflict') return reply.code(409).send({ error: 'trap-position-conflict' });
    log.info('admin.dungeon.trap.update', { adminId: admin.id, dungeonId: req.params.id, id: trap.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ view });
  });

  app.delete<{ Params: { id: string; trapId: string } }>('/api/admin/dungeons/:id/traps/:trapId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteTrap(req.params.id, req.params.trapId);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.trap.delete', { adminId: admin.id, dungeonId: req.params.id, id: req.params.trapId });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ view });
  });
};
