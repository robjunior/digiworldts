ALTER TABLE skills_catalog ADD COLUMN vfx_preset_id TEXT;
CREATE INDEX IF NOT EXISTS idx_skills_vfx_preset ON skills_catalog(vfx_preset_id);
