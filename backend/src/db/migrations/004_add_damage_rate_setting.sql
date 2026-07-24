-- Add `damage_rate` to game_settings — an admin-tunable global multiplier
-- applied to every damage roll in the combat engine. Same shape / policy as
-- `xp_rate`: NOT NULL, default 1.0, CHECK (> 0). Fresh installs get the
-- column via this migration (schema.sql keeps the baseline unchanged — the
-- migration is the authoritative delta for post-launch schema evolution).
--
-- Portable across SQLite and Postgres. Both dialects accept
-- `DOUBLE PRECISION` (Postgres float8; SQLite treats it as REAL affinity).
ALTER TABLE game_settings
  ADD COLUMN damage_rate DOUBLE PRECISION NOT NULL DEFAULT 1.0 CHECK (damage_rate > 0);
