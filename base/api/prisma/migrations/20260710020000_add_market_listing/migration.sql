-- CreateTable
-- TASK-42 (R-10): the 11th migration, purely ADDITIVE — a NEW `MarketListing` table
-- for the player market (a seller lists an owned Digimon for DigiCredits; another
-- player buys it). A brand-new table touches no existing row and breaks no released
-- contract, so the ten prior committed migrations stay byte-stable (invariant 5). The
-- `sellerId` FK RESTRICTs on delete (users are soft-deleted, never hard-DELETEd), and
-- `status` defaults to 'open' so a freshly created listing is immediately buyable.
CREATE TABLE "MarketListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sellerId" TEXT NOT NULL,
    "digimonId" TEXT NOT NULL,
    "priceCredits" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "MarketListing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MarketListing_sellerId_idx" ON "MarketListing"("sellerId");
