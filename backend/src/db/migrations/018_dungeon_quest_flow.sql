-- 018_dungeon_quest_flow.sql
--
-- Restructures the 3 elemental dungeon sets into a clean progression and
-- introduces a 3-shard quest that unlocks 2 late-game dungeons.
--
--   * D1 (Whispering Grove / Tidal Cove / Ember Foothills):
--       intro dungeon. NO boss, NO key, NO door. Just walk + one potion +
--       the warp to D2. Playable with a fresh party out of onboarding.
--
--   * D2 (Rooted Hollow / Sunken Ruins / Cinder Caverns):
--       mid-boss dungeon. Boss + key + door retained. Loot: nothing special.
--
--   * D3 (Palmon Sanctum / Gomamon Deep / Blazing Core):
--       final boss of each set. Boss now DROPS a matching elemental shard
--       (Verdant / Tidal / Ember) as a 100%-guaranteed, once-per-player
--       reward, via a new `dungeon_encounters.reward_item_id` FK column.
--       Grant is idempotent because encounter.defeated is tracked per user
--       in `user_dungeon_runs.defeated_encounters` and the runtime hook
--       only fires the first time an encounter is defeated.
--
--   * NEW: two late-game dungeons gated by all three shards:
--       - `dun_convergence` at biome_region='storm'  (Convergence Storm)
--       - `dun_void`        at biome_region='void'   (The Static)
--     Both use the same 20×20 / 84-tile template. Both have a
--     `dungeons.unlock_requires_items` JSON array that lists the 3 shard
--     item ids; the /api/world/regions endpoint filters them out for any
--     player who does not yet own all 3.
--
-- Portable across SQLite and Postgres.

-- =============================================================================
-- 1. Schema: two new nullable columns
-- =============================================================================
ALTER TABLE dungeons            ADD COLUMN unlock_requires_items TEXT;
ALTER TABLE dungeon_encounters  ADD COLUMN reward_item_id        TEXT REFERENCES shop_items(id) ON DELETE SET NULL;

-- =============================================================================
-- 2. Strip D1 (of each elemental set) of its boss, key pickup, and door.
--    D1 becomes a free-entry intro dungeon.
-- =============================================================================
DELETE FROM dungeon_encounters WHERE id IN ('enc_plant_1_boss','enc_water_1_boss','enc_fire_1_boss');
DELETE FROM dungeon_items      WHERE id IN ('ditm_pln_1_key','ditm_wtr_1_key','ditm_fir_1_key');
DELETE FROM dungeon_doors      WHERE id IN ('dor_pln_1_gate','dor_wtr_1_gate','dor_fir_1_gate');

-- =============================================================================
-- 3. Add the 3 quest shards to the shop_items catalog.
--    enabled=0 so they never appear for purchase.
-- =============================================================================
INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at) VALUES
  ('itm-quest-shard-plant', 'Verdant Shard', 'A pulsing plant-etched fragment dropped by the Sanctum Elder. One of three shards needed to open the way beyond.', 0, 'quest', 'item', '{}', 0, 1753963000000),
  ('itm-quest-shard-water', 'Tidal Shard',   'A wave-slick water fragment dropped by the Deep Guardian. One of three shards needed to open the way beyond.',       0, 'quest', 'item', '{}', 0, 1753963000000),
  ('itm-quest-shard-fire',  'Ember Shard',   'A smoldering fire fragment dropped by the Core Phoenix. One of three shards needed to open the way beyond.',            0, 'quest', 'item', '{}', 0, 1753963000000)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 4. Wire the 3 D3 bosses to drop matching shards on defeat.
-- =============================================================================
UPDATE dungeon_encounters SET reward_item_id = 'itm-quest-shard-plant' WHERE id = 'enc_plant_3_boss';
UPDATE dungeon_encounters SET reward_item_id = 'itm-quest-shard-water' WHERE id = 'enc_water_3_boss';
UPDATE dungeon_encounters SET reward_item_id = 'itm-quest-shard-fire'  WHERE id = 'enc_fire_3_boss';

-- =============================================================================
-- 5. New late-game dungeons. Hidden until the player owns all three shards.
--    Both use the same 20x20 template with the standard corridor+two-room
--    layout used by the elemental set.
-- =============================================================================

-- 5-pre. Release the biome_regions this migration seeds. `dungeons` carries a
-- partial UNIQUE index on biome_region, so an admin-created dungeon that
-- already claimed 'storm' or 'void' would abort the INSERT below. Guarding the
-- INSERT with ON CONFLICT DO NOTHING is not sufficient: the tiles/encounters
-- inserted afterwards reference dun_convergence and dun_void by foreign key,
-- so a silently skipped dungeon fails the migration a few statements later.
-- Releasing the region keeps the admin's dungeon intact; only its region
-- assignment is cleared, and that is re-selectable from the dungeon admin UI.
UPDATE dungeons
   SET biome_region = NULL
 WHERE biome_region IN ('storm', 'void')
   AND id NOT IN ('dun_convergence', 'dun_void');

