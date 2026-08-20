/**
 * Cross-domain xref integrity test — validates that the xref validator catches
 * all classes of broken cross-domain references.
 *
 * This test is complementary to the lifecycle test — it focuses specifically
 * on the validator's ability to catch each class of broken ref.
 *
 * Run: pnpm --filter @digiworld/backend test:xref-integrity
 *   (requires DB_PATH pointing at a scratch file, e.g. /tmp/dw-xref-test.db)
 */
import { unlinkSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { SqliteAdapter } from '../src/db/sqlite.ts';
import { closeDbAdapter, getDb } from '../src/db/index.ts';
import { validateXref } from '../src/content-deploy/versions.ts';
import { loadCatalog } from '../src/digimon/xml.ts';
import { config } from '../src/config.ts';
import { seedDefaultQuests } from '../src/quests/seed.ts';
import { seedInitialNpcs } from '../src/npcs/seed.ts';
import { syncDialogueFolder } from '../src/dialogues/sync.ts';
import { seedShopItems } from '../src/social/shop.ts';

const DB_PATH = process.env.DB_PATH!;

function cleanupDb(): void {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
}

function cleanupSeedDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function seedBaselineContent(): Promise<void> {
  const adapter = await SqliteAdapter.create();
  await seedDefaultQuests(adapter);
  await seedInitialNpcs(adapter);
  await syncDialogueFolder();
  await seedShopItems();
  await adapter.close();
  console.log('  Baseline content seeded');
}

async function exportSeedArtifact(outDir: string): Promise<string> {
  // Simplified export for testing — just the tables
  const adapter = await SqliteAdapter.create();
  const tables: Record<string, Record<string, unknown>[]> = {};
  
  // Import CONTENT_TABLES dynamically
  const { CONTENT_TABLES } = await import('../src/seed-export/content-tables.ts');
  
  for (const t of CONTENT_TABLES) {
    const rows = await adapter.query<Record<string, unknown>>(`SELECT * FROM ${t.name}`);
    tables[t.name] = rows;
  }
  
  await adapter.close();
  
  const envelope = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    source: 'test',
    skippedMissingTables: [],
    tables,
    assetManifest: [],
  };
  
  const seedPath = resolve(outDir, 'seed.json');
  writeFileSync(seedPath, JSON.stringify(envelope, null, 2));
  
  return seedPath;
}

// ============================================================================
// TEST SUITES
// ============================================================================

