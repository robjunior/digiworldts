-- Ice skill-pool remake — same shape as 070-074.
--
-- The Rookie→Mega ice pool is re-authored around three design archetypes
-- (Controller / Lockdown / Debuffer), growing from 24 to 36 skills. The old
-- `sk-ice-*` rows are dropped so `seedSkillsCatalogV2()` re-inserts the new set
-- instead of being shadowed by them — the seeder upserts
-- `ON CONFLICT (name) DO NOTHING`, so a stale row would win.
--
-- This wipe also retires the pre-existing Ultimate grind: four of the six old
-- Ultimate skills applied `freeze` to `enemy_all`, two granted party-wide
-- `invulnerable`, and a third stacked 30% damage reduction — the simulator
-- resolved that tier at 81 turns against 14-38 for every reworked element.
--
-- `upgrade_of` is a self-referencing FK, so any pointer into the doomed rows
-- is nulled before the delete.
--
-- Portable across SQLite and Postgres.
UPDATE skills_catalog SET upgrade_of = NULL WHERE upgrade_of LIKE 'sk-ice-%';
DELETE FROM skills_catalog WHERE id LIKE 'sk-ice-%';
