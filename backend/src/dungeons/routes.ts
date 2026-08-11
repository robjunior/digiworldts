import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { one, run } from '../db/index.js';
import {
  applyTiledImportNew,
  applyTiledImportReplace,
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
  extractRun,
  getEncounter,
  getDungeon,
  getRun,
  getDungeonView,
  listDungeons,
  moveRun,
  replaceTiles,
  resetRun,
  setDungeonRandomPool,
  startOrGetRun,
  unlockDoor,
  updateDoor,
  updateDungeon,
  updateEncounter,
  updateWarp,
  wipeRun,
} from './repo.js';
import { parseTiledJson, tiledMapToImportPayload } from './tiled-import.js';
import { createTrap, deleteTrap, listTraps, updateTrap } from './traps.js';
import { listZones, replaceZones } from './zones.js';
import { createKit, deleteKit, getKitWithItems, listKitsForUser, updateKit, type KitOutcome } from './kits.js';
import { escrowKitToStash, readStash } from './stash.js';
import { hasFlag } from '../flags/repo.js';import { BIOMES } from '@digiworld/shared/world';
import type { Kit, KitError } from '@digiworld/shared/dungeon';
import {
  asCreateDungeonPayload,
  CreateDungeonInputSchema,
  DoorInputSchema,
  DungeonRandomPoolInputSchema,
  CreateEncounterInputSchema,
  CreateItemInputSchema,
  CreateWarpInputSchema,
  MoveInputSchema,
  ReplaceZonesInputSchema,
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
import { countPartyMembers } from '../roster/routes.js';
import { setPveDungeonContext, startPveBattleFromEncounter } from '../world/pve-battle.js';
import type { WildMon } from '../world/engine.js';
import { randomEncounterMatchesDungeonConfig } from './random.js';

const ImportTiledNewInputSchema = z.object({
  tiledJson: z.unknown(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  biome: z.union([z.enum(BIOMES), z.literal('null')]),
});

const ImportTiledReplaceInputSchema = z.object({
  tiledJson: z.unknown(),
});

const KitItemSchema = z.object({
  itemId: z.string().min(1),
  qty: z.number().int().positive(),
  slotOrder: z.number().int(),
});

const KitInputSchema = z.object({
  name: z.string().trim().min(1).max(64),
  items: z.array(KitItemSchema).max(20),
});

const EnterDungeonInputSchema = z.object({
  kitId: z.string().min(1).optional(),
});

const UseScrollInputSchema = z.object({
  itemId: z.string().min(1),
});

function kitErrorHttpCode(err: KitError): number {
  switch (err) {
    case 'not-found':
      return 404;
    case 'duplicate-name':
    case 'duplicate-item':
      return 409;
    case 'invalid-name':
    case 'invalid-items':
      return 400;
  }
}

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

  app.post('/api/admin/dungeons/import-tiled', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsedBody = ImportTiledNewInputSchema.safeParse(req.body);
    if (!parsedBody.success) return reply.code(400).send({ error: 'invalid-import-input', details: parsedBody.error.issues });
    const parsedTiled = parseTiledJson(parsedBody.data.tiledJson);
    if (!parsedTiled.ok) return reply.code(400).send({ error: parsedTiled.error, details: parsedTiled.details });
    const payload = tiledMapToImportPayload(parsedTiled.map);
    if (!payload.ok) return reply.code(400).send({ error: payload.error, details: payload.details });
    const result = await applyTiledImportNew({
      name: parsedBody.data.name,
      biome: parsedBody.data.biome,
      ...(parsedBody.data.description !== undefined ? { description: parsedBody.data.description } : {}),
      payload: payload.payload,
    });
    if (!result.ok) return reply.code(409).send({ error: result.error, missing: result.missing });
    log.info('admin.dungeon.import.new', {
      adminId: admin.id,
      id: result.dungeon.id,
      tiles: payload.payload.tiles.length,
      tilesets: payload.payload.tilesets.length,
      encounters: payload.payload.encounters.length,
      items: payload.payload.items.length,
      doors: payload.payload.doors.length,
      warps: payload.payload.warps.length,
      traps: payload.payload.traps.length,
    });
    return reply.code(201).send({ dungeon: result.dungeon, warnings: payload.warnings });
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/import-tiled', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsedBody = ImportTiledReplaceInputSchema.safeParse(req.body);
    if (!parsedBody.success) return reply.code(400).send({ error: 'invalid-import-input', details: parsedBody.error.issues });
    const parsedTiled = parseTiledJson(parsedBody.data.tiledJson);
    if (!parsedTiled.ok) return reply.code(400).send({ error: parsedTiled.error, details: parsedTiled.details });
    const existing = await getDungeon(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'not-found' });
    const payload = tiledMapToImportPayload(parsedTiled.map, { currentSpawn: { x: existing.spawnX, y: existing.spawnY } });
    if (!payload.ok) return reply.code(400).send({ error: payload.error, details: payload.details });
    const result = await applyTiledImportReplace(req.params.id, payload.payload);
    if (!result.ok) {
      if (result.error === 'not-found') return reply.code(404).send({ error: 'not-found' });
      return reply.code(409).send({ error: result.error, missing: result.missing });
    }
    log.info('admin.dungeon.import.replace', {
      adminId: admin.id,
      id: req.params.id,
      tiles: payload.payload.tiles.length,
      tilesets: payload.payload.tilesets.length,
      encounters: payload.payload.encounters.length,
      items: payload.payload.items.length,
      doors: payload.payload.doors.length,
      warps: payload.payload.warps.length,
      traps: payload.payload.traps.length,
    });
    return reply.send({ view: result.view, warnings: payload.warnings });
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
    const partySize = await countPartyMembers(user.id);
    if (partySize < 1) return reply.code(400).send({ error: 'empty-party' });
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

    const started = await startPveBattleFromEncounter(user.id, wilds, encounter.sceneId);
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

  app.get('/api/dungeon/kits', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const kits = await listKitsForUser(me.id);
    return reply.send({ kits });
  });

  app.post('/api/dungeon/kits', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = KitInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result: KitOutcome<Kit> = await createKit(me.id, parsed.data);
    if (!result.ok) return reply.code(kitErrorHttpCode(result.error)).send({ error: result.error });
    return reply.send({ kit: result.kit });
  });

  app.put<{ Params: { id: string } }>('/api/dungeon/kits/:id', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = KitInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result: KitOutcome<Kit> = await updateKit(me.id, req.params.id, parsed.data);
    if (!result.ok) return reply.code(kitErrorHttpCode(result.error)).send({ error: result.error });
    return reply.send({ kit: result.kit });
  });

  app.delete<{ Params: { id: string } }>('/api/dungeon/kits/:id', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const removed = await deleteKit(me.id, req.params.id);
    if (!removed) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/enter', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = EnterDungeonInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });

    if (parsed.data.kitId !== undefined) {
      const flagOn = await hasFlag(me.id, 'dungeon-kit-enabled');
      if (!flagOn) return reply.code(403).send({ error: 'kit-flag-disabled' });
      const kit = await getKitWithItems(me.id, parsed.data.kitId);
      if (!kit) return reply.code(404).send({ error: 'kit-not-found' });
      const escrow = await escrowKitToStash(me.id, req.params.id, kit);
      if (!escrow.ok) return reply.code(402).send({ error: escrow.error, missing: escrow.missing });
      const view = await startOrGetRun(me.id, req.params.id);
      if (!view) return reply.code(404).send({ error: 'dungeon-not-found' });
      log.info('dungeon.enter', { userId: me.id, dungeonId: req.params.id, kitId: parsed.data.kitId });
      return reply.send({ view, stash: escrow.stash });
    }

    const view = await startOrGetRun(me.id, req.params.id);
    if (!view) return reply.code(404).send({ error: 'dungeon-not-found' });
    const stash = await readStash(me.id, req.params.id);
    return reply.send({ view, stash });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/extract', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const dungeon = await getDungeon(req.params.id);
    if (!dungeon) return reply.code(404).send({ error: 'dungeon-not-found' });
    const activeRun = await getRun(me.id, req.params.id);
    if (!activeRun) return reply.code(404).send({ error: 'no-run' });
    if (activeRun.state !== 'active') return reply.code(409).send({ error: 'run-not-active', state: activeRun.state });

    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'dungeon-not-found' });
    const onExit = view.warps.some((w) => w.isExit && w.x === activeRun.currentX && w.y === activeRun.currentY);
    if (!onExit) return reply.code(409).send({ error: 'not-on-exit-tile', x: activeRun.currentX, y: activeRun.currentY });

    const result = await extractRun(me.id, req.params.id, 'walked_out');
    if (!result) return reply.code(409).send({ error: 'extract-failed' });
    log.info('dungeon.extract.walked_out', { userId: me.id, dungeonId: req.params.id, itemCount: result.extractedItems.length });
    return reply.send({
      run: result.run,
      extractedItems: result.extractedItems,
      extractedResources: result.extractedResources,
      extractionKind: result.extractionKind,
    });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/use-scroll', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const parsed = UseScrollInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });

    const dungeon = await getDungeon(req.params.id);
    if (!dungeon) return reply.code(404).send({ error: 'dungeon-not-found' });
    const activeRun = await getRun(me.id, req.params.id);
    if (!activeRun) return reply.code(404).send({ error: 'no-run' });
    if (activeRun.state !== 'active') return reply.code(409).send({ error: 'run-not-active', state: activeRun.state });

    const shopItem = await one<{ id: string; item_type: string }>(
      "SELECT id, item_type FROM shop_items WHERE id = ? AND enabled = 1",
      parsed.data.itemId,
    );
    if (!shopItem) return reply.code(404).send({ error: 'scroll-not-found' });
    if (shopItem.item_type !== 'extraction') return reply.code(400).send({ error: 'not-extraction-scroll' });

    const redirectToStash = await hasFlag(me.id, 'dungeon-extraction');
    const now = Date.now();
    let deducted = false;
    if (redirectToStash) {
      const decRes = await run(
        "UPDATE dungeon_run_stash SET qty = qty - 1, updated_at = ? WHERE user_id = ? AND dungeon_id = ? AND item_id = ? AND qty >= 1",
        now, me.id, req.params.id, parsed.data.itemId,
      );
      deducted = decRes.changes > 0;
    } else {
      const decRes = await run(
        "UPDATE player_inventory SET qty = qty - 1, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= 1",
        now, me.id, parsed.data.itemId,
      );
      deducted = decRes.changes > 0;
    }
    if (!deducted) return reply.code(402).send({ error: 'insufficient-scroll' });

    const result = await extractRun(me.id, req.params.id, 'teleport_scroll');
    if (!result) return reply.code(409).send({ error: 'extract-failed' });
    log.info('dungeon.extract.teleport_scroll', { userId: me.id, dungeonId: req.params.id, itemId: parsed.data.itemId, itemCount: result.extractedItems.length });
    return reply.send({
      run: result.run,
      extractedItems: result.extractedItems,
      extractedResources: result.extractedResources,
      extractionKind: result.extractionKind,
    });
  });

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id/random-pool', async (req, reply) => {
    await requireAdmin(req, reply);
    const dungeon = await getDungeon(req.params.id);
    if (!dungeon) return reply.code(404).send({ error: 'not-found' });
    return reply.send({
      pool: dungeon.randomPool,
      params: {
        encounterRate: dungeon.randomEncounterRate,
        minLevel: dungeon.randomMinLevel,
        maxLevel: dungeon.randomMaxLevel,
        maxStage: dungeon.randomMaxStage,
        minPartySize: dungeon.randomMinPartySize,
        maxPartySize: dungeon.randomMaxPartySize,
        allowedElements: dungeon.randomAllowedElements ?? [],
      },
    });
  });

  app.put<{ Params: { id: string } }>('/api/admin/dungeons/:id/random-pool', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = DungeonRandomPoolInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const dungeon = await setDungeonRandomPool(req.params.id, parsed.data.pool, parsed.data.params);
    if (!dungeon) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.random-pool.set', { adminId: admin.id, id: dungeon.id, poolSize: parsed.data.pool.length });
    return reply.send({ dungeon });
  });

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id/zones', async (req, reply) => {
    await requireAdmin(req, reply);
    const dungeon = await getDungeon(req.params.id);
    if (!dungeon) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ zones: await listZones(req.params.id) });
  });

  app.put<{ Params: { id: string } }>('/api/admin/dungeons/:id/zones', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = ReplaceZonesInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-input', details: parsed.error.issues });
    const result = await replaceZones(req.params.id, parsed.data.zones as unknown as readonly Parameters<typeof replaceZones>[1][number][]);
    if (result === 'not-found') return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.zones.replaced', { adminId: admin.id, id: req.params.id, count: result.length });
    return reply.send({ zones: result });
  });
};
