-- migrator:self-managed-transaction
PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
BEGIN;

CREATE TABLE player_roster_new (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id    TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp            INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  hp_bonus      INTEGER NOT NULL DEFAULT 0,
  en_bonus      INTEGER NOT NULL DEFAULT 0,
  atk_bonus     INTEGER NOT NULL DEFAULT 0,
  def_bonus     INTEGER NOT NULL DEFAULT 0,
  int_bonus     INTEGER NOT NULL DEFAULT 0,
  spd_bonus     INTEGER NOT NULL DEFAULT 0,
  mood          INTEGER NOT NULL DEFAULT 50 CHECK (mood BETWEEN 0 AND 100),
  status        TEXT NOT NULL DEFAULT 'resting'
                CHECK (status IN ('resting', 'training', 'party', 'adventure', 'nursery')),
  slot_index    INTEGER,
  revive_at     INTEGER,
  current_hp    INTEGER,
  current_en    INTEGER,
  pets_today    INTEGER NOT NULL DEFAULT 0,
  pets_day      TEXT,
  listed_at     INTEGER,
  evolution_history TEXT,
  equipped_skill_ids TEXT,
  stage_pools   TEXT,
  nursery_stage TEXT,
  nursery_evolve_at INTEGER,
  nursery_chain TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (user_id, slot_index) ON CONFLICT ABORT
);

INSERT INTO player_roster_new (
  id, user_id, catalog_id, nickname, level, xp, hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus,
  mood, status, slot_index, revive_at, current_hp, current_en, pets_today, pets_day, listed_at, evolution_history,
  equipped_skill_ids, stage_pools, nursery_stage, nursery_evolve_at, nursery_chain, created_at, updated_at
)
SELECT
  id, user_id, catalog_id, nickname, level, xp, hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus,
  mood, status, slot_index, revive_at, current_hp, current_en, pets_today, pets_day, listed_at, evolution_history,
  equipped_skill_ids, stage_pools, NULL, NULL, NULL, created_at, updated_at
FROM player_roster;

DROP TABLE player_roster;
ALTER TABLE player_roster_new RENAME TO player_roster;

CREATE INDEX IF NOT EXISTS idx_roster_user ON player_roster(user_id);
CREATE INDEX IF NOT EXISTS idx_roster_status ON player_roster(user_id, status);

COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA legacy_alter_table=OFF;
