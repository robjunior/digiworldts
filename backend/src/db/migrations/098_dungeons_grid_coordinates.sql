-- Continuous dungeon grid coordinates.
-- Coordinates are opt-in and scoped to dungeon_group_id. Legacy dungeons
-- remain outside a grid until an admin assigns both values.
ALTER TABLE dungeons ADD COLUMN grid_x INTEGER;
ALTER TABLE dungeons ADD COLUMN grid_y INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeons_group_grid_position
  ON dungeons(dungeon_group_id, grid_x, grid_y)
  WHERE dungeon_group_id IS NOT NULL AND grid_x IS NOT NULL AND grid_y IS NOT NULL;
