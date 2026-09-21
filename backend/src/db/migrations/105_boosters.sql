-- 105_boosters.sql
-- Booster "manual curation" tables (see docs/booster-spec).
-- The DB is a runtime CACHE; source of truth is the versioned seed files in
-- seeds/boosters/ which the loader transforms and deploys here.
--
-- Ids are deterministic (`code` lowercased for boosters; `code:ref` and
-- `code:item:ref` for nodes/items) so re-deploys converge idempotently.
-- `seed_hash` pins the exact source file a booster snapshot was built from.
-- Portable SQL: runs identically on SQLite and Postgres.

CREATE TABLE IF NOT EXISTS boosters (
  id            TEXT PRIMARY KEY,        -- code lowercased, e.g. "bt-04"
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  "set"         TEXT NOT NULL,           -- quoted: `set` is a reserved keyword
  release_date  TEXT NOT NULL,           -- YYYY-MM-DD
  description   TEXT,
  status        TEXT NOT NULL,           -- draft | review | published | archived
  tags          TEXT,                    -- JSON array
  seed_hash     TEXT NOT NULL,
  loaded_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS booster_digimon_nodes (
  id             TEXT PRIMARY KEY,       -- "bt-04:agumon"
  booster_id     TEXT NOT NULL REFERENCES boosters(id) ON DELETE CASCADE,
  ref            TEXT NOT NULL,          -- file-local slug
  digimon_id     TEXT NOT NULL,          -- -> global catalog (XML)
  parent_node_id TEXT REFERENCES booster_digimon_nodes(id),
  rarity         TEXT NOT NULL,
  weight         INTEGER NOT NULL CHECK (weight > 0),
  "order"        INTEGER NOT NULL,
  UNIQUE (booster_id, ref)
);

CREATE TABLE IF NOT EXISTS booster_item_entries (
  id         TEXT PRIMARY KEY,           -- "bt-04:item:fire-spirit"
  booster_id TEXT NOT NULL REFERENCES boosters(id) ON DELETE CASCADE,
  ref        TEXT NOT NULL,
  item_id    TEXT NOT NULL,              -- -> global shop_items catalog
  rarity     TEXT NOT NULL,
  weight     INTEGER NOT NULL CHECK (weight > 0),
  "order"    INTEGER NOT NULL,
  UNIQUE (booster_id, ref)
);

CREATE INDEX IF NOT EXISTS idx_booster_nodes_parent ON booster_digimon_nodes(parent_node_id);
CREATE INDEX IF NOT EXISTS idx_booster_nodes_booster ON booster_digimon_nodes(booster_id);
CREATE INDEX IF NOT EXISTS idx_booster_items_booster ON booster_item_entries(booster_id);