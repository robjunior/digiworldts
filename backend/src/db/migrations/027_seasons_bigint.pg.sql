-- 027_seasons_bigint.pg.sql
--
-- POSTGRES-ONLY. Fixes the same class of bug documented in
-- 012_dungeon_timestamps_bigint.pg.sql: SQLite INTEGER is 8-byte and stores
-- ms-epoch fine, but Postgres INTEGER is int4 (max 2,147,483,647) and
-- overflows on any real Date.now() (~1.78e12). Migration 026 declared the
-- seasons + user_season_results timestamps as plain INTEGER; the ticker
-- crashes on its first tick with "value out of range for type integer".
--
-- Widen every timestamp column to BIGINT. Data is safe: no season rows
-- exist yet when this migration runs (026 just created empty tables), so
-- ALTER TYPE is a pure metadata change.

ALTER TABLE seasons              ALTER COLUMN starts_at    TYPE BIGINT;
ALTER TABLE seasons              ALTER COLUMN ends_at      TYPE BIGINT;
ALTER TABLE seasons              ALTER COLUMN ended_at     TYPE BIGINT;
ALTER TABLE seasons              ALTER COLUMN created_at   TYPE BIGINT;

ALTER TABLE user_season_results  ALTER COLUMN finalized_at TYPE BIGINT;
