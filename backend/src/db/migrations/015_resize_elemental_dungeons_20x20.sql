-- 015_resize_elemental_dungeons_20x20.sql
--
-- Migration 013 seeded the 3 elemental sets on a 15x3 straight corridor —
-- too cramped to feel like an actual dungeon. This resizes them to 20x20 and
-- rebuilds them with a proper 3-room layout:
--
--     Room A (spawn, 5x5)  ->  corridor  ->  Room B (potion+key, 5x5)
--                                             |
--                                             corridor  (with locked door)
--                                             |
--                                             Room C (boss+warp, 5x5)
--
-- Map (W = walkable):
--
--     0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19
--  2         W  W  W  W  W                                        <- Room A (spawn)
--  3         W  W  W  W  W
--  4         W  W  S  W  W    (S = spawn at 4,4)
--  5         W  W  W  W  W
--  6         W  W  W  W  W
--  7               W                                                <- corridor A->B
--  8               W
--  9               W
-- 10         W  W  W  W  W                W  W  W  W  W             <- Rooms B (potion+key) + C (boss+warp)
-- 11         W  P  W  W  W                W  W  W  W  W
-- 12         W  W  W  W  W  W  W  W  D  W  W  W  B  W  W            <- corridor B->C with door
-- 13         W  W  W  K  W                W  W  W  W  W
-- 14         W  W  W  W  W                W  W  W  W  W
--
-- Entities relocated:
--   spawn  (0,1)  -> (4,4)
--   potion (3,1)  -> (3,11)
--   key    (6,1)  -> (5,13)
--   door   (9,1)  -> (10,12)
--   boss   (12,1) -> (15,12)
--   warp   (14,1) -> (17,12)
--
-- Wipes the 9 seeded dungeons (cascades to tiles/encounters/items/warps/doors
-- and any user_dungeon_runs) then re-inserts with the new dimensions and
-- layout. Runs once per migrator ledger; safe on fresh installs (delete on
-- empty state is a no-op).
--
-- Portable across SQLite and Postgres: uses INSERT..SELECT with a VALUES
-- table source (supported by both since SQLite 3.14 and Postgres forever) so
-- 9 dungeons x 84 tiles = 756 tile rows are produced by one statement.

-- =============================================================================
-- 1. Wipe the 9 seed dungeons (cascade removes all child rows)
-- =============================================================================
DELETE FROM dungeons WHERE id IN (
  'dun_plant_1','dun_plant_2','dun_plant_3',
  'dun_water_1','dun_water_2','dun_water_3',
  'dun_fire_1', 'dun_fire_2', 'dun_fire_3'
);

