import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import type { Action } from '../battle/types.js';
import { q } from '../db/index.js';
import { log } from '../util/log.js';
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
import {
  actInPveBattle,
  getPveBattleView,
  hasActivePveBattle,
  startPveBattleFromEncounter,
} from './pve-battle.js';
import { adjacentQuestAt, blockingWorldObjectAt } from '../quests/repo.js';

const UnitIdSchema = z.string().regex(/^[ab]:[0-5]$/);
const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fight'), unitId: UnitIdSchema, targetId: UnitIdSchema }),
  z.object({ type: z.literal('skill'), unitId: UnitIdSchema, skillId: z.string().min(1), targetId: UnitIdSchema }),
  z.object({ type: z.literal('guard'), unitId: UnitIdSchema }),
  z.object({ type: z.literal('analyze'), unitId: UnitIdSchema, targetId: UnitIdSchema }),
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

export const worldPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/world/regions', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const rows = await q<{ biome_region: Biome; id: string }>(
      `SELECT id, biome_region FROM dungeons WHERE biome_region IS NOT NULL`,
    );
    const dungeonByBiome = new Map<Biome, string>();
    for (const r of rows) dungeonByBiome.set(r.biome_region, r.id);
    const scoutedRows = await q<{ dungeon_id: string }>(
      `SELECT dungeon_id FROM user_dungeon_runs WHERE user_id = ?`,
      user.id,
    );
    const scoutedDungeonIds = new Set(scoutedRows.map((r) => r.dungeon_id));
    const regions = BIOMES.map((biome) => {
      const dungeonId = dungeonByBiome.get(biome) ?? null;
      return {
        biome,
        label: BIOME_LABEL[biome],
        element: BIOME_ELEMENT[biome],
        danger: BIOME_DANGER[biome],
        lat: BIOME_COORDS[biome].lat,
        lon: BIOME_COORDS[biome].lon,
        dungeonId,
        scouted: dungeonId !== null && scoutedDungeonIds.has(dungeonId),
      };
    });
    return reply.send({ regions });
  });

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
    if (!(await hasAliveParty(user.id))) {
      return reply.code(409).send({ error: 'no-alive-party', message: 'Assign at least one alive Digimon to your party before exploring.' });
    }
    const dir = req.body?.dir;
    if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
      return reply.code(400).send({ error: 'invalid-input', message: 'dir must be up/down/left/right' });
    }

    const current = await loadOrInitPosition(user.id);
    const nextPos = nextPosition(current, dir);
    const blocker = await blockingWorldObjectAt(nextPos.x, nextPos.y);
    if (blocker) {
      return reply.code(409).send({
        error: 'blocked',
        message: blocker.label ? `${blocker.label} blocks the way.` : 'A world object blocks the way.',
      });
    }
    const prevSteps = await getStepsTaken(user.id);
    const steps = prevSteps + 1;
    await savePosition(user.id, nextPos, steps);

    const biome = currentBiome(nextPos);
    const rating = await partyRating(user.id);
    const encounter = await rollEncounter(biome, rating);

    let battleView: ReturnType<typeof getPveBattleView> = null;
    let battleStartError: string | null = null;

    if (encounter.kind === 'wild-mon') {
      const started = await startPveBattleFromEncounter(user.id, encounter.mons);
      if (started.ok) {
        battleView = started.view;
        log.info('world.encounter', {
          userId: user.id,
          biome,
          kind: 'wild-mon',
          rating: rating.rating,
          wildCount: encounter.mons.length,
          rareCount: encounter.mons.filter((m) => m.rare).length,
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
      adjacentQuest: await adjacentQuestAt(nextPos.x, nextPos.y),
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
    const parsed = ActionSchema.safeParse(req.body?.action);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-input', message: parsed.error.issues[0]?.message ?? 'action required' });
    }
    const result = await actInPveBattle(user.id, parsed.data as Action);
    if (!result.ok) {
      const status = result.code === 'no-battle' ? 404 : 400;
      return reply.code(status).send({ error: result.error, ...(result.code ? { code: result.code } : {}) });
    }
    return reply.send({
      battle: result.view,
      ended: result.ended,
      ...(result.capturedMonId ? { capturedMonId: result.capturedMonId } : {}),
      ...(result.xpAwards ? { xpAwards: result.xpAwards } : {}),
      ...(result.itemDrops ? { itemDrops: result.itemDrops } : {}),
      ...(result.speciesAwards ? { speciesAwards: result.speciesAwards } : {}),
      ...(result.creditsGained !== undefined ? { creditsGained: result.creditsGained } : {}),
      ...(result.bitsGained !== undefined ? { bitsGained: result.bitsGained } : {}),
    });
  });
};
