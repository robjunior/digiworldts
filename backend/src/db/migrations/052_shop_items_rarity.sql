-- 052_shop_items_rarity.sql
--
-- Item rarity tier for the dungeon-extraction refactor (see
-- ADR docs/wiki/ADRs/2026-08-07 — Dungeon crawler + extraction refactor.md).
--
-- Rarity 0..4 = common | uncommon | rare | epic | legendary.
-- Influences drop weights (F6), evolution outcome bonuses (F7),
-- and UI display (F1 — this migration).
--
-- Portable across SQLite and Postgres. Range 0..4 is enforced at the
-- app boundary via Zod (backend/src/admin/shop.ts) — a DB CHECK constraint
-- would require dialect-specific migrations for no functional benefit
-- given the Zod gate.
--
-- Non-nullable with DEFAULT 0 backfills every existing row to 'common'
-- with no data change visible to callers.

ALTER TABLE shop_items ADD COLUMN rarity INTEGER NOT NULL DEFAULT 0;
