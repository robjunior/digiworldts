-- 103_content_status_columns.sqlite.sql  (SQLite only)
--
-- Same healing as 103_content_status_columns.pg.sql: restores the `status`
-- content-lifecycle column on quests, world_objects, npcs,
-- dialogue_definitions and shop_items (the runtime and the committed bundle
-- depend on it; migration 099 that shipped it was deleted by the
-- feature-removal commit).
--
-- SQLite has no conditional ADD COLUMN, so these are unconditional — the
-- migration ledger guarantees each DB runs this file exactly once. DBs that
-- ran the original 099 before its deletion are NOT re-migrated here (their
-- ledger entry covers the old file and the columns already exist), which is
-- fine: the only long-lived SQLite DB is the dev DB, which predates/postdates
-- the 099 window without the columns.

ALTER TABLE quests
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE world_objects
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE npcs
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE dialogue_definitions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE shop_items
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));

-- Backfill: legacy `enabled` soft-delete flag maps onto the new taxonomy.
UPDATE shop_items SET status = 'archived' WHERE enabled = 0;