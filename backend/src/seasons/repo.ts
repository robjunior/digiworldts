/**
 * Seasons — competitive periods with MMR snapshots.
 *
 * Lifecycle:
 *   1. Admin creates a season with a planned start/end window.
 *   2. Users play; `users.mmr` moves as usual (matches always count).
 *   3. Ticker (src/seasons/ticker.ts) polls every 60s and auto-closes any
 *      season whose `ends_at <= now`:
 *        a. INSERT a row per active user into `user_season_results`
 *           capturing their MMR at the snapshot moment.
 *        b. Apply SOFT DECAY to `users.mmr` for those same users:
 *              new = round(1000 + (old - 1000) * 0.5), clamped >= 1000
 *           (Bronze/floor players are unaffected; top players regress halfway
 *           toward 1000. Preserves relative order.)
 *        c. Set `seasons.ended_at = now`.
 *      Whole thing is a single transaction — a mid-close crash re-runs from
 *      scratch on the next tick because `ended_at` stays NULL until commit.
 *
 * The player career endpoint reads `rankHi` = MAX(final_mmr) FROM user_season_results.
 *
 * Public reads (any authed user) — season list + own results — live here.
 * Admin mutations live in `routes.ts`.
 */
import { one, q, run, tx } from '../db/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

// ============================================================================
// Row shapes — mirror migrations/026_seasons.sql
// ============================================================================

export type SeasonRow = {
  readonly id: string;
  readonly name: string;
  readonly starts_at: number;
  readonly ends_at: number;
  readonly ended_at: number | null;
  readonly created_at: number;
  readonly created_by: string | null;
};

export type UserSeasonResultRow = {
  readonly user_id: string;
  readonly season_id: string;
  readonly final_mmr: number;
  readonly finalized_at: number;
};

export type Season = {
  readonly id: string;
  readonly name: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly endedAt: number | null;
  readonly createdAt: number;
  readonly createdBy: string | null;
};

export type UserSeasonResult = {
  readonly userId: string;
  readonly seasonId: string;
  readonly seasonName: string;
  readonly finalMmr: number;
  readonly finalizedAt: number;
};

// ============================================================================
// SQL constants (portable across SQLite + Postgres via q()/one()/run())
// ============================================================================

const SQL_LIST_SEASONS = `SELECT * FROM seasons ORDER BY created_at DESC`;
const SQL_GET_SEASON = `SELECT * FROM seasons WHERE id = ?`;
const SQL_LIST_ACTIVE = `SELECT * FROM seasons WHERE ended_at IS NULL ORDER BY starts_at ASC`;
const SQL_LIST_EXPIRED_OPEN = `SELECT * FROM seasons WHERE ended_at IS NULL AND ends_at <= ? ORDER BY ends_at ASC`;
const SQL_INSERT_SEASON = `INSERT INTO seasons (id, name, starts_at, ends_at, ended_at, created_at, created_by) VALUES (?, ?, ?, ?, NULL, ?, ?)`;
const SQL_UPDATE_SEASON = `UPDATE seasons SET name = ?, starts_at = ?, ends_at = ? WHERE id = ? AND ended_at IS NULL`;
const SQL_MARK_ENDED = `UPDATE seasons SET ended_at = ? WHERE id = ? AND ended_at IS NULL`;
const SQL_DELETE_SEASON = `DELETE FROM seasons WHERE id = ? AND ended_at IS NULL`;

const SQL_LIST_RESULTS_FOR_USER = `
  SELECT r.user_id, r.season_id, r.final_mmr, r.finalized_at, s.name AS season_name
  FROM user_season_results r
  JOIN seasons s ON s.id = r.season_id
  WHERE r.user_id = ?
  ORDER BY r.finalized_at DESC
`;
const SQL_MAX_FINAL_MMR = `SELECT MAX(final_mmr) AS peak FROM user_season_results WHERE user_id = ?`;
const SQL_SNAPSHOT_ALL_USERS_INTO_RESULTS = `
  INSERT INTO user_season_results (user_id, season_id, final_mmr, finalized_at)
  SELECT id, ?, mmr, ? FROM users WHERE disabled = 0
`;
const SQL_APPLY_SOFT_DECAY_TO_ALL = `
  UPDATE users
  SET mmr = CAST(1000 + (mmr - 1000) * 0.5 AS INTEGER),
      updated_at = ?
  WHERE disabled = 0 AND mmr > 1000
`;

// ============================================================================
// Row → public mapping
// ============================================================================

function seasonFromRow(r: SeasonRow): Season {
  return {
    id: r.id,
    name: r.name,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    endedAt: r.ended_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

// ============================================================================
// Errors
// ============================================================================

export type SeasonError =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'already_ended' }
  | { readonly kind: 'invalid_range'; readonly reason: string }
  | { readonly kind: 'name_required' };

function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}
function err(error: SeasonError): { readonly ok: false; readonly error: SeasonError } {
  return { ok: false, error };
}

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SeasonError };

// ============================================================================
// Reads
// ============================================================================

export async function listSeasons(): Promise<Season[]> {
  const rows = await q<SeasonRow>(SQL_LIST_SEASONS);
  return rows.map(seasonFromRow);
}

export async function getSeason(id: string): Promise<Season | null> {
  const row = await one<SeasonRow>(SQL_GET_SEASON, id);
  return row ? seasonFromRow(row) : null;
}

export async function listActiveSeasons(): Promise<Season[]> {
  const rows = await q<SeasonRow>(SQL_LIST_ACTIVE);
  return rows.map(seasonFromRow);
}

