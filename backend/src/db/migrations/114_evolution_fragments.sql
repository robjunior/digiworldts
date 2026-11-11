-- 114 — Evolution is gated by digimon-specific fragments; remove the legacy chips.
--
-- The generic evolution chips (itm-digi-chip-*), their A/B/C siblings + fragments
-- (itm-chip-*), and their Chip-Factory recipes (rcp-chip-*) are replaced by
-- per-digimon fragments (itm-evo-frag-*). Clean existing deployed DBs: drop the
-- chip SKUs (clearing player-held copies first so the RESTRICT FK on
-- player_inventory.item_id does not block the delete) and the chip recipes.
--
-- Portable across SQLite and Postgres (both support LIKE; player_shop_purchases /
-- player_inventory / farm_recipes rows referencing chips are removed first).

DELETE FROM player_shop_purchases WHERE item_id LIKE 'itm-digi-chip-%' OR item_id LIKE 'itm-chip-%';
DELETE FROM player_inventory     WHERE item_id LIKE 'itm-digi-chip-%' OR item_id LIKE 'itm-chip-%';
DELETE FROM farm_recipes         WHERE id LIKE 'rcp-chip-%';
DELETE FROM shop_items           WHERE id LIKE 'itm-digi-chip-%' OR id LIKE 'itm-chip-%';