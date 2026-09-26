-- 109_player_teams_bigint.pg.sql
--
-- Fixes 108_player_teams.sql on Postgres. 108 declared created_at/updated_at
-- as INTEGER, which is variable-width in SQLite (fine for ms timestamps) but
-- strictly INT4 in Postgres (max value 2_147_483_647). The teams engine writes
-- Date.now() (a millisecond epoch, ~1.79e12 in 2026), so creating a team fails
-- with
--   error code 22003 "value "1790..." is out of range for type integer"
-- on Postgres while the same INSERT succeeds on SQLite. Same shape and fix as
-- 106_boosters_loaded_at_bigint.pg.sql.
--
-- SQLite doesn't need this migration -- its INTEGER type promotes to 8 bytes
-- automatically. Hence the .pg.sql suffix.

ALTER TABLE player_teams
  ALTER COLUMN created_at TYPE BIGINT,
  ALTER COLUMN updated_at TYPE BIGINT;