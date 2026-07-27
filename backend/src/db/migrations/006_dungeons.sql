-- Dungeons: admin-authored, editable maps reached by clicking a POI on the world globe.
-- Progression is tracked via the optional linked quest (dungeons.quest_id) firing
-- user_quest_progress on clear. Per-player run state (current tile + defeated
-- encounters + collected items) lives in user_dungeon_runs alongside the shared
-- editable map.
--
-- Layer model:
--   - dungeon_tiles     = walkable path (sparse: only walkable rows exist)
--   - dungeon_encounters = scripted battles pinned to a tile
--   - dungeon_items     = pickups pinned to a tile
--
-- Encounter shape (dungeon_encounters.digimon_data JSON):
--   [{ catalogId, level, statOverride?: {hp?,en?,atk?,def?,int?,spd?},
--      skillsOverride?: [{name,element,cost,power,description?}, ...] up to 4 }]
--
-- Portability: TEXT for JSON blobs (matches quests.data convention).
-- INTEGER for ms-epoch timestamps (matches quests / world_objects convention).
-- Both SQLite and Postgres apply this file (plain `.sql`, dialect-agnostic).

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
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dungeons_world_object ON dungeons(world_object_id);
CREATE INDEX IF NOT EXISTS idx_dungeons_quest ON dungeons(quest_id);

CREATE TABLE IF NOT EXISTS dungeon_tiles (
  dungeon_id  TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  PRIMARY KEY (dungeon_id, x, y)
);

CREATE TABLE IF NOT EXISTS dungeon_encounters (
  id           TEXT PRIMARY KEY,
  dungeon_id   TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x            INTEGER NOT NULL,
  y            INTEGER NOT NULL,
  label        TEXT,
  difficulty   TEXT NOT NULL DEFAULT 'normal' CHECK (difficulty IN ('easy','normal','elite','boss')),
  digimon_data TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dungeon_encounters_dungeon ON dungeon_encounters(dungeon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_encounters_pos ON dungeon_encounters(dungeon_id, x, y);

CREATE TABLE IF NOT EXISTS dungeon_items (
  id         TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  item_id    TEXT NOT NULL,
  qty        INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dungeon_items_dungeon ON dungeon_items(dungeon_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_items_pos ON dungeon_items(dungeon_id, x, y);

CREATE TABLE IF NOT EXISTS user_dungeon_runs (
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dungeon_id          TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  current_x           INTEGER NOT NULL,
  current_y           INTEGER NOT NULL,
  defeated_encounters TEXT NOT NULL DEFAULT '[]',
  collected_items     TEXT NOT NULL DEFAULT '[]',
  started_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  PRIMARY KEY (user_id, dungeon_id)
);
CREATE INDEX IF NOT EXISTS idx_user_dungeon_runs_user ON user_dungeon_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_dungeon_runs_dungeon ON user_dungeon_runs(dungeon_id);

ALTER TABLE world_objects ADD COLUMN dungeon_id TEXT REFERENCES dungeons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_world_objects_dungeon ON world_objects(dungeon_id);
