CREATE TABLE IF NOT EXISTS dungeon_warps (
  id                TEXT PRIMARY KEY,
  dungeon_id        TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x                 INTEGER NOT NULL,
  y                 INTEGER NOT NULL,
  target_dungeon_id TEXT REFERENCES dungeons(id) ON DELETE SET NULL,
  label             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (dungeon_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_dungeon_warps_dungeon ON dungeon_warps(dungeon_id);
