-- S10 — Global trigger state + enabled flags
--
-- Trigger targets are now referenced by id from ANY map (global pool), so the
-- fired state is keyed globally per user by trigger id — no dungeon-group
-- scope. S10 tables are dev-only (no released data), so the state table is
-- dropped and recreated without the scope column.
--
-- `enabled` on bridges and triggers: off = treated as absent (bridge: gap
-- stays blocked and nothing renders; trigger: not rendered and cannot fire).

DROP TABLE user_dungeon_trigger_states;

CREATE TABLE user_dungeon_trigger_states (
  user_id TEXT NOT NULL,
  trigger_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unused', 'used')),
  changed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, trigger_id)
);
CREATE INDEX idx_user_dungeon_trigger_states_user ON user_dungeon_trigger_states(user_id);

ALTER TABLE dungeon_bridges ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE dungeon_triggers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
