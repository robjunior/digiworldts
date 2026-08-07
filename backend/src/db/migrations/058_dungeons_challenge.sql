-- 058_dungeons_challenge.sql
--
-- Per-dungeon "clear condition" — admin-authored trigger for auto-extraction
-- (F4 of the dungeon extraction refactor, ADR docs/wiki/ADRs/2026-08-07).
--
-- challenge_kind — enumerates HOW a run's challenge is considered cleared:
--   'boss_defeated'          — challenge_config.bossEncounterId
--   'all_encounters_defeated'— no config
--   'reach_tile'             — challenge_config.targetX/targetY
--   'collect_item'           — challenge_config.itemId/qty
--   'survive_waves'          — challenge_config.waveCount/spawnTable (V2)
--   'none'                   — never auto-clears; player must walk-out or scroll.
-- Enforced via CHECK — portable SQLite/PG.
--
-- challenge_config — nullable JSON with the per-kind params.
--
-- challenge_progress (on user_dungeon_runs) — nullable JSON with per-kind
--   progress ledger (e.g. { wavesCleared: 3 } for survive_waves). NULL when
--   the challenge is stateless (boss_defeated, reach_tile, collect_item all
--   read run state directly).
--
-- Default 'none' preserves existing behavior: F3 dungeons continue to end
-- only via walk-out, extraction scroll, or wipe.

ALTER TABLE dungeons ADD COLUMN challenge_kind TEXT NOT NULL DEFAULT 'none'
  CHECK (challenge_kind IN ('none', 'boss_defeated', 'all_encounters_defeated', 'reach_tile', 'collect_item', 'survive_waves'));
ALTER TABLE dungeons ADD COLUMN challenge_config TEXT;

ALTER TABLE user_dungeon_runs ADD COLUMN challenge_progress TEXT;
