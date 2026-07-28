-- P5 Day 10: per-user locale preference for cross-device UI sync.
--
-- Values: 'en' or 'pt', or NULL for "let the client detect from
-- navigator.language". Portable across SQLite + Postgres (ADD COLUMN
-- with a nullable TEXT is a no-op default in both dialects).
ALTER TABLE users ADD COLUMN locale_pref TEXT;
