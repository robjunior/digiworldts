-- The old world/dungeon content is intentionally retired by the PvE reset.
DELETE FROM world_objects;
DELETE FROM quests;

CREATE TABLE IF NOT EXISTS pve_places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  explore_pool TEXT NOT NULL DEFAULT '[]',
  expedition_pool TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pve_places_enabled ON pve_places(enabled, name);

CREATE TABLE IF NOT EXISTS pve_party_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  explore_party TEXT NOT NULL DEFAULT '[]',
  expedition_party TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
