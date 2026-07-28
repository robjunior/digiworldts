-- 012_seed_elemental_dungeons.sql
--
-- Ships three themed dungeon sets (Plant / Water / Fire) so a fresh install has
-- something to explore. Each set is 3 linked dungeons behind a globe POI:
--
--   Plant : forest region  -> Whispering Grove  -> Rooted Hollow  -> Palmon Sanctum
--   Water : lake region    -> Tidal Cove        -> Sunken Ruins   -> Gomamon Deep
--   Fire  : foundry region -> Ember Foothills   -> Cinder Caverns -> Blazing Core
--
-- Layout is identical across all 9 dungeons for pacing consistency: a straight
-- 15-tile corridor on row y=1 (x=0..14) with:
--   (0,1)  spawn
--   (3,1)  small med-kit pickup           (itm-heal-small)
--   (6,1)  element key pickup             (itm-key-{plant|water|fire})
--   (9,1)  locked door                    (requires the matching key)
--   (12,1) boss encounter                 (element Champion, level 10/15/20)
--   (14,1) warp                           (to next dungeon; final warps to /world)
--
-- Random encounters are element-locked (randomAllowedElements) with a Rookie
-- stage cap, scaling 3-7 / 8-12 / 13-18 across the three dungeons. Level cap
-- of the boss respects the user's requested cap of 20.
--
-- Portable across SQLite and Postgres:
--   - INSERT ... ON CONFLICT(id) DO NOTHING is supported by both.
--   - Fixed ms-epoch timestamp keeps the seed deterministic.
--   - digimon_data / random_allowed_elements are TEXT JSON blobs (matches
--     repo.ts parseDigimon + parseAllowedElements).
-- Idempotent: the shop_items keys, dungeons, tiles, encounters, items, warps,
-- and doors all use stable ids so a re-run is a no-op even if the ledger were
-- ever manually cleared.

-- =============================================================================
-- 1. Key items in the shop_items catalog
-- =============================================================================
--   These items exist purely as inventory keys. They are `enabled=0` so they
--   never appear for purchase - the only way to obtain them is by walking over
--   the key tile in the matching dungeon (moveRun upserts dungeon pickups into
--   player_inventory, so keys picked up on the map become unlock-able).
INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at) VALUES
  ('itm-key-plant', 'Plant Key',  'A vine-wrapped key. Opens the sealed gate deep in a plant-themed dungeon.',    0, 'key', 'item', '{}', 0, 1753963000000),
  ('itm-key-water', 'Water Key',  'A crystalline key beaded with water. Opens the sealed gate in a water dungeon.', 0, 'key', 'item', '{}', 0, 1753963000000),
  ('itm-key-fire',  'Fire Key',   'A smoldering key still warm to the touch. Opens the sealed gate in a fire dungeon.', 0, 'key', 'item', '{}', 0, 1753963000000)
ON CONFLICT(id) DO NOTHING;

