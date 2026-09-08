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
import { announceDungeonMove } from './presence.js';
import { findTilesetByName, listTilesets, updateTilesetGeometry } from '../tilesets/repo.js';
import type { ImportedTilesetRef } from './tiled-import.js';
import { createChest, deleteChest, updateChest } from './chests.js';
import { getKeyById, listKeysForGroup, updateKeyPlacement } from './keys.js';
import { listZones, replaceZones } from './zones.js';
import { createKit, deleteKit, getKitWithItems, listKitsForUser, updateKit, type KitOutcome } from './kits.js';
import { escrowKitToStash, readStash } from './stash.js';
import { hasFlag } from '../flags/repo.js';
import { BIOMES } from '@digiworld/shared/world';
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

/** Auto-correct stored tileset spacing/margin from the TMJ when the library entry still has the default 0/0. */
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
  // PVE dungeon endpoints are disabled — this game is PVP-only.
  // Players attempting these routes receive a 403 Forbidden response.
  app.get<{ Params: { id: string } }>('/api/dungeon/:id', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled. This game mode is PVP-only.' });
  });

  app.get<{ Params: { id: string } }>('/api/dungeon/:id/neighbors', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/move', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string; doorId: string } }>('/api/dungeons/:id/doors/:doorId/unlock', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string; triggerId: string } }>('/api/dungeon/:id/triggers/:triggerId/activate', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string; encId: string } }>('/api/dungeon/:id/encounter/:encId/start', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/random-encounter/start', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/complete', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/reset', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.get('/api/dungeon/kits', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post('/api/dungeon/kits', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.put<{ Params: { id: string } }>('/api/dungeon/kits/:id', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.delete<{ Params: { id: string } }>('/api/dungeon/kits/:id', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/enter', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/extract', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  app.post<{ Params: { id: string } }>('/api/dungeon/:id/use-scroll', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'Dungeon content is disabled.' });
  });

  // Admin-only routes remain (requireAdmin gate).
  app.get<{ Params: { id: string } }>('/api/admin/dungeons', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post('/api/admin/dungeons', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/import-tiled', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string } }>('/api/admin/dungeons/:id', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/dungeons/:id', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string; encId: string } }>('/api/admin/dungeons/:id/encounters/:encId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; encId: string } }>('/api/admin/dungeons/:id/encounters/:encId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/items', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; itemId: string } }>('/api/admin/dungeons/:id/items/:itemId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/warps', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string; warpId: string } }>('/api/admin/dungeons/:id/warps/:warpId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; warpId: string } }>('/api/admin/dungeons/:id/warps/:warpId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/doors', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string; doorId: string } }>('/api/admin/dungeons/:id/doors/:doorId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; doorId: string } }>('/api/admin/dungeons/:id/doors/:doorId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/traps', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string; trapId: string } }>('/api/admin/dungeons/:id/traps/:trapId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; trapId: string } }>('/api/admin/dungeons/:id/traps/:trapId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/triggers', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string; triggerId: string } }>('/api/admin/dungeons/:id/triggers/:triggerId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; triggerId: string } }>('/api/admin/dungeons/:id/triggers/:triggerId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/bridges', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string; bridgeId: string } }>('/api/admin/dungeons/:id/bridges/:bridgeId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; bridgeId: string } }>('/api/admin/dungeons/:id/bridges/:bridgeId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id/random-pool', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string } }>('/api/admin/dungeons/:id/random-pool', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.get<{ Params: { id: string } }>('/api/admin/dungeons/:id/zones', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string } }>('/api/admin/dungeons/:id/zones', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.post<{ Params: { id: string } }>('/api/admin/dungeons/:id/chests', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.put<{ Params: { id: string; chestId: string } }>('/api/admin/dungeons/:id/chests/:chestId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.delete<{ Params: { id: string; chestId: string } }>('/api/admin/dungeons/:id/chests/:chestId', async (req, reply) => {
    return requireAdmin(req, reply);
  });

  app.get('/api/admin/trigger-pool', async (req, reply) => {
    return requireAdmin(req, reply);
  });
};
