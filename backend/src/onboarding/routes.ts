import type { FastifyPluginAsync } from 'fastify';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import {
  completeOnboarding,
  createTeam,
  deleteTeam,
  getConfig,
  getSnapshotForPlayer,
  getTeam,
  listTeamsAdmin,
  updateConfig,
  updateTeam,
  type OnboardingError,
  type OnboardingTeamInput,
} from './engine.js';

function statusForOnboardingError(err: OnboardingError): number {
  if (err === 'not-found') return 404;
  if (err === 'invalid-catalog-id') return 404;
  if (err === 'duplicate-slug') return 409;
  if (err === 'already-onboarded') return 409;
  if (err === 'no-teams-available') return 503;
  return 400;
}

type TeamBody = {
  slug?: string;
  name?: string;
  description?: string;
  monCatalogIds?: string[];
  sortOrder?: number;
  enabled?: boolean;
};

function normalizeTeamInput(body: TeamBody | undefined): OnboardingTeamInput | null {
  if (!body || typeof body !== 'object') return null;
  const { slug, name, description, monCatalogIds, sortOrder, enabled } = body;
  if (typeof slug !== 'string' || typeof name !== 'string') return null;
  if (!Array.isArray(monCatalogIds) || monCatalogIds.length !== 3) return null;
  const ids = monCatalogIds.map((v) => (typeof v === 'string' ? v : ''));
  if (ids.some((v) => v.length === 0)) return null;
  const input: OnboardingTeamInput = {
    slug,
    name,
    monCatalogIds: [ids[0]!, ids[1]!, ids[2]!],
  };
  if (description !== undefined) input.description = description;
  if (sortOrder !== undefined) input.sortOrder = sortOrder;
  if (enabled !== undefined) input.enabled = enabled;
  return input;
}

export const onboardingPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/onboarding', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (user.onboardingCompleted) {
      return reply.send({ completed: true, config: await getConfig(), teams: [] });
    }
    const snapshot = await getSnapshotForPlayer();
    if (snapshot.teams.length === 0) {
      return reply.code(503).send({ error: 'no-teams-available', message: 'Admin has not configured any onboarding teams yet.' });
    }
    return reply.send({ completed: false, ...snapshot });
  });

  app.post<{ Body: { teamId?: string } }>('/api/onboarding/select', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (user.onboardingCompleted) {
      return reply.code(409).send({ error: 'already-onboarded', message: 'You have already completed onboarding.' });
    }
    const teamId = req.body?.teamId;
    if (typeof teamId !== 'string' || teamId.length === 0) {
      return reply.code(400).send({ error: 'invalid-input', message: 'teamId required' });
    }
    const result = await completeOnboarding(user.id, teamId);
    if (!result.ok) {
      return reply.code(statusForOnboardingError(result.error)).send({ error: result.error, message: result.message });
    }
    log.info('onboarding.select.ok', { userId: user.id, teamSlug: result.value.teamSlug });
    return reply.code(201).send(result.value);
  });

  app.get('/api/admin/onboarding/config', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ config: await getConfig() });
  });

  app.put<{ Body: { introDialogue?: string; bgImage?: string } }>('/api/admin/onboarding/config', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const body = req.body ?? {};
    if (typeof body.introDialogue !== 'string') {
      return reply.code(400).send({ error: 'invalid-input', message: 'introDialogue required' });
    }
    const result = await updateConfig({
      introDialogue: body.introDialogue,
      bgImage: typeof body.bgImage === 'string' ? body.bgImage : '',
    });
    if (!result.ok) {
      return reply.code(statusForOnboardingError(result.error)).send({ error: result.error, message: result.message });
    }
    log.info('admin.onboarding.config.update', { adminId: admin.id });
    return reply.send({ config: result.value });
  });

  app.get('/api/admin/onboarding/teams', async (req, reply) => {
    await requireAdmin(req, reply);
    return reply.send({ teams: await listTeamsAdmin() });
  });

  app.get<{ Params: { id: string } }>('/api/admin/onboarding/teams/:id', async (req, reply) => {
    await requireAdmin(req, reply);
    const team = await getTeam(req.params.id);
    if (!team) return reply.code(404).send({ error: 'not-found' });
    return reply.send({ team });
  });

  app.post<{ Body: TeamBody }>('/api/admin/onboarding/teams', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const input = normalizeTeamInput(req.body);
    if (!input) return reply.code(400).send({ error: 'invalid-input' });
    const result = await createTeam(input);
    if (!result.ok) {
      return reply.code(statusForOnboardingError(result.error)).send({ error: result.error, message: result.message });
    }
    log.info('admin.onboarding.team.create', { adminId: admin.id, id: result.value.id, slug: result.value.slug });
    return reply.code(201).send({ team: result.value });
  });

  app.put<{ Params: { id: string }; Body: TeamBody }>('/api/admin/onboarding/teams/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const input = normalizeTeamInput(req.body);
    if (!input) return reply.code(400).send({ error: 'invalid-input' });
    const result = await updateTeam(req.params.id, input);
    if (!result.ok) {
      return reply.code(statusForOnboardingError(result.error)).send({ error: result.error, message: result.message });
    }
    log.info('admin.onboarding.team.update', { adminId: admin.id, id: req.params.id });
    return reply.send({ team: result.value });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/onboarding/teams/:id', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    const result = await deleteTeam(req.params.id);
    if (!result.ok) {
      return reply.code(statusForOnboardingError(result.error)).send({ error: result.error });
    }
    log.info('admin.onboarding.team.delete', { adminId: admin.id, id: req.params.id });
    return reply.send({ ok: true, id: req.params.id });
  });
};
