-- AlterTable
-- TASK-34 (R-14): add the additive `role` authorization-tier column to User — the
-- FIRST tier beyond bare "authenticated" ("user" | "admin"). A defaulted ('user')
-- NOT NULL column, so every existing row reads 'user' and no account silently gains
-- privilege; the 7 prior committed migrations stay byte-stable and no released
-- contract breaks (invariant 5). SQLite supports adding a column with a constant
-- default in place. The first admin is bootstrapped from config (ADMIN_EMAILS) on
-- register/login, never by hand-editing this column.
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
