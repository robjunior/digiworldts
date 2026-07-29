-- 022_users_tutorial_seen.sql
--
-- Persists per-user tutorial "seen" state server-side. Previously stored in
-- client localStorage (`digiworld.tutorial.seen.{userId}`), which cleared with
-- cache/private mode and never crossed devices — so the intro/per-page
-- tutorials re-fired every session on a fresh browser.
--
-- TEXT column holding a JSON array of tutorial IDs (e.g. `["route:/lobby"]`).
-- Parsed/serialized in `backend/src/tutorial/routes.ts`. Portable across
-- SQLite and Postgres.

ALTER TABLE users ADD COLUMN tutorial_seen TEXT NOT NULL DEFAULT '[]';