-- =============================================================================
-- 2. Dungeon rows
-- =============================================================================
--   biome  -> visual arena / theme
--   biome_region -> unique per globe POI (only the first dungeon of each set
--                   is reachable via the world map; deeper dungeons are reached
--                   through warps)
INSERT INTO dungeons (
  id, world_object_id, quest_id, name, description, biome, width, height,
  spawn_x, spawn_y, biome_region,
  random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level,
  random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements,
  created_at, updated_at
) VALUES
  ('dun_plant_1', NULL, NULL, 'Whispering Grove',
    'Soft ferns underfoot and a canopy of Palmon leaves. A sealed gate blocks the path deeper into the grove.',
    'forest', 15, 3, 0, 1, 'forest',
    1, 0.18, 3,  7, 'Rookie', 1, 2, '["plant"]', 1753963000000, 1753963000000),
  ('dun_plant_2', NULL, NULL, 'Rooted Hollow',
    'The trees pull tighter here. Older Palmon patrol the mossy trails guarding a slumbering warden.',
    'forest', 15, 3, 0, 1, NULL,
    1, 0.20, 8,  12, 'Rookie', 1, 2, '["plant"]', 1753963000000, 1753963000000),
  ('dun_plant_3', NULL, NULL, 'Palmon Sanctum',
    'The oldest heart of the grove. A living guardian stirs at the sanctum core.',
    'forest', 15, 3, 0, 1, NULL,
    1, 0.22, 13, 18, 'Rookie', 1, 2, '["plant"]', 1753963000000, 1753963000000),

  ('dun_water_1', NULL, NULL, 'Tidal Cove',
    'A quiet inlet where Lunamon skim the pools. A rusted grate blocks the tunnel beyond.',
    'lake', 15, 3, 0, 1, 'lake',
    1, 0.18, 3,  7, 'Rookie', 1, 2, '["water"]', 1753963000000, 1753963000000),
  ('dun_water_2', NULL, NULL, 'Sunken Ruins',
    'Half-flooded halls patrolled by wary Gomamon. Something large lumbers in the depths.',
    'lake', 15, 3, 0, 1, NULL,
    1, 0.20, 8,  12, 'Rookie', 1, 2, '["water"]', 1753963000000, 1753963000000),
  ('dun_water_3', NULL, NULL, 'Gomamon Deep',
    'A cavern chamber below sea level. The deep guardian waits in the last hall.',
    'lake', 15, 3, 0, 1, NULL,
    1, 0.22, 13, 18, 'Rookie', 1, 2, '["water"]', 1753963000000, 1753963000000),

  ('dun_fire_1',  NULL, NULL, 'Ember Foothills',
    'Volcanic slopes crawling with Agumon. A steel door blocks the path up the ridge.',
    'foundry', 15, 3, 0, 1, 'foundry',
    1, 0.18, 3,  7, 'Rookie', 1, 2, '["fire"]', 1753963000000, 1753963000000),
  ('dun_fire_2',  NULL, NULL, 'Cinder Caverns',
    'Ash-choked tunnels prowled by Guilmon. Heat radiates from the sealed chamber beyond.',
    'foundry', 15, 3, 0, 1, NULL,
    1, 0.20, 8,  12, 'Rookie', 1, 2, '["fire"]', 1753963000000, 1753963000000),
  ('dun_fire_3',  NULL, NULL, 'Blazing Core',
    'The heart of the mountain. Great wings beat somewhere in the smoke.',
    'foundry', 15, 3, 0, 1, NULL,
    1, 0.22, 13, 18, 'Rookie', 1, 2, '["fire"]', 1753963000000, 1753963000000)
ON CONFLICT(id) DO NOTHING;

