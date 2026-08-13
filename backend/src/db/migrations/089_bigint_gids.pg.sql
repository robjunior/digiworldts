-- 089_bigint_gids.pg.sql
--
-- Widens every column that stores a raw Tiled Global Tile ID to BIGINT.
-- Tiled encodes flip/rotation flags in the high bits of a GID
-- (horizontal 0x80000000, vertical 0x40000000, diagonal 0x20000000),
-- so flagged tiles easily exceed the 2^31-1 limit of Postgres INTEGER.
-- SQLite INTEGER is already 64-bit, so this migration is Postgres-only.

ALTER TABLE dungeon_tiles ALTER COLUMN gid TYPE BIGINT;
ALTER TABLE dungeon_tilesets ALTER COLUMN firstgid TYPE BIGINT;
ALTER TABLE dungeon_chests ALTER COLUMN unused_tile_gid TYPE BIGINT;
ALTER TABLE dungeon_chests ALTER COLUMN used_tile_gid TYPE BIGINT;
ALTER TABLE dungeon_doors ALTER COLUMN unused_tile_gid TYPE BIGINT;
ALTER TABLE dungeon_doors ALTER COLUMN used_tile_gid TYPE BIGINT;
ALTER TABLE dungeon_traps ALTER COLUMN unused_tile_gid TYPE BIGINT;
ALTER TABLE dungeon_traps ALTER COLUMN used_tile_gid TYPE BIGINT;
