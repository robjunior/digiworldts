-- 042_dual_currency_columns.sql
-- Pure ADD COLUMN migration. Safe to be marked as applied if the columns already exist.

ALTER TABLE player_wallet ADD COLUMN netcore INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_items ADD COLUMN currency TEXT NOT NULL DEFAULT 'credits';
ALTER TABLE shop_items ADD COLUMN price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_items ADD COLUMN shop_category TEXT NOT NULL DEFAULT 'misc';
ALTER TABLE shop_items ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_items ADD COLUMN quick_offer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_items ADD COLUMN one_time INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