-- =============================================================================
-- 3. Walkable tiles: 15 per dungeon (single row y=1, x=0..14) = 135 rows
-- =============================================================================
INSERT INTO dungeon_tiles (dungeon_id, x, y) VALUES
  ('dun_plant_1', 0, 1),('dun_plant_1', 1, 1),('dun_plant_1', 2, 1),('dun_plant_1', 3, 1),('dun_plant_1', 4, 1),
  ('dun_plant_1', 5, 1),('dun_plant_1', 6, 1),('dun_plant_1', 7, 1),('dun_plant_1', 8, 1),('dun_plant_1', 9, 1),
  ('dun_plant_1',10, 1),('dun_plant_1',11, 1),('dun_plant_1',12, 1),('dun_plant_1',13, 1),('dun_plant_1',14, 1),

  ('dun_plant_2', 0, 1),('dun_plant_2', 1, 1),('dun_plant_2', 2, 1),('dun_plant_2', 3, 1),('dun_plant_2', 4, 1),
  ('dun_plant_2', 5, 1),('dun_plant_2', 6, 1),('dun_plant_2', 7, 1),('dun_plant_2', 8, 1),('dun_plant_2', 9, 1),
  ('dun_plant_2',10, 1),('dun_plant_2',11, 1),('dun_plant_2',12, 1),('dun_plant_2',13, 1),('dun_plant_2',14, 1),

  ('dun_plant_3', 0, 1),('dun_plant_3', 1, 1),('dun_plant_3', 2, 1),('dun_plant_3', 3, 1),('dun_plant_3', 4, 1),
  ('dun_plant_3', 5, 1),('dun_plant_3', 6, 1),('dun_plant_3', 7, 1),('dun_plant_3', 8, 1),('dun_plant_3', 9, 1),
  ('dun_plant_3',10, 1),('dun_plant_3',11, 1),('dun_plant_3',12, 1),('dun_plant_3',13, 1),('dun_plant_3',14, 1),

  ('dun_water_1', 0, 1),('dun_water_1', 1, 1),('dun_water_1', 2, 1),('dun_water_1', 3, 1),('dun_water_1', 4, 1),
  ('dun_water_1', 5, 1),('dun_water_1', 6, 1),('dun_water_1', 7, 1),('dun_water_1', 8, 1),('dun_water_1', 9, 1),
  ('dun_water_1',10, 1),('dun_water_1',11, 1),('dun_water_1',12, 1),('dun_water_1',13, 1),('dun_water_1',14, 1),

  ('dun_water_2', 0, 1),('dun_water_2', 1, 1),('dun_water_2', 2, 1),('dun_water_2', 3, 1),('dun_water_2', 4, 1),
  ('dun_water_2', 5, 1),('dun_water_2', 6, 1),('dun_water_2', 7, 1),('dun_water_2', 8, 1),('dun_water_2', 9, 1),
  ('dun_water_2',10, 1),('dun_water_2',11, 1),('dun_water_2',12, 1),('dun_water_2',13, 1),('dun_water_2',14, 1),

  ('dun_water_3', 0, 1),('dun_water_3', 1, 1),('dun_water_3', 2, 1),('dun_water_3', 3, 1),('dun_water_3', 4, 1),
  ('dun_water_3', 5, 1),('dun_water_3', 6, 1),('dun_water_3', 7, 1),('dun_water_3', 8, 1),('dun_water_3', 9, 1),
  ('dun_water_3',10, 1),('dun_water_3',11, 1),('dun_water_3',12, 1),('dun_water_3',13, 1),('dun_water_3',14, 1),

  ('dun_fire_1',  0, 1),('dun_fire_1',  1, 1),('dun_fire_1',  2, 1),('dun_fire_1',  3, 1),('dun_fire_1',  4, 1),
  ('dun_fire_1',  5, 1),('dun_fire_1',  6, 1),('dun_fire_1',  7, 1),('dun_fire_1',  8, 1),('dun_fire_1',  9, 1),
  ('dun_fire_1', 10, 1),('dun_fire_1', 11, 1),('dun_fire_1', 12, 1),('dun_fire_1', 13, 1),('dun_fire_1', 14, 1),

  ('dun_fire_2',  0, 1),('dun_fire_2',  1, 1),('dun_fire_2',  2, 1),('dun_fire_2',  3, 1),('dun_fire_2',  4, 1),
  ('dun_fire_2',  5, 1),('dun_fire_2',  6, 1),('dun_fire_2',  7, 1),('dun_fire_2',  8, 1),('dun_fire_2',  9, 1),
  ('dun_fire_2', 10, 1),('dun_fire_2', 11, 1),('dun_fire_2', 12, 1),('dun_fire_2', 13, 1),('dun_fire_2', 14, 1),

  ('dun_fire_3',  0, 1),('dun_fire_3',  1, 1),('dun_fire_3',  2, 1),('dun_fire_3',  3, 1),('dun_fire_3',  4, 1),
  ('dun_fire_3',  5, 1),('dun_fire_3',  6, 1),('dun_fire_3',  7, 1),('dun_fire_3',  8, 1),('dun_fire_3',  9, 1),
  ('dun_fire_3', 10, 1),('dun_fire_3', 11, 1),('dun_fire_3', 12, 1),('dun_fire_3', 13, 1),('dun_fire_3', 14, 1)
ON CONFLICT(dungeon_id, x, y) DO NOTHING;

