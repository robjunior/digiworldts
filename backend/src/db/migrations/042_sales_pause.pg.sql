-- 042_sales_pause.pg.sql
-- Replaces 041's per-SKU disable table. The free-amount /buy redesign removed
-- fixed credit packs entirely, so there is no SKU left to disable — the only
-- admin lever that still makes sense is a global sales pause.
-- 041 shipped with zero rows, so dropping it loses nothing.
--
-- Singleton-row pattern: PK on a BOOLEAN column with CHECK (id) and DEFAULT TRUE
-- makes it structurally impossible to hold more than one row.

DROP TABLE IF EXISTS commerce.disabled_credit_packs;

CREATE TABLE IF NOT EXISTS commerce.sales_pause (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  paused_at BIGINT,
  paused_by TEXT,
  reason TEXT
);
