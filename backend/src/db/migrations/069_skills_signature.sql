-- Signature skills.
--
-- A signature is a Digimon's own famous attack (2 per template, pulled from
-- its wikimon technique list). Unlike the element pool — which any mon of that
-- element can learn — a signature is gated to `owner_template_id` and is
-- surfaced in a dedicated field in the frontend, separate from the pool.
--
-- `signature` doubles as a cheap filter flag: pool queries exclude
-- `signature = 1` so the generic element pool is unchanged for every mon that
-- does not own the skill.
--
-- Portable across SQLite and Postgres (pure `ADD COLUMN` + `CREATE INDEX`).
ALTER TABLE skills_catalog ADD COLUMN signature INTEGER NOT NULL DEFAULT 0 CHECK (signature IN (0, 1));
ALTER TABLE skills_catalog ADD COLUMN owner_template_id TEXT;

CREATE INDEX IF NOT EXISTS idx_skills_signature ON skills_catalog(signature);
CREATE INDEX IF NOT EXISTS idx_skills_owner_template ON skills_catalog(owner_template_id);
