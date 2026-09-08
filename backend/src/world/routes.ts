import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import type { Action } from '../battle/types.js';
import { q } from '../db/index.js';
import { log } from '../util/log.js';
import { emit } from '../telemetry/emit.js';
import { biomeAt, BIOME_COLOR, BIOME_COORDS, BIOME_DANGER, BIOME_ELEMENT, BIOME_LABEL, BIOMES, tilesAround, type Biome } from './biomes.js';
import {
  currentBiome,
  getStepsTaken,
  hasAliveParty,
  loadOrInitPosition,
  nextPosition,
  partyRating,
  rollEncounter,
  savePosition,
  type Direction,
  type Position,
} from './engine.js';
import { actInPveBattle, getPveBattleView, hasActivePveBattle, startPveBattleFromEncounter } from './pve-battle.js';
import { adjacentQuestAt, blockingWorldObjectAt } from '../quests/repo.js';

const UnitIdSchema = z.string().regex(/^[ab]:[0-5]$/);
const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fight'), unitId: UnitIdSchema, targetId: UnitIdSchema }),
  z.object({ type: z.literal('skill'), unitId: UnitIdSchema, skillId: z.string().min(1), targetId: UnitIdSchema }),
  z.object({ type: z.literal('capture'), unitId: UnitIdSchema, targetId: UnitIdSchema }),
  z.object({ type: z.literal('use_item'), unitId: UnitIdSchema, targetId: UnitIdSchema, itemId: z.string().min(1) }),
  z.object({ type: z.literal('flee') }),
]);

const VIEW_RADIUS = 18;

function biomeMeta(b: Biome): { biome: Biome; label: string; element: string; color: string } {
  return { biome: b, label: BIOME_LABEL[b], element: BIOME_ELEMENT[b], color: BIOME_COLOR[b] };
}

function positionView(pos: Position): {
  x: number;
  y: number;
  seed: number;
  biome: ReturnType<typeof biomeMeta>;
  tiles: Array<{ x: number; y: number; biome: Biome; color: string }>;
} {
  const tiles = tilesAround(pos.seed, pos.x, pos.y, VIEW_RADIUS).map((t) => ({
    ...t,
    color: BIOME_COLOR[t.biome],
  }));
  return {
    x: pos.x,
    y: pos.y,
    seed: pos.seed,
    biome: biomeMeta(biomeAt(pos.seed, pos.x, pos.y)),
    tiles,
  };
}

function parseRequiredItems(value: string | null): readonly string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((entry): entry is string => typeof entry === 'string');
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}

export const worldPlugin: FastifyPluginAsync = async (app) => {
  // PVE world exploration is disabled — this game is PVP-only.
  // Players attempting these routes receive a 403 Forbidden response.

  app.get('/api/world/regions', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'World exploration is disabled. This game mode is PVP-only.' });
  });

  app.get('/api/world/state', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'World exploration is disabled.' });
  });

  app.post<{ Body: { dir?: Direction } }>('/api/world/move', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'World exploration is disabled.' });
  });

  app.get('/api/world/battle', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'World battle is disabled.' });
  });

  app.post<{ Body: { action?: Action } }>('/api/world/battle/act', async (req, reply) => {
    return reply.code(403).send({ error: 'pvp-only', message: 'World battle is disabled.' });
  });
};