-- =============================================================================
-- 4. Boss encounters at (12,1) - Champion of the element, one stage above the
--    Rookies in the random pool. Level 10 / 15 / 20 across the three dungeons.
-- =============================================================================
--   digimon_data JSON matches EncounterDigimonSchema:
--   [{ catalogId, level, nickname }]
INSERT INTO dungeon_encounters (id, dungeon_id, x, y, label, difficulty, digimon_data, created_at, updated_at) VALUES
  ('enc_plant_1_boss', 'dun_plant_1', 12, 1, 'Grove Warden',    'boss', '[{"catalogId":"skb-314","level":10,"nickname":"Grove Warden"}]',   1753963000000, 1753963000000),
  ('enc_plant_2_boss', 'dun_plant_2', 12, 1, 'Hollow Guardian', 'boss', '[{"catalogId":"skb-349","level":15,"nickname":"Hollow Guardian"}]', 1753963000000, 1753963000000),
  ('enc_plant_3_boss', 'dun_plant_3', 12, 1, 'Sanctum Elder',   'boss', '[{"catalogId":"skb-393","level":20,"nickname":"Sanctum Elder"}]',   1753963000000, 1753963000000),

  ('enc_water_1_boss', 'dun_water_1', 12, 1, 'Cove Watcher',    'boss', '[{"catalogId":"skb-3","level":10,"nickname":"Cove Watcher"}]',      1753963000000, 1753963000000),
  ('enc_water_2_boss', 'dun_water_2', 12, 1, 'Ruin Sentinel',   'boss', '[{"catalogId":"skb-344","level":15,"nickname":"Ruin Sentinel"}]',   1753963000000, 1753963000000),
  ('enc_water_3_boss', 'dun_water_3', 12, 1, 'Deep Guardian',   'boss', '[{"catalogId":"skb-344","level":20,"nickname":"Deep Guardian"}]',   1753963000000, 1753963000000),

  ('enc_fire_1_boss',  'dun_fire_1',  12, 1, 'Foothill Bruiser','boss', '[{"catalogId":"skb-326","level":10,"nickname":"Foothill Bruiser"}]',1753963000000, 1753963000000),
  ('enc_fire_2_boss',  'dun_fire_2',  12, 1, 'Cavern Alpha',    'boss', '[{"catalogId":"skb-78","level":15,"nickname":"Cavern Alpha"}]',     1753963000000, 1753963000000),
  ('enc_fire_3_boss',  'dun_fire_3',  12, 1, 'Core Phoenix',    'boss', '[{"catalogId":"skb-308","level":20,"nickname":"Core Phoenix"}]',    1753963000000, 1753963000000)
ON CONFLICT(id) DO NOTHING;

