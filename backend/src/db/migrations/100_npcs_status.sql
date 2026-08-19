-- 100_npcs_status.sql
--
-- Add status column to npcs for draft/published workflow.
-- Default 'draft' so existing NPCs need explicit publish.
-- Portable across SQLite and Postgres.

ALTER TABLE npcs ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_npcs_status ON npcs(status);