import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { biomeAt, BIOME_COLOR, BIOME_ELEMENT, BIOME_LABEL, tilesAround, type Biome } from './biomes.js';
import {
  currentBiome,
  getStepsTaken,
  loadOrInitPosition,
  nextPosition,
  partyRating,
  rollEncounter,
  savePosition,
  type Direction,
  type Position,
} from './engine.js';

const VIEW_RADIUS = 5;

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

export const worldPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/world/state', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user.onboardingCompleted) {
      return reply.code(409).send({ error: 'onboarding-required' });
    }
    const pos = await loadOrInitPosition(user.id);
    const steps = await getStepsTaken(user.id);
    const rating = await partyRating(user.id);
    return reply.send({
      position: positionView(pos),
      partyRating: rating,
      steps,
      viewRadius: VIEW_RADIUS,
    });
  });

  app.post<{ Body: { dir?: Direction } }>('/api/world/move', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user.onboardingCompleted) {
      return reply.code(409).send({ error: 'onboarding-required' });
    }
    const dir = req.body?.dir;
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
      return reply.code(400).send({ error: 'invalid-input', message: 'dir must be up/down/left/right' });
    }

    const current = await loadOrInitPosition(user.id);
    const nextPos = nextPosition(current, dir);
    const prevSteps = await getStepsTaken(user.id);
    const steps = prevSteps + 1;
    await savePosition(user.id, nextPos, steps);

    const biome = currentBiome(nextPos);
    const rating = await partyRating(user.id);
    const encounter = await rollEncounter(biome, rating.rating);

    if (encounter.kind !== 'none') {
      log.info('world.encounter', {
        userId: user.id,
        biome,
        kind: encounter.kind,
        rating: rating.rating,
        rare: encounter.kind === 'wild-mon' ? encounter.mon.rare : undefined,
      });
    }

    return reply.send({
      position: positionView(nextPos),
      partyRating: rating,
      steps,
      encounter,
    });
  });
};
