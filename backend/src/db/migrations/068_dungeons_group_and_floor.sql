-- F9 — Multi-floor dungeons: group_id + floor_index.
--
-- Adds two OPTIONAL columns to `dungeons`. When both are NULL (the
-- default for every legacy dungeon), the dungeon stays single-floor
-- and every code path here behaves exactly as F1-F8 does today.
-- When set together, they mark a dungeon as one floor of a multi-
-- floor group:
--   * `dungeon_group_id` — string tag shared across every floor of
--     the same group. Distinct groups pick distinct tags; there is
--     no separate `dungeon_groups` table because there is no metadata
--     to store — the group name IS the tag, and each floor's own
--     `name` (`"Test Tower F2"`) is the presentational label.
--   * `floor_index` — 0-based ordinal within the group. Used ONLY
--     for the floor breadcrumb; adjacency between floors is defined
--     by explicit `dungeon_warps` rows, not by index arithmetic, so
--     a group can express any DAG (branching towers, boss chambers
--     off to the side, one-way descents).
--
-- moveRun's warp branch (backend/src/dungeons/repo.ts) detects when
-- a warp crosses floors of the same group and migrates the player's
-- run + stash rows to the destination floor's dungeon_id. wipeRun
-- and extractRun aggregate the stash across every floor of the group
-- when they fire, so a wipe on floor 2 confiscates loot picked up on
-- floor 1 and an extraction on floor 3 grants everything back.
--
-- Portable across SQLite and Postgres. Reversible — drop the columns
-- to restore single-floor semantics.
ALTER TABLE dungeons ADD COLUMN floor_index INTEGER;
ALTER TABLE dungeons ADD COLUMN dungeon_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_dungeons_group_floor ON dungeons(dungeon_group_id, floor_index);
