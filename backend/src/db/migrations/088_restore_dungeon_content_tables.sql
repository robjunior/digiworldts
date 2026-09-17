-- 102_restore_dungeon_content_tables.sql
--
-- Restores the dungeon content tables that the feature-removal commit
-- (5498847) deleted the creating migrations for, while CONTENT_TABLES and
-- the committed content bundle still ship dungeon content and the deploy
-- applies it. Fresh databases (both dialects) were left without these
-- tables, so `content:deploy --apply` died at `dungeons` with
-- "no such table" — the first deploy of a new environment would have
-- failed before reaching any content.
--
-- Fully idempotent for already-deployed DBs (which have these tables from
-- the old migrations, recorded in their schema_versions ledger):
--   * CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS → no-op
--   * ALTER TABLE ADD COLUMN IF NOT EXISTS → no-op where the column exists
--
-- Portable across SQLite and Postgres:
--   * timestamps are BIGINT (ms epochs like 1786489052790 overflow PG INTEGER)
--   * FK ordering: parents (quests/world_objects/shop_items are baseline
--     tables created before migrations run; within this file, dungeons is
--     created before everything that references it, dungeon_bridges before
--     dungeon_trigger_targets)
--   * the sqlite baseline (schema.sql) already creates dungeon_doors /
--     dungeon_warps / dungeon_traps WITHOUT the later-added columns
--     (unused_tile_gid, is_exit, ...); those get ADD COLUMN'd here so fresh
--     sqlite DBs accept the bundle rows that carry them.

