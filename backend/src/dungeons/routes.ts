import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { one, q, run } from '../db/index.js';
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
  getDungeonGridNeighbors,
  getRun,
  getDungeonView,
  listDungeons,
  moveRun,
  replaceTiles,
  resetRun,
  setDungeonRandomPool,
  startOrGetRun,
  unlockDoor,
  activateTrigger,
  updateDoor,
  updateDungeon,
  updateEncounter,
  updateWarp,
  wipeRun,
} from './repo.js';
import { parseTiledJson, tiledMapToImportPayload, validateTiledImportTilesets } from './tiled-import.js';
import { createTrap, deleteTrap, listTraps, updateTrap } from './traps.js';
import { createTrigger, deleteTrigger, updateTrigger } from './triggers.js';
import { createBridge, deleteBridge, updateBridge } from './bridges.js';
import { findTilesetByName, listTilesets, updateTilesetGeometry } from '../tilesets/repo.js';
import type { ImportedTilesetRef } from './tiled-import.js';
import { createChest, deleteChest, updateChest } from './chests.js';
import { getKeyById, listKeysForGroup, updateKeyPlacement } from './keys.js';
import { listZones, replaceZones } from './zones.js';
import { createKit, deleteKit, getKitWithItems, listKitsForUser, updateKit, type KitOutcome } from './kits.js';
import { escrowKitToStash, readStash } from './stash.js';
import { hasFlag } from '../flags/repo.js';import { BIOMES } from '@digiworld/shared/world';
import type { Kit, KitError } from '@digiworld/shared/dungeon';
import {
  asCreateDungeonPayload,
  BridgeInputSchema,
  CreateChestInputSchema,
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
  TriggerInputSchema,
  UpdateBridgeInputSchema,
  UpdateChestInputSchema,
  UpdateDungeonInputSchema,
  UpdateDoorInputSchema,
  UpdateEncounterInputSchema,
  UpdateTrapInputSchema,
  UpdateTriggerInputSchema,
  UpdateWarpInputSchema,
  asEncounterDigimon,
} from './validation.js';
import { loadCatalog, findTemplate } from '../digimon/xml.js';
import { countPartyMembers } from '../roster/routes.js';
import { hasActivePveBattle, setPveDungeonContext, startPveBattleFromEncounter } from '../world/pve-battle.js';
import type { WildMon } from '../world/engine.js';
import { randomEncounterMatchesDungeonConfig } from './random.js';

