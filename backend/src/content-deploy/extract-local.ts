/**
 * One-off extractor: dump content tables from an EXISTING local SQLite DB
 * into the canonical seed envelope — WITHOUT running migrations (the dev DB
 * on this machine is in a half-migrated state, so db:init aborts).
 *
 * Dialogue authoring is FILE-AUTHORITATIVE: dialogues live as `.twee` files in
 * backend/data/dialogues/, and a `sync` step imports them into the
 * dialogue_definitions table. A dev DB may have an EMPTY dialogue_definitions
 * table even though the dialogues exist on disk — so we parse the .twee files
 * directly and inject dialogue_definitions rows into the bundle. This keeps the
 * committed bundle self-contained and makes the content xref gate validate
 * against the real dialogue IDs (otherwise every quest introDialogueId ref
 * would false-positive as a broken cross-reference).
 *
 * This is a developer convenience used by `pnpm content:refresh` and is the
 * same payload shape `content:deploy --apply` consumes. It reads only.
 */
import Database from 'better-sqlite3';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CONTENT_TABLES } from '../seed-export/content-tables.js';
import { parseAndValidate } from '../dialogues/runtime.js';
import { hashSource } from '../dialogues/repo.js';

const DB_PATH = process.env.DB_PATH ?? 'data/digiworld.db';

const tables: Record<string, Record<string, unknown>[]> = {};
const skippedMissingTables: string[] = [];

const db = new Database(resolve(process.cwd(), DB_PATH), { readonly: true, fileMustExist: true });
try {
  for (const { name, orderBy } of CONTENT_TABLES) {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name);
    if (!exists) {
      skippedMissingTables.push(name);
      continue;
    }
    const rows = db.prepare(`SELECT * FROM ${name} ORDER BY ${orderBy.join(', ')}`).all();
    tables[name] = rows as Record<string, unknown>[];
  }
} finally {
  db.close();
}

// --- Enrich dialogue_definitions from the .twee files (file-authoritative) ---
// Use a cwd-relative path (this script runs from backend/): dialogues live in
// backend/data/dialogues. We avoid importing config because config triggers the
// DB migrator, and we avoid buildCrossRefChecker() because it opens the DB
// (which may be locked by a running stack). Plain parseAndValidate is enough
// to extract dialogue_definitions rows; the content xref gate validates the
// bundle's refs later.
const dialogueDir = resolve(process.cwd(), 'data', 'dialogues');
const dialogueRows: Record<string, unknown>[] = [];
try {
  const files = (await readdir(dialogueDir)).filter(
    (n) => n.toLowerCase().endsWith('.twee') || n.toLowerCase().endsWith('.tw'),
  );
  for (const file of files) {
    const dialogueId = file.replace(/\.(twee|tw)$/i, '');
    const source = await readFile(resolve(dialogueDir, file), 'utf8');
    const parsed = parseAndValidate(source, dialogueId);
    if (parsed.definition === null) {
      // eslint-disable-next-line no-console
      console.warn(`extract-local: dialogue ${dialogueId} failed to parse, skipped`);
      continue;
    }
    const def = parsed.definition;
    dialogueRows.push({
      dialogue_id: dialogueId,
      title: def.title ?? dialogueId,
      source_path: file,
      source_hash: hashSource(source),
      source_twee: source,
      start_node_id: def.startNodeId,
      npc_ids: JSON.stringify(def.npcIds ?? []),
      ir_json: JSON.stringify(def),
      node_count: Object.keys(def.nodes ?? {}).length,
      status: 'published',
      imported_at: Date.now(),
      updated_at: Date.now(),
    });
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`extract-local: could not read dialogues dir (${dialogueDir}): ${err instanceof Error ? err.message : String(err)}`);
}
tables['dialogue_definitions'] = dialogueRows;

// --- Enrich booster tables from seed files (file-authoritative curation) ---
// Boosters are NOT authored in the DB: they are curated in seeds/boosters/*.booster.json
// (see boosters/pipeline.ts). Inject their compiled rows directly into the bundle
// so `content:xref` and `content:deploy --apply` treat them like any other content
// table. The global catalog (digimons.xml) supplies cross-file validation of the
// digimonId refs; shop_items ids come from the recently-dumped bundle table.
import { buildBoosterTables, DEFAULT_SEEDS_DIR } from '../boosters/pipeline.js';
import { parseCatalogXml } from '../digimon/xml.js';
{
  // Load the global catalog directly (NOT via config, which triggers the DB
  // migrator — see digimon-content-deploy skill). Fall back to empty if missing.
  const catalogXmlPath = resolve(process.cwd(), 'data', 'catalog', 'digimons.xml');
  let catalog;
  try {
    catalog = parseCatalogXml(await readFile(catalogXmlPath, 'utf8'));
  } catch {
    catalog = undefined;
  }
  const boosterOpts = { seedsDir: DEFAULT_SEEDS_DIR, itemIds: (tables['shop_items'] ?? []).map((r) => String(r['id'])) };
  if (catalog) Object.assign(boosterOpts, { catalog });
  const boosterOut = await buildBoosterTables(boosterOpts);
  if (boosterOut.boosters.length > 0) {
    tables['boosters'] = boosterOut.boosters as unknown as Record<string, unknown>[];
    tables['booster_digimon_nodes'] = boosterOut.booster_digimon_nodes as unknown as Record<string, unknown>[];
    tables['booster_item_entries'] = boosterOut.booster_item_entries as unknown as Record<string, unknown>[];
  } else {
    delete tables['boosters'];
    delete tables['booster_digimon_nodes'];
    delete tables['booster_item_entries'];
  }
  if (boosterOut.issues.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`extract-local: booster seed issues (${boosterOut.issues.length}):\n` +
      boosterOut.issues.map((i) => `  - [${i.file}] ${i.rule}: ${i.message}`).join('\n'));
  }
}

const seed = {
  schemaVersion: 1,
  exportedAt: Date.now(),
  source: { database: 'sqlite', dbPath: DB_PATH },
  skippedMissingTables,
  tables,
  assetManifest: [],
};

const out = process.argv[2] ?? resolve(process.cwd(), '..', 'content', 'content-bundle.json');
await writeFile(out, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
const counts = Object.fromEntries(Object.entries(tables).map(([n, r]) => [n, r.length]));
// eslint-disable-next-line no-console
console.log(`extract-local: wrote ${out}`);
// eslint-disable-next-line no-console
console.log(`extract-local: tables=${JSON.stringify(counts)}`);
if (skippedMissingTables.length > 0) {
  // eslint-disable-next-line no-console
  console.log(`extract-local: skippedMissingTables=${skippedMissingTables.join(',')}`);
}
