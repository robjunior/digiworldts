/**
 * Content tables shared between the seed-export CLI (dump) and the
 * content-deploy CLI (apply/rollback/diff).
 *
 * Each entry lists the table's PRIMARY KEY columns — used for deterministic
 * ORDER BY on export and as the diff/merge key on deploy.
 */
export const CONTENT_TABLES: ReadonlyArray<{ name: string; orderBy: readonly string[] }> = [
  { name: 'quests', orderBy: ['id'] },
  { name: 'world_objects', orderBy: ['id'] },
  { name: 'dialogue_definitions', orderBy: ['dialogue_id'] },
  { name: 'npcs', orderBy: ['id'] },
  { name: 'dungeons', orderBy: ['id'] },
  { name: 'dungeon_tiles', orderBy: ['dungeon_id', 'x', 'y', 'layer_kind'] },
  { name: 'dungeon_encounters', orderBy: ['id'] },
  { name: 'dungeon_doors', orderBy: ['id'] },
  { name: 'dungeon_warps', orderBy: ['id'] },
  { name: 'dungeon_traps', orderBy: ['id'] },
  { name: 'dungeon_chests', orderBy: ['id'] },
  { name: 'dungeon_zones', orderBy: ['id'] },
  { name: 'dungeon_keys', orderBy: ['id'] },
  { name: 'dungeon_kits', orderBy: ['id'] },
  { name: 'dungeon_kit_items', orderBy: ['kit_id', 'item_id'] },
  { name: 'dungeon_rarity_tables', orderBy: ['id'] },
  { name: 'dungeon_tilesets', orderBy: ['dungeon_id', 'tileset_id'] },
  { name: 'dungeon_items', orderBy: ['id'] },
  { name: 'dungeon_triggers', orderBy: ['id'] },
  { name: 'dungeon_trigger_targets', orderBy: ['id'] },
  { name: 'tilesets', orderBy: ['id'] },
  { name: 'shop_items', orderBy: ['id'] },
  { name: 'shop_bundles', orderBy: ['id'] },
  { name: 'shop_bundle_items', orderBy: ['bundle_id', 'item_id'] },
  { name: 'onboarding_config', orderBy: ['id'] },
  { name: 'onboarding_teams', orderBy: ['id'] },
  { name: 'game_settings', orderBy: ['id'] },
  { name: 'skills_catalog', orderBy: ['id'] },
  { name: 'building_blueprints', orderBy: ['id'] },
  { name: 'farm_recipes', orderBy: ['id'] },
  { name: 'adventures', orderBy: ['id'] },
  { name: 'catalog_loot_entries', orderBy: ['id'] },
  { name: 'seasons', orderBy: ['id'] },
] as const;