-- =============================================================================
-- 2. Re-insert dungeons at 20x20 with spawn at (4,4)
-- =============================================================================
INSERT INTO dungeons (
  id, world_object_id, quest_id, name, description, biome, width, height,
  spawn_x, spawn_y, biome_region,
  random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level,
  random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements,
  created_at, updated_at
) VALUES
  ('dun_plant_1', NULL, NULL, 'Whispering Grove',
    'Soft ferns underfoot and a canopy of Palmon leaves. A sealed gate blocks the path deeper into the grove.',
    'forest', 20, 20, 4, 4, 'forest',
    1, 0.18, 3,  7, 'Rookie', 1, 2, '["plant"]', 1753963000000, 1753963000000),
  ('dun_plant_2', NULL, NULL, 'Rooted Hollow',
    'The trees pull tighter here. Older Palmon patrol the mossy trails guarding a slumbering warden.',
    'forest', 20, 20, 4, 4, NULL,
    1, 0.20, 8,  12, 'Rookie', 1, 2, '["plant"]', 1753963000000, 1753963000000),
  ('dun_plant_3', NULL, NULL, 'Palmon Sanctum',
    'The oldest heart of the grove. A living guardian stirs at the sanctum core.',
    'forest', 20, 20, 4, 4, NULL,
    1, 0.22, 13, 18, 'Rookie', 1, 2, '["plant"]', 1753963000000, 1753963000000),

  ('dun_water_1', NULL, NULL, 'Tidal Cove',
    'A quiet inlet where Lunamon skim the pools. A rusted grate blocks the tunnel beyond.',
    'lake', 20, 20, 4, 4, 'lake',
    1, 0.18, 3,  7, 'Rookie', 1, 2, '["water"]', 1753963000000, 1753963000000),
  ('dun_water_2', NULL, NULL, 'Sunken Ruins',
    'Half-flooded halls patrolled by wary Gomamon. Something large lumbers in the depths.',
    'lake', 20, 20, 4, 4, NULL,
    1, 0.20, 8,  12, 'Rookie', 1, 2, '["water"]', 1753963000000, 1753963000000),
  ('dun_water_3', NULL, NULL, 'Gomamon Deep',
    'A cavern chamber below sea level. The deep guardian waits in the last hall.',
    'lake', 20, 20, 4, 4, NULL,
    1, 0.22, 13, 18, 'Rookie', 1, 2, '["water"]', 1753963000000, 1753963000000),

  ('dun_fire_1',  NULL, NULL, 'Ember Foothills',
    'Volcanic slopes crawling with Agumon. A steel door blocks the path up the ridge.',
    'foundry', 20, 20, 4, 4, 'foundry',
    1, 0.18, 3,  7, 'Rookie', 1, 2, '["fire"]', 1753963000000, 1753963000000),
  ('dun_fire_2',  NULL, NULL, 'Cinder Caverns',
    'Ash-choked tunnels prowled by Guilmon. Heat radiates from the sealed chamber beyond.',
    'foundry', 20, 20, 4, 4, NULL,
    1, 0.20, 8,  12, 'Rookie', 1, 2, '["fire"]', 1753963000000, 1753963000000),
  ('dun_fire_3',  NULL, NULL, 'Blazing Core',
    'The heart of the mountain. Great wings beat somewhere in the smoke.',
    'foundry', 20, 20, 4, 4, NULL,
    1, 0.22, 13, 18, 'Rookie', 1, 2, '["fire"]', 1753963000000, 1753963000000);

-- =============================================================================
-- 3. Tiles: 84 walkable per dungeon x 9 dungeons = 756 rows.
--    Produced by cross-joining the dungeon ids against the 84-tile template.
-- =============================================================================
INSERT INTO dungeon_tiles (dungeon_id, x, y)
SELECT d.id, t.x, t.y
FROM (VALUES
  ('dun_plant_1'),('dun_plant_2'),('dun_plant_3'),
  ('dun_water_1'),('dun_water_2'),('dun_water_3'),
  ('dun_fire_1'), ('dun_fire_2'), ('dun_fire_3')
) AS d(id)
CROSS JOIN (VALUES
  -- Room A: 5x5 spawn room at (2..6, 2..6)
  (2,2),(3,2),(4,2),(5,2),(6,2),
  (2,3),(3,3),(4,3),(5,3),(6,3),
  (2,4),(3,4),(4,4),(5,4),(6,4),
  (2,5),(3,5),(4,5),(5,5),(6,5),
  (2,6),(3,6),(4,6),(5,6),(6,6),
  -- Corridor A -> B (vertical, x=4, y=7..9)
  (4,7),(4,8),(4,9),
  -- Room B: 5x5 potion+key room at (2..6, 10..14)
  (2,10),(3,10),(4,10),(5,10),(6,10),
  (2,11),(3,11),(4,11),(5,11),(6,11),
  (2,12),(3,12),(4,12),(5,12),(6,12),
  (2,13),(3,13),(4,13),(5,13),(6,13),
  (2,14),(3,14),(4,14),(5,14),(6,14),
  -- Corridor B -> C (horizontal, y=12, x=7..12) - door sits at (10,12)
  (7,12),(8,12),(9,12),(10,12),(11,12),(12,12),
  -- Room C: 5x5 boss+warp room at (13..17, 10..14)
  (13,10),(14,10),(15,10),(16,10),(17,10),
  (13,11),(14,11),(15,11),(16,11),(17,11),
  (13,12),(14,12),(15,12),(16,12),(17,12),
  (13,13),(14,13),(15,13),(16,13),(17,13),
  (13,14),(14,14),(15,14),(16,14),(17,14)
) AS t(x, y);

