-- 099_quests_status.sql
--
-- Add status column to quests for draft/published workflow.
-- Default 'draft' so existing quests need explicit publish.
-- Portable across SQLite and Postgres.

ALTER TABLE quests ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);