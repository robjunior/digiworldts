-- AlterTable
-- TASK-235 (R-40): add the additive daily-reward streak columns to User — the
-- server-authoritative state of the once-per-calendar-day claim loop.
--   `dailyStreakDay`: INTEGER NOT NULL DEFAULT 0 — 0 = never claimed, 1..7 = the day
--     in the fixed 7-day cycle granted by the most recent claim. The constant default
--     means every existing row reads 0 (a clean "never claimed") and no account's
--     streak changes silently on deploy; SQLite supports adding a column with a
--     constant default in place.
--   `lastDailyClaimedAt`: NULLABLE DATETIME with NO default — NULL until the first
--     claim; the once-per-UTC-calendar-day gate compares it to `now`.
-- Both are purely ADDITIVE (invariant 5): the 13 prior committed migrations stay
-- byte-stable and no released contract breaks (mirrors the mmr/premiumUntil/spawn*
-- additive-column precedents). Claiming (POST /api/daily/claim) advances the streak via
-- the pure advanceStreak() and CREDITS the day's DAILY_REWARDS entry into ResourceBalance
-- with an append-only AuditLog row, all in one $transaction (invariant 3). These two
-- columns are the streak STATE, not the spendable resource itself.
ALTER TABLE "User" ADD COLUMN "dailyStreakDay" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastDailyClaimedAt" DATETIME;