export async function getActiveSeason(): Promise<Season | null> {
  const rows = await listActiveSeasons();
  return rows[0] ?? null;
}

export async function listUserResults(userId: string): Promise<UserSeasonResult[]> {
  type Row = UserSeasonResultRow & { readonly season_name: string };
  const rows = await q<Row>(SQL_LIST_RESULTS_FOR_USER, userId);
  return rows.map((r) => ({
    userId: r.user_id,
    seasonId: r.season_id,
    seasonName: r.season_name,
    finalMmr: r.final_mmr,
    finalizedAt: r.finalized_at,
  }));
}

/**
 * `rankHi` = MAX(final_mmr) across all a user's past seasons.
 * Returns null when the user has never finalized any season.
 */
export async function getPeakMmr(userId: string): Promise<number | null> {
  const row = await one<{ readonly peak: number | null }>(SQL_MAX_FINAL_MMR, userId);
  return row?.peak ?? null;
}

// ============================================================================
// Mutations (admin surface)
// ============================================================================

export type CreateSeasonInput = {
  readonly name: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly createdBy: string;
};

export async function createSeason(input: CreateSeasonInput): Promise<Result<Season>> {
  const name = input.name.trim();
  if (name.length === 0) return err({ kind: 'name_required' });
  if (input.endsAt <= input.startsAt) {
    return err({ kind: 'invalid_range', reason: 'ends_at must be after starts_at' });
  }
  const id = newId('sea');
  const now = Date.now();
  await run(SQL_INSERT_SEASON, id, name, input.startsAt, input.endsAt, now, input.createdBy);
  log.info('season.created', { id, name, startsAt: input.startsAt, endsAt: input.endsAt, by: input.createdBy });
  const season = await getSeason(id);
  if (season === null) return err({ kind: 'not_found' });
  return ok(season);
}

export type UpdateSeasonInput = {
  readonly name?: string;
  readonly startsAt?: number;
  readonly endsAt?: number;
};

export async function updateSeason(id: string, patch: UpdateSeasonInput): Promise<Result<Season>> {
  const current = await getSeason(id);
  if (current === null) return err({ kind: 'not_found' });
  if (current.endedAt !== null) return err({ kind: 'already_ended' });
  const name = (patch.name ?? current.name).trim();
  if (name.length === 0) return err({ kind: 'name_required' });
  const startsAt = patch.startsAt ?? current.startsAt;
  const endsAt = patch.endsAt ?? current.endsAt;
  if (endsAt <= startsAt) {
    return err({ kind: 'invalid_range', reason: 'ends_at must be after starts_at' });
  }
  await run(SQL_UPDATE_SEASON, name, startsAt, endsAt, id);
  log.info('season.updated', { id, name, startsAt, endsAt });
  const updated = await getSeason(id);
  if (updated === null) return err({ kind: 'not_found' });
  return ok(updated);
}

export async function deleteSeason(id: string): Promise<Result<{ readonly id: string }>> {
  const current = await getSeason(id);
  if (current === null) return err({ kind: 'not_found' });
  if (current.endedAt !== null) return err({ kind: 'already_ended' });
  const result = await run(SQL_DELETE_SEASON, id);
  if (result.changes === 0) return err({ kind: 'already_ended' });
  log.info('season.deleted', { id });
  return ok({ id });
}

/**
 * End a season NOW (from admin action or ticker).
 *
 * Single transaction:
 *   1. Snapshot every non-disabled user's current MMR into user_season_results.
 *   2. Apply soft decay to users.mmr where mmr > 1000.
 *   3. Mark seasons.ended_at = now.
 *
 * Idempotent: `SQL_MARK_ENDED` guards on `ended_at IS NULL`, so a concurrent
 * caller loses the UPDATE race (0 changes) and we bail. The ticker uses this
 * to serialize across nodes without a distributed lock in the common path.
 */
export async function endSeason(id: string): Promise<Result<{ readonly id: string; readonly snapshottedUsers: number }>> {
  const current = await getSeason(id);
  if (current === null) return err({ kind: 'not_found' });
  if (current.endedAt !== null) return err({ kind: 'already_ended' });
  const now = Date.now();
  try {
    const snapshottedUsers = await tx(async (t) => {
      const snap = await t.run(SQL_SNAPSHOT_ALL_USERS_INTO_RESULTS, [id, now]);
      await t.run(SQL_APPLY_SOFT_DECAY_TO_ALL, [now]);
      const mark = await t.run(SQL_MARK_ENDED, [now, id]);
      if (mark.changes === 0) {
        // Someone else closed it concurrently — abort the whole tx so their
        // snapshot wins and we don't double-insert.
        throw new Error('__season_closed_concurrently__');
      }
      return snap.changes;
    });
    log.info('season.ended', { id, snapshottedUsers, endedAt: now });
    return ok({ id, snapshottedUsers });
  } catch (e) {
    if (e instanceof Error && e.message === '__season_closed_concurrently__') {
      log.info('season.end_race_lost', { id });
      return err({ kind: 'already_ended' });
    }
    throw e;
  }
}

/**
 * List seasons whose planned `ends_at` is in the past and haven't been closed
 * yet. Used by the ticker.
 */
export async function listSeasonsDueForClose(now: number): Promise<Season[]> {
  const rows = await q<SeasonRow>(SQL_LIST_EXPIRED_OPEN, now);
  return rows.map(seasonFromRow);
}
