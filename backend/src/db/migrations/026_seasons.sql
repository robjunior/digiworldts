-- 026_seasons.sql
--
-- Competitive seasons + per-user season results.
--
-- `seasons` is admin-managed: an admin creates a season with a planned
-- start/end date range (e.g. April → May). When `now >= ends_at` the
-- background ticker (`src/seasons/ticker.ts`) auto-closes the season:
--   1. Snapshots each user's current `users.mmr` into `user_season_results`
--   2. Applies SOFT DECAY to `users.mmr`: `new = 1000 + (old - 1000) * 0.5`
--      (rounded to nearest int; clamped >= 1000) — brings top players closer
--      to the pack while preserving relative order.
--   3. Sets `seasons.ended_at = now` (idempotent).
--
-- `rankHi` on the tamer career page is `MAX(final_mmr)` from all a user's
-- past `user_season_results` (falls back to current `mmr` when the user has
-- never been through a season close).
--
-- Matches always count for MMR; the season concept only marks WHEN the
-- snapshot happens, not whether MMR is live.
--
-- Portable across SQLite and Postgres. `INTEGER` on both sides is 8-byte in
-- SQLite and 4-byte in Postgres — both accept our timestamp ranges (unix ms)
-- since we're within INT4 range through year 2038 and Postgres widens
-- transparently at the driver layer for larger values via BIGINT casts in
-- follow-up migrations if we ever need them (see 012_dungeon_timestamps_bigint.pg.sql
-- for the precedent). For now unix ms fits INT4 → INT8 conversion cleanly.

CREATE TABLE IF NOT EXISTS seasons (
  id           TEXT PRIMARY KEY,                                -- 'sea_...'
  name         TEXT NOT NULL,                                   -- 'Spring 2026', 'Season 1'
  starts_at    INTEGER NOT NULL,                                -- unix ms (planned)
  ends_at      INTEGER NOT NULL,                                -- unix ms (planned)
  ended_at     INTEGER,                                         -- unix ms (actual close; NULL = still open)
  created_at   INTEGER NOT NULL,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_seasons_open ON seasons(ends_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_seasons_created ON seasons(created_at);

CREATE TABLE IF NOT EXISTS user_season_results (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id    TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  final_mmr    INTEGER NOT NULL,
  finalized_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, season_id)
);
CREATE INDEX IF NOT EXISTS idx_user_season_results_user_mmr ON user_season_results(user_id, final_mmr);
CREATE INDEX IF NOT EXISTS idx_user_season_results_season ON user_season_results(season_id);
