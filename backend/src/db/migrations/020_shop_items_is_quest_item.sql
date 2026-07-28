-- 020_shop_items_is_quest_item.sql
--
-- Adds a boolean flag to shop_items to distinguish "quest items" (items that
-- carry narrative significance and are dropped by bosses / referenced by quests)
-- from regular consumables/cosmetics/etc.
--
-- The flag is UI-only — it does not change how items are stored in inventory
-- or how they can be used. The BossEditor filters the item picker into two
-- lists (regular vs quest) based on this flag.
--
-- Portable across SQLite and Postgres.

ALTER TABLE shop_items ADD COLUMN is_quest_item INTEGER NOT NULL DEFAULT 0;
