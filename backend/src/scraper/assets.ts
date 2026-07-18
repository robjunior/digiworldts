/**
 * Asset downloader — pulls portrait (webp) and dot sprite (gif) for each
 * catalog entry into `public/assets/digimon/{catalogId}/`.
 *
 * Contract:
 *   - `downloadAsset` is idempotent: skips if the target file already exists
 *     AND is non-empty (a zero-byte file counts as "missing" so we heal
 *     interrupted downloads on the next run).
 *   - Writes go to a `.part` file first and are renamed on success to prevent
 *     ever serving a half-written image.
 *   - Concurrency is bounded by `MAX_PARALLEL` to avoid nuking the source
 *     server or exhausting local sockets.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from '../config.js';
import { fetchBytes } from './http.js';
import { log } from '../util/log.js';

const MAX_PARALLEL = 6;

export type AssetJob = {
  catalogId: string;
  portraitUrl: string;
  dotUrl: string;
};

export type AssetResult = {
  catalogId: string;
  portraitStatus: 'ok' | 'skipped' | 'failed';
  dotStatus: 'ok' | 'skipped' | 'failed';
  errors: string[];
};

export type AssetPaths = {
  dir: string;
  portrait: string;
  dot: string;
};

export function assetPaths(catalogId: string): AssetPaths {
  const dir = resolve(config.paths.assetsDir, catalogId);
  return {
    dir,
    portrait: join(dir, 'portrait.webp'),
    dot: join(dir, 'dot.gif'),
  };
}

export function assetPublicUrls(catalogId: string): { portrait: string; dot: string } {
  return {
    portrait: `/assets/digimon/${catalogId}/portrait.webp`,
    dot: `/assets/digimon/${catalogId}/dot.gif`,
  };
}

function isValidLocal(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const s = statSync(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

async function pullOne(url: string, dest: string): Promise<{ ok: boolean; skipped: boolean; error?: string }> {
  if (isValidLocal(dest)) return { ok: true, skipped: true };
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const res = await fetchBytes(url, { maxRetries: 3, timeoutMs: 30_000 });
  if (!res.ok || !res.data) {
    return { ok: false, skipped: false, error: res.error ?? `http ${res.status}` };
  }
  const bytes = res.data;
  if (bytes.byteLength < 32) {
    return { ok: false, skipped: false, error: `payload too small (${bytes.byteLength}B)` };
  }
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
    return { ok: true, skipped: false };
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {}
    return { ok: false, skipped: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Download one job (portrait + dot). Existing valid files are left alone. */
export async function downloadAssetJob(job: AssetJob): Promise<AssetResult> {
  const paths = assetPaths(job.catalogId);
  const errors: string[] = [];

  const portraitRes = await pullOne(job.portraitUrl, paths.portrait);
  const dotRes = await pullOne(job.dotUrl, paths.dot);

  const portraitStatus: AssetResult['portraitStatus'] = portraitRes.ok
    ? portraitRes.skipped
      ? 'skipped'
      : 'ok'
    : 'failed';
  const dotStatus: AssetResult['dotStatus'] = dotRes.ok
    ? dotRes.skipped
      ? 'skipped'
      : 'ok'
    : 'failed';

  if (portraitRes.error) errors.push(`portrait: ${portraitRes.error}`);
  if (dotRes.error) errors.push(`dot: ${dotRes.error}`);

  return { catalogId: job.catalogId, portraitStatus, dotStatus, errors };
}

/**
 * Run a batch of asset jobs with bounded concurrency. Returns aggregate
 * counts + per-job results (useful for admin/CLI reporting).
 */
export async function downloadAssetBatch(jobs: AssetJob[]): Promise<{
  results: AssetResult[];
  summary: { downloaded: number; skipped: number; failed: number };
}> {
  const results: AssetResult[] = new Array(jobs.length);
  let cursor = 0;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  const workers = new Array(Math.min(MAX_PARALLEL, jobs.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const job = jobs[i];
      if (!job) return;
      const r = await downloadAssetJob(job);
      results[i] = r;
      const p = r.portraitStatus;
      const d = r.dotStatus;
      if (p === 'ok') downloaded++;
      else if (p === 'skipped') skipped++;
      else failed++;
      if (d === 'ok') downloaded++;
      else if (d === 'skipped') skipped++;
      else failed++;
    }
  });
  await Promise.all(workers);
  return { results, summary: { downloaded, skipped, failed } };
}

/** Cheap hash for logging (not security) — helps correlate re-runs. */
export function jobDigest(job: AssetJob): string {
  return createHash('sha1').update(`${job.catalogId}|${job.portraitUrl}|${job.dotUrl}`).digest('hex').slice(0, 12);
}

/** True if BOTH portrait and dot exist locally as non-empty files. */
export function hasLocalAssets(catalogId: string): boolean {
  const paths = assetPaths(catalogId);
  return isValidLocal(paths.portrait) && isValidLocal(paths.dot);
}

/** Log helper that reports a batch summary in one line. */
export function logBatchSummary(prefix: string, summary: { downloaded: number; skipped: number; failed: number }): void {
  log.info(prefix, summary);
}
