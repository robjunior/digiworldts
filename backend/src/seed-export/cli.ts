/**
 * Seed-export CLI.
 *
 * Reads the dev database (content tables only — no user state) plus the
 * file-backed content (scenes JSON, particle/skill-vfx presets, catalog XML,
 * Twine dialogues, tileset PNGs, arena GLBs) and emits a versioned seed
 * artifact that can bootstrap other environments:
 *
 *   <out>/
 *     seed.json          # envelope: { schemaVersion, exportedAt, sourceDb,
 *                         #            skippedMissingTables, tables, assetManifest }
 *     assets/
 *       scenes/…         # scenes.json, particle-presets.json, skill-vfx-presets.json
 *       catalog/…        # digimons.xml
 *       dialogues/…      # *.twee
 *       tilesets/…       # <tilesetId>.png
 *       arenas/…         # *.glb
 *
 * Usage:
 *   pnpm seed:export                          # default out: backend/seed-export
 *   pnpm seed:export --out ./seed-copy        # custom destination
 *   pnpm seed:export --tables quests,npcs     # subset of content tables only
 *   pnpm seed:export --no-assets              # DB tables only, skip file assets
 *   pnpm seed:export --help
 *
 * Deterministic output: every table is ordered by its PRIMARY KEY columns and
 * the envelope is pretty-printed with 2-space indentation. A table that does
 * not exist in the source DB (e.g. a migration not yet applied) is skipped
 * with a warning and recorded in `skippedMissingTables` rather than failing.
 */
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

type Row = Record<string, unknown>;

/** Strip credentials from a Postgres connection string before persisting. */
function sanitizeDatabaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** Content tables and their PK columns (used for deterministic ORDER BY). */
const CONTENT_TABLES: ReadonlyArray<{ name: string; orderBy: readonly string[] }> = [
  { name: 'quests', orderBy: ['id'] },
  { name: 'world_objects', orderBy: ['id'] },
  { name: 'dialogue_definitions', orderBy: ['dialogue_id'] },
  { name: 'npcs', orderBy: ['id'] },
  { name: 'dungeons', orderBy: ['id'] },
  { name: 'dungeon_tiles', orderBy: ['dungeon_id', 'x', 'y'] },
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
  { name: 'coin_offers', orderBy: ['id'] },
] as const;

type CliOptions = {
  out: string;
  tables: readonly string[];
  includeAssets: boolean;
  help: boolean;
};

function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string', short: 'o' },
      tables: { type: 'string', short: 't' },
      'no-assets': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });
  if (positionals.length > 0) {
    throw new Error(`Unexpected positional argument: ${positionals.join(' ')}`);
  }
  return {
    out: values.out ?? '',
    tables: values.tables ? values.tables.split(',').map((t) => t.trim()).filter(Boolean) : [],
    includeAssets: !values['no-assets'],
    help: values.help ?? false,
  };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Seed-export CLI — dump dev content into a versioned seed artifact.

Usage:
  pnpm seed:export [options]

Options:
  -o, --out <dir>      Output directory (default: <backend>/seed-export)
  -t, --tables <csv>   Subset of content tables (comma-separated names)
      --no-assets      Skip file-backed assets (scenes, catalog, dialogues, tilesets, arenas)
      --help           Show this help