async function runQuestXrefTests(): Promise<void> {
  console.log('\n=== Quest Xref Tests ===');
  
  // Test 1: Quest talk objective → npc
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [{ id: 'qst_test', name: 'Test', description: '', requiredLevel: 1, data: JSON.stringify({ objectives: [{ kind: 'talk', npcId: 'npc_missing', text: 'Talk' }], steps: [], finalReward: { items: [], pickCount: 0 }, unlocksQuestIds: [] }), createdAt: Date.now(), updatedAt: Date.now(), status: 'draft' }],
        npcs: [],
        dialogue_definitions: [],
        shop_items: [],
        dungeons: [],
        dungeon_tiles: [],
        dungeon_encounters: [],
        dungeon_doors: [],
        dungeon_warps: [],
        dungeon_traps: [],
        dungeon_chests: [],
        dungeon_zones: [],
        dungeon_keys: [],
        dungeon_kits: [],
        dungeon_kit_items: [],
        dungeon_rarity_tables: [],
        dungeon_tilesets: [],
        dungeon_items: [],
        dungeon_triggers: [],
        dungeon_trigger_targets: [],
        tilesets: [],
        shop_items: [],
        shop_bundles: [],
        shop_bundle_items: [],
        onboarding_config: [],
        onboarding_teams: [],
        game_settings: [],
        skills_catalog: [],
        building_blueprints: [],
        farm_recipes: [],
        adventures: [],
        catalog_loot_entries: [],
        seasons: [],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Quest talk objective → missing npc fails', issues.some(i => i.domain === 'quests' && i.message.includes('npc_missing')));
    await adapter.close();
  }
  
  // Quest collect objective → item
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [{ id: 'qst_test', name: 'Test', description: '', requiredLevel: 1, data: JSON.stringify({ objectives: [{ kind: 'collect', itemId: 'itm_missing', qty: 1, text: 'Collect' }], steps: [], finalReward: { items: [], pickCount: 0 }, unlocksQuestIds: [] }), createdAt: Date.now(), updatedAt: Date.now(), status: 'draft' }],
        shop_items: [{ id: 'itm_existing', name: 'Existing', description: '', priceCredits: 10, price: 10, currency: 'credits', kind: 'consumable', class: 'item', payload: {}, enabled: true, isQuestItem: false, rarity: 'common', itemType: 'consumable', kitClass: null, kitMaxQty: null, status: 'draft', createdAt: Date.now() }],
        npcs: [],
        dialogue_definitions: [],
        // ... other tables empty
        dungeons: [], dungeon_tiles: [], dungeon_encounters: [], dungeon_doors: [], dungeon_warps: [], dungeon_traps: [], dungeon_chests: [], dungeon_zones: [], dungeon_keys: [], dungeon_kits: [], dungeon_kit_items: [], dungeon_rarity_tables: [], dungeon_tilesets: [], dungeon_items: [], dungeon_triggers: [], dungeon_trigger_targets: [], tilesets: [], shop_items: [{ id: 'itm_existing', name: 'Existing', description: '', priceCredits: 10, price: 10, currency: 'credits', kind: 'consumable', class: 'item', payload: {}, enabled: true, isQuestItem: false, rarity: 'common', itemType: 'consumable', kitClass: null, kitMaxQty: null, status: 'draft', createdAt: Date.now() }], shop_bundles: [], shop_bundle_items: [], onboarding_config: [], onboarding_teams: [], game_settings: [], skills_catalog: [], building_blueprints: [], farm_recipes: [], adventures: [], catalog_loot_entries: [], seasons: [],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Quest collect objective → missing item fails', issues.some(i => i.domain === 'quests' && i.message.includes('itm_missing')));
    await adapter.close();
  }
  
  // Quest loot step -> item
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [
          {
            id: 'qst_test',
            name: 'Test',
            description: '',
            requiredLevel: 1,
            data: JSON.stringify({
              objectives: [],
              steps: [{ type: 'loot', pool: { items: [{ itemId: 'itm_missing' }], pickCount: 1 } }],
              finalReward: { items: [], pickCount: 0 },
              unlocksQuestIds: [],
            }),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'draft',
          },
        ],
        shop_items: [
          {
            id: 'itm_existing',
            name: 'Existing',
            description: '',
            priceCredits: 10,
            price: 10,
            currency: 'credits',
            kind: 'consumable',
            class: 'item',
            payload: {},
            enabled: true,
            isQuestItem: false,
            rarity: 'common',
            itemType: 'consumable',
            kitClass: null,
            kitMaxQty: null,
            status: 'draft',
            createdAt: Date.now(),
          },
        ],
        npcs: [],
        dialogue_definitions: [],
        dungeons: [],
        dungeon_tiles: [],
        dungeon_encounters: [],
        dungeon_doors: [],
        dungeon_warps: [],
        dungeon_traps: [],
        dungeon_chests: [],
        dungeon_zones: [],
        dungeon_keys: [],
        dungeon_kits: [],
        dungeon_kit_items: [],
        dungeon_rarity_tables: [],
        dungeon_tilesets: [],
        dungeon_items: [],
        dungeon_triggers: [],
        dungeon_trigger_targets: [],
        tilesets: [],
        shop_items: [
          {
            id: 'itm_existing',
            name: 'Existing',
            description: '',
            priceCredits: 10,
            price: 10,
            currency: 'credits',
            kind: 'consumable',
            class: 'item',
            payload: {},
            enabled: true,
            isQuestItem: false,
            rarity: 'common',
            itemType: 'consumable',
            kitClass: null,
            kitMaxQty: null,
            status: 'draft',
            createdAt: Date.now(),
          },
        ],
        shop_bundles: [],
        shop_bundle_items: [],
        onboarding_config: [],
        onboarding_teams: [],
        game_settings: [],
        skills_catalog: [],
        building_blueprints: [],
        farm_recipes: [],
        adventures: [],
        catalog_loot_entries: [],
        seasons: [],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Quest loot step -> missing item fails', issues.some(i => i.domain === 'quests' && i.message.includes('itm_missing')));
    await adapter.close();
  }
}

