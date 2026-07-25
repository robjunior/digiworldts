/**
 * Battle HTTP plugin. Endpoints:
 *
 *   GET /api/battle/spectate/:matchId (auth required)
 *     Returns { matchId, view, spectatorCount } for the current battle state.
 *     Live updates come through the WS `spectate` join → wsdeliver:{userId}
 *     fanout (see lobby/ws.ts + battle/routes.ts::deliverToSpectators).
 *
 *   GET /api/battle/last (auth required)
 *     Returns the caller's most recent completed PvP match summary
 *     (LastMatchSummary shape). 404 when the caller has no match history.
 *     Consumed by the lobby's LastMatch component after PvP finishes.
 *
 *   GET /api/battle/history?limit=N (auth required)
 *     Returns { matches: LastMatchSummary[] } — the caller's N most recent
 *     completed matches (default 10, max 50). Fallback for `/api/battle/last`
 *     and future match-history UI.
 *
 * Auth: any signed-in user can spectate any live match. Match history is
 * scoped per-caller — you only see matches you played in.
 *
 * The outcome field is normalized from the caller's perspective on the
 * backend (win_a becomes 'win' if you were player_a, 'loss' otherwise) so
 * the frontend doesn't need to know which side it played.
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { one, q } from '../db/index.js';
import { getSpectatorView } from './routes.js';
import { spectatorCount } from './spectate.js';

type MatchWithOpponent = {
  id: string;
  player_a: string;
  player_b: string;
  winner: string | null;
  outcome: 'win_a' | 'win_b' | 'draw' | 'fled_a' | 'fled_b' | 'abandoned';
  rounds: number;
  ended_at: number;
  opponent_name: string | null;
};

const SQL_SELECT_LAST_MATCH = `SELECT m.id, m.player_a, m.player_b, m.winner, m.outcome, m.rounds, m.ended_at, CASE WHEN m.player_a = ? THEN ub.display_name ELSE ua.display_name END AS opponent_name FROM matches m LEFT JOIN users ua ON ua.id = m.player_a LEFT JOIN users ub ON ub.id = m.player_b WHERE m.player_a = ? OR m.player_b = ? ORDER BY m.ended_at DESC LIMIT 1`;

const SQL_SELECT_MATCH_HISTORY = `SELECT m.id, m.player_a, m.player_b, m.winner, m.outcome, m.rounds, m.ended_at, CASE WHEN m.player_a = ? THEN ub.display_name ELSE ua.display_name END AS opponent_name FROM matches m LEFT JOIN users ua ON ua.id = m.player_a LEFT JOIN users ub ON ub.id = m.player_b WHERE m.player_a = ? OR m.player_b = ? ORDER BY m.ended_at DESC LIMIT ?`;

type NormalizedOutcome = 'win' | 'loss' | 'draw' | 'fled';

type LastMatchSummary = {
  id: string;
  outcome: NormalizedOutcome;
  opponent?: string;
  endedAt: number;
};

function normalizeOutcome(row: MatchWithOpponent, userId: string): NormalizedOutcome {
  const isPlayerA = row.player_a === userId;
  switch (row.outcome) {
    case 'draw':
    case 'abandoned':
      return 'draw';
    case 'win_a':
      return isPlayerA ? 'win' : 'loss';
    case 'win_b':
      return isPlayerA ? 'loss' : 'win';
    case 'fled_a':
      return isPlayerA ? 'fled' : 'win';
    case 'fled_b':
      return isPlayerA ? 'win' : 'fled';
  }
}

function rowToSummary(row: MatchWithOpponent, userId: string): LastMatchSummary {
  const summary: LastMatchSummary = {
    id: row.id,
    outcome: normalizeOutcome(row, userId),
    endedAt: row.ended_at,
  };
  if (row.opponent_name) summary.opponent = row.opponent_name;
  return summary;
}

export const battlePlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get<{ Params: { matchId: string } }>('/api/battle/spectate/:matchId', async (req, reply) => {
    await requireAuth(req, reply);
    const view = await getSpectatorView(req.params.matchId);
    if (!view) return reply.code(404).send({ error: 'match-not-found' });
    const count = await spectatorCount(req.params.matchId);
    return reply.send({ matchId: view.matchId, view: view.view, spectatorCount: count });
  });

  app.get('/api/battle/last', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const row = await one<MatchWithOpponent>(SQL_SELECT_LAST_MATCH, user.id, user.id, user.id);
    if (!row) return reply.code(404).send({ error: 'no-matches' });
    return reply.send(rowToSummary(row, user.id));
  });

  app.get<{ Querystring: { limit?: string } }>('/api/battle/history', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit ?? '10', 10) || 10));
    const rows = await q<MatchWithOpponent>(SQL_SELECT_MATCH_HISTORY, user.id, user.id, user.id, limit);
    return reply.send({ matches: rows.map((r) => rowToSummary(r, user.id)) });
  });
};
