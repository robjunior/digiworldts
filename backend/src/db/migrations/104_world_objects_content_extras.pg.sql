-- 104_world_objects_content_extras.pg.sql  (Postgres only)
--
-- Restores the five world_objects columns the committed content bundle
-- carries. Their adding migration was deleted with the dungeon/world
-- feature-removal commit (5498847), so fresh DBs reject the bundle's
-- world_objects upsert ("column dungeon_id ... does not exist").
--
-- Deployed DBs that ran the old migration already have the columns:
-- IF NOT EXISTS makes this a no-op there. The sqlite twin lives in the
-- baseline schema.sql (SQLite has no conditional ADD COLUMN, and the only
-- long-lived SQLite DB already has the columns).
--
-- All five are nullable and the current bundle stores NULLs in them.

ALTER TABLE world_objects
  ADD COLUMN IF NOT EXISTS dungeon_id TEXT REFERENCES dungeons(id) ON DELETE SET NULL;
ALTER TABLE world_objects
  ADD COLUMN IF NOT EXISTS elements TEXT;
ALTER TABLE world_objects
  ADD COLUMN IF NOT EXISTS min_level INTEGER;
ALTER TABLE world_objects
  ADD COLUMN IF NOT EXISTS max_level INTEGER;
ALTER TABLE world_objects
  ADD COLUMN IF NOT EXISTS hidden_until_flag TEXT;