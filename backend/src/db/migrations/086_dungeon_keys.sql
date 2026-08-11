-- S9 Wave E — Dungeon-scoped keys
--
-- Auto-provisioned when a locked door or chest is created in a dungeon that
-- has a dungeon_group_id. Keys are group-scoped (not dungeon-scoped) so a
-- key found on floor 1 can unlock a POI on floor 2 of the same group.
--
-- generated_for_kind + generated_for_id: which POI this key was made for.
-- UNIQUE constraint prevents duplicate keys for the same POI.
-- placed_dungeon_id/x/y: where the admin placed the key on the map (nullable
-- until placed). Player pickup clears the placement.
-- name: auto-generated per group ("Chave A", "Chave B", ...).

CREATE TABLE dungeon_keys (
  id TEXT PRIMARY KEY,
  dungeon_group_id TEXT NOT NULL,
  generated_for_kind TEXT NOT NULL CHECK (generated_for_kind IN ('door', 'chest')),
  generated_for_id TEXT NOT NULL,
  name TEXT NOT NULL,
  placed_dungeon_id TEXT,
  placed_x INTEGER,
  placed_y INTEGER,
  created_at BIGINT NOT NULL,
  UNIQUE (generated_for_kind, generated_for_id)
);

CREATE INDEX idx_dungeon_keys_group ON dungeon_keys(dungeon_group_id);
CREATE INDEX idx_dungeon_keys_placement ON dungeon_keys(placed_dungeon_id, placed_x, placed_y);