-- =============================================================================
-- 4. Boss encounters at (15,12) - Champion of the element, one stage above the
--    Rookies in the random pool. Level 10 / 15 / 20 across the three dungeons.
-- =============================================================================
INSERT INTO dungeon_encounters (id, dungeon_id, x, y, label, difficulty, digimon_data, created_at, updated_at) VALUES
  ('enc_plant_1_boss', 'dun_plant_1', 15, 12, 'Grove Warden',    'boss', '[{"catalogId":"skb-314","level":10,"nickname":"Grove Warden"}]',   1753963000000, 1753963000000),
  ('enc_plant_2_boss', 'dun_plant_2', 15, 12, 'Hollow Guardian', 'boss', '[{"catalogId":"skb-349","level":15,"nickname":"Hollow Guardian"}]', 1753963000000, 1753963000000),
  ('enc_plant_3_boss', 'dun_plant_3', 15, 12, 'Sanctum Elder',   'boss', '[{"catalogId":"skb-393","level":20,"nickname":"Sanctum Elder"}]',   1753963000000, 1753963000000),

  ('enc_water_1_boss', 'dun_water_1', 15, 12, 'Cove Watcher',    'boss', '[{"catalogId":"skb-3","level":10,"nickname":"Cove Watcher"}]',      1753963000000, 1753963000000),
  ('enc_water_2_boss', 'dun_water_2', 15, 12, 'Ruin Sentinel',   'boss', '[{"catalogId":"skb-344","level":15,"nickname":"Ruin Sentinel"}]',   1753963000000, 1753963000000),
  ('enc_water_3_boss', 'dun_water_3', 15, 12, 'Deep Guardian',   'boss', '[{"catalogId":"skb-344","level":20,"nickname":"Deep Guardian"}]',   1753963000000, 1753963000000),

  ('enc_fire_1_boss',  'dun_fire_1',  15, 12, 'Foothill Bruiser','boss', '[{"catalogId":"skb-326","level":10,"nickname":"Foothill Bruiser"}]',1753963000000, 1753963000000),
  ('enc_fire_2_boss',  'dun_fire_2',  15, 12, 'Cavern Alpha',    'boss', '[{"catalogId":"skb-78","level":15,"nickname":"Cavern Alpha"}]',     1753963000000, 1753963000000),
  ('enc_fire_3_boss',  'dun_fire_3',  15, 12, 'Core Phoenix',    'boss', '[{"catalogId":"skb-308","level":20,"nickname":"Core Phoenix"}]',    1753963000000, 1753963000000);

