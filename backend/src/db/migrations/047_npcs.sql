-- 047_npcs.sql
--
-- Speaker registry cross-referenced at dialogue-import time.
--
-- One row per NPC. `expressions` is a JSON array of { key, label? } — small
-- enough that a JSON blob wins over a side table on both dialects. The
-- filesystem is the source of truth for portrait EXISTENCE (public/assets/npc/
-- {id}/{expression}.png), so `hasPortrait` is not persisted here — a fetch
-- computes it by stat.
--
-- Portable across SQLite and Postgres: TEXT columns only, JSON stored as TEXT
-- to match dialogue_definitions.npc_ids / ir_json.

CREATE TABLE IF NOT EXISTS npcs (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  expressions   TEXT NOT NULL DEFAULT '[]',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
