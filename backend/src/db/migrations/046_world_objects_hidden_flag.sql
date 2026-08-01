-- 046_world_objects_hidden_flag.sql
--
-- Narrative gating for world map objects: a world_object with
-- hidden_until_flag set is only visible to users whose user_flags include
-- that flag. NULL (the default for legacy rows) means "always visible",
-- preserving pre-P5 behavior.
--
-- Nullable + no default is portable across SQLite and Postgres. No backfill
-- needed.

ALTER TABLE world_objects ADD COLUMN hidden_until_flag TEXT;
