-- AlterTable
-- TASK-29 (R-6): add the additive `xp` column to Digimon — the first column that
-- moves progression. A defaulted (0) NOT NULL column, so every existing row reads 0
-- and no released contract breaks (invariant 5). SQLite supports adding a column with
-- a constant default in place.
ALTER TABLE "Digimon" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;
