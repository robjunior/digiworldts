/**
 * Player career + PvP history endpoints.
 *
 *   GET /api/player/career        → aggregate for the account page hero + tiles
 *   GET /api/player/pvp-history   → last N matches for the history column
 *
 * Both are read-only aggregates; no CRUD lives here. Anything that mutates
 * user progression goes through its own module (roster/xp, battle/mmr, etc.).
 *
 * All queries use `?` placeholders — portable across SQLite + Postgres via
 * the shared `q()`/`one()` helpers in `db/index.ts`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/routes.js';
import { one, q } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import type { Stage, TemplateDigimon } from '../digimon/types.js';
import { xpToReach, levelFromXp } from '../progression/xp.js';
import { getActiveSeason, getPeakMmr, listUserResults } from '../seasons/repo.js';

// ============================================================================
// SQL
// ============================================================================

// Battles: wins/losses/draws where user was on either side.
// Portable conditional sum (works on SQLite AND Postgres — FILTER syntax is PG only).
const SQL_BATTLE_TOTALS = `
  SELECT
    SUM(CASE WHEN winner = ? THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN winner IS NOT NULL AND winner != ? THEN 1 ELSE 0 END) AS losses,
    SUM(CASE WHEN winner IS NULL THEN 1 ELSE 0 END) AS draws
  FROM matches
  WHERE player_a = ? OR player_b = ?
`;

// Roster snapshot for level derivation + digivolutions counter.
const SQL_ROSTER_MIN = `
  SELECT catalog_id, level, xp, evolution_history
  FROM player_roster
  WHERE user_id = ?
`;

// Dex Registered = COUNT distinct catalog_ids in player_species_data.
const SQL_DEX_COUNT = `SELECT COUNT(*) AS n FROM player_species_data WHERE user_id = ?`;

// Time Trained = SUM(duration_ms) for completed training sessions.
const SQL_TIME_TRAINED_MS = `
  SELECT COALESCE(SUM(duration_ms), 0) AS ms
  FROM training_sessions
  WHERE user_id = ? AND collected_at IS NOT NULL
`;

// PvP history — most recent first, joined with users for display names.
const SQL_PVP_HISTORY = `
  SELECT
    m.id, m.player_a, m.player_b, m.winner, m.outcome, m.rounds, m.started_at, m.ended_at,
    ua.display_name AS a_name, ub.display_name AS b_name
  FROM matches m
  JOIN users ua ON ua.id = m.player_a
  JOIN users ub ON ub.id = m.player_b
  WHERE m.player_a = ? OR m.player_b = ?
  ORDER BY m.ended_at DESC
  LIMIT ?
`;

// User row (for MMR).
const SQL_USER_MMR = `SELECT mmr FROM users WHERE id = ?`;

// ============================================================================
// Row shapes (local — not exported)
// ============================================================================

type BattleTotalsRow = {
  readonly wins: number | null;
  readonly losses: number | null;
  readonly draws: number | null;
};

type RosterMinRow = {
  readonly catalog_id: string;
  readonly level: number;
  readonly xp: number;
  readonly evolution_history: string | null;
};

type CountRow = { readonly n: number | null };
type MsRow = { readonly ms: number | null };
type MmrRow = { readonly mmr: number };

type PvpRow = {
  readonly id: string;
  readonly player_a: string;
  readonly player_b: string;
  readonly winner: string | null;
  readonly outcome: 'win_a' | 'win_b' | 'draw' | 'fled_a' | 'fled_b' | 'abandoned';
  readonly rounds: number;
  readonly started_at: number;
  readonly ended_at: number;
  readonly a_name: string;
  readonly b_name: string;
};

// ============================================================================
// Response shapes (exported for the frontend client)
// ============================================================================

export type PlayerCareerResponse = {
  readonly tamer: {
    readonly id: string;
    readonly username: string;
    readonly displayName: string;
    readonly level: number;
    readonly xp: number;
    readonly xpFloor: number;
    readonly xpNext: number;
    readonly mmr: number;
    readonly mmrHigh: number;
    readonly tier: 'I' | 'II' | 'III' | 'IV' | 'V';
  };
  readonly activeSeason: {
    readonly id: string;
    readonly name: string;
    readonly endsAt: number;
  } | null;
  readonly seasonHistory: readonly {
    readonly seasonId: string;
    readonly seasonName: string;
    readonly finalMmr: number;
    readonly finalizedAt: number;
  }[];
  readonly battles: {
    readonly wins: number;
    readonly losses: number;
    readonly draws: number;
    readonly total: number;
    readonly winRatePct: number;
  };
  readonly digivolutions: number;
  readonly dexRegistered: number;
  readonly timeTrainedHours: number;
};

export type PvpMatchSummary = {
  readonly id: string;
  readonly win: boolean;
  readonly isDraw: boolean;
  readonly outcome: PvpRow['outcome'];
  readonly opponent: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly rounds: number;
  readonly endedAt: number;
};

export type PvpHistoryResponse = {
  readonly matches: readonly PvpMatchSummary[];
};

// ============================================================================
// Helpers
// ============================================================================

function tierFor(mmr: number): PlayerCareerResponse['tamer']['tier'] {
  if (mmr < 1200) return 'I';
  if (mmr < 1400) return 'II';
  if (mmr < 1600) return 'III';
  if (mmr < 1800) return 'IV';
  return 'V';
}

function parseEvolutionCount(json: string | null): number {
  if (!json || json === '[]') return 0;
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Derive tamer level/XP from the highest-level mon in the roster.
 * Uses the mon's stage curve from progression/xp.ts. Empty roster → level 1.
 */
