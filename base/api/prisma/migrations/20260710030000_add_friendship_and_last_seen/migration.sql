-- TASK-44 (R-11): the 12th migration, purely ADDITIVE — the social friends slice.
-- Two additive changes, neither touching an existing row's shape or a released
-- contract, so the eleven prior committed migrations stay byte-stable (invariant 5):
--   1. a NULLABLE `lastSeenAt` column on User (every existing row reads NULL = "never
--      seen"); SQLite supports adding a nullable column in place. It is stamped on every
--      `GET /api/auth/me` and read only by the friends view's `online` derivation — the
--      `MeResponse` WIRE shape is byte-unchanged (lastSeenAt is NOT projected).
--   2. a brand-new `Friendship` table (a friend-request/friendship edge). A new table
--      touches no existing row. `requesterId`/`addresseeId` FKs RESTRICT on delete
--      (users are soft-deleted, never hard-DELETEd), `status` defaults to 'pending', and
--      a unique on the ordered (requesterId, addresseeId) pair forbids duplicate same-
--      direction requests. No spendable value moves (invariant 3 untriggered — a
--      friendship is domain state, no ResourceBalance/AuditLog).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastSeenAt" DATETIME;

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requesterId" TEXT NOT NULL,
    "addresseeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Friendship_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Friendship_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Friendship_requesterId_idx" ON "Friendship"("requesterId");

-- CreateIndex
CREATE INDEX "Friendship_addresseeId_idx" ON "Friendship"("addresseeId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_requesterId_addresseeId_key" ON "Friendship"("requesterId", "addresseeId");
