-- F6 — Fragments, rarity tables, Cypher recipes, part 1: dungeon_rarity_tables.
--
-- A rarity table is a reusable weighted loot table an encounter can point
-- at (via dungeon_encounters.rarity_table_id, added in migration 063). At
-- defeat time the server rolls between `min_rolls` and `max_rolls` items
-- from the pool tagged `pool_tag` (matched against shop_items.drop_pool,
-- added in migration 066), weighted by the `weights` map (rarity → weight).
--
-- Weights format: JSON object mapping the 0-4 rarity int to a positive
-- integer weight, e.g. {"0": 60, "1": 25, "2": 10, "3": 4, "4": 1}. Missing
-- rarities are treated as zero. The roll normalizes on the fly so weights
-- don't need to sum to any specific value.
--
-- Portable across SQLite and Postgres.
CREATE TABLE IF NOT EXISTS dungeon_rarity_tables (
  id          TEXT PRIMARY KEY,
  weights     TEXT NOT NULL,
  pool_tag    TEXT NOT NULL,
  min_rolls   INTEGER NOT NULL DEFAULT 1 CHECK (min_rolls >= 0),
  max_rolls   INTEGER NOT NULL DEFAULT 3 CHECK (max_rolls >= min_rolls)
);

CREATE INDEX IF NOT EXISTS idx_dungeon_rarity_tables_pool_tag ON dungeon_rarity_tables(pool_tag);