INSERT INTO dungeons (
  id, world_object_id, quest_id, parent_id, name, description, biome, width, height,
  spawn_x, spawn_y, biome_region,
  random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level,
  random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements,
  unlock_requires_items,
  created_at, updated_at
) VALUES
  ('dun_convergence', NULL, NULL, NULL, 'Convergence Storm',
    'The three shards resonate here. Something ancient stirs at the eye of the storm.',
    'storm', 20, 20, 4, 4, 'storm',
    1, 0.24, 18, 24, 'Champion', 1, 3, '["light","dark","electricity"]',
    '["itm-quest-shard-plant","itm-quest-shard-water","itm-quest-shard-fire"]',
    1753963000000, 1753963000000),
  ('dun_void', NULL, NULL, NULL, 'The Static',
    'A tear in the world. The shards react violently as you approach. This is where the world ends — or begins again.',
    'void', 20, 20, 4, 4, 'void',
    1, 0.28, 22, 28, 'Ultimate', 2, 3, '["null","dark"]',
    '["itm-quest-shard-plant","itm-quest-shard-water","itm-quest-shard-fire"]',
    1753963000000, 1753963000000)
ON CONFLICT (id) DO NOTHING;

-- 5a. Tiles for the two new dungeons (84 walkable tiles each, same template).
INSERT INTO dungeon_tiles (dungeon_id, x, y)
WITH d(id) AS (VALUES ('dun_convergence'), ('dun_void')),
t(x, y) AS (VALUES
  (2,2),(3,2),(4,2),(5,2),(6,2),
  (2,3),(3,3),(4,3),(5,3),(6,3),
  (2,4),(3,4),(4,4),(5,4),(6,4),
  (2,5),(3,5),(4,5),(5,5),(6,5),
  (2,6),(3,6),(4,6),(5,6),(6,6),
  (4,7),(4,8),(4,9),
  (2,10),(3,10),(4,10),(5,10),(6,10),
  (2,11),(3,11),(4,11),(5,11),(6,11),
  (2,12),(3,12),(4,12),(5,12),(6,12),
  (2,13),(3,13),(4,13),(5,13),(6,13),
  (2,14),(3,14),(4,14),(5,14),(6,14),
  (7,12),(8,12),(9,12),(10,12),(11,12),(12,12),
  (13,10),(14,10),(15,10),(16,10),(17,10),
  (13,11),(14,11),(15,11),(16,11),(17,11),
  (13,12),(14,12),(15,12),(16,12),(17,12),
  (13,13),(14,13),(15,13),(16,13),(17,13),
  (13,14),(14,14),(15,14),(16,14),(17,14)
)
-- The WHERE is load-bearing: SQLite cannot tell an upsert's ON from a join's ON
-- after INSERT ... SELECT, and requires a WHERE clause to disambiguate.
SELECT d.id, t.x, t.y FROM d CROSS JOIN t WHERE true
ON CONFLICT (dungeon_id, x, y) DO NOTHING;

-- 5b. Final bosses at (15,12) for each new dungeon.
--     Convergence: Champion-tier Angemon (skb-8) L24
--     Void:        Ultimate-tier MetalGreymon (skb-56) L28
INSERT INTO dungeon_encounters (id, dungeon_id, x, y, label, difficulty, digimon_data, created_at, updated_at) VALUES
  ('enc_convergence_boss', 'dun_convergence', 15, 12, 'Convergence Warden', 'boss',
    '[{"catalogId":"skb-8","level":24,"nickname":"Convergence Warden"}]',
    1753963000000, 1753963000000),
  ('enc_void_boss',        'dun_void',        15, 12, 'The Static',         'boss',
    '[{"catalogId":"skb-56","level":28,"nickname":"The Static"}]',
    1753963000000, 1753963000000)
ON CONFLICT (id) DO NOTHING;

-- 5c. Warps at (17,12) exiting back to the world.
INSERT INTO dungeon_warps (id, dungeon_id, x, y, target_dungeon_id, label, created_at, updated_at) VALUES
  ('wrp_convergence_exit', 'dun_convergence', 17, 12, NULL, 'Return to the World', 1753963000000, 1753963000000),
  ('wrp_void_exit',        'dun_void',        17, 12, NULL, 'Return to the World', 1753963000000, 1753963000000)
ON CONFLICT (id) DO NOTHING;
