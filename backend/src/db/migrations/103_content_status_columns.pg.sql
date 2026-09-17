-- 103_content_status_columns.pg.sql  (Postgres only)
--
-- Restores the `status` content-lifecycle column on the five DB-backed
-- content domains. Migration 099_content_lifecycle_status_columns.sql added
-- it, but the feature-removal commit (5498847) deleted that migration while
-- the runtime still depends on it:
--   * quests/repo.ts        → WHERE status = 'published'
--   * npcs/repo.ts          → upserts + reads status
--   * social/shop.ts        → WHERE status = 'published'
--   * dialogues/repo.ts     → upserts + reads status
--   * content bundle rows   → dialogue_definitions carries a status value
-- Deployed DBs that ran 099 already have the columns (IF NOT EXISTS no-ops);
-- fresh PG environments are healed here.
--
-- Postgres supports ADD COLUMN IF NOT EXISTS — the SQLite twin
-- (103_content_status_columns.sqlite.sql) relies on the migrations ledger
-- instead, since SQLite has no conditional ADD COLUMN.

ALTER TABLE quests
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE world_objects
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE npcs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE dialogue_definitions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));
ALTER TABLE shop_items
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));

-- Backfill: legacy `enabled` soft-delete flag maps onto the new taxonomy.
-- Idempotent — rows already archived stay archived.
UPDATE shop_items SET status = 'archived' WHERE enabled = 0;

-- Version ledger tables. They live in the sqlite baseline (schema.sql) but
-- were never added to the Postgres baseline; the migration that originally
-- created them for PG (099) was deleted with the feature-removal commit, so
-- fresh PG environments lack them and content-deploy fails at the first
-- recordVersion. CREATE IF NOT EXISTS keeps this safe for DBs that have
-- them from the 099 era.

CREATE TABLE IF NOT EXISTS content_versions (
  id              TEXT PRIMARY KEY,
  domain          TEXT NOT NULL,
  ref_id          TEXT NOT NULL,
  version_number  INTEGER NOT NULL CHECK (version_number > 0),
  status          TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  definition_json TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  created_by      TEXT,
  UNIQUE (domain, ref_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_content_versions_domain_ref ON content_versions(domain, ref_id);
CREATE INDEX IF NOT EXISTS idx_content_versions_created_at ON content_versions(created_at);

CREATE TABLE IF NOT EXISTS active_versions (
  domain      TEXT NOT NULL,
  ref_id      TEXT NOT NULL,
  version_id  TEXT NOT NULL REFERENCES content_versions(id),
  PRIMARY KEY (domain, ref_id),
  UNIQUE (domain, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_active_versions_version_id ON active_versions(version_id);