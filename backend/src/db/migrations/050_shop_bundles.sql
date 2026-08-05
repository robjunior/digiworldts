CREATE TABLE IF NOT EXISTS shop_bundles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  currency       TEXT NOT NULL DEFAULT 'credits',
  discount_pct   INTEGER NOT NULL DEFAULT 0,
  shop_category  TEXT NOT NULL DEFAULT 'bundle',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  featured       INTEGER NOT NULL DEFAULT 0,
  quick_offer    INTEGER NOT NULL DEFAULT 0,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_bundles_enabled ON shop_bundles(enabled, sort_order);

CREATE TABLE IF NOT EXISTS shop_bundle_items (
  bundle_id  TEXT NOT NULL REFERENCES shop_bundles(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_bundle_items_bundle ON shop_bundle_items(bundle_id);
