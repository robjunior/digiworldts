-- S10 — Lever trigger per-run state
--
-- The lever POI (dungeon_triggers) fires once per run. Instead of widening
-- the user_dungeon_run_poi_states.poi_kind CHECK constraint, the fired ids
-- live in a JSON array on user_dungeon_runs (mirroring oneshot_triggered_ids
-- and unlocked_doors). On SQLite the column is pre-added by
-- applyColumnMigrations (sqlite.ts), so this pure ADD COLUMN migration is
-- a no-op there (the migrator's duplicate-column detection marks it applied);
-- Postgres runs it fresh.

ALTER TABLE user_dungeon_runs ADD COLUMN triggered_triggers TEXT NOT NULL DEFAULT '[]';
