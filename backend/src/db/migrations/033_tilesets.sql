-- 033_tilesets.sql
--
-- Shared tileset library used by the Tiled dungeon importer. Each tileset is
-- a spritesheet PNG uploaded once by an admin and referenced by 0..N
-- dungeons via `dungeon_tilesets` (see migration 034). The image_filename
-- is informational; the runtime path is derived from the tileset id.
--
-- `created_at` / `updated_at` are BIGINT to hold Date.now() ms epochs — the
-- convention across every other `_at` column. Portable across SQLite and
-- Postgres (SQLite treats BIGINT as INTEGER affinity, i.e. 64-bit).

CREATE TABLE IF NOT EXISTS tilesets (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  image_filename TEXT NOT NULL,
  tile_width     INTEGER NOT NULL CHECK (tile_width > 0 AND tile_width <= 512),
  tile_height    INTEGER NOT NULL CHECK (tile_height > 0 AND tile_height <= 512),
  image_width    INTEGER NOT NULL CHECK (image_width > 0),
  image_height   INTEGER NOT NULL CHECK (image_height > 0),
  columns        INTEGER NOT NULL CHECK (columns > 0),
  tile_count     INTEGER NOT NULL CHECK (tile_count > 0),
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tilesets_name ON tilesets(name);
