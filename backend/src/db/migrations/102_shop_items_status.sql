-- 102_shop_items_status.sql
--
-- Add status column to shop_items for draft/published workflow.
-- Default 'draft' so existing items need explicit publish.
-- Note: `enabled` controls player-facing visibility; `status` controls
-- content-lifecycle (draft → published). Both must be true for an item
-- to be available to players.
-- Portable across SQLite and Postgres.

ALTER TABLE shop_items ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_shop_items_status ON shop_items(status);