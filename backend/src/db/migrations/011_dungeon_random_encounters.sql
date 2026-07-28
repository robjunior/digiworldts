ALTER TABLE dungeons ADD COLUMN random_encounters_enabled INTEGER NOT NULL DEFAULT 0 CHECK (random_encounters_enabled IN (0, 1));
ALTER TABLE dungeons ADD COLUMN random_encounter_rate REAL NOT NULL DEFAULT 0.12 CHECK (random_encounter_rate >= 0 AND random_encounter_rate <= 1);
ALTER TABLE dungeons ADD COLUMN random_min_level INTEGER NOT NULL DEFAULT 1 CHECK (random_min_level >= 1);
ALTER TABLE dungeons ADD COLUMN random_max_level INTEGER NOT NULL DEFAULT 5 CHECK (random_max_level >= random_min_level);
ALTER TABLE dungeons ADD COLUMN random_max_stage TEXT NOT NULL DEFAULT 'Rookie';
ALTER TABLE dungeons ADD COLUMN random_min_party_size INTEGER NOT NULL DEFAULT 1 CHECK (random_min_party_size >= 1 AND random_min_party_size <= 3);
ALTER TABLE dungeons ADD COLUMN random_max_party_size INTEGER NOT NULL DEFAULT 1 CHECK (random_max_party_size >= random_min_party_size AND random_max_party_size <= 3);
ALTER TABLE dungeons ADD COLUMN random_allowed_elements TEXT;
