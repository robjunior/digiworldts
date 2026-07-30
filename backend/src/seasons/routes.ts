/**
 * Seasons — admin CRUD + manual "end now" endpoint.
 *
 * All routes require `requireAdmin`. Reads that a regular player needs
 * (current active season, own history) are inlined into
 * `/api/player/career` (see src/player/routes.ts) — no public season
 * surface is needed here.
 *
 * Auto-close by planned `ends_at` deadline is handled by the ticker
 * (src/seasons/ticker.ts). This endpoint is the manual override.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth/routes.js';
import { log } from '../util/log.js';
import {
  createSeason,
  deleteSeason,
  endSeason,
  getSeason,
  listSeasons,
  updateSeason,
  type SeasonError,
} from './repo.js';

const CreateSeasonSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    startsAt: z.number().int().nonnegative(),
    endsAt: z.number().int().nonnegative(),
  })
  .strict();

const UpdateSeasonSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    startsAt: z.number().int().nonnegative().optional(),
    endsAt: z.number().int().nonnegative().optional(),
  })
  .strict();

function statusFor(error: SeasonError): number {
  switch (error.kind) {
    case 'not_found':
      return 404;
    case 'already_ended':
      return 409;
    case 'invalid_range':
    case 'name_required':
      return 400;
  }
}

export const seasonsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/admin/seasons', async (req, reply) => {
    await requireAdmin(req, reply);
    const seasons = await listSeasons();
    return reply.send({ seasons });
  });

  app.get<{ Params: { id: string } }>('/api/admin/seasons/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const season = await getSeason(req.params.id);
    if (!season) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ season });
  });

  app.post('/api/admin/seasons', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = CreateSeasonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-season', details: parsed.error.issues });
    }
    const result = await createSeason({
      name: parsed.data.name,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      createdBy: admin.id,
    });
    if (!result.ok) {
      return reply.code(statusFor(result.error)).send({ error: result.error.kind, ...('reason' in result.error ? { reason: result.error.reason } : {}) });
    }
    log.info('admin.season.create', { adminId: admin.id, id: result.value.id, name: result.value.name });
    return reply.code(201).send({ season: result.value });
  });

  app.patch<{ Params: { id: string } }>('/api/admin/seasons/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const parsed = UpdateSeasonSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-season', details: parsed.error.issues });
    }
    const patch: Parameters<typeof updateSeason>[1] = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.startsAt !== undefined ? { startsAt: parsed.data.startsAt } : {}),
      ...(parsed.data.endsAt !== undefined ? { endsAt: parsed.data.endsAt } : {}),
    };
    const result = await updateSeason(req.params.id, patch);
    if (!result.ok) {
      return reply.code(statusFor(result.error)).send({ error: result.error.kind, ...('reason' in result.error ? { reason: result.error.reason } : {}) });
    }
    log.info('admin.season.update', { adminId: admin.id, id: result.value.id });
    return reply.send({ season: result.value });
  });

  app.post<{ Params: { id: string } }>('/api/admin/seasons/:id/end', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await endSeason(req.params.id);
    if (!result.ok) {
      return reply.code(statusFor(result.error)).send({ error: result.error.kind });
    }
    log.info('admin.season.end', { adminId: admin.id, id: result.value.id, snapshottedUsers: result.value.snapshottedUsers });
    // Return the updated season so the UI can refresh the row inline.
    const updated = await getSeason(result.value.id);
    return reply.send({ ok: true, season: updated, snapshottedUsers: result.value.snapshottedUsers });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/seasons/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteSeason(req.params.id);
    if (!result.ok) {
      return reply.code(statusFor(result.error)).send({ error: result.error.kind });
    }
    log.info('admin.season.delete', { adminId: admin.id, id: req.params.id });
    return reply.send({ ok: true });
  });
};
