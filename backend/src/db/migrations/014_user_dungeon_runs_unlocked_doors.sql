-- 014_user_dungeon_runs_unlocked_doors.sql
--
-- Migration 010 introduced the dungeon_doors table but forgot the matching
-- ALTER on user_dungeon_runs. The repo layer (backend/src/dungeons/repo.ts)
-- has been reading/writing an `unlocked_doors` TEXT/JSON column since day
-- one, but the column never actually existed in either dialect's schema.
--
-- This latent bug slept because no real player had entered a dungeon with
-- a door before the elemental-set seed in migration 013. As soon as a
-- player calls GET /api/dungeon/:id for a dungeon that has any door, the
-- backend blows up with `column "unlocked_doors" of relation
-- "user_dungeon_runs" does not exist`.
--
-- Portable across SQLite and Postgres: both accept
-- `ALTER TABLE ... ADD COLUMN ... TEXT NOT NULL DEFAULT '[]'`.

ALTER TABLE user_dungeon_runs ADD COLUMN unlocked_doors TEXT NOT NULL DEFAULT '[]';
