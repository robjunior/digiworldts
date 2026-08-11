-- S9 Wave D — Tile GID columns + dungeon_key_id on doors/traps
--
-- Doors and traps ship with the new (unused, used) tile GID fields in Wave A
-- shared types (as `| null`) and hardcoded null defaults in doorFromRow /
-- trapFromRow. This migration adds the actual DB columns; the *fromRow
-- readers get updated in the same commit to read them.
--
-- dungeon_key_id on doors is the S9 counterpart of the legacy key_item_id
-- (shop item). Coexists with backward-compat: when dungeon_key_id is set,
-- Wave E logic checks the group-scoped inventory instead of the user's
-- global shop inventory; when null, legacy key_item_id flow applies.

ALTER TABLE dungeon_doors ADD COLUMN unused_tile_gid INTEGER;
ALTER TABLE dungeon_doors ADD COLUMN used_tile_gid INTEGER;
ALTER TABLE dungeon_doors ADD COLUMN dungeon_key_id TEXT;

ALTER TABLE dungeon_traps ADD COLUMN unused_tile_gid INTEGER;
ALTER TABLE dungeon_traps ADD COLUMN used_tile_gid INTEGER;
