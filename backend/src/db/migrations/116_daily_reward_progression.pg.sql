-- Daily reward continuous progression: add total_cycles and season columns.
ALTER TABLE player_wallet ADD COLUMN IF NOT EXISTS total_cycles INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_wallet ADD COLUMN IF NOT EXISTS season INTEGER NOT NULL DEFAULT 1;
