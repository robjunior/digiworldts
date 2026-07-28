-- SQLite variant of 019 — same intent, but sqlite ADD COLUMN is unconditional
-- and requires stronger table-shape checks handled by the migration runner.
-- Both columns nullable to preserve legacy rows.

ALTER TABLE user_quest_progress ADD COLUMN objective_progress TEXT;
ALTER TABLE user_quest_progress ADD COLUMN claimed_at INTEGER;
