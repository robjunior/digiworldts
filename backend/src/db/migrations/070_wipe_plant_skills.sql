-- Plant skill-pool remake.
--
-- The Rookie→Mega plant pool is re-authored from scratch around three design
-- archetypes (DoT / Healer / Zone Control), growing from 24 to 36 skills. The
-- old `sk-plant-*` rows are dropped so `seedSkillsCatalogV2()` re-inserts the
-- new set cleanly instead of colliding on the `name` unique constraint.
--
-- Anything still referencing a dropped row via `upgrade_of` is nulled first so
-- the self-referencing FK cannot block the delete.
--
-- Portable across SQLite and Postgres.
UPDATE skills_catalog SET upgrade_of = NULL WHERE upgrade_of LIKE 'sk-plant-%';
DELETE FROM skills_catalog WHERE id LIKE 'sk-plant-%';