function deriveTamerProgression(
  rosterRows: readonly RosterMinRow[],
  templateByCatalog: Map<string, TemplateDigimon>,
): { level: number; xp: number; xpFloor: number; xpNext: number } {
  if (rosterRows.length === 0) {
    return { level: 1, xp: 0, xpFloor: 0, xpNext: 100 };
  }
  const top = rosterRows.reduce((best, row) => {
    if (row.level > best.level) return row;
    if (row.level === best.level && row.xp > best.xp) return row;
    return best;
  }, rosterRows[0]!);
  const template = templateByCatalog.get(top.catalog_id);
  const stage: Stage = template?.stage ?? 'Rookie';
  const derivedLevel = levelFromXp(top.xp, stage);
  const level = Math.max(top.level, derivedLevel);
  const xpFloor = xpToReach(level, stage);
  const xpNext = xpToReach(level + 1, stage);
  const xp = Math.min(Math.max(top.xp, xpFloor), xpNext);
  return { level, xp, xpFloor, xpNext };
}

// ============================================================================
// Plugin
// ============================================================================

const PvpHistoryQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const playerPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/player/career', async (req, reply) => {
    const user = await requireAuth(req, reply);

    // Fire the parallelizable reads together — none depend on each other.
    const [battleRow, rosterRows, dexRow, timeRow, mmrRow, activeSeason, peakMmr, history] =
      await Promise.all([
        one<BattleTotalsRow>(SQL_BATTLE_TOTALS, user.id, user.id, user.id, user.id),
        q<RosterMinRow>(SQL_ROSTER_MIN, user.id),
        one<CountRow>(SQL_DEX_COUNT, user.id),
        one<MsRow>(SQL_TIME_TRAINED_MS, user.id),
        one<MmrRow>(SQL_USER_MMR, user.id),
        getActiveSeason(),
        getPeakMmr(user.id),
        listUserResults(user.id),
      ]);

    const catalog = await loadCatalog();
    const templateByCatalog = new Map<string, TemplateDigimon>();
    for (const t of catalog.digimons) templateByCatalog.set(t.id, t);

    const wins = battleRow?.wins ?? 0;
    const losses = battleRow?.losses ?? 0;
    const draws = battleRow?.draws ?? 0;
    const total = wins + losses + draws;
    const winRatePct = total > 0 ? Math.round((wins / total) * 100) : 0;

    const digivolutions = rosterRows.reduce((sum, r) => sum + parseEvolutionCount(r.evolution_history), 0);

    const progression = deriveTamerProgression(rosterRows, templateByCatalog);
    const mmr = mmrRow?.mmr ?? user.mmr;
    const mmrHigh = peakMmr !== null && peakMmr > mmr ? peakMmr : mmr;

    const response: PlayerCareerResponse = {
      tamer: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        level: progression.level,
        xp: progression.xp,
        xpFloor: progression.xpFloor,
        xpNext: progression.xpNext,
        mmr,
        mmrHigh,
        tier: tierFor(mmrHigh),
      },
      activeSeason: activeSeason
        ? { id: activeSeason.id, name: activeSeason.name, endsAt: activeSeason.endsAt }
        : null,
      seasonHistory: history.map((r) => ({
        seasonId: r.seasonId,
        seasonName: r.seasonName,
        finalMmr: r.finalMmr,
        finalizedAt: r.finalizedAt,
      })),
      battles: { wins, losses, draws, total, winRatePct },
      digivolutions,
      dexRegistered: dexRow?.n ?? 0,
      timeTrainedHours: Math.round(((timeRow?.ms ?? 0) / 3_600_000) * 10) / 10,
    };
    return reply.send(response);
  });

  app.get('/api/player/pvp-history', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const parsed = PvpHistoryQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-query', details: parsed.error.issues });
    }
    const limit = parsed.data.limit;
    const rows = await q<PvpRow>(SQL_PVP_HISTORY, user.id, user.id, limit);
    const matches: PvpMatchSummary[] = rows.map((row) => {
      const iAmA = row.player_a === user.id;
      const opponent = iAmA
        ? { id: row.player_b, displayName: row.b_name }
        : { id: row.player_a, displayName: row.a_name };
      const isDraw = row.winner === null;
      const win = !isDraw && row.winner === user.id;
      return {
        id: row.id,
        win,
        isDraw,
        outcome: row.outcome,
        opponent,
        rounds: row.rounds,
        endedAt: row.ended_at,
      };
    });
    const response: PvpHistoryResponse = { matches };
    return reply.send(response);
  });
};
