-- S9 Wave E — Group-scoped run inventory
--
-- Ephemeral per-run inventory scoped to dungeon_group_id (NOT dungeon_id) so
-- keys and event items follow the player across floors of the same group.
-- Purged when the group's active run transitions from 'active' to any
-- terminal RUN_STATE (extracted / wiped / extracted_by_teleport /
-- cleared_challenge).
--
-- Distinct from player_inventory (the global shop inventory) — never joins.

CREATE TABLE user_dungeon_run_group_inventory (
  user_id TEXT NOT NULL,
  dungeon_group_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('dungeon-key', 'dungeon-event-item')),
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  acquired_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, dungeon_group_id, item_kind, item_id)
);

CREATE INDEX idx_group_inv_user_group ON user_dungeon_run_group_inventory(user_id, dungeon_group_id);
