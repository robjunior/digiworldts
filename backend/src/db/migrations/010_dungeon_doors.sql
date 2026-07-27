CREATE TABLE IF NOT EXISTS dungeon_doors (
  id            TEXT PRIMARY KEY,
  dungeon_id    TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x             INTEGER NOT NULL,
  y             INTEGER NOT NULL,
  key_item_id   TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (dungeon_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_dungeon_doors_dungeon ON dungeon_doors(dungeon_id);
