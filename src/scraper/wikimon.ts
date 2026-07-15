/**
 * wikimon.net scraper — enriches a scraped skullbot entry with:
 *   - Attack techniques (name + short description + japanese name when present)
 *   - Profile fields (Level, Class, Attribute, Type, Family, Prior forms…)
 *
 * wikimon uses MediaWiki with `<table class="wikitable">` sections. The
 * layout is stable enough for regex+strip to work well without pulling in
 * a real DOM library. We use small, defensive parsers — anything unexpected
 * degrades to "no data" rather than throwing.
 *
 * We DO NOT scrape image galleries (respect for bandwidth); skullbot supplies
 * the sprite + portrait we care about. Wikimon is used only for game logic
 * data: attack names → skill pool.
 */
import { fetchText } from './http.js';
import { log } from '../util/log.js';
import { ELEMENTS, type Element } from '../digimon/types.js';

const WIKIMON_BASE = 'https://wikimon.net';

export type WikimonAttack = {
  name: string;
  romaji?: string;
  japanese?: string;
  description?: string;
};

export type WikimonProfile = {
  level?: string;
  className?: string;
  attribute?: string;
  type?: string;
  family?: string[];
  priorForms?: string[];
  nextForms?: string[];
};

export type WikimonPage = {
  slug: string;
  url: string;
  attacks: WikimonAttack[];
  profile: WikimonProfile;
};

// ---------------------------------------------------------------------------
// Small HTML utilities. Kept private, none leak outside this file.
// ---------------------------------------------------------------------------

function stripTags(html: string): string {
  return html
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sliceSection(html: string, headlineId: string): string | null {
  const startRe = new RegExp(
    `<span[^>]+class="mw-headline"[^>]+id="${headlineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`,
  );
  const startMatch = startRe.exec(html);
  if (!startMatch) return null;
  const start = startMatch.index;
  const nextHeadline = /<span[^>]+class="mw-headline"[^>]+id="[^"]+"[^>]*>/g;
  nextHeadline.lastIndex = start + startMatch[0].length;
  const nextMatch = nextHeadline.exec(html);
  const end = nextMatch ? nextMatch.index : html.length;
  return html.slice(start, end);
}

function extractTable(section: string, indexHint = 0): string | null {
  const wikiRe = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
  let hits = 0;
  let m: RegExpExecArray | null = wikiRe.exec(section);
  while (m) {
    if (hits === indexHint) return m[0];
    hits += 1;
    m = wikiRe.exec(section);
  }
  const anyRe = /<table[^>]*>([\s\S]*?)<\/table>/g;
  hits = 0;
  m = anyRe.exec(section);
  while (m) {
    if (hits === indexHint) return m[0];
    hits += 1;
    m = anyRe.exec(section);
  }
  return null;
}

function iterRows(tableHtml: string): string[] {
  const rows: string[] = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null = re.exec(tableHtml);
  while (m) {
    if (m[1] !== undefined) rows.push(m[1]);
    m = re.exec(tableHtml);
  }
  return rows;
}

function iterCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const re = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/g;
  let m: RegExpExecArray | null = re.exec(rowHtml);
  while (m) {
    if (m[1] !== undefined) cells.push(m[1]);
    m = re.exec(rowHtml);
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Attack Techniques parser
// ---------------------------------------------------------------------------

function stripCitations(s: string): string {
  return s.replace(/\[\s*\d+\s*\]/g, '').replace(/\s+/g, ' ').trim();
}

function isCjk(s: string): boolean {
  if (!s) return false;
  const cjk = s.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g);
  return cjk !== null && cjk.length >= Math.ceil(s.length / 3);
}

/**
 * Wikimon Attack Techniques rows in practice:
 *   header: Name | Translation | Kanji/Kana | Romanization | Dub | Description
 *   data:   Name | [N] cite    | ""         | JAPANESE     | Romaji | (dub) | Description
 * So we do NOT drop empty cells — we KEEP positional order and pick by role:
 *   - name        = first non-empty cell that has real letters
 *   - japanese    = first CJK-heavy cell
 *   - romaji      = first non-CJK cell after `japanese`
 *   - description = last non-empty cell that isn't the name / a citation
 */
