-- AlterTable
-- TASK-255 (R-31a): add the additive nullable party-slot column to Digimon so a player's
-- chosen party (up to 3) persists. NULL = not in party. No default, no backfill (invariant-5 additive).
ALTER TABLE "Digimon" ADD COLUMN "partySlot" INTEGER;