Exported tables: ${CONTENT_TABLES.map((t) => t.name).join(', ')}`);
}

async function sha256File(path: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Copy a file into <out>/assets/<rel>, recording a manifest entry. */
async function copyAsset(
  src: string,
  outRoot: string,
  rel: string,
  manifest: Array<{ rel: string; bytes: number; sha256: string }>,
): Promise<void> {
  const dest = join(outRoot, 'assets', rel);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  const info = await stat(dest);
  manifest.push({ rel, bytes: info.size, sha256: await sha256File(dest) });
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  // Config/env must be loaded before the DB helper is first used; DB_PATH is
  // honoured from the environment, so no code path here pins a different file.
  const [{ config }, { q, closeDbAdapter }] = await Promise.all([
    import('../config.js'),
    import('../db/index.js'),
  ]);

  const projectRoot = config.paths.root;
  const outRoot = opts.out ? resolve(process.cwd(), opts.out) : resolve(projectRoot, 'seed-export');
  await mkdir(outRoot, { recursive: true });

  const wanted = opts.tables.length > 0
    ? CONTENT_TABLES.filter((t) => opts.tables.includes(t.name))
    : [...CONTENT_TABLES];

  const tables: Record<string, Row[]> = {};
  const skippedMissingTables: string[] = [];
  for (const { name, orderBy } of wanted) {
    try {
      const rows = await q<Row>(`SELECT * FROM ${name} ORDER BY ${orderBy.join(', ')}`);
      tables[name] = rows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no such table/i.test(msg)) {
        // eslint-disable-next-line no-console
        console.warn(`seed-export: skipping missing table "${name}"`);
        skippedMissingTables.push(name);
      } else {
        throw err;
      }
    }
  }

  const assetManifest: Array<{ rel: string; bytes: number; sha256: string }> = [];
  if (opts.includeAssets) {
    const scenesDir = resolve(config.paths.dataDir, 'scenes');
    const catalogXml = config.paths.catalogXml;
    const dialoguesDir = config.paths.dialogues;
    const tilesetsDir = resolve(config.paths.dataDir, 'tilesets');
    const arenasDir = resolve(projectRoot, '..', 'scene3d', 'assets', 'arenas');

    // Scenes JSON presets.
    for (const file of ['scenes.json', 'particle-presets.json', 'skill-vfx-presets.json']) {
      const src = join(scenesDir, file);
      try {
        await copyAsset(src, outRoot, join('scenes', file), assetManifest);
      } catch {
        // eslint-disable-next-line no-console
        console.warn(`seed-export: scenes preset missing, skipped: ${src}`);
      }
    }

    // Catalog XML.
    try {
      await copyAsset(catalogXml, outRoot, join('catalog', 'digimons.xml'), assetManifest);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`seed-export: catalog XML missing, skipped: ${catalogXml}`);
    }

    // Twine dialogues.
    try {
      for (const entry of await readdir(dialoguesDir)) {
        if (entry.endsWith('.twee')) {
          await copyAsset(join(dialoguesDir, entry), outRoot, join('dialogues', entry), assetManifest);
        }
      }
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`seed-export: dialogues dir missing, skipped: ${dialoguesDir}`);
    }

    // Tileset PNGs — one file per tileset id; copy when present.
    const tilesetIds = (tables['tilesets'] ?? []).map((row) => row['id']).filter((id): id is string => typeof id === 'string');
    try {
      for (const entry of await readdir(tilesetsDir)) {
        if (entry.endsWith('.png') && (tilesetIds.length === 0 || tilesetIds.includes(entry.replace(/\.png$/, '')))) {
          await copyAsset(join(tilesetsDir, entry), outRoot, join('tilesets', entry), assetManifest);
        }
      }
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`seed-export: tilesets dir missing, skipped: ${tilesetsDir}`);
    }

    // Arena GLBs.
    try {
      for (const entry of await readdir(arenasDir)) {
        if (entry.endsWith('.glb')) {
          await copyAsset(join(arenasDir, entry), outRoot, join('arenas', entry), assetManifest);
        }
      }
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`seed-export: arenas dir missing, skipped: ${arenasDir}`);
    }
  }

  const tableCounts: Record<string, number> = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.length]),
  );

  // Report the connection actually used: `sourceDb` is only meaningful for the
  // sqlite adapter; under Postgres the file path never exists.
  const source =
    config.DATABASE === 'postgres'
      ? { database: config.DATABASE, url: sanitizeDatabaseUrl(config.DATABASE_URL) ?? '(unset)' }
      : { database: config.DATABASE, dbPath: config.paths.db };

  const seed = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    source,
    skippedMissingTables,
    tables,
    assetManifest,
  };

  const seedPath = join(outRoot, 'seed.json');
  await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`seed-export: wrote ${seedPath}`);
  // eslint-disable-next-line no-console
  console.log(`seed-export: tables=${JSON.stringify(tableCounts)}`);
  // eslint-disable-next-line no-console
  console.log(`seed-export: assets=${assetManifest.length} files`);
  if (skippedMissingTables.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`seed-export: skippedMissingTables=${skippedMissingTables.join(',')}`);
  }

  await closeDbAdapter();
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`seed-export: failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
