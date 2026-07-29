/**
 * Per-user tutorial "seen" state. Backs the frontend's `useTutorialSeen` hook.
 *
 * Replaced localStorage persistence (which cleared with cache and didn't
 * cross devices) with the `users.tutorial_seen` JSON column added by
 * migration 022. Idempotent: marking an already-seen id is a no-op.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../auth/routes.js';
import { one, run } from '../db/index.js';
import { log } from '../util/log.js';

const SQL_SELECT_SEEN = `SELECT tutorial_seen FROM users WHERE id = ?`;
const SQL_UPDATE_SEEN = `UPDATE users SET tutorial_seen = ?, updated_at = ? WHERE id = ?`;

type UserTutorialRow = { readonly tutorial_seen: string | null };

function parseSeen(raw: string | null): string[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

const MarkBodySchema = z.object({
  tutorialId: z.string().min(1).max(200),
});

export const tutorialPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/tutorial/seen', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const row = await one<UserTutorialRow>(SQL_SELECT_SEEN, user.id);
    const seenIds = parseSeen(row?.tutorial_seen ?? null);
    return { seenIds };
  });

  app.post('/api/tutorial/seen', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const parsed = MarkBodySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'invalid-body' });
      return;
    }
    const { tutorialId } = parsed.data;
    const row = await one<UserTutorialRow>(SQL_SELECT_SEEN, user.id);
    const current = parseSeen(row?.tutorial_seen ?? null);
    if (current.includes(tutorialId)) {
      return { seenIds: current };
    }
    const next = [...current, tutorialId];
    await run(SQL_UPDATE_SEEN, JSON.stringify(next), Date.now(), user.id);
    log.info('tutorial.marked-seen', { userId: user.id, tutorialId });
    return { seenIds: next };
  });

  app.delete('/api/tutorial/seen', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    await run(SQL_UPDATE_SEEN, '[]', Date.now(), user.id);
    log.info('tutorial.reset', { userId: user.id });
    return { seenIds: [] };
  });
};
