/**
 * Battle HTTP plugin. One endpoint today — spectator initial-fetch:
 *
 *   GET /api/battle/spectate/:matchId (auth required)
 *
 * Returns { matchId, view, spectatorCount } for the current battle state.
 * Live updates come through the WS `spectate` join → wsdeliver:{userId}
 * fanout (see lobby/ws.ts + battle/routes.ts::deliverToSpectators).
 *
 * Auth: any signed-in user can spectate any live match. Matches are inherently
 * public state — spectators see side A's perspective (opposing team stats
 * redacted, matching what a player sees).
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { getSpectatorView } from './routes.js';
import { spectatorCount } from './spectate.js';

export const battlePlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get<{ Params: { matchId: string } }>('/api/battle/spectate/:matchId', async (req, reply) => {
    await requireAuth(req, reply);
    const view = await getSpectatorView(req.params.matchId);
    if (!view) return reply.code(404).send({ error: 'match-not-found' });
    const count = await spectatorCount(req.params.matchId);
    return reply.send({ matchId: view.matchId, view: view.view, spectatorCount: count });
  });
};
