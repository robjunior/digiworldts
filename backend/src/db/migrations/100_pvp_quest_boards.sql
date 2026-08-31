CREATE TABLE IF NOT EXISTS pvp_quest_boards (
  period        TEXT NOT NULL,                       -- DAILY | WEEKLY | MONTHLY
  window_id     TEXT NOT NULL,                       -- YYYY-MM-DD | YYYY-Www | YYYY-MM
  instance_id   TEXT NOT NULL,                       -- stable id for this generated quest
  category      TEXT NOT NULL,
  params        TEXT NOT NULL,                       -- JSON qualifier params
  target        INTEGER NOT NULL,
  reward        TEXT NOT NULL,                       -- JSON reward declaration
  created_at    BIGINT NOT NULL,
  PRIMARY KEY (period, window_id, instance_id)
);
CREATE INDEX IF NOT EXISTS idx_pvp_quest_boards_window ON pvp_quest_boards (period, window_id);

CREATE TABLE IF NOT EXISTS pvp_quest_assignments (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,
  window_id     TEXT NOT NULL,
  instance_id   TEXT NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT '{}',          -- JSON free-form accumulator
  completed_at  BIGINT,                              -- NULL until target met
  claimed_at    BIGINT,                              -- NULL until reward granted
  created_at    BIGINT NOT NULL,
  PRIMARY KEY (user_id, period, window_id, instance_id)
);
CREATE INDEX IF NOT EXISTS idx_pvp_quest_assignments_user_window
  ON pvp_quest_assignments (user_id, period, window_id);
CREATE INDEX IF NOT EXISTS idx_pvp_quest_assignments_claimable
  ON pvp_quest_assignments (user_id, claimed_at) WHERE claimed_at IS NULL AND completed_at IS NOT NULL;

-- Idempotency ledger: a battle-end event is processed at most once per (battle, user).
-- Prevents replayed/duplicate battle-end events from inflating quest progress.
CREATE TABLE IF NOT EXISTS pvp_quest_battle_log (
  battle_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  processed_at  BIGINT NOT NULL,
  PRIMARY KEY (battle_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pvp_quest_battle_log_user ON pvp_quest_battle_log (user_id);
