/**
 * Adventure HTTP surface. Async by construction — thin wrappers over the
 * adventure/engine.ts module.
 *
 *   GET  /api/adventure               → active + last-collected + meat + config
 *   POST /api/adventure/start         → { monIds: string[3], hours: 1..8 }
 *   POST /api/adventure/collect       → dice-roll on server, award XP + resources + credits
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import {
  ADVENTURE_MAX_HOURS,
  ADVENTURE_MIN_HOURS,
  collectAdventure,
  readAdventurePage,
  startAdventure,
  type CollectAdventureError,
  type StartAdventureError,
} from './engine.js';

const StartSchema = z.object({
  monIds: z.array(z.string().min(1)).length(3),
  hours: z.number().int().min(ADVENTURE_MIN_HOURS).max(ADVENTURE_MAX_HOURS),
});

const CollectSchema = z.object({
  /** Omit when only one adventure is active (backwards compatible). */
  adventureId: z.string().min(1).optional(),
});

function statusForStart(err: StartAdventureError): number {
  switch (err) {
    case 'mon-not-found':
      return 404;
    case 'invalid-party-size':
    case 'duplicate-mon':
    case 'invalid-hours':
      return 400;
    case 'mon-busy':
    case 'mon-downed':
    case 'mon-listed':
    case 'active-adventures-limit':
      return 409;
    case 'insufficient-meat':
      return 402;
    default:
      return 400;
  }
}

function statusForCollect(err: CollectAdventureError): number {
  switch (err) {
    case 'no-adventure':
      return 404;
    case 'not-ready':
      return 409;
    default:
      return 400;
  }
}

export const adventurePlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/adventure', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const view = await readAdventurePage(user.id);
    return reply.send(view);
  });

  app.post('/api/adventure/start', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid-input',
        details: parsed.error.issues,
      });
    }
    const result = await startAdventure(user.id, parsed.data.monIds, parsed.data.hours);
    if (!result.ok) {
      return reply.code(statusForStart(result.error)).send({
        error: result.error,
        ...(result.details ? { details: result.details } : {}),
      });
    }
    return reply.send(result);
  });

  app.post('/api/adventure/collect', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = CollectSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid-input',
        details: parsed.error.issues,
      });
    }
    const result = await collectAdventure(user.id, parsed.data.adventureId);
    if (!result.ok) {
      return reply.code(statusForCollect(result.error)).send({
        error: result.error,
        ...(result.details ? { details: result.details } : {}),
      });
    }
    return reply.send(result);
  });
};
