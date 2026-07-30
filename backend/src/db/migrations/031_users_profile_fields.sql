-- 031_users_profile_fields.sql
--
-- Signup form now collects the payer's real name and email up front. These
-- power the MercadoPago PIX flow (payer.first_name / payer.last_name /
-- payer.email in `/buy`) and future account recovery / receipts.
--
-- All three columns are nullable so the migration is a no-op on rows that
-- pre-date the new form. New registrations MUST provide them (Zod-enforced
-- in `backend/src/auth/routes.ts::RegisterSchema`).
--
-- Portable across SQLite and Postgres — plain `ADD COLUMN <name> TEXT`
-- works on both. No default (NULL) so existing users are untouched.
ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