-- =============================================================================
-- 5. Pickups: potion at (3,11) + key at (5,13) per dungeon (18 total)
-- =============================================================================
INSERT INTO dungeon_items (id, dungeon_id, x, y, item_id, qty, created_at) VALUES
  ('ditm_pln_1_pot', 'dun_plant_1', 3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_pln_1_key', 'dun_plant_1', 5, 13, 'itm-key-plant',  1, 1753963000000),
  ('ditm_pln_2_pot', 'dun_plant_2', 3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_pln_2_key', 'dun_plant_2', 5, 13, 'itm-key-plant',  1, 1753963000000),
  ('ditm_pln_3_pot', 'dun_plant_3', 3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_pln_3_key', 'dun_plant_3', 5, 13, 'itm-key-plant',  1, 1753963000000),

  ('ditm_wtr_1_pot', 'dun_water_1', 3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_wtr_1_key', 'dun_water_1', 5, 13, 'itm-key-water',  1, 1753963000000),
  ('ditm_wtr_2_pot', 'dun_water_2', 3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_wtr_2_key', 'dun_water_2', 5, 13, 'itm-key-water',  1, 1753963000000),
  ('ditm_wtr_3_pot', 'dun_water_3', 3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_wtr_3_key', 'dun_water_3', 5, 13, 'itm-key-water',  1, 1753963000000),

  ('ditm_fir_1_pot', 'dun_fire_1',  3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_fir_1_key', 'dun_fire_1',  5, 13, 'itm-key-fire',   1, 1753963000000),
  ('ditm_fir_2_pot', 'dun_fire_2',  3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_fir_2_key', 'dun_fire_2',  5, 13, 'itm-key-fire',   1, 1753963000000),
  ('ditm_fir_3_pot', 'dun_fire_3',  3, 11, 'itm-heal-small', 1, 1753963000000),
  ('ditm_fir_3_key', 'dun_fire_3',  5, 13, 'itm-key-fire',   1, 1753963000000);

-- =============================================================================
-- 6. Locked doors at (10,12) per dungeon (9 total) - sits in the B->C corridor
-- =============================================================================
INSERT INTO dungeon_doors (id, dungeon_id, x, y, key_item_id, label, created_at, updated_at) VALUES
  ('dor_pln_1_gate', 'dun_plant_1', 10, 12, 'itm-key-plant', 'Sealed Vine Gate',    1753963000000, 1753963000000),
  ('dor_pln_2_gate', 'dun_plant_2', 10, 12, 'itm-key-plant', 'Overgrown Gate',      1753963000000, 1753963000000),
  ('dor_pln_3_gate', 'dun_plant_3', 10, 12, 'itm-key-plant', 'Ancient Root Gate',   1753963000000, 1753963000000),

  ('dor_wtr_1_gate', 'dun_water_1', 10, 12, 'itm-key-water', 'Rusted Grate',        1753963000000, 1753963000000),
  ('dor_wtr_2_gate', 'dun_water_2', 10, 12, 'itm-key-water', 'Sunken Portcullis',   1753963000000, 1753963000000),
  ('dor_wtr_3_gate', 'dun_water_3', 10, 12, 'itm-key-water', 'Abyssal Seal',        1753963000000, 1753963000000),

  ('dor_fir_1_gate', 'dun_fire_1',  10, 12, 'itm-key-fire',  'Steel Ridge Door',    1753963000000, 1753963000000),
  ('dor_fir_2_gate', 'dun_fire_2',  10, 12, 'itm-key-fire',  'Molten Slab Gate',    1753963000000, 1753963000000),
  ('dor_fir_3_gate', 'dun_fire_3',  10, 12, 'itm-key-fire',  'Core Vault Door',     1753963000000, 1753963000000);

-- =============================================================================
-- 7. Warps at (17,12) per dungeon (far east end of Room C).
--    1->2, 2->3, 3->world exit (target NULL)
-- =============================================================================
INSERT INTO dungeon_warps (id, dungeon_id, x, y, target_dungeon_id, label, created_at, updated_at) VALUES
  ('wrp_pln_1_to_2', 'dun_plant_1', 17, 12, 'dun_plant_2', 'Path to Rooted Hollow',  1753963000000, 1753963000000),
  ('wrp_pln_2_to_3', 'dun_plant_2', 17, 12, 'dun_plant_3', 'Path to Palmon Sanctum', 1753963000000, 1753963000000),
  ('wrp_pln_3_exit', 'dun_plant_3', 17, 12, NULL,          'Return to the World',    1753963000000, 1753963000000),

  ('wrp_wtr_1_to_2', 'dun_water_1', 17, 12, 'dun_water_2', 'Passage to Sunken Ruins',1753963000000, 1753963000000),
  ('wrp_wtr_2_to_3', 'dun_water_2', 17, 12, 'dun_water_3', 'Descent to Gomamon Deep',1753963000000, 1753963000000),
  ('wrp_wtr_3_exit', 'dun_water_3', 17, 12, NULL,          'Return to the World',    1753963000000, 1753963000000),

  ('wrp_fir_1_to_2', 'dun_fire_1',  17, 12, 'dun_fire_2',  'Path to Cinder Caverns', 1753963000000, 1753963000000),
  ('wrp_fir_2_to_3', 'dun_fire_2',  17, 12, 'dun_fire_3',  'Path to Blazing Core',   1753963000000, 1753963000000),
  ('wrp_fir_3_exit', 'dun_fire_3',  17, 12, NULL,          'Return to the World',    1753963000000, 1753963000000);
