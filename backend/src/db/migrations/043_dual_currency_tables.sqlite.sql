-- 043_dual_currency_tables.sqlite.sql
-- migrator:self-managed-transaction
-- SQLite counterpart for dual currency tables and data backfill.
-- Asymmetry documented: SQLite cannot add CHECK constraints to existing tables via ALTER.
-- Therefore, columns added in 042 (netcore, currency, price, etc.) have NO CHECK constraints on SQLite
-- in both fresh and migrated DBs. The invariants (netcore >= 0, price >= 0, currency in ('credits','netcore'), 0/1 flags)
-- are enforced entirely in the application layer for SQLite. Postgres gets real CHECK constraints via its 043 migration.

PRAGMA foreign_keys=OFF;
BEGIN;

UPDATE shop_items SET price = price_credits WHERE price = 0;

CREATE TABLE IF NOT EXISTS player_shop_purchases (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT NOT NULL REFERENCES shop_items(id) ON DELETE RESTRICT,
  purchased_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS coin_offers (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side            TEXT NOT NULL CHECK (side IN ('sell','buy')),
  lots_total      INTEGER NOT NULL CHECK (lots_total > 0),
  lots_remaining  INTEGER NOT NULL CHECK (lots_remaining >= 0),
  price_per_lot   INTEGER NOT NULL CHECK (price_per_lot > 0),
  created_at      INTEGER NOT NULL,
  cancelled_at    INTEGER,
  completed_at    INTEGER
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
  created_at     INTEGER NOT NULL
);

-- Fix player_inventory.item_id FK to ON DELETE RESTRICT
CREATE TABLE player_inventory_new (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES shop_items(id) ON DELETE RESTRICT,
  qty         INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 0),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);
INSERT INTO player_inventory_new SELECT * FROM player_inventory;
DROP TABLE player_inventory;
ALTER TABLE player_inventory_new RENAME TO player_inventory;

COMMIT;
PRAGMA foreign_keys=ON;
