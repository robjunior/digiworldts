/**
 * Training HTTP surface. Async by construction — thin wrappers over the
 * training/engine.ts module.
 *
 *   GET  /api/training                       → full view (stations + eligible mons)
 *   POST /api/training/assign/:buildingId    → { monId, statKinds: TrainingStat[], durationMs }
 *   POST /api/training/collect/:buildingId   → mutate roster (bump stats + mood)
 *   POST /api/training/cancel/:buildingId    → drop session, no reward
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { TRAINING_STATS, type TrainingStat } from '../digimon/types.js';
import {
  assignTraining,
  cancelTraining,
  collectTraining,
  readTraining,
  type TrainingError,
} from './engine.js';

const StatKindSchema = z.enum(TRAINING_STATS);

const AssignSchema = z.object({
  monId: z.string().min(3),
  statKinds: z.array(StatKindSchema).min(1).max(4),
  durationMs: z.number().int().min(1),
});

function statusForError(err: TrainingError): number {
  switch (err) {
    case 'building-not-found':
    case 'mon-not-found':
    case 'session-not-found':
      return 404;
    case 'not-finished':
    case 'building-busy':
    case 'mon-busy':
    case 'mon-in-party':
      return 409;
    case 'building-not-training':
    case 'invalid-stat':
    case 'wrong-stat-count':
    case 'duplicate-stat':
    case 'invalid-duration':
      return 400;
  }
}

export const trainingPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/training', async (req, reply) => {
    const user = await requireAuth(req, reply);
    return reply.send(await readTraining(user.id));
  });

  app.post<{ Params: { buildingId: string } }>('/api/training/assign/:buildingId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await assignTraining(
      user.id,
      req.params.buildingId,
      parsed.data.monId,
      parsed.data.statKinds as TrainingStat[],
      parsed.data.durationMs,
    );
    if (!result.ok) return reply.code(statusForError(result.error)).send({ error: result.error });
    return reply.send(result);
  });

  app.post<{ Params: { buildingId: string } }>('/api/training/collect/:buildingId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await collectTraining(user.id, req.params.buildingId);
    if (!result.ok) return reply.code(statusForError(result.error)).send({ error: result.error });
    return reply.send(result);
  });

  app.post<{ Params: { buildingId: string } }>('/api/training/cancel/:buildingId', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await cancelTraining(user.id, req.params.buildingId);
    if (!result.ok) return reply.code(statusForError(result.error)).send({ error: result.error });
    return reply.send(result);
  });
};
