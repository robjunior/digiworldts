/**
 * Content tables shared between the seed-export CLI (dump) and the
 * content-deploy CLI (apply/rollback/diff).
 *
 * Each entry lists the table's IDENTITY columns — the row's primary key,
 * or a stable unique natural key when the PK is a volatile surrogate.
 * Used for deterministic ORDER BY on export, as the diff/merge key, the
 * ON CONFLICT target on deploy, and the version-ledger ref_id.
 *
 * NOTE on natural keys: `onboarding_teams` keys on `slug` and
 * `building_blueprints` keys on `name`, NOT their `id`. Both tables mint
 * ids with `newId(...)` at seeding time, so every environment that seeds
 * independently (dev DB, staging DB, fresh CI sqlite) ends up with DIFFERENT
 * random ids for the same logical row — an id-keyed upsert then trips the
 * unique natural-key constraint the first time a bundle reaches a DB that
 * already has the row under another id. The natural key (`slug` / `name`)
 * is the only identity stable across environments, so it is the deploy key.
 */
export const CONTENT_TABLES: ReadonlyArray<{ name: string; orderBy: readonly string[] }> = [
  { name: 'quests', orderBy: ['id'] },
  { name: 'dungeons', orderBy: ['id'] },
  { name: 'world_objects', orderBy: ['id'] },
  { name: 'dialogue_definitions', orderBy: ['dialogue_id'] },
  { name: 'npcs', orderBy: ['id'] },
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
  { name: 'onboarding_teams', orderBy: ['slug'] },
  { name: 'game_settings', orderBy: ['id'] },
  { name: 'skills_catalog', orderBy: ['id'] },
  { name: 'building_blueprints', orderBy: ['name'] },
  { name: 'farm_recipes', orderBy: ['id'] },
  { name: 'adventures', orderBy: ['id'] },
  { name: 'catalog_loot_entries', orderBy: ['id'] },
  { name: 'seasons', orderBy: ['id'] },
] as const;
