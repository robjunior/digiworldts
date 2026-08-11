-- S9 Wave C — Per-run POI state machine
--
-- Tracks the (used/unused) state of doors, traps, and chests per player run.
-- Composite PK (user_id, dungeon_id, poi_kind, poi_id) mirrors the existing
-- run identification pattern (user_dungeon_runs uses (user_id, dungeon_id) too).
--
-- Wave C ships table + repo module + view population only. Wiring
-- moveRun to actually write these rows (in parallel with the existing
-- oneshotTriggeredIds + unlockedDoors on user_dungeon_runs) is deferred
-- to Wave D when chest interaction lands — the chest POI will be the
-- first consumer, and traps/doors can be migrated incrementally.

CREATE TABLE user_dungeon_run_poi_states (
  user_id TEXT NOT NULL,
  dungeon_id TEXT NOT NULL,
  poi_kind TEXT NOT NULL CHECK (poi_kind IN ('door', 'trap', 'chest')),
  poi_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unused', 'used')),
  changed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, dungeon_id, poi_kind, poi_id)
);

CREATE INDEX idx_run_poi_states_run ON user_dungeon_run_poi_states(user_id, dungeon_id);
