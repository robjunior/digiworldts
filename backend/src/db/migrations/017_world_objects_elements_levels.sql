-- 017_world_objects_elements_levels.sql
--
-- Adds element restriction + level range to world_objects so admins can
-- configure a marker's random encounter spec at placement time.
--
--   elements  TEXT (JSON array of Element strings, or NULL = no restriction)
--   min_level INTEGER (nullable; when set, drives random encounter min level)
--   max_level INTEGER (nullable; when set, drives random encounter max level)
--
-- Portable across SQLite and Postgres. All three columns are nullable so
-- existing world_objects continue to work with their linked dungeon's own
-- random encounter fields.

ALTER TABLE world_objects ADD COLUMN elements TEXT;
ALTER TABLE world_objects ADD COLUMN min_level INTEGER;
ALTER TABLE world_objects ADD COLUMN max_level INTEGER;
