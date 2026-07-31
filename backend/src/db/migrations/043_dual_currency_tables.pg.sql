-- 043_dual_currency_tables.pg.sql
-- Postgres counterpart for dual currency tables and data backfill.
-- Asymmetry: Postgres gets CHECK constraints added via DO blocks. SQLite relies on app layer.

UPDATE shop_items SET price = price_credits WHERE price = 0;

CREATE TABLE IF NOT EXISTS player_shop_purchases (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL REFERENCES shop_items(id) ON DELETE RESTRICT,
  purchased_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS coin_offers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side            TEXT NOT NULL CHECK (side IN ('sell','buy')),
  lots_total      INTEGER NOT NULL CHECK (lots_total > 0),
  lots_remaining  INTEGER NOT NULL CHECK (lots_remaining >= 0),
  price_per_lot   INTEGER NOT NULL CHECK (price_per_lot > 0),
  created_at      BIGINT NOT NULL,
  cancelled_at    BIGINT,
  completed_at    BIGINT
);
CREATE INDEX IF NOT EXISTS idx_coin_offers_book ON coin_offers(side, price_per_lot, created_at);
CREATE INDEX IF NOT EXISTS idx_coin_offers_user ON coin_offers(user_id);

CREATE TABLE IF NOT EXISTS wallet_migration_audit (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits_before INTEGER NOT NULL,
  credits_after  INTEGER NOT NULL,
  netcore_before INTEGER NOT NULL,
  netcore_after  INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  created_at     BIGINT NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'player_wallet' AND c.conname = 'player_wallet_netcore_check'
  ) THEN
    ALTER TABLE player_wallet ADD CONSTRAINT player_wallet_netcore_check CHECK (netcore >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'shop_items' AND c.conname = 'shop_items_currency_check'
  ) THEN
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_currency_check CHECK (currency IN ('credits','netcore'));
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_price_check CHECK (price >= 0);
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_featured_check CHECK (featured IN (0,1));
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_quick_offer_check CHECK (quick_offer IN (0,1));
    ALTER TABLE shop_items ADD CONSTRAINT shop_items_one_time_check CHECK (one_time IN (0,1));
  END IF;
END $$;

DO $$ DECLARE
  fk_name text;
BEGIN
  SELECT c.conname INTO fk_name FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey) WHERE t.relname = 'player_inventory' AND a.attname = 'item_id' AND c.contype = 'f';
  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE player_inventory DROP CONSTRAINT ' || quote_ident(fk_name);
    EXECUTE 'ALTER TABLE player_inventory ADD CONSTRAINT ' || quote_ident(fk_name) || ' FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE RESTRICT';
  END IF;
END $$;