-- ============================================================================
-- dungeons (referenced by nearly every other dungeon table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeons (
  id              TEXT PRIMARY KEY,
  world_object_id TEXT REFERENCES world_objects(id) ON DELETE SET NULL,
  quest_id        TEXT REFERENCES quests(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  biome           TEXT NOT NULL DEFAULT 'null',
  width           INTEGER NOT NULL CHECK (width > 0 AND width <= 200),
  height          INTEGER NOT NULL CHECK (height > 0 AND height <= 200),
  spawn_x         INTEGER NOT NULL DEFAULT 0,
  spawn_y         INTEGER NOT NULL DEFAULT 0,
  random_encounters_enabled INTEGER NOT NULL DEFAULT 0 CHECK (random_encounters_enabled IN (0, 1)),
  random_encounter_rate REAL NOT NULL DEFAULT 0.12 CHECK (random_encounter_rate >= 0 AND random_encounter_rate <= 1),
  random_min_level INTEGER NOT NULL DEFAULT 1 CHECK (random_min_level >= 1),
  random_max_level INTEGER NOT NULL DEFAULT 5 CHECK (random_max_level >= random_min_level),
  random_max_stage TEXT NOT NULL DEFAULT 'Rookie',
  random_min_party_size INTEGER NOT NULL DEFAULT 1 CHECK (random_min_party_size >= 1 AND random_min_party_size <= 3),
  random_max_party_size INTEGER NOT NULL DEFAULT 1 CHECK (random_max_party_size >= random_min_party_size AND random_max_party_size <= 3),
  random_allowed_elements TEXT,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  biome_region    TEXT,
  parent_id       TEXT REFERENCES dungeons(id) ON DELETE SET NULL,
  unlock_requires_items TEXT,
  challenge_kind  TEXT NOT NULL DEFAULT 'none'
    CHECK (challenge_kind IN ('none', 'boss_defeated', 'all_encounters_defeated', 'reach_tile', 'collect_item', 'survive_waves')),
  challenge_config TEXT,
  walkable_mask_json TEXT,
  floor_index     INTEGER,
  dungeon_group_id TEXT,
  random_pool_json TEXT NOT NULL DEFAULT '[]',
  grid_x          INTEGER,
  grid_y          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dungeons_world_object ON dungeons(world_object_id);
CREATE INDEX IF NOT EXISTS idx_dungeons_quest ON dungeons(quest_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeons_biome_region_uniq
  ON dungeons(biome_region) WHERE biome_region IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dungeons_parent ON dungeons(parent_id);
CREATE INDEX IF NOT EXISTS idx_dungeons_group_floor ON dungeons(dungeon_group_id, floor_index);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeons_group_grid_position
  ON dungeons(dungeon_group_id, grid_x, grid_y)
  WHERE dungeon_group_id IS NOT NULL AND grid_x IS NOT NULL AND grid_y IS NOT NULL;

-- ============================================================================
-- dungeon_tiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_tiles (
  dungeon_id  TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  layer_kind  TEXT NOT NULL DEFAULT 'floor'
    CHECK (layer_kind IN ('liquid', 'floor', 'grass', 'tree', 'wall', 'walls', 'doors', 'water', 'pit', 'decoration', 'hidden')),
  gid         INTEGER NOT NULL DEFAULT 1 CHECK (gid >= 1),
  PRIMARY KEY (dungeon_id, x, y, layer_kind)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_tiles_dungeon ON dungeon_tiles(dungeon_id);

-- ============================================================================
-- dungeon_encounters
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_encounters (
  id             TEXT PRIMARY KEY,
  dungeon_id     TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x              INTEGER NOT NULL,
  y              INTEGER NOT NULL,
  label          TEXT,
  difficulty     TEXT NOT NULL DEFAULT 'normal' CHECK (difficulty IN ('easy', 'normal', 'elite', 'boss')),
  digimon_data   TEXT NOT NULL,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  reward_item_id TEXT REFERENCES shop_items(id) ON DELETE SET NULL,
  loots          TEXT NOT NULL DEFAULT '[]',
  scene_id       TEXT,
  rarity_table_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_dungeon_encounters_dungeon ON dungeon_encounters(dungeon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_encounters_pos ON dungeon_encounters(dungeon_id, x, y);

-- ============================================================================
-- dungeon_doors (sqlite baseline in schema.sql carries the same full shape)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_doors (
  id             TEXT PRIMARY KEY,
  dungeon_id     TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x              INTEGER NOT NULL,
  y              INTEGER NOT NULL,
  key_item_id    TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  label          TEXT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  unused_tile_gid INTEGER,
  used_tile_gid  INTEGER,
  dungeon_key_id TEXT,
  UNIQUE (dungeon_id, x, y)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_doors_dungeon ON dungeon_doors(dungeon_id);

-- ============================================================================
-- dungeon_warps (sqlite baseline in schema.sql carries the same full shape)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_warps (
  id                TEXT PRIMARY KEY,
  dungeon_id        TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x                 INTEGER NOT NULL,
  y                 INTEGER NOT NULL,
  target_dungeon_id TEXT REFERENCES dungeons(id) ON DELETE SET NULL,
  label             TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL,
  is_exit           INTEGER NOT NULL DEFAULT 0 CHECK (is_exit IN (0, 1)),
  UNIQUE (dungeon_id, x, y)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_warps_dungeon ON dungeon_warps(dungeon_id);

-- ============================================================================
-- dungeon_traps (sqlite baseline predates unused/used_tile_gid)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_traps (
  id          TEXT PRIMARY KEY,
  dungeon_id  TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('damage', 'poison', 'burn', 'energy_drain', 'mood_loss', 'teleport', 'random_encounter')),
  severity    INTEGER NOT NULL DEFAULT 20 CHECK (severity BETWEEN 1 AND 100),
  label       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  unused_tile_gid INTEGER,
  used_tile_gid  INTEGER,
  UNIQUE (dungeon_id, x, y)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_traps_dungeon ON dungeon_traps(dungeon_id);

-- ============================================================================
-- dungeon_chests
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_chests (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  label TEXT,
  contents_json TEXT NOT NULL DEFAULT '[]',
  locked_by_key_id TEXT,
  unused_tile_gid INTEGER,
  used_tile_gid INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (dungeon_id) REFERENCES dungeons(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dungeon_chests_dungeon ON dungeon_chests(dungeon_id);

-- ============================================================================
-- dungeon_zones
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_zones (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  safe INTEGER NOT NULL DEFAULT 0,
  pool_json TEXT NOT NULL DEFAULT '[]',
  roll_overrides_json TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (dungeon_id) REFERENCES dungeons(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dungeon_zones_dungeon ON dungeon_zones(dungeon_id);

-- ============================================================================
-- dungeon_keys
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_keys (
  id TEXT PRIMARY KEY,
  dungeon_group_id TEXT NOT NULL,
  generated_for_kind TEXT NOT NULL CHECK (generated_for_kind IN ('door', 'chest')),
  generated_for_id TEXT NOT NULL,
  name TEXT NOT NULL,
  placed_dungeon_id TEXT,
  placed_x INTEGER,
  placed_y INTEGER,
  created_at BIGINT NOT NULL,
  UNIQUE (generated_for_kind, generated_for_id)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_keys_group ON dungeon_keys(dungeon_group_id);
CREATE INDEX IF NOT EXISTS idx_dungeon_keys_placement ON dungeon_keys(placed_dungeon_id, placed_x, placed_y);

-- ============================================================================
-- dungeon_kits / dungeon_kit_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_kits (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_kits_user ON dungeon_kits(user_id);

CREATE TABLE IF NOT EXISTS dungeon_kit_items (
  kit_id       TEXT NOT NULL REFERENCES dungeon_kits(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  slot_order   INTEGER NOT NULL,
  PRIMARY KEY (kit_id, item_id)
);

-- ============================================================================
-- dungeon_rarity_tables
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_rarity_tables (
  id          TEXT PRIMARY KEY,
  weights     TEXT NOT NULL,
  pool_tag    TEXT NOT NULL,
  min_rolls   INTEGER NOT NULL DEFAULT 1 CHECK (min_rolls >= 0),
  max_rolls   INTEGER NOT NULL DEFAULT 3 CHECK (max_rolls >= min_rolls)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_rarity_tables_pool_tag ON dungeon_rarity_tables(pool_tag);

-- ============================================================================
-- dungeon_tilesets
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_tilesets (
  dungeon_id TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  tileset_id TEXT NOT NULL REFERENCES tilesets(id) ON DELETE RESTRICT,
  firstgid   INTEGER NOT NULL CHECK (firstgid >= 1),
  PRIMARY KEY (dungeon_id, tileset_id)
);
CREATE INDEX IF NOT EXISTS idx_dungeon_tilesets_dungeon ON dungeon_tilesets(dungeon_id);
CREATE INDEX IF NOT EXISTS idx_dungeon_tilesets_tileset ON dungeon_tilesets(tileset_id);

-- ============================================================================
-- dungeon_items
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_items (
  id         TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  item_id    TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dungeon_items_dungeon ON dungeon_items(dungeon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_items_pos ON dungeon_items(dungeon_id, x, y);

-- ============================================================================
-- dungeon_triggers / dungeon_bridges / dungeon_trigger_targets
-- ============================================================================
CREATE TABLE IF NOT EXISTS dungeon_triggers (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  label TEXT,
  unused_tile_gid INTEGER,
  used_tile_gid INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (dungeon_id) REFERENCES dungeons(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_triggers_pos ON dungeon_triggers(dungeon_id, x, y);
CREATE INDEX IF NOT EXISTS idx_dungeon_triggers_dungeon ON dungeon_triggers(dungeon_id);

CREATE TABLE IF NOT EXISTS dungeon_bridges (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  label TEXT,
  down_tile_gid INTEGER,
  up_tile_gid INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (dungeon_id) REFERENCES dungeons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dungeon_trigger_targets (
  id TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('door', 'bridge')),
  door_id TEXT,
  bridge_id TEXT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (trigger_id) REFERENCES dungeon_triggers(id) ON DELETE CASCADE,
  FOREIGN KEY (door_id) REFERENCES dungeon_doors(id) ON DELETE CASCADE,
  FOREIGN KEY (bridge_id) REFERENCES dungeon_bridges(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_trigger_targets_one ON dungeon_trigger_targets(trigger_id);
CREATE INDEX IF NOT EXISTS idx_dungeon_trigger_targets_door ON dungeon_trigger_targets(door_id);
CREATE INDEX IF NOT EXISTS idx_dungeon_trigger_targets_bridge ON dungeon_trigger_targets(bridge_id);