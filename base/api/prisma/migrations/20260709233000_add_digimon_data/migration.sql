-- AlterTable
-- TASK-30 (R-16): add the additive `dataFire` column to Digimon — the typed Fire
-- Data stat that, once it crosses a threshold, unlocks a SECOND, VARIANT evolution
-- branch (Agumon → Meramon instead of the linear Agumon → Greymon). A defaulted (0)
-- NOT NULL column, so every existing row reads 0 and no released contract breaks
-- (invariant 5). SQLite supports adding a column with a constant default in place.
-- Fire Data is domain progression (like xp/level), NOT a spendable resource — its
-- grant writes no audit row; only the priced variant evolve moves value (invariant 3).
ALTER TABLE "Digimon" ADD COLUMN "dataFire" INTEGER NOT NULL DEFAULT 0;
