-- Daily reward 30-day cycle: add longest_streak column and relax streak_day CHECK.
-- SQLite requires table rebuild to change a CHECK constraint.

CREATE TABLE player_wallet_new (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credits           INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  streak_day        INTEGER NOT NULL DEFAULT 0 CHECK (streak_day BETWEEN 0 AND 30),
  last_claim_at     INTEGER,
  longest_streak    INTEGER NOT NULL DEFAULT 0,
  premium_until     INTEGER,
  updated_at        INTEGER NOT NULL
);

INSERT INTO player_wallet_new (user_id, credits, streak_day, last_claim_at, premium_until, updated_at)
  SELECT user_id, credits, streak_day, last_claim_at, premium_until, updated_at FROM player_wallet;

DROP TABLE player_wallet;
ALTER TABLE player_wallet_new RENAME TO player_wallet;
