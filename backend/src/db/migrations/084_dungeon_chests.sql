-- S9 Wave D — Chest POI table
--
-- Chests are static POIs that deliver curated ChestReward[] on interaction.
-- lockedByKeyId is a placeholder in Wave D (locked chests are un-openable
-- until Wave E adds the DungeonKey system + group-scoped inventory).
--
-- unused_tile_gid + used_tile_gid store the Tiled GIDs the frontend renders
-- for the (closed) vs (opened) visual state; state itself lives in
-- user_dungeon_run_poi_states with poi_kind='chest'.

CREATE TABLE dungeon_chests (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  label TEXT,
  contents_json TEXT NOT NULL DEFAULT '[]',
  locked_by_key_id TEXT,
  unused_tile_gid INTEGER,
  used_tile_gid INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (dungeon_id) REFERENCES dungeons(id) ON DELETE CASCADE
);

CREATE INDEX idx_dungeon_chests_dungeon ON dungeon_chests(dungeon_id);
