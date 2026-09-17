-- Adventure fuel swap: expeditions now burn the Meat resource instead of
-- the itm-provision inventory item. Rename the spent column to match.
ALTER TABLE adventures RENAME COLUMN provisions_spent TO meat_spent;