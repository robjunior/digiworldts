/**
 * Booster CLI — validate + transform the seed files (the "Loader de seeds"
 * entry point for the build gate and manual runs).
 *
 *   booster:validate  <seedsDir?>   validate all seeds (schema+semantic+cross-file
 *                                    against the real catalogs); exit non-zero on
 *                                    ANY issue. Prints a JSO report on stdout.
 *   booster:compile   <seedsDir?>   validate AND transform into runtime rows, one
 *                                    JSON object per seed on stdout.
 *
 * Catalog resolution: digimons from config's CATALOG_XML (or data/catalog/
 * digimons.xml), item ids from the shop_items table of a DB (defaults to the
 * configured data DB; pass BOOSTER_ITEM_DB to point elsewhere). This gate is
 * the CI hook: fail the build if any seed is invalid (§3.3).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { buildBoosterTables, DEFAULT_SEEDS_DIR, ITEM_ID_SOURCE } from './pipeline.js';
import { loadCatalog, parseCatalogXml } from '../digimon/xml.js';
import { q } from '../db/index.js';

async function readItemIds(): Promise<string[]> {
  try {
    const rows = await q<{ id: string }>(`SELECT id FROM ${ITEM_ID_SOURCE} ORDER BY id`);
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

async function loadCatalogSafe(): Promise<ReturnType<typeof loadCatalog> | undefined> {
  try {
    // loadCatalog reads config's catalog path and crashes if missing; use the
    // repo default path as a fallback via parseCatalogXml.
    return loadCatalog();
  } catch {
    try {
      const xml = await readFile(resolve(process.cwd(), 'data', 'catalog', 'digimons.xml'), 'utf8');
      return parseCatalogXml(xml);
    } catch {
      return undefined;
    }
  }
}

function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { help: { type: 'boolean', default: false } },
    allowPositionals: true,
  });
  const mode = positionals[0] ?? 'validate';
  const seedsDir = positionals[1] ?? DEFAULT_SEEDS_DIR;

  if (values.help) {
    console.log('Usage: booster:<validate|compile> [seedsDir]');
    process.exit(0);
  }

  const run = async () => {
    const [catalog, itemIds] = await Promise.all([
      loadCatalogSafe(),
      process.env.BOOSTER_ITEM_DB === 'skip' ? Promise.resolve([]) : readItemIds(),
    ]);
    const out = await buildBoosterTables({
      seedsDir,
      ...(catalog ? { catalog } : {}),
      itemIds,
    });
    if (mode === 'compile') {
      for (const b of out.boosters) {
        process.stdout.write(`${JSON.stringify(b)}\n`);
      }
    } else if (mode === 'validate') {
      process.stdout.write(`${JSON.stringify({ valid: out.valid, boosterCount: out.boosters.length, issues: out.issues })}\n`);
    } else {
      throw new Error(`unknown mode "${mode}" (expected validate|compile)`);
    }
    if (!out.valid) process.exitCode = 1;
  };

  run().catch((err) => {
    process.stderr.write(`booster cli error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}

main();