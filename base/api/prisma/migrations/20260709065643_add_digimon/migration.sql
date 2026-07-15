-- CreateTable
CREATE TABLE "Digimon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "element" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "hp" INTEGER NOT NULL,
    "atk" INTEGER NOT NULL,
    "def" INTEGER NOT NULL,
    "spd" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Digimon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Digimon_userId_idx" ON "Digimon"("userId");
