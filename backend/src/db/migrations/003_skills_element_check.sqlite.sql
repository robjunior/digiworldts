-- Fix a SQLite-only CHECK-constraint drift. The old `skills_catalog.element`
-- CHECK allowed only 5 elements (fire, water, nature, electric, neutral) —
-- widened to 11 in commit a771d95 by editing schema.sql, but `CREATE TABLE
-- IF NOT EXISTS` is a no-op on existing DBs, so any pre-a771d95 deploy kept
-- the old CHECK and started rejecting new seed rows.
--
-- Postgres handles this via the DO $$ block in schema-pg.sql (line 215-228),
-- so this migration only targets the SQLite dialect (.sqlite.sql suffix).
--
-- SQLite cannot ALTER a CHECK constraint in place; recreate the table with
-- the correct constraint, copy the rows, drop, rename. Rows with elements
-- outside the new 11-element taxonomy are filtered out — they'd be invalid
-- under the current game rules anyway, and seedSkillsCatalogFromXml on the
-- same boot re-seeds authoritative data via ON CONFLICT (name) DO NOTHING.
CREATE TABLE skills_catalog__new (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT NOT NULL DEFAULT '',
  element        TEXT NOT NULL CHECK (element IN ('fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null')),
  energy_cost    INTEGER NOT NULL DEFAULT 0 CHECK (energy_cost >= 0),
  cooldown       INTEGER NOT NULL DEFAULT 0 CHECK (cooldown >= 0),
  actions_json   TEXT NOT NULL,
  tags_json      TEXT NOT NULL DEFAULT '[]',
  animation      TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

INSERT INTO skills_catalog__new
  SELECT id, name, description, element, energy_cost, cooldown, actions_json, tags_json, animation, enabled, created_at, updated_at
    FROM skills_catalog
   WHERE element IN ('fire', 'water', 'plant', 'ice', 'electricity', 'earth', 'steel', 'wind', 'light', 'dark', 'null');

DROP TABLE skills_catalog;
ALTER TABLE skills_catalog__new RENAME TO skills_catalog;

CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills_catalog(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_element ON skills_catalog(element);
