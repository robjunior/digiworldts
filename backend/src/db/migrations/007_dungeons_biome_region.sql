-- Optional link from a dungeon to one of the 11 fixed world regions (biomes).
-- When set, the /api/world/regions endpoint reports that region as "scouted"
-- once the user has any user_dungeon_runs row for this dungeon, and clicking
-- the region node on the world globe navigates the player straight into it.
--
-- Nullable (dungeons can exist without being a region entry).
-- Unique when set (each region has at most ONE canonical dungeon).

ALTER TABLE dungeons ADD COLUMN biome_region TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeons_biome_region_uniq
  ON dungeons(biome_region)
  WHERE biome_region IS NOT NULL;
