-- S10 — Lever trigger POI + targets
--
-- dungeon_triggers: a lever/button placed on a walkable tile. When the player
-- steps onto it, it fires once per run (state in
-- user_dungeon_runs.triggered_triggers) and activates its single target.
--
-- dungeon_trigger_targets: exactly one row per trigger (UNIQUE on trigger_id).
--   kind='door'   -> door_id opens without a key (added to unlocked_doors).
--   kind='bridge' -> cell (target_x, target_y) becomes walkable and renders
--                    used_tile_gid while the trigger is fired.

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
  target_x INTEGER,
  target_y INTEGER,
  used_tile_gid INTEGER,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (trigger_id) REFERENCES dungeon_triggers(id) ON DELETE CASCADE,
  FOREIGN KEY (door_id) REFERENCES dungeon_doors(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX idx_dungeon_trigger_targets_one ON dungeon_trigger_targets(trigger_id);
CREATE INDEX idx_dungeon_trigger_targets_bridge ON dungeon_trigger_targets(kind, target_x, target_y);
