-- S10 — Lever trigger POI + targets
--
-- dungeon_triggers: a lever/button placed on a walkable tile. When the player
-- steps onto it, it fires once per run (state in
-- user_dungeon_trigger_states, scoped to the dungeon group) and activates its
-- single target.
--
-- dungeon_trigger_targets: exactly one row per trigger (UNIQUE on trigger_id).
--   kind='door'   -> door_id opens without a key. The door may live on any
--                    floor of the same dungeon group (cross-map).
--   kind='bridge' -> bridge_id lowers (down = walkable). Same cross-map rule.

CREATE TABLE dungeon_triggers (
  id TEXT PRIMARY KEY,
  dungeon_id TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  label TEXT,
  unused_tile_gid INTEGER,
  used_tile_gid INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (dungeon_id) REFERENCES dungeons(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_dungeon_triggers_pos ON dungeon_triggers(dungeon_id, x, y);
CREATE INDEX idx_dungeon_triggers_dungeon ON dungeon_triggers(dungeon_id);

CREATE TABLE dungeon_trigger_targets (
  id TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('door', 'bridge')),
  door_id TEXT,
  bridge_id TEXT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (trigger_id) REFERENCES dungeon_triggers(id) ON DELETE CASCADE,
  FOREIGN KEY (door_id) REFERENCES dungeon_doors(id) ON DELETE CASCADE,
  FOREIGN KEY (bridge_id) REFERENCES dungeon_bridges(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_dungeon_trigger_targets_one ON dungeon_trigger_targets(trigger_id);
CREATE INDEX idx_dungeon_trigger_targets_door ON dungeon_trigger_targets(door_id);
CREATE INDEX idx_dungeon_trigger_targets_bridge ON dungeon_trigger_targets(bridge_id);
