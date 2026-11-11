/**
 * Content-deploy asset materialization.
 *
 * The content bundle seed envelope carries an `assetManifest` (produced by
 * `seed-export` / `content:bundle-assets`) that lists file-backed assets
 * staged next to the bundle (`<bundleDir>/assets/<rel>`). Tables are applied to
 * the DB by `applySeed`; this module writes the manifest's binary assets onto
 * the target environment's filesystem so file-authoritative content (arena
 * GLBs, scene presets, etc.) ships with the same `content:deploy --apply` step
 * instead of only riding a frontend static rebuild.
 *
 * Idempotent: an asset already on disk with a matching sha256 is left
 * untouched (no rewrite, no version churn). Only `arenas/*` files are written
 * by default, into `config.paths.arenaSeedDir`.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';

export type BundleAsset = { rel: string; bytes: number; sha256: string };

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export type AssetApplySummary = { applied: string[]; skippedUnchanged: string[]; missing: string[] };

/**
 * Write every `<prefix>` asset listed in the manifest into `destRoot`,
 * reading the source bytes from `<bundleDir>/assets/<rel>`.
 *
 * @param bundleDir  Directory that contains the bundle alongside its
 *                   staged `assets/` files (e.g. the `content/` repo dir).
 * @param manifest  The bundle's `assetManifest`.
 * @param prefix    Manifest rel prefix to materialize (`arenas/`, `scenes/`).
 * @param destRoot  Destination directory root for the prefix's files.
 */
export async function applyAssetPrefix(
  bundleDir: string,
  manifest: readonly BundleAsset[],
  prefix: string,
  destRoot: string,
): Promise<AssetApplySummary> {
  const summary: AssetApplySummary = { applied: [], skippedUnchanged: [], missing: [] };
  const entries = manifest.filter((a) => a.rel.startsWith(prefix));

  for (const entry of entries) {
    const rel = entry.rel.slice(prefix.length);
    // Safety: never let a manifest entry escape the prefix's dest dir.
    const cleanRel = relative(prefix, join(prefix, rel));
    if (cleanRel.split('/').includes('..')) {
      // eslint-disable-next-line no-console
      console.warn(`content-deploy: skipping unsafe asset rel "${entry.rel}"`);
      continue;
    }

    const src = resolve(bundleDir, 'assets', entry.rel);
    const dest = resolve(destRoot, cleanRel);

    let bytes: Buffer;
    try {
      bytes = await readFile(src);
    } catch {
      summary.missing.push(entry.rel);
      continue;
    }

    const actualSha = sha256(bytes);
    if (entry.sha256 && actualSha !== entry.sha256) {
      // eslint-disable-next-line no-console
      console.warn(`content-deploy: asset ${entry.rel} sha256 differs from manifest (manifest may be stale)`);
    }

    // Idempotent: skip if an existing file already has the same content.
    try {
      const existing = await readFile(dest);
      if (sha256(existing) === actualSha && entry.bytes === existing.byteLength) {
        summary.skippedUnchanged.push(entry.rel);
        continue;
      }
    } catch {
      // not present — will write
    }

    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    summary.applied.push(entry.rel);
  }

  return summary;
}

/** Materialize `arenas/*` assets (compat wrapper). */
export async function applyArenaAssets(
  bundleDir: string,
  manifest: readonly BundleAsset[],
  destRoot: string,
): Promise<AssetApplySummary> {
  return applyAssetPrefix(bundleDir, manifest, 'arenas/', destRoot);
}

/** Materialize `scenes/*` assets (scene presets: scenes.json). */
export async function applySceneAssets(
  bundleDir: string,
  manifest: readonly BundleAsset[],
  destRoot: string,
): Promise<AssetApplySummary> {
  return applyAssetPrefix(bundleDir, manifest, 'scenes/', destRoot);
}

/** Staged files already materialized in `<bundleDir>/assets` (for refresh tooling). */
export async function listStagedArenaAssets(bundleDir: string): Promise<string[]> {
  const root = resolve(bundleDir, 'assets', 'arenas');
  try {
    return (await readdir(root)).filter((n) => n.endsWith('.glb')).sort();
  } catch {
    return [];
  }
}

export async function stagedArenaAssetStat(
  bundleDir: string,
  file: string,
): Promise<{ rel: string; bytes: number; sha256: string } | null> {
  const p = resolve(bundleDir, 'assets', 'arenas', file);
  try {
    const buf = await readFile(p);
    const st = await stat(p);
    return { rel: `arenas/${file}`, bytes: st.size, sha256: sha256(buf) };
  } catch {
    return null;
  }
}