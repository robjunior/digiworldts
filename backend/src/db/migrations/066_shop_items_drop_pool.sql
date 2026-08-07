-- F6 — Fragments, rarity tables, Cypher recipes, part 5: shop_items drop_pool tag.
--
-- `drop_pool` — optional tag matched by dungeon_rarity_tables.pool_tag to
-- decide which shop_items enter the weighted roll for that table. E.g. a
-- rarity table with `pool_tag='shards'` rolls only items where
-- `drop_pool='shards'`. NULL means "not in any pool" — the item can still
-- appear as a fixed encounter loot but never rolls from a rarity table.
--
-- Portable across SQLite and Postgres.
ALTER TABLE shop_items ADD COLUMN drop_pool TEXT;

CREATE INDEX IF NOT EXISTS idx_shop_items_drop_pool_rarity ON shop_items(drop_pool, rarity);
