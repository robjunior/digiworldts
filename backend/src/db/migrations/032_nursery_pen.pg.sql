ALTER TABLE player_roster DROP CONSTRAINT IF EXISTS player_roster_status_check;
ALTER TABLE player_roster ADD CONSTRAINT player_roster_status_check CHECK (status IN ('resting','training','party','adventure','nursery'));
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS nursery_stage TEXT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS nursery_evolve_at BIGINT;
ALTER TABLE player_roster ADD COLUMN IF NOT EXISTS nursery_chain TEXT;
