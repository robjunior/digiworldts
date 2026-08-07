-- 054_dungeon_kits.sql
--
-- Kit presets — user-authored templates of items to bring into a dungeon
-- (ADR docs/wiki/ADRs/2026-08-07 — Dungeon crawler + extraction refactor.md).
--
-- A Kit is a template, not an escrow. Nothing leaves player_inventory at
-- edit time. Escrow happens at POST /api/dungeon/:id/enter when the run
-- starts (see backend/src/dungeons/stash.ts::escrowKitToStash).
--
-- One kit per (user_id, name) — the UNIQUE constraint is the race guard
-- against concurrent creates racing the same name.

CREATE TABLE dungeon_kits (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE INDEX idx_dungeon_kits_user ON dungeon_kits(user_id);
