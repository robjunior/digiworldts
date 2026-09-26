/**
 * HTTP surface for player teams (see teams/engine.ts for the rules).
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import {
  activateTeam,
  createTeam,
  deleteTeam,
  listTeams,
  renameTeam,
  setTeamMembers,
  TEAM_NAME_MAX,
} from './engine.js';
import { PARTY_SIZE } from '../digimon/types.js';

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(TEAM_NAME_MAX).optional(),
  seedFromParty: z.boolean().optional(),
});

const RenameSchema = z.object({
  name: z.string().trim().min(1).max(TEAM_NAME_MAX),
});

const MembersSchema = z.object({
  monIds: z.array(z.string().min(3).nullable()).length(PARTY_SIZE),
});

function toHttpError(result: { ok: false; error: string; message?: string }): {
  code: number;
  payload: { error: string; message?: string };
} {
  let code: number;
  switch (result.error) {
    case 'team-limit':
      code = 409;
      break;
    case 'not-found':
      code = 404;
      break;
    default:
      code = 409;
      break;
  }
  const payload: { error: string; message?: string } = { error: result.error };
  if (result.message !== undefined) payload.message = result.message;
  return { code, payload };
}

export const teamsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/teams', async (req, reply) => {
    const user = await requireAuth(req, reply);
    return reply.send(await listTeams(user.id));
  });

  app.post('/api/teams', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await createTeam(user.id, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.seedFromParty !== undefined ? { seedFromParty: parsed.data.seedFromParty } : {}),
    });
    if (!result.ok) {
      const { code, payload } = toHttpError(result);
      return reply.code(code).send(payload);
    }
    return reply.code(201).send(result.value);
  });

  app.post<{ Params: { id: string } }>('/api/teams/:id/rename', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const result = await renameTeam(user.id, req.params.id, parsed.data.name);
    if (!result.ok) {
      const { code, payload } = toHttpError(result);
      return reply.code(code).send(payload);
    }
    return reply.send(result.value);
  });

  app.put<{ Params: { id: string } }>('/api/teams/:id/members', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = MembersSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input', details: parsed.error.issues });
    const result = await setTeamMembers(user.id, req.params.id, parsed.data.monIds);
    if (!result.ok) {
      const { code, payload } = toHttpError(result);
      return reply.code(code).send(payload);
    }
    return reply.send(result.value);
  });

  app.post<{ Params: { id: string } }>('/api/teams/:id/activate', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await activateTeam(user.id, req.params.id);
    if (!result.ok) {
      const { code, payload } = toHttpError(result);
      return reply.code(code).send(payload);
    }
    return reply.send(result.value);
  });

  app.delete<{ Params: { id: string } }>('/api/teams/:id', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const result = await deleteTeam(user.id, req.params.id);
    if (!result.ok) {
      const { code, payload } = toHttpError(result);
      return reply.code(code).send(payload);
    }
    return reply.send(result.value);
  });
};