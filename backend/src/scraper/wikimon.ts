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
import { ELEMENTS, type Element, type ResistanceMap, type ResistanceMult } from '../digimon/types.js';

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
  [/\b(water|aqua|tide|tsunami|bubble|ocean|hydro|hydro|drown|drench)\b/i, 'water'],
  [/\b(ice|freeze|blizzard|frost|glacier|snow|arctic)\b/i, 'ice'],
  [/\b(plant|vine|leaf|forest|wood|bloom|petal|root|thorn|toxic|poison|nature)\b/i, 'plant'],
  [/\b(electric|electricity|thunder|lightning|volt|shock|spark|bolt|arc|zap)\b/i, 'electricity'],
  [/\b(earth|rock|stone|quake|boulder|terra|mud|geo|land)\b/i, 'earth'],
  [/\b(steel|metal|iron|blade|sword|armor|chrome|digizoid)\b/i, 'steel'],
  [/\b(wind|air|gale|storm|cyclone|tornado|hurricane|sky|breeze)\b/i, 'wind'],
  [/\b(light|holy|radiant|beam|shine|solar|aura|divine)\b/i, 'light'],
  [/\b(dark|shadow|abyss|void|night|nether|doom|curse)\b/i, 'dark'],
];

export function attackElement(attack: WikimonAttack, fallback: Element): Element {
  const haystack = `${attack.name} ${attack.description ?? ''}`;
  for (const [re, el] of KEYWORD_TO_ELEMENT) {
    if (re.test(haystack)) return el;
  }
  if ((ELEMENTS as readonly string[]).includes(fallback)) return fallback;
  return 'null';
}

const WIKIMON_TABLE_ELEMENT_ALIAS: Record<string, Element> = {
  fire: 'fire',
  water: 'water',
  plant: 'plant',
  nature: 'plant',
  ice: 'ice',
  electric: 'electricity',
  electricity: 'electricity',
  earth: 'earth',
  steel: 'steel',
  metal: 'steel',
  wind: 'wind',
  light: 'light',
  holy: 'light',
  dark: 'dark',
  null: 'null',
  neutral: 'null',
};

function parseMultSymbol(cell: string): ResistanceMult | null {
  const s = cell.replace(/<[^>]*>/g, '').trim().toLowerCase();
  if (s.includes('2x') || s.includes('◉') || s.includes('⦿')) return 2;
  if (s.includes('1.5x') || s.includes('○') || s.includes('◯')) return 1.5;
  if (s.includes('0.5x') || s.includes('△') || s.includes('▲')) return 0.5;
  if (s.includes('no damage') || s.includes('✕') || s.includes('×') || s.includes('immune')) return 0;
  if (s === '—' || s === '-' || s === '' || s.includes('no effect')) return 1;
  return null;
}

export async function scrapeResistances(slug: string): Promise<ResistanceMap | null> {
  try {
    const url = `${WIKIMON_BASE}/${encodeURIComponent(slug.trim())}`;
    const res = await fetchText(url, { maxRetries: 2, timeoutMs: 30_000 });
    if (!res.ok || !res.data) {
      log.warn('wikimon.resistances.fetch-fail', { slug, url, status: res.status, error: res.error });
      return null;
    }
    const html = res.data;
    const tableMatch = html.match(/Elemental\s*Resistances?[\s\S]{0,200}?<table[\s\S]*?<\/table>/i);
    if (!tableMatch) {
      log.info('wikimon.resistances.missing', { slug });
      return null;
    }
    const table = tableMatch[0];
    const headerRow = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/);
    const rowMatches = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    if (rowMatches.length < 2 || !headerRow) return null;
    const headers = [...headerRow[1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, '').trim().toLowerCase());
    const values = [...rowMatches[1]![1]!.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => m[1]!);
    const map: ResistanceMap = {};
    for (let i = 0; i < headers.length && i < values.length; i++) {
      const el = WIKIMON_TABLE_ELEMENT_ALIAS[headers[i]!];
      if (!el) continue;
      const mult = parseMultSymbol(values[i]!);
      if (mult === null || mult === 1) continue;
      map[el] = mult;
    }
    if (Object.keys(map).length === 0) return null;
    log.info('wikimon.resistances.ok', { slug, entries: Object.keys(map).length });
    return map;
  } catch (err) {
    log.warn('wikimon.resistances.error', { slug, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
