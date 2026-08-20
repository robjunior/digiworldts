-- 099_content_lifecycle_status_columns.sql
--
-- Content lifecycle v1 (see .omo/plans/content-lifecycle-v1.md).
--
-- Adds a `status` column to the five DB-backed content domains so admin edits
-- can be drafted, published, and archived without touching player state:
--
--   quests, world_objects, npcs, dialogue_definitions, shop_items
--
-- `status` is ADDED alongside existing flags (e.g. shop_items.enabled), NOT
-- replacing them — backward compatible. Default 'published' preserves current
-- behavior for every existing row and every INSERT that omits the column.
--
-- Also creates the immutable version history tables:
--   content_versions — one frozen JSON snapshot per (domain, ref_id) version;
--   active_versions  — the live version pointer per (domain, ref_id) that
--                      `pnpm content:deploy` swaps transactionally.
--
-- Backfill: shop_items.enabled=0 rows (the legacy soft-delete flag) map onto
-- the new taxonomy as 'archived'.
--
-- Portable across SQLite and Postgres:
--   - CHECK constraints are allowed inside ADD COLUMN on both dialects.
--   - BIGINT timestamps (Postgres BIGINT = 8 bytes; better-sqlite3 stores it
--     as a native 64-bit int — same convention as migrations 045/049).
--   - `REFERENCES users(id) ON DELETE SET NULL` keeps the audit trail intact
--     if an admin account is ever deleted.
--   - No FKs from content_versions/active_versions to the content tables
--     themselves: ref_id is a weak string ref, so versioning can never
--     constrain or break player-facing rows (player-state isolation rule).

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

CREATE TABLE IF NOT EXISTS content_versions (
  id              TEXT PRIMARY KEY,
  domain          TEXT NOT NULL,
  ref_id          TEXT NOT NULL,
  version_number  INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  definition_json TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (domain, ref_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_content_versions_domain_ref
  ON content_versions(domain, ref_id);

CREATE TABLE IF NOT EXISTS active_versions (
  domain     TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES content_versions(id) ON DELETE CASCADE,
  PRIMARY KEY (domain, ref_id)
);