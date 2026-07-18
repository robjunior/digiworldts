/**
 * Startup asset verifier — walks the loaded XML catalog and ensures every
 * entry has BOTH portrait.webp and dot.gif on disk under
 * public/assets/digimon/{catalogId}/. Missing files are re-downloaded from
 * the URLs recorded in the `scraped_catalog` table (for skullbot-derived
 * ids like `skb-317`) or from the URL fields in the XML entry itself.
 *
 * This satisfies the requirement:
 *   "save localy (on frontend files) check every startup if missing content"
 *
 * The verifier is idempotent: on a clean install it downloads everything;
 * on subsequent starts it skips every valid file and only re-downloads
 * files that were deleted / truncated / never got there.
 *
 * Called from src/server.ts during boot AFTER the catalog is loaded and
 * BEFORE the HTTP listener starts accepting traffic (so admin doesn't get
 * 404s from the assets folder).
 *
 * Async by construction — the scraped_catalog lookup routes through the
 * DbAdapter (SQLite or Postgres).
 */
import { one, type ScrapedRow } from '../db/index.js';
import { log } from '../util/log.js';
import type { Catalog } from '../digimon/types.js';
import {
  assetPublicUrls,
  downloadAssetBatch,
  hasLocalAssets,
  logBatchSummary,
  type AssetJob,
} from './assets.js';
import { skullbotAssetUrls } from './skullbot.js';

const SKULLBOT_ID_RE = /^skb-(\d+)$/;
const SQL_SELECT_SCRAPED = `SELECT * FROM scraped_catalog WHERE skullbot_id = ?`;

async function resolveJob(catalogId: string, xmlPortrait: string, xmlDot: string): Promise<AssetJob | null> {
  const skb = SKULLBOT_ID_RE.exec(catalogId);
  if (skb && skb[1]) {
    const id = Number(skb[1]);
    const row = await one<ScrapedRow>(SQL_SELECT_SCRAPED, id);
    if (row) {
      return { catalogId, portraitUrl: row.portrait_url, dotUrl: row.dot_url };
    }
    const urls = skullbotAssetUrls(id);
    return { catalogId, portraitUrl: urls.portrait, dotUrl: urls.dot };
  }
  const isHttp = /^https?:\/\//;
  if (isHttp.test(xmlPortrait) && isHttp.test(xmlDot)) {
    return { catalogId, portraitUrl: xmlPortrait, dotUrl: xmlDot };
  }
  return null;
}

export type VerifyReport = {
  totalCatalog: number;
  ok: number;
  repaired: number;
  irreparable: string[];
  summary: { downloaded: number; skipped: number; failed: number };
};

/**
 * Verify every entry in `catalog`. Downloads missing files. Returns a report
 * that server.ts can log; failure to repair does NOT throw — the server
 * still starts, but the affected entries render with a broken-image
 * fallback (admin can then fix from the admin page).
 */
export async function verifyCatalogAssets(catalog: Catalog): Promise<VerifyReport> {
  const missing: AssetJob[] = [];
  const irreparable: string[] = [];
  let ok = 0;

  for (const d of catalog.digimons) {
    if (hasLocalAssets(d.id)) {
      ok += 1;
      continue;
    }
    const job = await resolveJob(d.id, d.assets.portrait, d.assets.dot);
    if (job) missing.push(job);
    else irreparable.push(d.id);
  }

  if (missing.length === 0) {
    log.info('assets.verify.clean', { total: catalog.digimons.length, ok });
    return {
      totalCatalog: catalog.digimons.length,
      ok,
      repaired: 0,
      irreparable,
      summary: { downloaded: 0, skipped: 0, failed: 0 },
    };
  }

  log.info('assets.verify.repairing', { missing: missing.length, irreparable: irreparable.length });
  const { results, summary } = await downloadAssetBatch(missing);
  const repaired = results.filter((r) => r.portraitStatus !== 'failed' && r.dotStatus !== 'failed').length;
  logBatchSummary('assets.verify.done', summary);
  return { totalCatalog: catalog.digimons.length, ok, repaired, irreparable, summary };
}

/**
 * Utility for the admin API: what URLs would the frontend load for this
 * catalog id? (Uses the deterministic /assets/digimon/{id}/... layout.)
 */
export function urlsForCatalog(catalogId: string): { portrait: string; dot: string } {
  return assetPublicUrls(catalogId);
}
