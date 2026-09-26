/**
 * Bundle the arena GLBs into the committed content bundle.
 *
 * The content-deploy seed carries DB tables AND binary assets via
 * `assetManifest`. This script stages every `scene3d/assets/arenas/*.glb`
 * (the git-tracked, frontend-served arena models) into
 * `<repo>/content/assets/arenas/` and records them in the bundle's
 * `assetManifest`, so `content:deploy --apply` materializes them into the
 * target backend's `/assets/arenas/` seed dir on deployment.
 *
 * Follows the minimal-diff rule: it touches ONLY `assetManifest` (+ staged
 * files). Every table in the committed bundle must remain byte-identical —
 * the script asserts that and aborts otherwise. Run it AFTER updating the
 * arena GLB, then commit the bundle + staged files together.
 *
 * Run: npx tsx backend/scripts/bundle-arena-assets.mts   (from repo root)
 */
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..'); // backend/scripts/ → repo root
const BUNDLE_PATH = resolve(ROOT, 'content', 'content-bundle.json');
const ARENAS_SRC = resolve(ROOT, 'scene3d', 'assets', 'arenas');
const STAGE_DIR = resolve(ROOT, 'content', 'assets', 'arenas');

type AssetEntry = { rel: string; bytes: number; sha256: string };

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));
const tablesJson = JSON.stringify(bundle.tables); // byte-identical check target

mkdirSync(STAGE_DIR, { recursive: true });

// --- Stage the arena GLBs + build manifest entries (sorted for stability) ---
const entries: AssetEntry[] = [];
const glbFiles = readdirSync(ARENAS_SRC)
  .filter((n) => n.endsWith('.glb'))
  .sort();
for (const file of glbFiles) {
  const src = resolve(ARENAS_SRC, file);
  copyFileSync(src, resolve(STAGE_DIR, file));
  const st = statSync(resolve(STAGE_DIR, file));
  entries.push({ rel: `arenas/${file}`, bytes: st.size, sha256: sha256File(resolve(STAGE_DIR, file)) });
}

// Preserve any already-committed non-arena manifest entries (e.g. scenes.json).
const prior = Array.isArray(bundle.assetManifest) ? bundle.assetManifest : [];
const nonArena = prior.filter((e: AssetEntry) => !e.rel.startsWith('arenas/'));
const newManifest = [...nonArena, ...entries];

// --- Assert tables byte-identical (minimal-diff rule) ---
if (JSON.stringify(bundle.tables) !== tablesJson) {
  throw new Error('a content table changed unexpectedly — aborting (bundle-arena-assets must not touch tables)');
}

const changed = JSON.stringify(bundle.assetManifest) !== JSON.stringify(newManifest);
if (!changed) {
  console.log('arena assets unchanged — nothing to write');
} else {
  bundle.assetManifest = newManifest;
  writeFileSync(BUNDLE_PATH, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
}

console.log(`arena assets: ${entries.map((e) => e.rel).join(', ') || '(none)'}`);
console.log(`staged -> ${STAGE_DIR}`);
console.log(`assetManifest entries: ${newManifest.length} (was ${prior.length})`);
console.log(`bundle: ${BUNDLE_PATH}${changed ? ' (written)' : ' (unchanged)'}`);