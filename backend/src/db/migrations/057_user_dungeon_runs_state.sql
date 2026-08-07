-- 057_user_dungeon_runs_state.sql
--
-- Dungeon run state machine + resource stash counters + exit warp marker.
-- Part of F3 (loot redirect + wipe + extraction) — see
-- ADR docs/wiki/ADRs/2026-08-07 — Dungeon crawler + extraction refactor.md.
--
-- state       — 'active' | 'extracted' | 'wiped' | 'extracted_by_teleport'
--              | 'cleared_challenge'. Enforced via CHECK — portable SQLite/PG.
-- ended_at    — ms epoch of the state transition (NULL while active).
-- extraction_kind — 'walked_out' | 'teleport_scroll' | 'challenge_win' | NULL.
-- stash_meat/bits/data — resource counters gained during the run. Never
--              deducted from the player at run start; they only ACCUMULATE.
--              Zeroed on wipe; merged into resources on extract.
--
-- dungeon_warps.is_exit — boolean marker on warps that lead OUT of the
--              dungeon system. F3 uses it to gate the /extract endpoint.
--
-- Backfill — every historical run with completed_at IS NOT NULL is treated
-- as 'extracted' so quest hooks continue to fire on the same paths.

ALTER TABLE user_dungeon_runs ADD COLUMN state TEXT NOT NULL DEFAULT 'active'
  CHECK (state IN ('active', 'extracted', 'wiped', 'extracted_by_teleport', 'cleared_challenge'));
ALTER TABLE user_dungeon_runs ADD COLUMN ended_at INTEGER;
ALTER TABLE user_dungeon_runs ADD COLUMN extraction_kind TEXT
  CHECK (extraction_kind IS NULL OR extraction_kind IN ('walked_out', 'teleport_scroll', 'challenge_win'));
ALTER TABLE user_dungeon_runs ADD COLUMN stash_meat INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_dungeon_runs ADD COLUMN stash_bits INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_dungeon_runs ADD COLUMN stash_data INTEGER NOT NULL DEFAULT 0;

UPDATE user_dungeon_runs SET state = 'extracted', ended_at = completed_at
  WHERE completed_at IS NOT NULL;

ALTER TABLE dungeon_warps ADD COLUMN is_exit INTEGER NOT NULL DEFAULT 0
  CHECK (is_exit IN (0, 1));