export function parseAttackTechniques(section: string): WikimonAttack[] {
  const table = extractTable(section, 0);
  if (!table) return [];
  const rows = iterRows(table);
  const attacks: WikimonAttack[] = [];
  const isHeaderRow = (row: string): boolean =>
    /(<th\b)/i.test(row) && !/^\s*<td/i.test(row);
  let headerConsumed = false;
  for (const rowHtml of rows) {
    if (!headerConsumed && isHeaderRow(rowHtml)) {
      headerConsumed = true;
      continue;
    }
    if (isHeaderRow(rowHtml)) continue;
    const cellsRaw = iterCells(rowHtml).map(stripTags);
    if (cellsRaw.length === 0) continue;
    const cells = cellsRaw.map(stripCitations);
    const name = cells.find((c) => c.length > 1 && /[A-Za-z]/.test(c));
    if (!name) continue;
    let japanese: string | undefined;
    let romaji: string | undefined;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i] ?? '';
      if (!c) continue;
      if (!japanese && isCjk(c)) {
        japanese = c;
        continue;
      }
      if (japanese && !romaji && !isCjk(c) && /[A-Za-zĀ-ž]/.test(c)) {
        romaji = c;
      }
    }
    const description = [...cells]
      .reverse()
      .find((c) => c.length > 3 && c !== name && !isCjk(c) && c !== romaji);
    const attack: WikimonAttack = { name };
    if (romaji) attack.romaji = romaji;
    if (japanese) attack.japanese = japanese;
    if (description) attack.description = description;
    attacks.push(attack);
    if (attacks.length >= 20) break;
  }
  return attacks;
}

// ---------------------------------------------------------------------------
// Profile parser
// ---------------------------------------------------------------------------

const PROFILE_KEYS: Record<string, keyof WikimonProfile> = {
  level: 'level',
  class: 'className',
  attribute: 'attribute',
  type: 'type',
  family: 'family',
  'prior forms': 'priorForms',
  'next forms': 'nextForms',
  'evolves from': 'priorForms',
  'evolves to': 'nextForms',
};

export function parseProfile(pageHtml: string): WikimonProfile {
  const profile: WikimonProfile = {};
  const boxRe = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
  let m: RegExpExecArray | null = boxRe.exec(pageHtml);
  let looked = 0;
  while (m && looked < 4) {
    looked += 1;
    const tableHtml = m[0];
    if (!/Level|Class|Attribute|Type/i.test(tableHtml)) {
      m = boxRe.exec(pageHtml);
      continue;
    }
    for (const rowHtml of iterRows(tableHtml)) {
      const cells = iterCells(rowHtml).map(stripTags);
      if (cells.length < 2) continue;
      const key = (cells[0] ?? '').toLowerCase();
      const value = cells.slice(1).join(', ').trim();
      const field = PROFILE_KEYS[key];
      if (!field || !value) continue;
      if (field === 'family' || field === 'priorForms' || field === 'nextForms') {
        profile[field] = value.split(/,|·|\//).map((s) => s.trim()).filter(Boolean);
      } else {
        profile[field] = value;
      }
    }
    break;
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchWikimonPage(slug: string): Promise<WikimonPage | null> {
  const encoded = encodeURIComponent(slug.trim());
  const url = `${WIKIMON_BASE}/${encoded}`;
  const res = await fetchText(url, { maxRetries: 2, timeoutMs: 30_000 });
  if (!res.ok || !res.data) {
    log.warn('wikimon.fetch.fail', { slug, url, status: res.status, error: res.error });
    return null;
  }
  const html = res.data;
  const section = sliceSection(html, 'Attack_Techniques') ?? '';
  const attacks = section ? parseAttackTechniques(section) : [];
  const profile = parseProfile(html);
  log.info('wikimon.fetch.ok', { slug, attacks: attacks.length });
  return { slug, url, attacks, profile };
}

// ---------------------------------------------------------------------------
// Attack → skill element heuristic. Very simple keyword mapping.
// The admin can always override in the XML catalog later.
// ---------------------------------------------------------------------------

const KEYWORD_TO_ELEMENT: Array<[RegExp, Element]> = [
  [/\b(fire|flame|inferno|burn|blaze|scorch|magma|ember|volcano|pyro)\b/i, 'fire'],
  [/\b(water|aqua|tide|tsunami|bubble|ocean|hydro|frost|ice|freeze|blizzard)\b/i, 'water'],
  [/\b(nature|plant|vine|leaf|forest|wood|bloom|petal|root|thorn|toxic|poison)\b/i, 'nature'],
  [/\b(electric|thunder|lightning|volt|shock|spark|storm|bolt|arc|zap)\b/i, 'electric'],
];

export function attackElement(attack: WikimonAttack, fallback: Element): Element {
  const haystack = `${attack.name} ${attack.description ?? ''}`;
  for (const [re, el] of KEYWORD_TO_ELEMENT) {
    if (re.test(haystack)) return el;
  }
  if ((ELEMENTS as readonly string[]).includes(fallback)) return fallback;
  return 'neutral';
}
