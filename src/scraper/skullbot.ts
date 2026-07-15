/**
 * skullbot.fr scraper.
 *
 * Two entry points:
 *   - fetchListedDigimons():  the roster grid at /digimon; one entry per Digimon
 *   - fetchDigimonDetail(id): the individual /digimon/{id} page; adds
 *                             prev/next digivolution chains
 *
 * Every entry we can pull cheaply from the list page:
 *   skullbot_id, name, stage, attribute, portrait_url, dot_url
 *
 * The HTML is imperfect (server literally returns HTTP 403 but the body is
 * the real page) — http.ts handles that by treating 403+HTML as success.
 * The list page is a single flat wall of anchor tags, so a regex sweep is
 * both the simplest and most robust extractor here. Cheerio / DOM parsing
 * would need an extra dep for zero legitimate gain.
 */
import { fetchText } from './http.js';
import { run, tx } from '../db/index.js';
import { log } from '../util/log.js';
import { ATTRIBUTES, STAGES, type Attribute, type Stage } from '../digimon/types.js';

const LIST_URL = 'https://api.skullbot.fr/digimon';
const DETAIL_URL = (id: number): string => `https://api.skullbot.fr/digimon/${id}`;

// Zero-pad to a minimum of 3 digits (dot001, dot123, dot1317 — natural width above 3).
function padId(id: number): string {
  return id.toString().padStart(3, '0');
}

export function skullbotAssetUrls(id: number): { portrait: string; dot: string } {
  const padded = padId(id);
  return {
    portrait: `https://api.skullbot.fr/digimon_ts/portraits/ui_chara_icon_1${padded}.webp`,
    dot: `https://api.skullbot.fr/digimon_ts/dots/dot${padded}.gif`,
  };
}

export type SkullbotEntry = {
  skullbot_id: number;
  name: string;
  stage: Stage;
  attribute: Attribute;
  portrait_url: string;
  dot_url: string;
};

// Match blocks that start with <a href="https://api.skullbot.fr/digimon/{id}"
// and end at the closing </a>. Every listed digimon on the root page (and on
// the neighbours in a detail page) is inside one of these anchors.
const ANCHOR_RE = /<a\s+href="https:\/\/api\.skullbot\.fr\/digimon\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
const ID_RE = /<div\s+class="id">#(\d+)<\/div>/;
const DOT_RE = /<img\s+class="digi"\s+src="([^"]+)"/;
const PORTRAIT_RE = /<img\s+title="([^"]+)"\s+src="([^"]+)"/;
const META_RE = /([A-Za-z-]+(?:\s[A-Za-z-]+)?)\s*\|\s*([A-Za-z]+)/;

function normalizeStage(raw: string): Stage {
  const clean = raw.trim();
  if ((STAGES as readonly string[]).includes(clean)) return clean as Stage;
  return 'Rookie';
}

function normalizeAttribute(raw: string): Attribute {
  const clean = raw.trim();
  if ((ATTRIBUTES as readonly string[]).includes(clean)) return clean as Attribute;
  return 'Unknown';
}

function parseAnchor(inner: string, urlId: number): SkullbotEntry | null {
  const idMatch = ID_RE.exec(inner);
  const id = idMatch ? Number(idMatch[1]) : urlId;
  const dotMatch = DOT_RE.exec(inner);
  const portraitMatch = PORTRAIT_RE.exec(inner);
  if (!portraitMatch) return null;
  const [, title, portraitUrl] = portraitMatch;
  if (!title || !portraitUrl) return null;
  const metaMatch = META_RE.exec(inner);
  if (!metaMatch) return null;
  const [, stageRaw, attrRaw] = metaMatch;
  if (!stageRaw || !attrRaw) return null;
  const dotUrl = dotMatch?.[1] ?? skullbotAssetUrls(id).dot;
  return {
    skullbot_id: id,
    name: title.trim(),
    stage: normalizeStage(stageRaw),
    attribute: normalizeAttribute(attrRaw),
    portrait_url: portraitUrl,
    dot_url: dotUrl,
  };
}

/**
 * Parse every anchor on a page. `urlIdFromHref` is used only as a fallback
 * when the `#id` div is missing (defensive — the site is consistent).
 */
export function parseSkullbotPage(html: string): SkullbotEntry[] {
  const out: SkullbotEntry[] = [];
  const seen = new Set<number>();
  ANCHOR_RE.lastIndex = 0;
  for (;;) {
    const m = ANCHOR_RE.exec(html);
    if (!m) break;
    const urlId = Number(m[1]);
    const inner = m[2] ?? '';
    const entry = parseAnchor(inner, urlId);
    if (!entry) continue;
    if (seen.has(entry.skullbot_id)) continue;
    seen.add(entry.skullbot_id);
    out.push(entry);
  }
  return out;
}

/**
 * Fetch the root list page and parse every listed digimon.
 * The root page contains the entire roster (~750 entries), so a single
 * request replaces hundreds of detail fetches for the initial catalog.
 */
export async function fetchListedDigimons(): Promise<SkullbotEntry[]> {
  const res = await fetchText(LIST_URL, { maxRetries: 3, timeoutMs: 30_000 });
  if (!res.ok || !res.data) {
    log.error('skullbot.list.fail', { status: res.status, error: res.error });
    return [];
  }
  const entries = parseSkullbotPage(res.data);
  log.info('skullbot.list.ok', { count: entries.length });
  return entries;
}

export type SkullbotDetail = {
  self: SkullbotEntry;
  evolvesFrom: SkullbotEntry[];
  evolvesInto: SkullbotEntry[];
};

/**
 * Fetch and parse one detail page. The self entry is the anchor that matches
 * the requested id; every other anchor on the page is a neighbour (either
 * prev or next in the digivolution chain — the page renders them top→bottom).
 */
export async function fetchDigimonDetail(id: number): Promise<SkullbotDetail | null> {
  const res = await fetchText(DETAIL_URL(id), { maxRetries: 3, timeoutMs: 25_000 });
  if (!res.ok || !res.data) {
    log.warn('skullbot.detail.fail', { id, status: res.status, error: res.error });
    return null;
  }
  const entries = parseSkullbotPage(res.data);
  const selfIdx = entries.findIndex((e) => e.skullbot_id === id);
  if (selfIdx === -1) return null;
  const self = entries[selfIdx];
  if (!self) return null;
  return {
    self,
    evolvesFrom: entries.slice(0, selfIdx),
    evolvesInto: entries.slice(selfIdx + 1),
  };
}

// ============================================================================
// DB persistence
// ============================================================================

const SQL_UPSERT_SCRAPED = `INSERT INTO scraped_catalog (skullbot_id, name, stage, attribute, portrait_url, dot_url, wikimon_slug, raw_json, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(skullbot_id) DO UPDATE SET
       name = excluded.name,
       stage = excluded.stage,
       attribute = excluded.attribute,
       portrait_url = excluded.portrait_url,
       dot_url = excluded.dot_url,
       raw_json = excluded.raw_json,
       scraped_at = excluded.scraped_at`;

/** Persist a batch of entries into the `scraped_catalog` table. */
export async function persistScraped(entries: SkullbotEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const now = Date.now();
  await tx(async (t) => {
    for (const e of entries) {
      await t.run(SQL_UPSERT_SCRAPED, [
        e.skullbot_id,
        e.name,
        e.stage,
        e.attribute,
        e.portrait_url,
        e.dot_url,
        e.name.replace(/\s+/g, '_'),
        JSON.stringify(e),
        now,
      ]);
    }
  });
  return entries.length;
}
