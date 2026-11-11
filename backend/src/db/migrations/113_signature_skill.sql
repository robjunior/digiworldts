-- Signature skill selection.
--
-- The single active signature per roster mon. A signature is a Digimon's own
-- exclusive skill (signature=1 AND owner_template_id). Exactly ONE may be
-- selected at a time; NULL means "no signature selected". The selection is
-- validated against the digimon's element archetypes (see skills/archetypes.ts).
--
-- Cleared on evolution (the new form owns a different set of signatures, so
-- the identity must be re-picked). Portable across SQLite and Postgres.
ALTER TABLE player_roster ADD COLUMN signature_skill_id TEXT;