-- Electricity skill-pool remake — same shape as 070 (plant), 071 (dark), 072 (light).
--
-- The Rookie→Mega electricity pool is re-authored around three design
-- archetypes (Combo / Chain / Stun), growing from 24 to 36 skills. The old
-- `sk-elec-*` rows are dropped so `seedSkillsCatalogV2()` re-inserts the new
-- set instead of being shadowed by them — the seeder upserts
-- `ON CONFLICT (name) DO NOTHING`, so a stale row would win.
--
-- Note the id prefix is `sk-elec-`, not `sk-electricity-`: the seed factory is
-- built with `makeSkillFactory('electricity', 'elec')`.
--
-- `upgrade_of` is a self-referencing FK, so any pointer into the doomed rows
-- is nulled before the delete.
--
-- Portable across SQLite and Postgres.
UPDATE skills_catalog SET upgrade_of = NULL WHERE upgrade_of LIKE 'sk-elec-%';
DELETE FROM skills_catalog WHERE id LIKE 'sk-elec-%';
