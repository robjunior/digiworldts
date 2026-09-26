-- 108_player_teams.sql
--
-- Saved team lineups (the roster screen's left column).
--
-- A team is a named lineup of 3 OWNED Digimon (player_roster ids). Teams are
-- loose references: the same mon may appear in several teams. Only the ACTIVE
-- team is mirrored into player_roster.slot_index 0..2 (the party), so battle,
-- matchmaking, the lobby scene and every existing consumer of
-- `loadPartyLoadout` keep working untouched.
--
--   active INTEGER 0|1 — at most one active team per user (partial unique).
--   mon_N_id NULL     — empty slot allowed while drafting a team; activation
--                       requires all three filled.
--
-- Also adds `player_wallet.extra_team_slots`: purchased +1 team slots from
-- the shop item `itm-team-slot` (200 credits each, repeatable).
-- Team limit = 3 + (2 if premium) + extra_team_slots, capped server-side.
CREATE TABLE IF NOT EXISTS player_teams (
  id          TEXT PRIMARY KEY,                       -- 'team_...'
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mon_1_id    TEXT REFERENCES player_roster(id) ON DELETE SET NULL,
  mon_2_id    TEXT REFERENCES player_roster(id) ON DELETE SET NULL,
  mon_3_id    TEXT REFERENCES player_roster(id) ON DELETE SET NULL,
  active      INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_teams_user ON player_teams(user_id);
-- Race-safe single-active guarantee (concurrent activations: the loser's
-- UPDATE on the second user_id row violates this and the tx rolls back).
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_teams_active
  ON player_teams(user_id) WHERE active = 1;

ALTER TABLE player_wallet ADD COLUMN extra_team_slots INTEGER NOT NULL DEFAULT 0;