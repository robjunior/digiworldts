-- 021_dungeon_encounters_loots.sql
--
-- Bosses (and eventually every encounter) drop a list of items instead of the
-- single `reward_item_id` set by migration 018. Each entry rolls independently
-- on `chance` (0..1). `chance = 1` = guaranteed. `qty` is fixed per drop.
--
-- Encoded as a JSON string in one column so the shape can evolve without a
-- follow-up migration — matches how digimon_data is stored on the same table.
--
-- Backfills existing rows: an encounter with a non-null reward_item_id
-- becomes a single-entry guaranteed drop, so player-visible behavior is
-- preserved across the migration. `reward_item_id` is kept for now (read-only
-- backward compat) and can be dropped in a follow-up once every consumer
-- has migrated to `loots`.
--
-- Portable across SQLite and Postgres (both accept ALTER + JSON literals).

ALTER TABLE dungeon_encounters ADD COLUMN loots TEXT NOT NULL DEFAULT '[]';

UPDATE dungeon_encounters
SET loots = '[{"itemId":"' || reward_item_id || '","qty":1,"chance":1}]'
WHERE reward_item_id IS NOT NULL AND loots = '[]';
