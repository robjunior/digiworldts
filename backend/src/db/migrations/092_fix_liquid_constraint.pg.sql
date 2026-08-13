-- 092_fix_liquid_constraint.pg.sql
--
-- Fixes the dungeon_tiles.layer_kind CHECK constraint on Postgres DBs where
-- migration 090 ran but failed to drop the old constraint because its name was
-- 'dungeon_tiles_new_layer_kind_check' (left over from the table recreation in
-- migration 088). This migration drops whichever CHECK constraint currently
-- guards layer_kind and installs the correct one including 'liquid'.
-- Do NOT wrap in BEGIN/COMMIT — the migrator runs each file in a tx.

DO $$
DECLARE
  con_name TEXT;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'dungeon_tiles'::regclass
    AND c.contype = 'c'
    AND a.attname = 'layer_kind';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE dungeon_tiles DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE dungeon_tiles ADD CONSTRAINT dungeon_tiles_layer_kind_check
  CHECK (layer_kind IN ('liquid', 'floor', 'grass', 'tree', 'wall', 'walls', 'doors', 'water', 'pit', 'decoration', 'hidden'));