async function runDialogueXrefTests(): Promise<void> {
  console.log('\n=== Dialogue Xref Tests ===');
  
  // Dialogue → npc (speaker)
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [],
        npcs: [{ id: 'npc_existing', displayName: 'Existing', expressions: JSON.stringify([{ key: 'neutral' }]), status: 'draft', createdAt: Date.now(), updatedAt: Date.now() }],
        dialogue_definitions: [{ dialogue_id: 'dlg_test', title: 'Test', startNodeId: 'start', ir_json: JSON.stringify({ nodes: { start: { speaker: { npcId: 'npc_missing', expression: 'neutral' }, text: 'Hello', choices: [], entryActions: [], jumps: [] } } }), sourcePath: null, sourceTwee: '', status: 'draft', createdAt: Date.now(), updatedAt: Date.now() }],
        shop_items: [],
        npcs: [{ id: 'npc_existing', displayName: 'Existing', expressions: JSON.stringify([{ key: 'neutral' }]), status: 'draft', createdAt: Date.now(), updatedAt: Date.now() }],
        // empty tables
        dungeons: [], dungeon_tiles: [], dungeon_encounters: [], dungeon_doors: [], dungeon_warps: [], dungeon_traps: [], dungeon_chests: [], dungeon_zones: [], dungeon_keys: [], dungeon_kits: [], dungeon_kit_items: [], dungeon_rarity_tables: [], dungeon_tilesets: [], dungeon_items: [], dungeon_triggers: [], dungeon_trigger_targets: [], tilesets: [], shop_items: [], shop_bundles: [], shop_bundle_items: [], onboarding_config: [], onboarding_teams: [], game_settings: [], skills_catalog: [], building_blueprints: [], farm_recipes: [], adventures: [], catalog_loot_entries: [], seasons: [],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Dialogue → missing npc fails', issues.some(i => i.domain === 'dialogue_definitions' && i.message.includes('npc_missing')));
    await adapter.close();
  }
  
  // Dialogue → item (give_item)
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [],
        npcs: [{ id: 'npc_existing', displayName: 'Existing', expressions: JSON.stringify([{ key: 'neutral' }]), status: 'draft', createdAt: Date.now(), updatedAt: Date.now() }],
        dialogue_definitions: [{ dialogue_id: 'dlg_test', title: 'Test', startNodeId: 'start', ir_json: JSON.stringify({ nodes: { start: { speaker: { npcId: 'npc_existing', expression: 'neutral' }, text: 'Here', choices: [{ id: 'c1', text: 'Take', target: 'end' }], entryActions: [{ name: 'give_item', args: [{ kind: 'literal', value: 'itm_missing' }] }] } } }), sourcePath: null, sourceTwee: '', status: 'draft', createdAt: Date.now(), updatedAt: Date.now() }],
        shop_items: [{ id: 'itm_existing', name: 'Existing', description: '', priceCredits: 10, price: 10, currency: 'credits', kind: 'consumable', class: 'item', payload: {}, enabled: true, isQuestItem: false, rarity: 'common', itemType: 'consumable', kitClass: null, kitMaxQty: null, status: 'draft', createdAt: Date.now() }],
        // empty tables
        dungeons: [], dungeon_tiles: [], dungeon_encounters: [], dungeon_doors: [], dungeon_warps: [], dungeon_traps: [], dungeon_chests: [], dungeon_zones: [], dungeon_keys: [], dungeon_kits: [], dungeon_kit_items: [], dungeon_rarity_tables: [], dungeon_tilesets: [], dungeon_items: [], dungeon_triggers: [], dungeon_trigger_targets: [], tilesets: [], shop_items: [{ id: 'itm_existing', name: 'Existing', description: '', priceCredits: 10, price: 10, currency: 'credits', kind: 'consumable', class: 'item', payload: {}, enabled: true, isQuestItem: false, rarity: 'common', itemType: 'consumable', kitClass: null, kitMaxQty: null, status: 'draft', createdAt: Date.now() }], shop_bundles: [], shop_bundle_items: [], onboarding_config: [], onboarding_teams: [], game_settings: [], skills_catalog: [], building_blueprints: [], farm_recipes: [], adventures: [], catalog_loot_entries: [], seasons: [],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Dialogue give_item → missing item fails', issues.some(i => i.domain === 'dialogue_definitions' && i.message.includes('itm_missing')));
    await adapter.close();
  }
}

