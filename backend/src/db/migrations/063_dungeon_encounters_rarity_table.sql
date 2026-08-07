-- F6 — Fragments, rarity tables, Cypher recipes, part 2: encounter rarity_table_id.
--
-- Optional foreign key to dungeon_rarity_tables.id. When set, defeatEncounter
-- rolls that table for loot IN ADDITION to (not instead of) the encounter's
-- own `loots` column. This lets a boss encounter grant a fixed reward AND
-- roll a weighted crafting drop from a shared pool.
--
-- Portable across SQLite and Postgres. Nullable — legacy encounters keep
-- their fixed loots behavior with no change.
ALTER TABLE dungeon_encounters ADD COLUMN rarity_table_id TEXT;
