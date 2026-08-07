-- F6 — Fragments, rarity tables, Cypher recipes, part 3: farm recipe crafting inputs.
--
-- `requires_items` — JSON array of {itemId: string, qty: int} required to
-- start the craft. Server pre-flight deducts them (guarded UPDATE per
-- item; on any shortfall the whole craft errors 402 and no items are
-- consumed). Empty '[]' preserves the current currency-only crafts.
--
-- `inherit_rarity_from` — when set to 'fragment', the crafted output's
-- rarity equals the MAX rarity of consumed items in `requires_items` that
-- carry the 'fragment' item_type. Cyphers (evolution keys) crafted from
-- Element Shards inherit the highest input rarity — a mix of one r3 Shard
-- + eight r0 Shards yields an r3 Cypher.
--
-- Portable across SQLite and Postgres.
ALTER TABLE farm_recipes ADD COLUMN requires_items TEXT NOT NULL DEFAULT '[]';
ALTER TABLE farm_recipes ADD COLUMN inherit_rarity_from TEXT;
