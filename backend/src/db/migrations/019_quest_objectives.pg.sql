-- Migration 019: quest objectives + per-user tracking.
--
-- Extends user_quest_progress to store per-objective counters (JSON blob)
-- and a claimed_at timestamp. Combined with new optional fields on the Quest
-- JSON blob (objectives, giver, rewardText, lockHint), this enables the
-- mockup's travel/defeat/progress/accept/claim flow.
--
-- objective_progress: JSON array indexed by objective position:
--   [{ "counter": 0, "doneAt": null }, ...]
-- claimed_at: NULL until the user hits "Claim" after completing all objectives.

ALTER TABLE user_quest_progress ADD COLUMN IF NOT EXISTS objective_progress TEXT;
ALTER TABLE user_quest_progress ADD COLUMN IF NOT EXISTS claimed_at BIGINT;
