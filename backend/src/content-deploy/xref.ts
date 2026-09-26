/**
 * Cross-domain xref validator (CI gate).
 *
 * Usage: pnpm typecheck:xref <seed.json|dir>
 *
 * Loads seed.json (fail-fast), loads the digimon catalog from the artifact's
 * assets (assetManifest rel catalog/digimons.xml) falling back to config,
 * validates every cross-domain ref, emits a JSON report to stdout, exits 0
 * clean / 1 broken.
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';

import { CONTENT_TABLES } from '../seed-export/content-tables.js';
import { parseCatalogXml } from '../digimon/xml.js';
import { validateXref, type XrefIssue, type DigimonXrefContext } from './versions.js';

type Row = Record<string, unknown>;

type SeedEnvelope = {
  schemaVersion: number;
  exportedAt: number;
  source: unknown;
  skippedMissingTables: string[];
  tables: Record<string, Row[]>;
  assetManifest: Array<{ rel: string; bytes: number; sha256: string }>;
};

const FORBIDDEN_TABLE_NAMES: ReadonlySet<string> = new Set([
  'friendships',
  'coin_offers',
  'sessions',
  'resources',
  'login_attempts',
]);
const FORBIDDEN_TABLE_PREFIXES: readonly string[] = ['player_', 'user_', 'pending_', 'wallet_'];

function isForbiddenTable(name: string): boolean {
  return FORBIDDEN_TABLE_NAMES.has(name) || FORBIDDEN_TABLE_PREFIXES.some((p) => name.startsWith(p));
}

type CliOptions = {
  seedPath: string;
};

function parseCliArgs(argv: string[]): CliOptions {
  const { positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (positionals.length !== 1) {
    throw new Error('Usage: pnpm typecheck:xref <seed.json|dir>');
  }
  const seedPath = positionals[0];
  if (!seedPath) throw new Error('Usage: pnpm typecheck:xref <seed.json|dir>');
  return { seedPath };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// Project root is 4 directories up from this file
// (backend/src/content-deploy/xref.ts -> backend/)
const repoRoot = resolve(__dirname, '..', '..', '..');

async function resolveSeedPath(path: string): Promise<string> {
  const { stat } = await import('node:fs/promises');
  // Resolve relative to repo root, not process.cwd() —
  // pnpm --filter changes CWD to backend/ where content/ is not at root.
  const abs = resolve(repoRoot, path);
  try {
    const info = await stat(abs);
    return info.isDirectory() ? resolve(abs, 'seed.json') : abs;
  } catch {
    return abs;
  }
}

async function loadSeed(seedPath: string): Promise<SeedEnvelope> {
  let raw: string;
  try {
    raw = await readFile(seedPath, 'utf8');
  } catch {
    throw new Error(`seed.json not found at ${seedPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON in ${seedPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`seed.json at ${seedPath} must be a JSON object envelope`);
  }
  const env = parsed as Partial<SeedEnvelope>;
  if (env.schemaVersion !== 1) {
    throw new Error(`seed.json at ${seedPath}: unsupported schemaVersion ${String(env.schemaVersion)} (expected 1)`);
  }
  if (typeof env.tables !== 'object' || env.tables === null || Array.isArray(env.tables)) {
    throw new Error(`seed.json at ${seedPath}: missing "tables" object`);
  }
  for (const [name, rows] of Object.entries(env.tables)) {
    if (!Array.isArray(rows)) {
      throw new Error(`seed.json at ${seedPath}: tables.${name} must be an array of rows`);
    }
  }
  return env as SeedEnvelope;
}

function forbiddenTablesIn(env: SeedEnvelope): string[] {
  return Object.keys(env.tables).filter(isForbiddenTable).sort();
}

function buildDigimonContext(catalog: { digimons: Array<{ id: string; skillPool: Array<{ id: string }>; signatureSkillId?: string }> }): DigimonXrefContext {
  const ids = new Set(catalog.digimons.map((d) => d.id));
  const skillsByTemplate = new Map<string, ReadonlySet<string>>();
  const signaturesByTemplate = new Map<string, string>();
  const requiredItemsByEvolve = new Map<string, string>();

  for (const d of catalog.digimons) {
    skillsByTemplate.set(d.id, new Set(d.skillPool.map((s) => s.id)));
    if (d.signatureSkillId) signaturesByTemplate.set(d.id, d.signatureSkillId);
  }
  return { ids, skillsByTemplate, signaturesByTemplate, requiredItemsByEvolve };
}

async function loadDigimonCatalog(seedPath: string, assetManifest: SeedEnvelope['assetManifest']): Promise<{ digimons: Array<{ id: string; skillPool: Array<{ id: string }>; signatureSkillId?: string }> }> {
  const seedDir = dirname(seedPath);
  // Check artifact assetManifest for digimons.xml
  const catalogAsset = assetManifest?.find((a) => a.rel === 'catalog/digimons.xml');
  if (catalogAsset) {
    const assetPath = resolve(seedDir, 'assets', catalogAsset.rel);
    if (existsSync(assetPath)) {
      const raw = readFileSync(assetPath, 'utf8');
      try {
        return parseCatalogXml(raw);
      } catch {
        // fall through to config fallback
      }
    }
  }
  // Fallback: load from config path via loadCatalog
  try {
    const { loadCatalog } = await import('../digimon/xml.js');
    return loadCatalog();
  } catch {
    // Return empty catalog (fail-closed: any digimon refs will be reported as broken)
    return { digimons: [] };
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  const seedPath = await resolveSeedPath(opts.seedPath);

  // Fail-fast: load and shape-check seed.json
  const env = await loadSeed(seedPath);
  const forbidden = forbiddenTablesIn(env);
  if (forbidden.length > 0) {
    const report = {
      ok: false,
      error: `seed artifact contains player-state tables: ${forbidden.join(', ')}`,
      checkedAt: new Date().toISOString(),
      artifact: seedPath,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // Load digimon catalog (from artifact assets or config fallback)
  const catalog = await loadDigimonCatalog(seedPath, env.assetManifest);
  const digimonContext = buildDigimonContext(catalog);

  // Run cross-domain validation
  const issues = validateXref(env, digimonContext, catalog as any);

  // Emit JSON report
  const report = {
    ok: issues.length === 0,
    artifact: seedPath,
    checkedAt: new Date().toISOString(),
    tables: Object.fromEntries(
      Object.entries(env.tables).map(([name, rows]) => [name, rows.length])
    ),
    issues,
    summary: {
      totalIssues: issues.length,
      byDomain: Object.fromEntries(
        Object.entries(issues.reduce((acc, i) => {
          acc[i.domain] = (acc[i.domain] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>))
          .sort(([, a], [, b]) => b - a)
      ),
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (issues.length > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const report = {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    checkedAt: new Date().toISOString(),
  };
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});