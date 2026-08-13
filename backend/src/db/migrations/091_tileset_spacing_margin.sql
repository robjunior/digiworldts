-- 091_tileset_spacing_margin.sql
--
-- Adds spacing/margin fields to the tilesets table. Tiled tilesets can specify
-- a gap between tiles (spacing) and a gap around the sheet border (margin).
-- The importer auto-populates these from the TMJ, and the renderer uses them
-- to compute the correct sub-image offset.
-- Do NOT wrap in BEGIN/COMMIT — the migrator runs each file in a tx.

ALTER TABLE tilesets ADD COLUMN spacing INTEGER NOT NULL DEFAULT 0 CHECK (spacing >= 0);
ALTER TABLE tilesets ADD COLUMN margin INTEGER NOT NULL DEFAULT 0 CHECK (margin >= 0);
