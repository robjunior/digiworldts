-- 023_dungeon_traps.sql
--
-- Adds tile-based traps to dungeons. Traps trigger when a player steps onto
-- their (x,y); the server rolls a dodge check using the party's average SPD
-- (`avoidChance = min(0.75, avgSpd / 500)`); on a landed trap the effect is
-- applied per the `kind` column and the trap id is recorded in the run's
-- `oneshot_triggered_ids` so it never re-fires during that run.
--
-- Portable across SQLite and Postgres.

CREATE TABLE IF NOT EXISTS dungeon_traps (
  id          TEXT PRIMARY KEY,
  dungeon_id  TEXT NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('damage','poison','burn','energy_drain','mood_loss','teleport','random_encounter')),
  severity    INTEGER NOT NULL DEFAULT 20 CHECK (severity BETWEEN 1 AND 100),
  label       TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (dungeon_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_dungeon_traps_dungeon ON dungeon_traps(dungeon_id);

-- Per-run one-shot tracker (JSON array of trap ids that already fired this run).
-- Nullable + default '[]' at read-time in the repo, so old rows keep working.
ALTER TABLE user_dungeon_runs ADD COLUMN oneshot_triggered_ids TEXT NOT NULL DEFAULT '[]';
