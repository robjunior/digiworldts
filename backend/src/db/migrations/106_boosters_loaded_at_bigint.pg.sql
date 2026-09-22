-- 106_boosters_loaded_at_bigint.pg.sql
--
-- Fixes 105_boosters.sql on Postgres. The original migration declared
-- boosters.loaded_at as INTEGER, which is variable-width in SQLite (fine for
-- ms timestamps) but strictly INT4 in Postgres (max value 2_147_483_647).
-- The booster pipeline writes loaded_at = Date.now() (a millisecond epoch,
-- ~1.79e12 in 2026), so the content-deploy upsert into boosters fails with
--   error code 22003 "value ... is out of range for type integer"
-- on Postgres, while the same apply succeeds on SQLite.
--
-- SQLite doesn't need this migration -- its INTEGER type promotes to 8 bytes
-- automatically. Hence the .pg.sql suffix.

ALTER TABLE boosters
  ALTER COLUMN loaded_at TYPE BIGINT;