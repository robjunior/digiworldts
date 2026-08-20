-- 099_content_lifecycle_status_columns.sqlite.sql
--
-- Content lifecycle v1 (see .omo/plans/content-lifecycle-v1.md).
--
-- SQLite variant. The baseline schema.sql already declares
-- content_versions/active_versions, so the CREATE TABLE statements here are
-- idempotent no-ops; the ADD COLUMNs target tables whose baseline schema
-- predates the status taxonomy.
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
-- SUPERSEDES the four per-domain status migrations that shipped on `main`
-- (099_quests_status / 100_npcs_status / 101_dialogue_definitions_status /
-- 102_shop_items_status); those files are deleted. This is the canonical
-- 3-state taxonomy (draft|published|archived, DEFAULT 'published').
--
-- NOTE: SQLite has no `ADD COLUMN IF NOT EXISTS`, so on a database where the
-- superseded per-domain migrations already ran, this migration would fail on
-- the first ALTER. No such database exists in the current deployment —
-- production is Postgres, and dev/test SQLite databases are either fresh
-- (tests under /tmp) or predate those migrations. Fresh databases run the
-- canonical taxonomy below directly.

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
ALTER TABLE dungeons
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