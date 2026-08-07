-- 056_dungeon_run_stash.sql
--
-- Per-run ephemeral bag — carries items brought via Kit AND items found
-- during a run. origin distinguishes the two so extraction reports can
-- show "brought N, found M, extracted N+M" and so a future wipe-policy
-- change (Q1) can flip preserve-kit semantics without a schema change.
--
-- F2 SHIPS DRY: this table exists and the escrow path fills it on
-- POST /api/dungeon/:id/enter, but no loot flow writes to it yet.
-- F3 flips the redirect via flag:dungeon-extraction.

CREATE TABLE dungeon_run_stash (
  user_id      TEXT NOT NULL,
  dungeon_id   TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty >= 0),
  origin       TEXT NOT NULL CHECK (origin IN ('kit', 'loot')),
  updated_at   BIGINT NOT NULL,
  PRIMARY KEY (user_id, dungeon_id, item_id, origin)
);

CREATE INDEX idx_dungeon_run_stash_run ON dungeon_run_stash(user_id, dungeon_id);
