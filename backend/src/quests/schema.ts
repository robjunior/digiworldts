export const QUESTS_DDL = `
CREATE TABLE IF NOT EXISTS quests (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  required_level INTEGER NOT NULL DEFAULT 1,
  data           TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
`;

export const WORLD_OBJECTS_DDL = `
CREATE TABLE IF NOT EXISTS world_objects (
  id          TEXT PRIMARY KEY,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  scale       REAL NOT NULL DEFAULT 1.0,
  tint        TEXT,
  quest_id    TEXT REFERENCES quests(id) ON DELETE SET NULL,
  passable    INTEGER NOT NULL DEFAULT 0,
  label       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_objects_pos ON world_objects (x, y);
`;

export const USER_QUEST_PROGRESS_DDL = `
CREATE TABLE IF NOT EXISTS user_quest_progress (
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id                 TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  current_step_index       INTEGER NOT NULL,
  current_dialogue_node_id TEXT,
  choices_made             TEXT NOT NULL DEFAULT '{}',
  started_at               INTEGER NOT NULL,
  completed_at             INTEGER,
  PRIMARY KEY (user_id, quest_id)
);
`;

export const QUEST_SCHEMA_DDL = `${QUESTS_DDL}\n${WORLD_OBJECTS_DDL}\n${USER_QUEST_PROGRESS_DDL}`;
