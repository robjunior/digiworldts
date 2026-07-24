-- P1 of skills-refactor: extend `skills_catalog` for the 264-skill pool.
--
-- The P3 seed populates: `name_pt`, `description_pt`, `stage`, `slot_role`,
-- optional `upgrade_of` (progression chain link), and `tier_2` flag.
-- Legacy wikimon inline skills stay untouched — `stage` and `slot_role` are
-- nullable so pre-P1 catalog rows keep working via the engine's legacy path.
--
-- Portable across SQLite and Postgres (pure `ADD COLUMN` + `CREATE INDEX`).
ALTER TABLE skills_catalog ADD COLUMN name_pt TEXT NOT NULL DEFAULT '';
ALTER TABLE skills_catalog ADD COLUMN description_pt TEXT;
ALTER TABLE skills_catalog ADD COLUMN stage TEXT;
ALTER TABLE skills_catalog ADD COLUMN slot_role TEXT;
ALTER TABLE skills_catalog ADD COLUMN upgrade_of TEXT REFERENCES skills_catalog(id);
ALTER TABLE skills_catalog ADD COLUMN tier_2 INTEGER NOT NULL DEFAULT 0 CHECK (tier_2 IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_skills_stage ON skills_catalog(stage);
CREATE INDEX IF NOT EXISTS idx_skills_slot_role ON skills_catalog(slot_role);
CREATE INDEX IF NOT EXISTS idx_skills_upgrade_of ON skills_catalog(upgrade_of);
