-- 116 — Replace legacy evolution items with the new 3-item system.
--
-- Removes the old per-digimon fragments (itm-evo-frag-*), evolution keys
-- (itm-evo-*), and cyphers (itm-cypher-*) along with their loot entries.
-- The new system uses elemental essences, rarity cores, and archetype sigils.

DELETE FROM player_shop_purchases WHERE item_id LIKE 'itm-evo-frag-%' OR item_id LIKE 'itm-evo-%' OR item_id LIKE 'itm-cypher-%';
DELETE FROM player_inventory     WHERE item_id LIKE 'itm-evo-frag-%' OR item_id LIKE 'itm-evo-%' OR item_id LIKE 'itm-cypher-%';
DELETE FROM catalog_loot_entries WHERE item_id LIKE 'itm-evo-frag-%' OR item_id LIKE 'itm-evo-%' OR item_id LIKE 'itm-cypher-%';
DELETE FROM farm_recipes         WHERE id LIKE 'rcp-evo-key-%' OR id LIKE 'rcp-cypher-%' OR id LIKE 'rcp-essence-%';
DELETE FROM shop_items           WHERE id LIKE 'itm-evo-frag-%' OR id LIKE 'itm-evo-%' OR id LIKE 'itm-cypher-%';