async function runShopXrefTests(): Promise<void> {
  console.log('\n=== Shop Xref Tests ===');
  
  // Shop bundle items → bundle + item
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [], npcs: [], dialogue_definitions: [],
        shop_items: [{ id: 'itm_existing', name: 'Existing', description: '', priceCredits: 10, price: 10, currency: 'credits', kind: 'consumable', class: 'item', payload: {}, enabled: true, isQuestItem: false, rarity: 'common', itemType: 'consumable', kitClass: null, kitMaxQty: null, status: 'draft', createdAt: Date.now() }],
        shop_bundles: [{ id: 'bundle_test', name: 'Test Bundle', description: '', currency: 'credits', discountPct: 0, shopCategory: 'bundle', sortOrder: 0, featured: false, quickOffer: false, enabled: true, createdAt: Date.now(), updatedAt: Date.now() }],
        shop_bundle_items: [{ bundle_id: 'bundle_missing', item_id: 'itm_existing', qty: 1, sortOrder: 0 }, { bundle_id: 'bundle_test', item_id: 'itm_missing', qty: 1, sortOrder: 0 }],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Shop bundle item → missing bundle fails', issues.some(i => i.domain === 'shop_bundle_items' && i.message.includes('bundle_missing')));
    check('Shop bundle item → missing item fails', issues.some(i => i.domain === 'shop_bundle_items' && i.message.includes('itm_missing')));
    await adapter.close();
  }
}

async function runDungeonXrefTests(): Promise<void> {
  console.log('\n=== Dungeon Xref Tests ===');
  
  // dungeon_encounters digimon_data → digimon catalog
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [], npcs: [], dialogue_definitions: [], shop_items: [],
        dungeons: [{ id: 'dng_test', world_object_id: null, quest_id: null, name: 'Test', description: '', biome: 'null', width: 10, height: 10, spawn_x: 0, spawn_y: 0, random_encounters_enabled: 1, random_min_level: 1, random_max_level: 5, random_max_stage: 'Rookie', random_min_party_size: 1, random_max_party_size: 1, random_allowed_elements: null, created_at: Date.now(), updated_at: Date.now() }],
        dungeon_encounters: [{ id: 'enc_test', dungeon_id: 'dng_test', x: 1, y: 1, label: 'Test', difficulty: 'normal', digimon_data: JSON.stringify([{ catalogId: 'skb_missing', level: 1 }]), loots: JSON.stringify([]), scene_id: null, created_at: Date.now(), updated_at: Date.now() }],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const catalog = loadCatalog();
    const digimonIds = new Set(catalog.digimons.map(d => d.id));
    const digimonContext = { ids: digimonIds };
    const issues = validateXref({ tables: seed.tables }, digimonContext);
    check('Dungeon encounter digimon_data → missing digimon fails', issues.some(i => i.domain === 'dungeon_encounters' && i.message.includes('skb_missing')));
    await adapter.close();
  }
  
  // dungeon_items → shop_items
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [], npcs: [], dialogue_definitions: [], shop_items: [{ id: 'itm_existing', name: 'Existing', description: '', priceCredits: 10, price: 10, currency: 'credits', kind: 'consumable', class: 'item', payload: {}, enabled: true, isQuestItem: false, rarity: 'common', itemType: 'consumable', kitClass: null, kitMaxQty: null, status: 'draft', createdAt: Date.now() }],
        dungeons: [{ id: 'dng_test', world_object_id: null, quest_id: null, name: 'Test', description: '', biome: 'null', width: 10, height: 10, spawn_x: 0, spawn_y: 0, random_encounters_enabled: 1, random_min_level: 1, random_max_level: 5, random_max_stage: 'Rookie', random_min_party_size: 1, random_max_party_size: 1, random_allowed_elements: null, created_at: Date.now(), updated_at: Date.now() }],
        dungeon_items: [{ id: 'ditm_test', dungeon_id: 'dng_test', x: 1, y: 1, item_id: 'itm_missing', qty: 1, created_at: Date.now() }],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Dungeon item → missing item fails', issues.some(i => i.domain === 'dungeon_items' && i.message.includes('itm_missing')));
    await adapter.close();
  }
  
  // dungeon_doors → shop_items (key_item_id)
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [], npcs: [], dialogue_definitions: [], shop_items: [{ id: 'itm_existing', name: 'Existing', description: '', priceCredits: 10, price: 10, currency: 'credits', kind: 'consumable', class: 'item', payload: {}, enabled: true, isQuestItem: false, rarity: 'common', itemType: 'consumable', kitClass: null, kitMaxQty: null, status: 'draft', createdAt: Date.now() }],
        dungeons: [{ id: 'dng_test', world_object_id: null, quest_id: null, name: 'Test', description: '', biome: 'null', width: 10, height: 10, spawn_x: 0, spawn_y: 0, random_encounters_enabled: 1, random_min_level: 1, random_max_level: 5, random_max_stage: 'Rookie', random_min_party_size: 1, random_max_party_size: 1, random_allowed_elements: null, created_at: Date.now(), updated_at: Date.now() }],
        dungeon_doors: [{ id: 'door_test', dungeon_id: 'dng_test', x: 1, y: 1, key_item_id: 'itm_missing', label: 'Locked', created_at: Date.now(), updated_at: Date.now() }],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('Dungeon door key_item_id → missing item fails', issues.some(i => i.domain === 'dungeon_doors' && i.message.includes('itm_missing')));
    await adapter.close();
  }
}

