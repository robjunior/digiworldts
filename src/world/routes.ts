import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import type { Action } from '../battle/types.js';
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
import {
  actInPveBattle,
  getPveBattleView,
  hasActivePveBattle,
  startPveBattleFromEncounter,
} from './pve-battle.js';

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
      battleActive: hasActivePveBattle(user.id),
    });
  });

  app.post<{ Body: { dir?: Direction } }>('/api/world/move', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user.onboardingCompleted) {
      return reply.code(409).send({ error: 'onboarding-required' });
    }
    if (hasActivePveBattle(user.id)) {
      return reply.code(409).send({ error: 'battle-in-progress', message: 'Resolve your active battle first.' });
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
    const encounter = await rollEncounter(biome, rating.rating, rating.dominantStage);

    let battleView: ReturnType<typeof getPveBattleView> = null;
    let battleStartError: string | null = null;

    if (encounter.kind === 'wild-mon') {
      const started = await startPveBattleFromEncounter(user.id, encounter.mon);
      if (started.ok) {
        battleView = started.view;
        log.info('world.encounter', {
          userId: user.id,
          biome,
          kind: 'wild-mon',
          rating: rating.rating,
          rare: encounter.mon.rare,
        });
      } else {
        battleStartError = started.error;
        log.warn('world.encounter.start-fail', { userId: user.id, error: started.error });
      }
    }

    return reply.send({
      position: positionView(nextPos),
      partyRating: rating,
      steps,
      encounter,
      battle: battleView,
      battleStartError,
    });
  });

  app.get('/api/world/battle', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const view = getPveBattleView(user.id);
    if (!view) return reply.code(404).send({ error: 'no-active-battle' });
    return reply.send({ battle: view });
  });

  app.post<{ Body: { action?: Action } }>('/api/world/battle/act', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const action = req.body?.action;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return reply.code(400).send({ error: 'invalid-input', message: 'action required' });
    }
    const result = await actInPveBattle(user.id, action);
    if (!result.ok) {
      const status = result.code === 'no-battle' ? 404 : 400;
      return reply.code(status).send({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    }
    return reply.send({
      battle: result.view,
      ended: result.ended,
      ...(result.capturedMonId ? { capturedMonId: result.capturedMonId } : {}),
      ...(result.xpAwards ? { xpAwards: result.xpAwards } : {}),
      ...(result.itemDrop ? { itemDrop: result.itemDrop } : {}),
    });
  });
};
