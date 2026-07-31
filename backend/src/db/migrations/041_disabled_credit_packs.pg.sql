-- 041_disabled_credit_packs.pg.sql
-- REV-1.1 phase 1 T38: admin can disable a credit pack SKU without a redeploy.
-- Config in discord/config/products.json is the base declaration; this table is
-- a runtime DB override consulted by /buy and mutated by /admin disable.
-- Discord service reads this table via its own PG pool (search_path=commerce, public).

CREATE TABLE IF NOT EXISTS commerce.disabled_credit_packs (
  sku TEXT PRIMARY KEY,
  disabled_at BIGINT NOT NULL,
  disabled_by TEXT NOT NULL,
  reason TEXT
);
