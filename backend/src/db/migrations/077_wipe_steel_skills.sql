-- Steel (Metal) skill-pool remake — same shape as 070-076.
--
-- The Rookie→Mega steel pool is re-authored around three design archetypes
-- (Tank / Counter / Fortress), growing from 24 to 36 skills. The old
-- `sk-steel-*` rows are dropped so `seedSkillsCatalogV2()` re-inserts the new
-- set instead of being shadowed by them — the seeder upserts
-- `ON CONFLICT (name) DO NOTHING`, so a stale row would win.
--
-- This wipe also retires two defects the old pool shipped: party-wide
-- mitigation stacking that dragged Champion/Ultimate/Mega to 34-38 turns, and
-- eight uses of the `schedule` action, whose delay the runtime ignores.
--
-- `upgrade_of` is a self-referencing FK, so any pointer into the doomed rows
-- is nulled before the delete.
--
-- Portable across SQLite and Postgres.
UPDATE skills_catalog SET upgrade_of = NULL WHERE upgrade_of LIKE 'sk-steel-%';
DELETE FROM skills_catalog WHERE id LIKE 'sk-steel-%';
