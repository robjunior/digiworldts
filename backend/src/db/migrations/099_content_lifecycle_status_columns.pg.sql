-- 099_content_lifecycle_status_columns.pg.sql
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
-- SUPERSEDES the four per-domain status migrations that shipped on `main`
-- (099_quests_status / 100_npcs_status / 101_dialogue_definitions_status /
-- 102_shop_items_status): those added a 2-state `status` (draft|published,
-- DEFAULT 'draft') per table. Those files are deleted. This migration is the
-- canonical 3-state taxonomy (draft|published|archived, DEFAULT 'published'),
-- and it is IDEMPOTENT so it boots both fresh databases AND databases where
-- the old per-domain migrations already ran:
--
--   * `ADD COLUMN IF NOT EXISTS` is a no-op where the column exists.
--   * The DO block widens the legacy 2-state CHECK to the 3-state taxonomy.
--   * The SET DEFAULT statements align pre-existing columns to 'published'
--     (the old migrations defaulted to 'draft').
--   * The backfill only touches rows still 'published', so re-runs are no-ops.
--
-- Postgres-only. SQLite variant: 099_content_lifecycle_status_columns.sqlite.sql.

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
ALTER TABLE dungeons
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived'));

-- Widen the legacy 2-state CHECK constraints (draft|published, no 'archived')
-- left behind by the superseded per-domain migrations on databases where they
-- ran. The fresh-path constraints (added above) already contain 'archived',
-- so the NOT LIKE '%archived%' guard keeps this a no-op there.
DO $$
DECLARE
  t  text;
  cn text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quests', 'npcs', 'dialogue_definitions', 'shop_items']
  LOOP
    SELECT conname INTO cn
    FROM pg_constraint
    WHERE conrelid = to_regclass(t)::oid
      AND contype = 'c'
      AND conname LIKE '%status%'
      AND pg_get_constraintdef(oid) NOT LIKE '%archived%'
    ORDER BY conname
    LIMIT 1;
    IF cn IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', t, cn);
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (status IN (''draft'', ''published'', ''archived''))',
        t, t || '_status_check'
      );
    END IF;
  END LOOP;
END $$;

-- Align pre-existing columns (the old migrations defaulted to 'draft') with
-- the canonical 'published' default. Fresh-path columns are already
-- 'published' — this is a no-op there.
ALTER TABLE quests ALTER COLUMN status SET DEFAULT 'published';
ALTER TABLE npcs ALTER COLUMN status SET DEFAULT 'published';
ALTER TABLE dialogue_definitions ALTER COLUMN status SET DEFAULT 'published';
ALTER TABLE shop_items ALTER COLUMN status SET DEFAULT 'published';

-- Backfill: legacy `enabled` soft-delete flag maps onto the new taxonomy.
-- Guarded so re-running (or a DB where the superseded migrations also ran a
-- backfill) is a no-op.
UPDATE shop_items SET status = 'archived' WHERE enabled = 0 AND status <> 'archived';

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