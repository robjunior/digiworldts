-- 053_shop_items_kit_class.sql
--
-- Item taxonomy + kit-slot metadata for the dungeon-extraction refactor
-- (ADR docs/wiki/ADRs/2026-08-07 — Dungeon crawler + extraction refactor.md).
--
-- item_type — enumerates the domain role of the item so admin dropdowns
--   (EvolutionEdgeEditor, DoorEditor, RecipeEditor, KitEditor) can filter
--   to the relevant subset. Enforced at the app boundary via Zod, not a
--   DB CHECK, for portability.
-- kit_class — per-class cap key used by KitEditor. NULL = uncapped.
-- kit_max_qty — soft cap when kit_class is set (e.g. revive=3, extract=1).
--
-- Every existing row keeps behavior identical: DEFAULT 'consumable' for
-- item_type covers the common shop item shape; the two new nullable
-- columns are opt-in.

ALTER TABLE shop_items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'consumable';
ALTER TABLE shop_items ADD COLUMN kit_class TEXT;
ALTER TABLE shop_items ADD COLUMN kit_max_qty INTEGER;
