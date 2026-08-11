-- Wind skill-pool remake — same shape as 070-077.
--
-- The Rookie→Mega wind pool is re-authored around three design archetypes,
-- growing from 24 to 36 skills. The old `sk-wind-*` rows are dropped so
-- `seedSkillsCatalogV2()` re-inserts the new set instead of being shadowed by
-- them — the seeder upserts `ON CONFLICT (name) DO NOTHING`, so a stale row
-- would win.
--
-- `upgrade_of` is a self-referencing FK, so any pointer into the doomed rows
-- is nulled before the delete.
--
-- Portable across SQLite and Postgres.
UPDATE skills_catalog SET upgrade_of = NULL WHERE upgrade_of LIKE 'sk-wind-%';
DELETE FROM skills_catalog WHERE id LIKE 'sk-wind-%';
