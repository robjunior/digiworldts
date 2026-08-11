-- S8 — Encounter zones (Wave B)
-- Rectangular zones on the dungeon map that override the dungeon-wide random
-- pool within their bounds. See ROADMAP.md §S8 for the four-branch precedence
-- semantics (safe → zone.pool → dungeon.randomPool → legacy filter).
--
-- safe INTEGER (0/1) chosen for SQLite compat; pool_json + roll_overrides_json
-- store JSON-serialized WildPool / Partial<WildPoolRollParams>.

CREATE TABLE dungeon_zones (
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

CREATE INDEX idx_dungeon_zones_dungeon ON dungeon_zones(dungeon_id);
