-- 088_dungeon_tiles_layer_kinds_and_pk.sql
--
-- Adds new Tiled layer kinds (grass, tree, wall) and changes the primary key
-- of dungeon_tiles from (dungeon_id, x, y) to (dungeon_id, x, y, layer_kind).
-- This lets a single cell hold multiple tiles from different layers (for
-- example floor + tree, or grass as a walkable foreground layer rendered
-- above entities).
--
-- Portable: SQLite requires table recreation to change the PK; Postgres could
-- use ALTER, but the recreate approach works on both dialects for this small
-- table. Do NOT wrap in BEGIN/COMMIT — the migrator runs each file in a tx.

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
SELECT dungeon_id, x, y, COALESCE(layer_kind, 'floor'), gid
FROM dungeon_tiles;

DROP TABLE dungeon_tiles;
ALTER TABLE dungeon_tiles_new RENAME TO dungeon_tiles;

CREATE INDEX IF NOT EXISTS idx_dungeon_tiles_dungeon ON dungeon_tiles(dungeon_id);
