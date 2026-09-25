-- 107_adventure_multi_team.sql
--
-- Multiple concurrent expeditions: replace the partial UNIQUE on (user_id)
-- WHERE collected_at IS NULL (one active team per user) with a per-slot
-- UNIQUE that admits up to ADVENTURE_MAX_ACTIVE in-flight teams.
--
--   slot INTEGER NOT NULL DEFAULT 0   -- team slot 0..ADVENTURE_MAX_ACTIVE-1
--
-- The engine assigns the smallest free slot and relies on this partial index
-- as the race-safe backstop (concurrent starts picking the same slot fail the
-- UNIQUE and the whole tx rolls back, meat refunded). Historical (collected)
-- rows are excluded, so past runs keep their old slot 0 without conflict.
DROP INDEX IF EXISTS adventures_unique_active_user;
ALTER TABLE adventures ADD COLUMN slot INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS adventures_unique_active_slot
  ON adventures(user_id, slot)
  WHERE collected_at IS NULL;