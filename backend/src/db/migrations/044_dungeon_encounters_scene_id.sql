-- 044_dungeon_encounters_scene_id.sql
--
-- Add per-encounter scene selection. When set, the boss/encounter locks in
-- that specific scene at battle start; when NULL, the frontend falls back to
-- the element-based auto-pick (Combat3DScene::pickArenaKey).
--
-- Nullable + no default is portable across SQLite and Postgres (both accept
-- ALTER TABLE ADD COLUMN with implicit NULL default). No backfill needed:
-- pre-existing encounters keep their auto-pick behavior.

ALTER TABLE dungeon_encounters ADD COLUMN scene_id TEXT;
