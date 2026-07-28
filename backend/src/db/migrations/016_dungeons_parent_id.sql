-- 016_dungeons_parent_id.sql
--
-- Adds optional parentId to dungeons so admin can nest related dungeons
-- into a parent → child tree in the admin list. Purely display metadata;
-- no runtime behavior change (parenting does NOT affect gameplay, unlocks,
-- or player flow — that stays driven by warps + biome_region).
--
-- Sets the 6 non-root elemental dungeons as children of their D1 so the
-- default seed shows the intended tree structure immediately:
--   Whispering Grove
--     └── Rooted Hollow
--           └── Palmon Sanctum
--   Tidal Cove
--     └── Sunken Ruins
--           └── Gomamon Deep
--   Ember Foothills
--     └── Cinder Caverns
--           └── Blazing Core
--
-- Portable across SQLite and Postgres.

ALTER TABLE dungeons ADD COLUMN parent_id TEXT REFERENCES dungeons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dungeons_parent ON dungeons(parent_id);

UPDATE dungeons SET parent_id = 'dun_plant_1' WHERE id = 'dun_plant_2';
UPDATE dungeons SET parent_id = 'dun_plant_2' WHERE id = 'dun_plant_3';
UPDATE dungeons SET parent_id = 'dun_water_1' WHERE id = 'dun_water_2';
UPDATE dungeons SET parent_id = 'dun_water_2' WHERE id = 'dun_water_3';
UPDATE dungeons SET parent_id = 'dun_fire_1'  WHERE id = 'dun_fire_2';
UPDATE dungeons SET parent_id = 'dun_fire_2'  WHERE id = 'dun_fire_3';
