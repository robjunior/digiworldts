#!/usr/bin/env node
/**
 * Complete auto-import spike:
 * 1. Auto-create tilesets from data/tileset/ directory
 * 2. Auto-import all TMX maps as dungeons
 * 
 * Usage: ./scripts/import-maps-spike.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.cwd(), 'data', 'tileset');



/**
 * Convert TMX XML format to Tiled JSON map format.
 * TMX is XML-based; Tiled JSON is the format parseTiledJson expects.
 * 
 * This function parses the TMX XML structure and converts it to a JSON object
 * that conforms to the Tiled JSON map format expected by parseTiledJson.
 * 
 * @param {string} tmxXml - The TMX XML string from a .tmx file
 * @returns {object} Tiled JSON map object
 */
function tmxToTiledJson(tmxXml) {
  const getAttr = (name, defaultVal) => {
    const match = tmxXml.match(new RegExp(name + "=\"([^\"]+)\""));
    return match ? match[1] : defaultVal;
  };
  
  const tiledMap = {
    type: "map",
    version: getAttr("version", "1.10") || "1.10",
    tiledversion: getAttr("tiledversion", "1.12.2") || "1.12.2",
    orientation: getAttr("orientation", "orthogonal") || "orthogonal",
    renderorder: getAttr("renderorder", "right-down") || "right-down",
    width: parseInt(getAttr("width", "0")) || 0,
    height: parseInt(getAttr("height", "0")) || 0,
    tilewidth: parseInt(getAttr("tilewidth", "32")) || 32,
    tileheight: parseInt(getAttr("tileheight", "32")) || 32,
    infinite: getAttr("infinite", "0") || "0",
    nextlayerid: parseInt(getAttr("nextlayerid", "1")) || 1,
    nextobjectid: parseInt(getAttr("nextobjectid", "1")) || 1,
    tilesets: [],
    layers: [],
    properties: []
  };
  
  // Extract tilesets
  const tsPattern = /<tileset[^>]*>/g;
  let match;
  let tileIndex = 0;
  while ((match = tsPattern.exec(tmxXml)) !== null) {
    const tsContent = match[0];
    tiledMap.tilesets.push({
      firstgid: parseInt(getAttr("firstgid", "1")) || 1,
      name: getAttr("name", "tileset-" + tileIndex),
      source: getAttr("source", undefined),
      tilewidth: parseInt(getAttr("tilewidth", "32")) || 32,
      tileheight: parseInt(getAttr("tileheight", "32")) || 32,
      spacing: parseInt(getAttr("spacing", "0")) || 0,
      margin: parseInt(getAttr("margin", "0")) || 0,
      columns: parseInt(getAttr("columns", "0")) || 1,
      tilecount: parseInt(getAttr("tilecount", "1")) || 1
    });
    tileIndex++;
  }
  
  // Extract layers - CSV data
  const layerMatches = tmxXml.match(/<layer[^>]*>["\x27\`][\s\S]*?["\x27\`][^>]*>[\s\S]*?<\/layer>/g) || [];
  
  layerMatches.forEach(layer => {
    const name = layer.match(/name=["\x27\`]([^"'\`]+)["\x27\`]/)?.[1] || "unnamed";
    const width = parseInt(layer.match(/width="(\d+)"/)?.[1]) || 0;
    const height = parseInt(layer.match(/height="(\d+)"/)?.[1]) || 0;
    const encoding = layer.match(/encoding="([^"]+)"/)?.[1] || "csv";
    
    let data = [];
    const dataMatch = layer.match(/<data[^>]*>(["\x27\`][\s\S]*?["\x27\`])?<\/data>/);
    if (dataMatch) {
      const content = dataMatch[1] || "";
      if (encoding === "csv") {
        const rows = content.split("\n").filter(row => row.trim());
        for (const row of rows) {
          const cells = row.split(",").map(cell => parseInt(cell.trim()) || 0);
          data = data.concat(cells);
        }
      }
    }
    
    tiledMap.layers.push({
      type: "tilelayer",
      name: name,
      width: width,
      height: height,
      data: data,
      properties: []
    });
  });
  
  return tiledMap;
}
async function main() {
  console.log('🚀 Complete Auto-Import Spike');
  console.log('='.repeat(60));
  
  const dbPhase = await runTilesetImportPhase();
  const mapPhase = await runMapImportPhase();
  
  console.log('='.repeat(60));
  console.log('🏁 IMPORT COMPLETE');
  console.log('='.repeat(60));
  console.log(`  �ilesets created: ${dbPhase.created}`);
  console.log(`  ⚠️  tilesets skipped: ${dbPhase.skipped}`);
  console.log(`  📋 maps imported: ${mapPhase.imported}`);
  console.log(`  ⚠️  maps skipped: ${mapPhase.skipped}`);
  console.log(`  ❌ maps failed: ${mapPhase.failed}`);
}

async function runTilesetImportPhase() {
  console.log('\n📦 Phase 1: Auto-Creating Tilesets');
  console.log('-'.repeat(60));
  
  const { getDb, closeDb } = require('./backend/src/db/index.js');
  const { createTileset, listTilesets } = require('./backend/src/tilesets/repo.js');
  
  await getDb();
  const existing = await listTilesets();
  const existingNames = new Set(existing.map(t => t.name));
  
  // Read all .tsx files recursively
  const tsxFiles = [];
  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { 
      recursive: true, 
      fileTypes: { file: ['.tsx'] } 
    });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      tsxFiles.push(fullPath.replace(process.cwd() + '/', ''));
    }
  }
  await walk(DATA_DIR);
  
  console.log('Found', tsxFiles.length, '.tsx files\n');
  
  let created = 0;
  let skipped = 0;
  
  for (const tsxRef of tsxFiles) {
    const tsxPath = path.join(DATA_DIR, tsxRef);
    if (!fs.existsSync(tsxPath)) continue;
    
    const content = fs.readFileSync(tsxPath, 'utf-8');
    
    // Extract TMX properties
    const firstgidMatch = content.match(/firstgid="(\d+)"/);
    const nameMatch = content.match(/name="([^"]+)"/);
    const tilewidthMatch = content.match(/tilewidth="(\d+)"/);
    const tileheightMatch = content.match(/tileheight="(\d+)"/);
    const tilecountMatch = content.match(/tilecount="(\d+)"/);
    const columnsMatch = content.match(/columns="(\d+)"/);
    const imageMatch = content.match(/image[^>]*?source="([^"]+)"/);
    
    const name = nameMatch ? nameMatch[1] : tsxRef.replace('.tsx', '');
    const firstgid = firstgidMatch ? parseInt(firstgidMatch[1]) : 1;
    const tileWidth = tilewidthMatch ? parseInt(tilewidthMatch[1]) : 16;
    const tileHeight = tileheightMatch ? parseInt(tileheightMatch[1]) : 16;
    const tileCount = tilecountMatch ? parseInt(tilecountMatch[1]) : null;
    const columns = columnsMatch ? parseInt(columnsMatch[1]) : null;
    const imageSource = imageMatch ? imageMatch[1] : null;
    
    if (!name) {
      console.log('⚠️  Skipping', tsxRef, '- no name found');
      skipped++;
      continue;
    }
    
    if (existingNames.has(name)) {
      console.log('⚠️  Skipping (already exists):', name);
      skipped++;
      continue;
    }
    
    // Find image file
    let imageFilename = imageSource;
    let imageWidth = null, imageHeight = null;
    
    if (imageSource) {
      const possiblePaths = [
        path.join(DATA_DIR, imageSource),
        path.join(DATA_DIR, '..', imageSource),
        path.join(DATA_DIR, '..', '..', imageSource),
      ];
      
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          imageFilename = path.basename(p);
          const stats = fs.statSync(p);
          // ASE files might not have width/height in EXIF, use reasonable defaults
          imageWidth = stats.size ? null : 256; // placeholder
          imageHeight = stats.size ? null : 256; // placeholder
          break;
        }
      }
      if (!imageFilename) {
        console.log('⚠️  Image not found for:', name, '- using', imageSource);
      }
    }
    
    // Calculate tile count/columns if not provided
    let calcColumns = columns;
    let calcTileCount = tileCount;
    if (!calcColumns && tileWidth) {
      calcColumns = Math.max(1, Math.floor((imageWidth || 256) / tileWidth));
    }
    if (!calcTileCount && calcColumns && tileWidth && tileHeight) {
      const imgH = imageHeight || tileHeight;
      calcTileCount = calcColumns * Math.max(1, Math.floor(imgH / tileHeight));
    }
    
    console.log('🔧 Creating tileset:', name);
    console.log('   firstgid:', firstgid, '| tileSize:', tileWidth + 'x' + tileHeight);
    console.log('   image:', imageFilename || 'none');
    console.log('   tileCount:', calcTileCount, 'columns:', calcColumns);
    
    try {
      await createTileset({
        name: name,
        imageFilename: imageFilename,
        tileWidth: tileWidth,
        tileHeight: tileHeight,
        imageWidth: imageWidth,
        imageHeight: imageHeight,
        spacing: 0,
        margin: 0,
      });
      created++;
      console.log('  ✅ Created successfully');
    } catch (err) {
      console.log('  ❌ Failed:', err.message.split('\\n')[0]);
    }
    console.log('');
  }
  
  await closeDb();
  
  console.log('='.repeat(50));
  console.log('📊 Tileset Phase Summary:');
  console.log('  ✅ Created:', created);
  console.log('  ⚠️  Skipped (already exist):', skipped);
  console.log('='.repeat(50));
  
  return { created, skipped };
}

async function runMapImportPhase() {
  console.log('\n🏰 Phase 2: Importing TMX Maps as Dungeons');
  console.log('-'.repeat(60));
  
  const { getDb, closeDb } = require('./backend/src/db/index.js');
  const { listDungeons, createDungeon } = require('./backend/src/dungeons/repo.js');
  const { parseTiledJson, tiledMapToImportPayload } = require('./backend/src/dungeons/tiled-import.js');
  
  await getDb();
  
  // List existing dungeons
  const existing = await listDungeons();
  const existingNames = new Set(existing.map(d => d.name));
  console.log('Existing dungeons in DB:', existingNames.size);
  
  // Find all .tmx files
  const tmxFiles = [];
  async function findTmx(dir) {
    const entries = await fs.promises.readdir(dir, { 
      recursive: true, 
      fileTypes: { file: ['.tmx'] } 
    });
    for (const entry of entries) {
      tmxFiles.push(path.join(dir, entry.name).replace(process.cwd() + '/', ''));
    }
  }
  await findTmx(DATA_DIR);
  
  console.log('Found', tmxFiles.length, '.tmx files\n');
  
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const tmxRef of tmxFiles) {
    try {
      const fileName = tmxRef.replace('.tmx', '');
      
      // Skip if dungeon already exists
      if (existingNames.has(fileName)) {
        console.log('⚠️  Skipping (already exists):', fileName);
        skipped++;
        continue;
      }
      
      const tmxPath = path.join(DATA_DIR, tmxRef);
      if (!fs.existsSync(tmxPath)) {
        console.log('❌ File not found:', tmxPath);
        failed++;
        continue;
      }
      
      const content = fs.readFileSync(tmxPath, 'utf-8');
      const tmxStart = content.indexOf('<?xml');
      const tmxEnd = content.lastIndexOf('</map>') + 6;
      
      if (tmxStart === -1 || tmxEnd === 5) {
        console.log('❌ Invalid TMX:', tmxRef);
        failed++;
        continue;
      }
      
      const tmxXml = content.slice(tmxStart, tmxEnd);
      // Convert TMX XML to Tiled JSON format before parsing
      const jsonMap = tmxToTiledJson(tmxXml);
      const parseResult = parseTiledJson(jsonMap);
      
      if (!parseResult.ok) {
        console.log('❌ Parse error for', tmxRef + ':', parseResult.error);
        failed++;
        continue;
      }
      
      const payloadResult = tiledMapToImportPayload(parseResult.data);
      
      if (!payloadResult.ok) {
        console.log('❌ Import error for', tmxRef + ':', payloadResult.error);
        failed++;
        continue;
      }
      
      // Create dungeon
      const biome = payloadResult.payload.biome ?? null;
      const now = Date.now();
      
      await createDungeon({
        name: fileName,
        description: `Auto-imported from ${tmxRef} on ${new Date().toISOString()}`,
        biome: biome,
        width: payloadResult.payload.width,
        height: payloadResult.payload.height,
        spawnX: payloadResult.payload.spawn.x,
        spawnY: payloadResult.payload.spawn.y,
        randomEncountersEnabled: payloadResult.payload.randomSettings.randomEncountersEnabled ?? false,
        randomEncounterRate: payloadResult.payload.randomSettings.randomEncounterRate ?? 0.12,
        randomMinLevel: payloadResult.payload.randomSettings.randomMinLevel ?? 1,
        randomMaxLevel: payloadResult.payload.randomSettings.randomMaxLevel ?? 5,
        randomMaxStage: payloadResult.payload.randomSettings.randomMaxStage ?? 'Rookie',
        randomMinPartySize: payloadResult.payload.randomSettings.randomMinPartySize ?? 1,
        randomMaxPartySize: payloadResult.payload.randomSettings.randomMaxPartySize ?? 1,
        randomAllowedElements: payloadResult.payload.randomSettings.randomAllowedElements ?? null,
        randomPool: [],
        challenge: { kind: 'none' },
        walkableMask: payloadResult.payload.walkableMask,
        dungeonGroupId: null,
        floorIndex: null,
        gridX: null,
        gridY: null,
        createdAt: now,
        updatedAt: now,
      });
      
      imported++;
      console.log('✅ Imported:', fileName);
      console.log('   Tiles:', payloadResult.payload.tiles.length);
      console.log('   Spawn at:', payloadResult.payload.spawn.x, ',', payloadResult.payload.spawn.y);
      console.log('');
      
    } catch (err) {
      console.log('❌ Fatal error for', tmxRef + ':', err.message.split('\\n')[0]);
      failed++;
    }
  }
  
  await closeDb();
  
  console.log('='.repeat(50));
  console.log('📊 Map Import Summary:');
  console.log('  ✅ Imported:', imported);
  console.log('  ⚠️  Skipped (already exist):', skipped);
  console.log('  ❌ Failed:', failed);
  console.log('='.repeat(50));
  
  return { imported, skipped, failed };
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
