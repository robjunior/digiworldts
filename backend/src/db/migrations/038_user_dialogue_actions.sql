-- 038_user_dialogue_actions.sql
--
-- At-most-once ledger for dialogue entry actions.
--
-- Authored dialogue loops: elder.twee sends the player from elder/who back to
-- elder/start with [[Back->elder/start]], and elder/start carries
-- @do set_flag("dialogue.elder.met"). Without a ledger the action re-fires on
-- every pass, which for give_item would be an item farm rather than a cosmetic
-- repeat. A retried advance -- a flaky network, a double click -- has the same
-- shape, so this also makes the endpoint idempotent.
--
-- Keyed on the stable id the parser emits per action (elder/relic#a0). That id
-- is derived from passage name plus ordinal, so re-importing the same .twee
-- keeps the ledger meaningful; editing a passage's actions deliberately mints
-- new ids, which lets a rewritten dialogue apply again.
--
-- Deliberately not folded into user_flags: flags are game state a designer may
-- sweep by namespace, and clearing this bookkeeping by accident would reopen
-- every farm it exists to close.
CREATE TABLE IF NOT EXISTS user_dialogue_actions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id  TEXT NOT NULL,
  applied_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, action_id)
);
