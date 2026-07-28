-- 012_dungeon_timestamps_bigint.pg.sql
--
-- POSTGRES-ONLY. SQLite's INTEGER is variable-length up to 8 bytes so it
-- happily stores ms-epoch values; Postgres's INTEGER is int4 (max
-- 2,147,483,647) which overflows on any real `Date.now()` value
-- (~1.78e12 as of this migration).
--
-- Migrations 006/008/010 declared every dungeon-family timestamp column as
-- plain INTEGER, which Postgres interpreted as int4. That was a latent bug:
-- the moment anyone tried to create a dungeon / encounter / item / warp /
-- door / run via the admin API (which uses `Date.now()`), the insert would
-- fail with "integer out of range". No user has hit it yet because no
-- dungeons had been authored against Postgres before now; the seed in
-- migration 013 is the first attempt.
--
-- This migration widens every one of those columns to BIGINT so that
-- Date.now()-shaped values fit cleanly (and the ~292M year range keeps us
-- comfortably past the 2038 problem).

ALTER TABLE dungeons            ALTER COLUMN created_at    TYPE BIGINT;
ALTER TABLE dungeons            ALTER COLUMN updated_at    TYPE BIGINT;

ALTER TABLE dungeon_encounters  ALTER COLUMN created_at    TYPE BIGINT;
ALTER TABLE dungeon_encounters  ALTER COLUMN updated_at    TYPE BIGINT;

ALTER TABLE dungeon_items       ALTER COLUMN created_at    TYPE BIGINT;

ALTER TABLE dungeon_warps       ALTER COLUMN created_at    TYPE BIGINT;
ALTER TABLE dungeon_warps       ALTER COLUMN updated_at    TYPE BIGINT;

ALTER TABLE dungeon_doors       ALTER COLUMN created_at    TYPE BIGINT;
ALTER TABLE dungeon_doors       ALTER COLUMN updated_at    TYPE BIGINT;

ALTER TABLE user_dungeon_runs   ALTER COLUMN started_at    TYPE BIGINT;
ALTER TABLE user_dungeon_runs   ALTER COLUMN completed_at  TYPE BIGINT;
