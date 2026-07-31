-- 035_dialogues.sql
--
-- Twine-authored dialogue. Writers author .twee in Twine; the importer parses
-- it into the IR declared in shared/src/dialogue.ts and stores that parsed
-- form here so the runtime never re-parses Twee at play time.
--
-- One row per dialogue_id: re-importing overwrites. Version history lives in
-- git alongside the .twee sources under backend/data/dialogues/, so the DB
-- does not duplicate it.
--
-- source_twee keeps the original file verbatim so a dialogue can be exported
-- back out and reopened in Twine without the parse being lossy.
--
-- Portable across SQLite and Postgres: TEXT columns only, JSON stored as TEXT
-- to match the existing convention (see quests.data / player_roster.stage_pools).
CREATE TABLE IF NOT EXISTS dialogue_definitions (
  dialogue_id   TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  source_path   TEXT,
  source_hash   TEXT NOT NULL,
  source_twee   TEXT NOT NULL,
  start_node_id TEXT NOT NULL,
  npc_ids       TEXT NOT NULL DEFAULT '[]',
  ir_json       TEXT NOT NULL,
  node_count    INTEGER NOT NULL DEFAULT 0,
  imported_at   BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dialogue_definitions_source_path ON dialogue_definitions(source_path);
