import { fetchText } from './http.js';
import { log } from '../util/log.js';
import { ATTRIBUTES, ELEMENTS, type Attribute, type Element, type ResistanceMap, type ResistanceMult } from '../digimon/types.js';

const GRINDOSAUR_BASE = 'https://www.grindosaur.com/en/games/digimon-story-time-stranger/digimon';

const TITLE_TO_MULT: Record<string, ResistanceMult> = {
  'no effect': 1,
  'double damage': 2,
  'one and a half damage': 1.5,
  'half damage': 0.5,
  'no damage': 0,
};

const HEADER_TO_ELEMENT: Record<string, Element> = {
  fire: 'fire',
  water: 'water',
  plant: 'plant',
  ice: 'ice',
  electricity: 'electricity',
  earth: 'earth',
  steel: 'steel',
  wind: 'wind',
  light: 'light',
  dark: 'dark',
  null: 'null',
};

const ATTRIBUTE_ALIAS: Record<string, Attribute> = {
  vaccine: 'Vaccine',
  data: 'Data',
  virus: 'Virus',
  free: 'Free',
  variable: 'Variable',
  unknown: 'Unknown',
  nodata: 'NoData',
  'no data': 'NoData',
  'no-data': 'NoData',
};

export type GrindosaurMonInfo = {
  readonly attribute: Attribute | null;
  readonly resistances: ResistanceMap | null;
};

export function nameToGrindosaurSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractResistanceTable(html: string, sectionHeader: string): { headers: string[]; values: string[] } | null {
  const headerRegex = new RegExp(`${sectionHeader}\\s*</h3>[\\s\\S]*?<table[^>]*>([\\s\\S]*?)</table>`, 'i');
  const tableMatch = html.match(headerRegex);
  if (!tableMatch) return null;
  const table = tableMatch[1] ?? '';
  const theadMatch = table.match(/<thead>([\s\S]*?)<\/thead>/i);
  const tbodyMatch = table.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!theadMatch || !tbodyMatch) return null;
  const headers = [...theadMatch[1]!.matchAll(/<img[^>]*title="([^"]+)"[^>]*>/gi)].map((m) => m[1]!.trim().toLowerCase());
  const firstRow = tbodyMatch[1]!.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (!firstRow) return null;
  const values = [...firstRow[1]!.matchAll(/<img[^>]*title="([^"]+)"[^>]*>/gi)].map((m) => m[1]!.trim().toLowerCase());
  return { headers, values };
}

function extractAttributeFromInfo(html: string): Attribute | null {
  const match = html.match(/<th[^>]*>\s*Attribute\s*<\/th>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i);
  if (!match) return null;
  const raw = match[1]!.trim().toLowerCase();
  return ATTRIBUTE_ALIAS[raw] ?? null;
}

function parseResistanceTable(html: string): ResistanceMap | null {
  const table = extractResistanceTable(html, 'Elemental Resistances');
  if (!table || table.headers.length === 0 || table.headers.length !== table.values.length) return null;
  const map: ResistanceMap = {};
  for (let i = 0; i < table.headers.length; i++) {
    const el = HEADER_TO_ELEMENT[table.headers[i]!];
    const mult = TITLE_TO_MULT[table.values[i]!];
    if (!el || mult === undefined || mult === 1) continue;
    if (!(ELEMENTS as readonly string[]).includes(el)) continue;
    map[el] = mult;
  }
  return map;
}

async function fetchGrindosaurPage(name: string, wikimonSlug?: string): Promise<{ slug: string; html: string } | null> {
  const candidates = [nameToGrindosaurSlug(name)];
  if (wikimonSlug && wikimonSlug !== name) {
    const alt = nameToGrindosaurSlug(wikimonSlug);
    if (!candidates.includes(alt)) candidates.push(alt);
  }
  for (const slug of candidates) {
    const url = `${GRINDOSAUR_BASE}/${slug}`;
    const res = await fetchText(url, { maxRetries: 2, timeoutMs: 30_000 });
    if (res.ok && res.data) return { slug, html: res.data };
    log.info('grindosaur.miss', { slug, status: res.status });
  }
  return null;
}

export async function scrapeResistances(name: string, wikimonSlug?: string): Promise<ResistanceMap | null> {
  const page = await fetchGrindosaurPage(name, wikimonSlug);
  if (!page) return null;
  const map = parseResistanceTable(page.html);
  if (!map) {
    log.info('grindosaur.no-table', { slug: page.slug });
    return null;
  }
  log.info('grindosaur.resistances.ok', { slug: page.slug, entries: Object.keys(map).length });
  return map;
}

export async function scrapeMonInfo(name: string, wikimonSlug?: string): Promise<GrindosaurMonInfo | null> {
  const page = await fetchGrindosaurPage(name, wikimonSlug);
  if (!page) return null;
  const attribute = extractAttributeFromInfo(page.html);
  const resistances = parseResistanceTable(page.html);
  if (!attribute && !resistances) {
    log.info('grindosaur.info.empty', { slug: page.slug });
    return null;
  }
  log.info('grindosaur.info.ok', {
    slug: page.slug,
    attribute,
    resistanceEntries: resistances ? Object.keys(resistances).length : 0,
  });
  return { attribute: attribute ?? null, resistances: resistances ?? null };
}

export function isKnownAttribute(v: string): v is Attribute {
  return (ATTRIBUTES as readonly string[]).includes(v);
}
