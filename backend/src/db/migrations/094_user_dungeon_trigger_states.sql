-- S10 — Lever trigger fired state, group-scoped
--
-- Single source of truth for fired lever triggers. Scoped by the dungeon
-- group (or the dungeon id itself when the dungeon has no group), so a lever
-- pulled on floor A unlocks its target door/bridge on floor B — the state
-- follows the whole run across maps. Cleared on reset/extract/wipe.

CREATE TABLE user_dungeon_trigger_states (
  user_id TEXT NOT NULL,
  dungeon_group_id TEXT NOT NULL,
  trigger_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('unused', 'used')),
  changed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, dungeon_group_id, trigger_id)
);
CREATE INDEX idx_user_dungeon_trigger_states_scope ON user_dungeon_trigger_states(user_id, dungeon_group_id);
