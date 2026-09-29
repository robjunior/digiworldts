DELETE FROM world_objects;
DELETE FROM quests;

CREATE TABLE IF NOT EXISTS pve_places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  explore_pool TEXT NOT NULL DEFAULT '[]',
  expedition_pool TEXT NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pve_places_enabled ON pve_places(enabled, name);

CREATE TABLE IF NOT EXISTS pve_party_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  explore_party TEXT NOT NULL DEFAULT '[]',
  expedition_party TEXT NOT NULL DEFAULT '[]',
  updated_at BIGINT NOT NULL
);
