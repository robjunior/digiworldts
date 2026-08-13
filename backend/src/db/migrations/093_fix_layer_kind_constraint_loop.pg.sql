-- 093_fix_layer_kind_constraint_loop.pg.sql
--
-- Postgres-only. Fixes DBs where BOTH a stale layer_kind CHECK constraint
-- (without 'liquid') and a correct one coexist on dungeon_tiles.
--
-- Why this is needed: migrations 090 and 092 used `SELECT ... INTO con_name`
-- in a DO block, which silently keeps only the FIRST matching row when more
-- than one CHECK constraint on layer_kind exists. Each run therefore dropped
-- the already-correct constraint and re-added it, leaving the stale
-- restrictive one in place — blocking any INSERT with layer_kind='liquid'.
--
-- This migration loops over EVERY check constraint touching layer_kind and
-- drops them all, then installs the single canonical constraint including
-- 'liquid'. Idempotent: on a DB with one correct constraint it drops and
-- re-adds it, ending in the same state.
-- Do NOT wrap in BEGIN/COMMIT — the migrator runs each file in a tx.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'dungeon_tiles'::regclass
      AND c.contype = 'c'
      AND a.attname = 'layer_kind'
  LOOP
    EXECUTE format('ALTER TABLE dungeon_tiles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE dungeon_tiles ADD CONSTRAINT dungeon_tiles_layer_kind_check
  CHECK (layer_kind IN ('liquid', 'floor', 'grass', 'tree', 'wall', 'walls', 'doors', 'water', 'pit', 'decoration', 'hidden'));