-- Drop legacy `active_matches` and `matchmaking_queue` tables. Battle state
-- and matchmaking queue now live in the Cluster (Redis or in-process) — see
-- src/battle/routes.ts and src/matchmaking/queue.ts. These tables were kept
-- around for one release as a migration hook + admin snapshot; N2 in
-- ROADMAP.md retires them.
--
-- Portable across SQLite and Postgres. IF EXISTS guards make it a no-op on
-- fresh installs (which never had the tables because 001 lands with the
-- initial schema-that-doesn't-have-them).
DROP TABLE IF EXISTS active_matches;
DROP TABLE IF EXISTS matchmaking_queue;
