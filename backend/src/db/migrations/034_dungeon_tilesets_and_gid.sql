-- 034_dungeon_tilesets_and_gid.sql
--
-- Wires the tileset library (migration 033) into dungeons:
--
--   1. `dungeon_tilesets` is the join between a dungeon and each tileset it
--      uses, tagged with the `firstgid` (Tiled's Global Tile ID base for
--      that tileset within this dungeon's GID space). A tileset can be used
--      by many dungeons; a dungeon can stack many tilesets.
--
--   2. `dungeon_tiles.gid` stores the actual sprite id per walkable cell.
--      Default 1 keeps every existing tile row valid (they'll all render
--      the first sprite of the first tileset a dungeon happens to acquire).
--
-- `ON DELETE RESTRICT` on tileset_id: a tileset in use by any dungeon must
-- not be deletable — the admin has to migrate first. `ON DELETE CASCADE` on
-- dungeon_id: deleting a dungeon drops its tileset refs cleanly.
--
-- Portable across SQLite and Postgres.

CREATE TABLE IF NOT EXISTS dungeon_tilesets (
  dungeon_id TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  tileset_id TEXT NOT NULL REFERENCES tilesets(id) ON DELETE RESTRICT,
  firstgid   INTEGER NOT NULL CHECK (firstgid >= 1),
  PRIMARY KEY (dungeon_id, tileset_id)
);

CREATE INDEX IF NOT EXISTS idx_dungeon_tilesets_dungeon ON dungeon_tilesets(dungeon_id);
CREATE INDEX IF NOT EXISTS idx_dungeon_tilesets_tileset ON dungeon_tilesets(tileset_id);

ALTER TABLE dungeon_tiles ADD COLUMN gid INTEGER NOT NULL DEFAULT 1 CHECK (gid >= 1);
