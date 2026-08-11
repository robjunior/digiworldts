-- S8 — Dungeon-wide encounter pool (Wave B)
-- Adds a curated pool of catalog IDs the player can encounter, alongside the
-- legacy filter fields. Empty default = grandfather to the existing statistical
-- filter (randomEncountersEnabled + randomMin/MaxLevel + randomMaxStage +
-- randomAllowedElements). Populated = pool takes precedence.

ALTER TABLE dungeons ADD COLUMN random_pool_json TEXT NOT NULL DEFAULT '[]';
