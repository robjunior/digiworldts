-- 055_dungeon_kit_items.sql
--
-- Line items on a Kit preset — one row per (kit, shop_items.id) with a
-- positive qty. CASCADE on parent delete keeps kit deletion atomic.
--
-- slot_order — UI ordering; server preserves it on read but does not
-- enforce uniqueness across items in a kit (a repeated order is legal
-- and simply renders in item_id sort order as a tie-break).

CREATE TABLE dungeon_kit_items (
  kit_id       TEXT NOT NULL REFERENCES dungeon_kits(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0),
  slot_order   INTEGER NOT NULL,
  PRIMARY KEY (kit_id, item_id)
);
