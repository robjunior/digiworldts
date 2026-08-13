-- 090_add_liquid_layer_kind.pg.sql
--
-- Adds the 'liquid' layer kind to dungeon_tiles.layer_kind CHECK constraint.
-- Postgres can drop and re-add the constraint in place.
-- The constraint name may be 'dungeon_tiles_layer_kind_check' on fresh DBs or
-- 'dungeon_tiles_new_layer_kind_check' on DBs that ran migration 088 (the
-- table was recreated as dungeon_tiles_new and then renamed). We drop any
-- constraint on the layer_kind column and add the corrected one.
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
