-- S10 — Bridge POI
--
-- A bridge is placed on a (usually non-walkable) gap tile. Its run state is
-- derived from the lever triggers that target it: while no targeting lever
-- has fired the bridge is UP (blocked, renders up_tile_gid); once a targeting
-- lever fires the bridge is DOWN (walkable, renders down_tile_gid).
-- Cross-map works because the lever state is group-scoped and a bridge may be
-- targeted by a lever on any floor of the same dungeon group.

CREATE TABLE dungeon_bridges (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  label TEXT,
  down_tile_gid INTEGER,
  up_tile_gid INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (dungeon_id) REFERENCES dungeons(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_dungeon_bridges_pos ON dungeon_bridges(dungeon_id, x, y);
CREATE INDEX idx_dungeon_bridges_dungeon ON dungeon_bridges(dungeon_id);
