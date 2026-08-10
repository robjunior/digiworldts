-- Earth skill-pool remake — same shape as 070-075.
--
-- The Rookie→Mega earth pool is re-authored around three design archetypes
-- (Tank / Guardian / Terrain Control), growing from 24 to 36 skills. The old
-- `sk-earth-*` rows are dropped so `seedSkillsCatalogV2()` re-inserts the new
-- set instead of being shadowed by them — the seeder upserts
-- `ON CONFLICT (name) DO NOTHING`, so a stale row would win.
--
-- Unlike 074 (water) and 075 (ice), this wipe fixes no balance defect: earth
-- already resolved cleanly at 0% draws across all four stages. It is a pure
-- archetype rework.
--
-- `upgrade_of` is a self-referencing FK, so any pointer into the doomed rows
-- is nulled before the delete.
--
-- Portable across SQLite and Postgres.
UPDATE skills_catalog SET upgrade_of = NULL WHERE upgrade_of LIKE 'sk-earth-%';
DELETE FROM skills_catalog WHERE id LIKE 'sk-earth-%';