-- =============================================================================
-- 5. Pickups: potion at (3,1) + key at (6,1) per dungeon (18 total)
-- =============================================================================
--   Potions reuse the existing itm-heal-small shop item (30% HP heal at battle
--   start). Keys use the itm-key-{element} rows seeded above.
INSERT INTO dungeon_items (id, dungeon_id, x, y, item_id, qty, created_at) VALUES
  ('ditm_pln_1_pot', 'dun_plant_1', 3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_pln_1_key', 'dun_plant_1', 6, 1, 'itm-key-plant',  1, 1753963000000),
  ('ditm_pln_2_pot', 'dun_plant_2', 3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_pln_2_key', 'dun_plant_2', 6, 1, 'itm-key-plant',  1, 1753963000000),
  ('ditm_pln_3_pot', 'dun_plant_3', 3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_pln_3_key', 'dun_plant_3', 6, 1, 'itm-key-plant',  1, 1753963000000),

  ('ditm_wtr_1_pot', 'dun_water_1', 3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_wtr_1_key', 'dun_water_1', 6, 1, 'itm-key-water',  1, 1753963000000),
  ('ditm_wtr_2_pot', 'dun_water_2', 3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_wtr_2_key', 'dun_water_2', 6, 1, 'itm-key-water',  1, 1753963000000),
  ('ditm_wtr_3_pot', 'dun_water_3', 3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_wtr_3_key', 'dun_water_3', 6, 1, 'itm-key-water',  1, 1753963000000),

  ('ditm_fir_1_pot', 'dun_fire_1',  3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_fir_1_key', 'dun_fire_1',  6, 1, 'itm-key-fire',   1, 1753963000000),
  ('ditm_fir_2_pot', 'dun_fire_2',  3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_fir_2_key', 'dun_fire_2',  6, 1, 'itm-key-fire',   1, 1753963000000),
  ('ditm_fir_3_pot', 'dun_fire_3',  3, 1, 'itm-heal-small', 1, 1753963000000),
  ('ditm_fir_3_key', 'dun_fire_3',  6, 1, 'itm-key-fire',   1, 1753963000000)
ON CONFLICT(id) DO NOTHING;

-- =============================================================================
-- 6. Locked doors at (9,1) per dungeon (9 total)
-- =============================================================================
--   key_item_id must reference a shop_items row (FK); each door of a set uses
--   the same element key so keys are reusable across the set once earned.
INSERT INTO dungeon_doors (id, dungeon_id, x, y, key_item_id, label, created_at, updated_at) VALUES
  ('dor_pln_1_gate', 'dun_plant_1', 9, 1, 'itm-key-plant', 'Sealed Vine Gate',    1753963000000, 1753963000000),
  ('dor_pln_2_gate', 'dun_plant_2', 9, 1, 'itm-key-plant', 'Overgrown Gate',      1753963000000, 1753963000000),
  ('dor_pln_3_gate', 'dun_plant_3', 9, 1, 'itm-key-plant', 'Ancient Root Gate',   1753963000000, 1753963000000),

  ('dor_wtr_1_gate', 'dun_water_1', 9, 1, 'itm-key-water', 'Rusted Grate',        1753963000000, 1753963000000),
  ('dor_wtr_2_gate', 'dun_water_2', 9, 1, 'itm-key-water', 'Sunken Portcullis',   1753963000000, 1753963000000),
  ('dor_wtr_3_gate', 'dun_water_3', 9, 1, 'itm-key-water', 'Abyssal Seal',        1753963000000, 1753963000000),

  ('dor_fir_1_gate', 'dun_fire_1',  9, 1, 'itm-key-fire',  'Steel Ridge Door',    1753963000000, 1753963000000),
  ('dor_fir_2_gate', 'dun_fire_2',  9, 1, 'itm-key-fire',  'Molten Slab Gate',    1753963000000, 1753963000000),
  ('dor_fir_3_gate', 'dun_fire_3',  9, 1, 'itm-key-fire',  'Core Vault Door',     1753963000000, 1753963000000)
ON CONFLICT(id) DO NOTHING;

-- =============================================================================
-- 7. Warps at (14,1) per dungeon: 1->2, 2->3, 3->world exit (target NULL)
-- =============================================================================
INSERT INTO dungeon_warps (id, dungeon_id, x, y, target_dungeon_id, label, created_at, updated_at) VALUES
  ('wrp_pln_1_to_2', 'dun_plant_1', 14, 1, 'dun_plant_2', 'Path to Rooted Hollow',  1753963000000, 1753963000000),
  ('wrp_pln_2_to_3', 'dun_plant_2', 14, 1, 'dun_plant_3', 'Path to Palmon Sanctum', 1753963000000, 1753963000000),
  ('wrp_pln_3_exit', 'dun_plant_3', 14, 1, NULL,          'Return to the World',    1753963000000, 1753963000000),

  ('wrp_wtr_1_to_2', 'dun_water_1', 14, 1, 'dun_water_2', 'Passage to Sunken Ruins',1753963000000, 1753963000000),
  ('wrp_wtr_2_to_3', 'dun_water_2', 14, 1, 'dun_water_3', 'Descent to Gomamon Deep',1753963000000, 1753963000000),
  ('wrp_wtr_3_exit', 'dun_water_3', 14, 1, NULL,          'Return to the World',    1753963000000, 1753963000000),

  ('wrp_fir_1_to_2', 'dun_fire_1',  14, 1, 'dun_fire_2',  'Path to Cinder Caverns', 1753963000000, 1753963000000),
  ('wrp_fir_2_to_3', 'dun_fire_2',  14, 1, 'dun_fire_3',  'Path to Blazing Core',   1753963000000, 1753963000000),
  ('wrp_fir_3_exit', 'dun_fire_3',  14, 1, NULL,          'Return to the World',    1753963000000, 1753963000000)
ON CONFLICT(id) DO NOTHING;
