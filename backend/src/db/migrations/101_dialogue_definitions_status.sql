-- 101_dialogue_definitions_status.sql
--
-- Add status column to dialogue_definitions for draft/published workflow.
-- Default 'draft' so existing dialogues need explicit publish.
-- Portable across SQLite and Postgres.

ALTER TABLE dialogue_definitions ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published'));

CREATE INDEX IF NOT EXISTS idx_dialogue_definitions_status ON dialogue_definitions(status);