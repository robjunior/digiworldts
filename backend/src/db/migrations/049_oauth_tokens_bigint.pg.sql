-- 049_oauth_tokens_bigint.pg.sql
--
-- Fixes 045_oauth_tokens.sql on Postgres. The original migration declared
-- expires_at / linked_at / updated_at as INTEGER, which is variable-width in
-- SQLite (fine for ms timestamps) but strictly INT4 in Postgres (max value
-- 2_147_483_647). Millisecond timestamps for any date after 1970-01-25 exceed
-- that limit, so INSERT into oauth_tokens on Postgres fails with
--   error code 22003 "value ... is out of range for type integer"
-- the first time an OAuth callback tries to persist tokens (linked_at = now()
-- is ~1.78e12).
--
-- SQLite doesn't need this migration — its INTEGER type promotes to 8 bytes
-- automatically. Hence the .pg.sql suffix.

ALTER TABLE oauth_tokens
  ALTER COLUMN expires_at TYPE BIGINT,
  ALTER COLUMN linked_at  TYPE BIGINT,
  ALTER COLUMN updated_at TYPE BIGINT;
