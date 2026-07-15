-- CreateTable
-- TASK-262 (R-31b): the 16th migration, purely ADDITIVE — a NEW `InventoryItem` table
-- for the space-limited player inventory (a player BUYS an `'inventory_item'`-kind shop
-- entry and OWNS a consumable-chip stack). A brand-new table touches no existing row and
-- breaks no released contract, so the fifteen prior committed migrations stay byte-stable
-- (invariant 5). Mirrors `ResourceBalance` exactly: cuid PK, a `userId` RESTRICT FK (users
-- are soft-deleted, never hard-DELETEd), a plain-String `itemId` slug (SQLite-no-enums),
-- an Int `quantity DEFAULT 0`, createdAt/updatedAt stamps, and the `@@unique([userId,
-- itemId])` composite that is the UPSERT KEY a grant increments on (so two grants of the
-- same item land on ONE row, summed). The item grant rides the EXISTING audited shop
-- purchase `$transaction` (same AuditLog row, invariant 3) — no new value path.
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InventoryItem_userId_idx" ON "InventoryItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_userId_itemId_key" ON "InventoryItem"("userId", "itemId");
