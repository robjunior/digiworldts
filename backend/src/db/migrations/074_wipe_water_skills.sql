-- Water skill-pool remake — same shape as 070 (plant), 071 (dark), 072 (light),
-- 073 (electricity).
--
-- The Rookie→Mega water pool is re-authored around three design archetypes
-- (Controller / Displacer / Sustain), growing from 24 to 36 skills. The old
-- `sk-water-*` rows are dropped so `seedSkillsCatalogV2()` re-inserts the new
-- set instead of being shadowed by them — the seeder upserts
-- `ON CONFLICT (name) DO NOTHING`, so a stale row would win.
--
-- This wipe also retires the pre-existing Champion stall: the old Champion tier
-- shipped three healing skills against one real AoE damage skill, plus a 60%
-- blind on every enemy, which the simulator resolved at ~31% draws over ~339
-- turns. The replacement pool budgets sustain against damage explicitly.
--
-- `upgrade_of` is a self-referencing FK, so any pointer into the doomed rows
-- is nulled before the delete.
--
-- Portable across SQLite and Postgres.
UPDATE skills_catalog SET upgrade_of = NULL WHERE upgrade_of LIKE 'sk-water-%';
DELETE FROM skills_catalog WHERE id LIKE 'sk-water-%';
