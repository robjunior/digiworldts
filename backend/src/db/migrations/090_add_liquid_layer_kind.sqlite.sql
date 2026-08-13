-- 090_add_liquid_layer_kind.sqlite.sql
--
-- Adds the 'liquid' layer kind to dungeon_tiles.layer_kind CHECK constraint.
-- SQLite cannot ALTER a CHECK constraint, so we recreate the table.
-- Do NOT wrap in BEGIN/COMMIT — the migrator runs each file in a tx.

CREATE TABLE dungeon_tiles_new (
  dungeon_id  TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  layer_kind  TEXT NOT NULL DEFAULT 'floor'
    CHECK (layer_kind IN ('liquid', 'floor', 'grass', 'tree', 'wall', 'walls', 'doors', 'water', 'pit', 'decoration', 'hidden')),
  gid         INTEGER NOT NULL DEFAULT 1 CHECK (gid >= 1),
  PRIMARY KEY (dungeon_id, x, y, layer_kind)
);

INSERT INTO dungeon_tiles_new (dungeon_id, x, y, layer_kind, gid)
SELECT dungeon_id, x, y, layer_kind, gid
FROM dungeon_tiles;

DROP TABLE dungeon_tiles;
ALTER TABLE dungeon_tiles_new RENAME TO dungeon_tiles;

CREATE INDEX IF NOT EXISTS idx_dungeon_tiles_dungeon ON dungeon_tiles(dungeon_id);
