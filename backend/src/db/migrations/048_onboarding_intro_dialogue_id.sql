-- 048_onboarding_intro_dialogue_id.sql
--
-- Optional interactive intro. When intro_dialogue_id is set, the /intro screen
-- runs the referenced dialogue through the runtime (same path DialogueOverlay
-- uses in the dungeon) instead of rendering the static intro_dialogue
-- paragraphs. NULL (the default for legacy rows) means "use the paragraph
-- text as before", preserving pre-P5 behavior.
--
-- Nullable + no default is portable across SQLite and Postgres. No backfill
-- needed. No FK to dialogue_definitions — cross-ref validation happens at
-- the API layer (see backend/src/onboarding/engine.ts::updateConfig) so a
-- paragraph-only deploy that never boots the dialogue system still works.

ALTER TABLE onboarding_config ADD COLUMN intro_dialogue_id TEXT;