async function runWorldObjectXrefTests(): Promise<void> {
  console.log('\n=== World Object Xref Tests ===');
  
  // world_objects → quests
  {
    const seed = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      source: 'test',
      skippedMissingTables: [],
      tables: {
        quests: [],
        world_objects: [{ id: 'wo_test', x: 1, y: 2, lat: 0, lon: 0, kind: 'tower', scale: 1, tint: null, quest_id: 'qst_missing', dungeon_id: null, passable: 0, label: 'Test', created_at: Date.now(), updated_at: Date.now() }],
        quests: [],
        // empty
        npcs: [], dialogue_definitions: [], shop_items: [], dungeons: [], dungeon_tiles: [], dungeon_encounters: [], dungeon_doors: [], dungeon_warps: [], dungeon_traps: [], dungeon_chests: [], dungeon_zones: [], dungeon_keys: [], dungeon_kits: [], dungeon_kit_items: [], dungeon_rarity_tables: [], dungeon_tilesets: [], dungeon_items: [], dungeon_doors: [], dungeon_warps: [], dungeon_traps: [], dungeon_chests: [], dungeon_zones: [], dungeon_keys: [], dungeon_kits: [], dungeon_kit_items: [], dungeon_rarity_tables: [], dungeon_tilesets: [], dungeon_items: [], dungeon_doors: [], dungeon_warps: [], dungeon_traps: [], dungeon_chests: [], dungeon_triggers: [], dungeon_trigger_targets: [], tilesets: [], shop_items: [], shop_bundles: [], shop_bundle_items: [], onboarding_config: [], onboarding_teams: [], game_settings: [], skills_catalog: [], building_blueprints: [], farm_recipes: [], adventures: [], catalog_loot_entries: [], seasons: [],
      },
      assetManifest: [],
    };
    
    const adapter = await SqliteAdapter.create();
    const issues = validateXref({ tables: seed.tables });
    check('World object quest_id → missing quest fails', issues.some(i => i.domain === 'world_objects' && i.message.includes('qst_missing')));
    await adapter.close();
  }
}

async function runCleanArtifactPasses(): Promise<void> {
  console.log('\n=== Clean Artifact Passes ===');
  
  // Clean up and re-seed
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
  
  const adapter = await SqliteAdapter.create();
  await seedDefaultQuests(adapter);
  await seedInitialNpcs(adapter);
  await syncDialogueFolder();
  await seedShopItems();
  await adapter.close();
  
  const seedDir = resolve('/tmp', `dw-clean-${Date.now()}`);
  cleanupSeedDir(seedDir);
  mkdirSync(seedDir, { recursive: true });
  
  const seedPath = await exportSeedArtifact(seedDir);
  
  const adapter2 = await SqliteAdapter.create();
  const seedData = JSON.parse(readFileSync(seedPath, 'utf8'));
  const issues = validateXref({ tables: seedData.tables });
  
  check('Clean artifact from seeded DB passes xref validation', issues.length === 0, `Got ${issues.length} issues: ${issues.map(i => i.message).join(', ')}`);
  
  await adapter2.close();
  cleanupSeedDir(seedDir);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  cleanupDb();
  
  console.log('=== Cross-domain Xref Integrity Test ===');
  console.log(`DB_PATH: ${DB_PATH}`);
  
  try {
    await runQuestXrefTests();
    await runDialogueXrefTests();
    await runShopXrefTests();
    await runDungeonXrefTests();
    await runWorldObjectXrefTests();
    await runCleanArtifactPasses();
  } catch (err) {
    console.error('TEST ERROR:', err instanceof Error ? err.message : String(err));
    failed++;
  } finally {
    cleanupDb();
  }
  
  console.log(`\n=== SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main();