const ImportTiledNewInputSchema = z.object({
  tiledJson: z.unknown(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  biome: z.union([z.enum(BIOMES), z.literal('null')]),
  dungeonGroupId: z.string().trim().min(1).max(120).optional(),
  floorIndex: z.number().int().min(0).max(99).nullable().optional(),
  gridX: z.number().int().min(-10_000).max(10_000).nullable().optional(),
  gridY: z.number().int().min(-10_000).max(10_000).nullable().optional(),
}).refine((value) => {
  const hasGrid = value.gridX !== undefined || value.gridY !== undefined || value.floorIndex !== undefined;
  if (hasGrid && value.dungeonGroupId === undefined) return false;
  if ((value.gridX === null) !== (value.gridY === null)) return false;
  if ((value.gridX !== undefined && value.gridX !== null) !== (value.gridY !== undefined && value.gridY !== null)) return false;
  return true;
}, { message: 'grid requires a group and X/Y together' });

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

/**
 * Auto-correct stored tileset spacing/margin from the TMJ when the library
 * entry still has the default 0/0. This fixes rendering for tilesets uploaded
 * before spacing/margin tracking existed, without requiring a manual re-upload.
 * If the stored values are non-zero and differ from the map, we emit a warning
 * and leave them alone so an admin can decide which source is authoritative.
 */
async function syncTilesetSpacingMargin(
  tilesetRefs: readonly ImportedTilesetRef[],
  warnings: string[],
): Promise<void> {
  for (const ref of tilesetRefs) {
    const g = ref.sourceGeometry;
    if (!g) continue;
    const ts = await findTilesetByName(ref.name);
    if (!ts) continue;
    if (ts.spacing === g.spacing && ts.margin === g.margin) continue;
    if (ts.spacing === 0 && ts.margin === 0) {
      const updated = await updateTilesetGeometry(ts.id, { spacing: g.spacing, margin: g.margin });
      if (updated) {
        log.info('admin.tileset.geometry-sync', { id: ts.id, name: ts.name, spacing: g.spacing, margin: g.margin });
      }
    } else {
      warnings.push(
        `tileset "${ref.name}" spacing/margin mismatch: library has ${ts.spacing}/${ts.margin}, map expects ${g.spacing}/${g.margin}; manual re-upload required`,
      );
    }
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
    try {
      const admin = await requireAdmin(req, reply);
      const parsedBody = ImportTiledNewInputSchema.safeParse(req.body);
      if (!parsedBody.success) return reply.code(400).send({ error: 'invalid-import-input', details: parsedBody.error.issues });
      const parsedTiled = parseTiledJson(parsedBody.data.tiledJson);
      if (!parsedTiled.ok) return reply.code(400).send({ error: parsedTiled.error, details: parsedTiled.details });
      const payload = tiledMapToImportPayload(parsedTiled.map);
      if (!payload.ok) return reply.code(400).send({ error: payload.error, details: payload.details });
      const library = await listTilesets();
      const tilesetWarnings = validateTiledImportTilesets(payload.payload.tilesets, library);
      const warnings = [...payload.warnings, ...tilesetWarnings];
      await syncTilesetSpacingMargin(payload.payload.tilesets, warnings);
      const result = await applyTiledImportNew({
        name: parsedBody.data.name,
        biome: parsedBody.data.biome,
        ...(parsedBody.data.description !== undefined ? { description: parsedBody.data.description } : {}),
        ...(parsedBody.data.dungeonGroupId !== undefined
          ? {
              dungeonGroupId: parsedBody.data.dungeonGroupId,
              floorIndex: parsedBody.data.floorIndex ?? null,
              gridX: parsedBody.data.gridX ?? null,
              gridY: parsedBody.data.gridY ?? null,
            }
          : {}),
        payload: payload.payload,
      });
      if (!result.ok) {
        if (result.error === 'grid-conflict') return reply.code(409).send({ error: 'grid-conflict' });
        return reply.code(409).send({ error: result.error, missing: result.missing });
      }
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
      return reply.code(201).send({ dungeon: result.dungeon, warnings });
    } catch (err) {
      log.error('admin.dungeon.import.new.error', { error: err });
      return reply.code(500).send({ error: 'internal error', details: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/import-tiled', async (req, reply) => {
    try {
      const admin = await requireAdmin(req, reply);
      const parsedBody = ImportTiledReplaceInputSchema.safeParse(req.body);
      if (!parsedBody.success) return reply.code(400).send({ error: 'invalid-import-input', details: parsedBody.error.issues });
      const parsedTiled = parseTiledJson(parsedBody.data.tiledJson);
      if (!parsedTiled.ok) return reply.code(400).send({ error: parsedTiled.error, details: parsedTiled.details });
      const existing = await getDungeon(req.params.id);
      if (!existing) return reply.code(404).send({ error: 'not-found' });
      const payload = tiledMapToImportPayload(parsedTiled.map, { currentSpawn: { x: existing.spawnX, y: existing.spawnY } });
      if (!payload.ok) return reply.code(400).send({ error: payload.error, details: payload.details });
      const library = await listTilesets();
      const tilesetWarnings = validateTiledImportTilesets(payload.payload.tilesets, library);
      const warnings = [...payload.warnings, ...tilesetWarnings];
      await syncTilesetSpacingMargin(payload.payload.tilesets, warnings);
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
      return reply.send({ view: result.view, warnings });
    } catch (err) {
      log.error('admin.dungeon.import.replace.error', { error: err });
      return reply.code(500).send({ error: 'internal error', details: err instanceof Error ? err.message : String(err) });
    }
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
    if (dungeon === 'grid-conflict') return reply.code(409).send({ error: 'grid-position-conflict' });
    if (dungeon === 'grid-group-required') return reply.code(400).send({ error: 'grid-group-required' });
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

  app.get<{ Params: { id: string } }>('/api/dungeon/:id/neighbors', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const neighbors = await getDungeonGridNeighbors(user.id, req.params.id);
    if (!neighbors) return reply.code(404).send({ error: 'not-found' });
    return reply.send(neighbors);
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/move', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (hasActivePveBattle(user.id)) {
      return reply.code(409).send({ error: 'battle-in-progress', message: 'Resolve your active battle first.' });
    }
    const parsed = MoveInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-move', details: parsed.error.issues });
    const moved = await moveRun(user.id, req.params.id, parsed.data.x, parsed.data.y);
    if (moved.kind === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (moved.kind === 'blocked') return reply.code(400).send({ error: 'not-walkable' });
    if (moved.kind === 'not-adjacent') return reply.code(400).send({ error: 'not-adjacent' });
    if (moved.kind === 'blocked-by-door') return reply.send({ run: moved.run, triggeredEncounterId: null, pickedUpItemId: null, blockedByDoorId: moved.doorId });
    if (moved.kind === 'blocked-by-chest') return reply.send({ run: moved.run, triggeredEncounterId: null, pickedUpItemId: null, blockedByChestId: moved.chestId });
    if (moved.kind === 'ok') return reply.send({ run: moved.run, triggeredEncounterId: moved.triggeredEncounterId, pickedUpItemId: moved.pickedUpItemId, ...(moved.randomEncounter ? { randomEncounter: moved.randomEncounter } : {}), ...(moved.warpToDungeonId !== undefined ? { warpToDungeonId: moved.warpToDungeonId } : {}), ...(moved.trapTriggered ? { trapTriggered: moved.trapTriggered } : {}), ...(moved.openedChestId !== undefined ? { openedChestId: moved.openedChestId, chestContents: moved.chestContents ?? [] } : {}) });
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

  app.post<{ Params: { id: string; triggerId: string } }>('/api/dungeon/:id/triggers/:triggerId/activate', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const activated = await activateTrigger(user.id, req.params.id, req.params.triggerId);
    if (!activated.ok) {
      if (activated.error === 'no-run') return reply.code(404).send({ error: 'no-run' });
      if (activated.error === 'disabled') return reply.code(400).send({ error: 'disabled' });
      if (activated.error === 'already-fired') return reply.code(409).send({ error: 'already-fired' });
      if (activated.error === 'not-adjacent') return reply.code(400).send({ error: 'not-adjacent' });
      return reply.code(404).send({ error: 'not-found' });
    }
    return reply.send({
      view: activated.view,
      triggeredTriggerId: activated.triggeredTriggerId,
      triggerTargetKind: activated.triggerTargetKind,
      activatedDoorId: activated.activatedDoorId,
      activatedBridgeId: activated.activatedBridgeId,
    });
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

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/triggers', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = TriggerInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-trigger', details: parsed.error.issues });
    const trigger = await createTrigger(req.params.id, parsed.data);
    if (trigger === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (trigger === 'conflict') return reply.code(409).send({ error: 'trigger-position-conflict' });
    if (trigger === 'invalid-target') return reply.code(400).send({ error: 'invalid-trigger-target' });
    log.info('admin.dungeon.trigger.create', { adminId: admin.id, dungeonId: req.params.id, id: trigger.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.code(201).send({ view });
  });

  app.put<{ Params: { id: string; triggerId: string } }>('/api/admin/dungeons/:id/triggers/:triggerId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateTriggerInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-trigger', details: parsed.error.issues });
    const trigger = await updateTrigger(req.params.id, req.params.triggerId, parsed.data);
    if (trigger === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (trigger === 'conflict') return reply.code(409).send({ error: 'trigger-position-conflict' });
    if (trigger === 'invalid-target') return reply.code(400).send({ error: 'invalid-trigger-target' });
    log.info('admin.dungeon.trigger.update', { adminId: admin.id, dungeonId: req.params.id, id: trigger.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ view });
  });

  app.delete<{ Params: { id: string; triggerId: string } }>('/api/admin/dungeons/:id/triggers/:triggerId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteTrigger(req.params.id, req.params.triggerId);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.trigger.delete', { adminId: admin.id, dungeonId: req.params.id, id: req.params.triggerId });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ view });
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/bridges', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = BridgeInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-bridge', details: parsed.error.issues });
    const bridge = await createBridge(req.params.id, parsed.data);
    if (bridge === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (bridge === 'conflict') return reply.code(409).send({ error: 'bridge-position-conflict' });
    log.info('admin.dungeon.bridge.create', { adminId: admin.id, dungeonId: req.params.id, id: bridge.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.code(201).send({ view });
  });

  app.put<{ Params: { id: string; bridgeId: string } }>('/api/admin/dungeons/:id/bridges/:bridgeId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateBridgeInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-bridge', details: parsed.error.issues });
    const bridge = await updateBridge(req.params.id, req.params.bridgeId, parsed.data);
    if (bridge === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (bridge === 'conflict') return reply.code(409).send({ error: 'bridge-position-conflict' });
    log.info('admin.dungeon.bridge.update', { adminId: admin.id, dungeonId: req.params.id, id: bridge.id });
    const view = await getDungeonView(req.params.id);
    if (!view) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ view });
  });

  app.delete<{ Params: { id: string; bridgeId: string } }>('/api/admin/dungeons/:id/bridges/:bridgeId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteBridge(req.params.id, req.params.bridgeId);
    if (!deleted) return reply.code(404).send({ error: 'not-found' });
    log.info('admin.dungeon.bridge.delete', { adminId: admin.id, dungeonId: req.params.id, id: req.params.bridgeId });
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

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/chests', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = CreateChestInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-chest', details: parsed.error.issues });
    const result = await createChest(req.params.id, parsed.data as unknown as Parameters<typeof createChest>[1]);
    if (result === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (result === 'conflict') return reply.code(409).send({ error: 'chest-already-at-cell' });
    log.info('admin.dungeon.chest.create', { adminId: admin.id, dungeonId: req.params.id, chestId: result.id });
    return reply.code(201).send({ chest: result });
  });

  app.put<{ Params: { id: string; chestId: string } }>('/api/admin/dungeons/:id/chests/:chestId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateChestInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid-chest', details: parsed.error.issues });
    const result = await updateChest(req.params.id, req.params.chestId, parsed.data as unknown as Parameters<typeof updateChest>[2]);
    if (result === 'not-found') return reply.code(404).send({ error: 'not-found' });
    if (result === 'conflict') return reply.code(409).send({ error: 'chest-already-at-cell' });
    log.info('admin.dungeon.chest.update', { adminId: admin.id, dungeonId: req.params.id, chestId: req.params.chestId });
    return reply.send({ chest: result });
  });

  app.delete<{ Params: { id: string; chestId: string } }>('/api/admin/dungeons/:id/chests/:chestId', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const deleted = await deleteChest(req.params.id, req.params.chestId);
    log.info('admin.dungeon.chest.delete', { adminId: admin.id, dungeonId: req.params.id, chestId: req.params.chestId, deleted });
    return reply.send({ ok: deleted });
  });

  app.get('/api/admin/trigger-pool', async (req, reply) => {
    await requireAdmin(req, reply);
    const doors = await q<{ readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly label: string | null; readonly dungeon_name: string }>(
      `SELECT d.id, d.dungeon_id, d.x, d.y, d.label, g.name AS dungeon_name FROM dungeon_doors d JOIN dungeons g ON g.id = d.dungeon_id ORDER BY g.name, d.y, d.x`,
    );
    const bridges = await q<{ readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly label: string | null; readonly enabled: number; readonly dungeon_name: string }>(
      `SELECT b.id, b.dungeon_id, b.x, b.y, b.label, b.enabled, g.name AS dungeon_name FROM dungeon_bridges b JOIN dungeons g ON g.id = b.dungeon_id ORDER BY g.name, b.y, b.x`,
    );
    const triggers = await q<{ readonly id: string; readonly dungeon_id: string; readonly x: number; readonly y: number; readonly label: string | null; readonly enabled: number; readonly dungeon_name: string }>(
      `SELECT t.id, t.dungeon_id, t.x, t.y, t.label, t.enabled, g.name AS dungeon_name FROM dungeon_triggers t JOIN dungeons g ON g.id = t.dungeon_id ORDER BY g.name, t.y, t.x`,
    );
    return reply.send({
      doors: doors.map((d) => ({ id: d.id, dungeonId: d.dungeon_id, dungeonName: d.dungeon_name, x: d.x, y: d.y, label: d.label })),
      bridges: bridges.map((b) => ({ id: b.id, dungeonId: b.dungeon_id, dungeonName: b.dungeon_name, x: b.x, y: b.y, label: b.label, enabled: b.enabled === 1 })),
      triggers: triggers.map((t) => ({ id: t.id, dungeonId: t.dungeon_id, dungeonName: t.dungeon_name, x: t.x, y: t.y, label: t.label, enabled: t.enabled === 1 })),
    });
  });

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id/keys', async (req, reply) => {
    await requireAdmin(req, reply);
    const dungeon = await getDungeon(req.params.id);
    if (!dungeon) return reply.code(404).send({ error: 'not-found' });
    if (!dungeon.dungeonGroupId) return reply.send({ keys: [] });
    return reply.send({ keys: await listKeysForGroup(dungeon.dungeonGroupId) });
  });

  app.put<{ Params: { keyId: string }; Body: { readonly dungeonId: string; readonly x: number; readonly y: number } }>('/api/admin/dungeon-keys/:keyId/placement', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const body = req.body;
    if (typeof body?.dungeonId !== 'string' || typeof body?.x !== 'number' || typeof body?.y !== 'number') {
      return reply.code(400).send({ error: 'invalid-input' });
    }
    const key = await getKeyById(req.params.keyId);
    if (!key) return reply.code(404).send({ error: 'not-found' });
    const dungeon = await getDungeon(body.dungeonId);
    if (!dungeon) return reply.code(404).send({ error: 'dungeon-not-found' });
    if (dungeon.dungeonGroupId !== key.dungeonGroupId) {
      return reply.code(400).send({ error: 'wrong-group', keyGroupId: key.dungeonGroupId, dungeonGroupId: dungeon.dungeonGroupId });
    }
    const updated = await updateKeyPlacement(req.params.keyId, body.dungeonId, body.x, body.y);
    log.info('admin.dungeon.key.place', { adminId: admin.id, keyId: req.params.keyId, dungeonId: body.dungeonId, x: body.x, y: body.y });
    return reply.send({ key: updated });
  });
};
