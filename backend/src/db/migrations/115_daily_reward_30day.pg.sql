-- Daily reward 30-day cycle: add longest_streak column and relax streak_day CHECK.
ALTER TABLE player_wallet ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_wallet DROP CONSTRAINT IF EXISTS player_wallet_streak_day_check;
ALTER TABLE player_wallet ADD CONSTRAINT player_wallet_streak_day_check CHECK (streak_day BETWEEN 0 AND 30);
