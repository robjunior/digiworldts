-- 032_dungeon_traps_bigint.pg.sql
--
-- Fix schema typo from migration 023: `dungeon_traps.created_at` was
-- declared INTEGER (int4, max 2^31-1) instead of BIGINT. Date.now() in ms
-- is > 2^31 for any timestamp from 2038 onward — actually since 2001-09-09
-- Date.now() has already outgrown int4 for ms epochs, so every trap INSERT
-- in production overflows with error 22003. Every other `_at` column in the
-- schema is BIGINT; align dungeon_traps.created_at with the convention.
--
-- Postgres-only: SQLite's INTEGER affinity is already 64-bit, no fix needed.

ALTER TABLE dungeon_traps ALTER COLUMN created_at TYPE BIGINT USING created_at::BIGINT;
