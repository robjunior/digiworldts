/**
 * Scraper CLI.
 *
 * Usage:
 *   pnpm scrape --list                     # refresh scraped_catalog from skullbot list page
 *   pnpm scrape --enrich [--limit N]       # enrich N entries via wikimon (default: 20)
 *   pnpm scrape --assets [--limit N]       # download portrait+dot for XML catalog entries
 *   pnpm scrape --all                      # list + enrich + assets, sensible defaults
 *   pnpm scrape --detail <skullbotId>      # sanity: fetch + print one detail page
 *
 * All modes are safe to re-run — they use upserts and skip already-cached files.
 */
import { fetchListedDigimons, persistScraped, fetchDigimonDetail } from './skullbot.js';
import { fetchWikimonPage, attackElement, type WikimonPage } from './wikimon.js';
import { scrapeResistances, scrapeMonInfo } from './grindosaur.js';
import { downloadAssetBatch, hasLocalAssets, type AssetJob } from './assets.js';
import { one, q, run, closeDbAdapter, type ScrapedRow } from '../db/index.js';
import { loadCatalog, saveCatalog, upsertTemplate, findTemplate } from '../digimon/xml.js';
import { attributeToElement, defaultStatsForStage } from '../digimon/element.js';
import { log } from '../util/log.js';
import { SKILLS_PER_DIGIMON, MAX_ENERGY, type Skill, type TemplateDigimon } from '../digimon/types.js';

type Mode = 'list' | 'enrich' | 'assets' | 'all' | 'detail' | 'resistances' | 'refresh' | 'help';

function parseArgs(argv: string[]): { mode: Mode; limit: number; detailId?: number } {
  let mode: Mode = 'help';
  let limit = 20;
  let detailId: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') mode = 'list';
    else if (a === '--enrich') mode = 'enrich';
    else if (a === '--assets') mode = 'assets';
    else if (a === '--all') mode = 'all';
    else if (a === '--resistances') mode = 'resistances';
    else if (a === '--refresh') mode = 'refresh';
    else if (a === '--detail') {
      mode = 'detail';
      const next = argv[i + 1];
      if (next) {
        detailId = Number(next);
        i++;
      }
    } else if (a === '--limit') {
      const next = argv[i + 1];
      if (next) {
        limit = Number(next);
        i++;
      }
    } else if (a === '--help' || a === '-h') mode = 'help';
  }
  if (limit <= 0 || !Number.isFinite(limit)) limit = 20;
  const out: { mode: Mode; limit: number; detailId?: number } = { mode, limit };
  if (detailId !== undefined) out.detailId = detailId;
  return out;
}

function printHelp(): void {
  process.stdout.write(
    [
      'pnpm scrape --list                     refresh scraped_catalog from the skullbot list page',
      'pnpm scrape --enrich [--limit N]       enrich N entries via wikimon (default 20)',
      'pnpm scrape --assets [--limit N]       download portrait+dot for XML catalog entries',
      'pnpm scrape --all                      list + enrich + assets',
      'pnpm scrape --resistances [--limit N]  scrape per-mon Element resistance tables from wikimon (default all)',
      'pnpm scrape --refresh [--limit N]      pull authoritative attribute + resistances from grindosaur and update the catalog XML in place',
      'pnpm scrape --detail <skullbotId>      fetch + print one detail page',
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// list mode
// ---------------------------------------------------------------------------

async function runList(): Promise<void> {
  const entries = await fetchListedDigimons();
  if (entries.length === 0) {
    log.error('scrape.list.empty');
    return;
  }
  const n = await persistScraped(entries);
  log.info('scrape.list.persisted', { entries: n });
}

// ---------------------------------------------------------------------------
// enrich mode
// ---------------------------------------------------------------------------

const SQL_SELECT_ENRICHABLE = `SELECT * FROM scraped_catalog WHERE wikimon_slug IS NOT NULL ORDER BY skullbot_id LIMIT ?`;
const SQL_MARK_ENRICHED = `UPDATE scraped_catalog SET raw_json = ?, scraped_at = ? WHERE skullbot_id = ?`;
const SQL_MARK_IN_CATALOG = `UPDATE scraped_catalog SET in_catalog = 1 WHERE skullbot_id = ?`;
const SQL_SELECT_SCRAPED_BY_ID = `SELECT * FROM scraped_catalog WHERE skullbot_id = ?`;

function chooseFourSkills(
  attacks: WikimonPage['attacks'],
  fallbackTemplate: TemplateDigimon,
): Skill[] {
  const chosen: Skill[] = [];
  const seen = new Set<string>();
  for (const a of attacks) {
    if (chosen.length >= SKILLS_PER_DIGIMON) break;
    const key = a.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const el = attackElement(a, fallbackTemplate.element);
    const idx = chosen.length;
    const cost = idx === 0 ? 0 : Math.min(MAX_ENERGY, 6 + idx * 10 + (idx === 3 ? 8 : 0));
    const power = idx === 0 ? 100 : 140 + idx * 80;
    const description = a.description ?? a.romaji ?? a.name;
    chosen.push({
      id: `s${idx}`,
      name: a.name.slice(0, 40),
      element: el,
      energyCost: cost,
      power,
      description,
    });
  }
  while (chosen.length < SKILLS_PER_DIGIMON) {
    const idx = chosen.length;
    const cost = idx === 0 ? 0 : Math.min(MAX_ENERGY, 8 + idx * 10);
    chosen.push({
      id: `s${idx}`,
      name: idx === 0 ? 'Slash' : idx === 1 ? 'Focus Strike' : idx === 2 ? 'Rampage' : 'Overdrive',
      element: fallbackTemplate.element,
      energyCost: cost,
      power: idx === 0 ? 100 : 140 + idx * 80,
    });
  }
  return chosen;
}

function buildTemplateFromScraped(row: ScrapedRow, wikimon: WikimonPage | null, evolvesInto: string[]): TemplateDigimon {
  const attrEnumSafe = row.attribute as TemplateDigimon['attribute'];
  const element = attributeToElement(attrEnumSafe);
  const stage = row.stage as TemplateDigimon['stage'];
  const baseStats = defaultStatsForStage(stage);
  const catalogId = `skb-${row.skullbot_id}`;
  const skeleton: TemplateDigimon = {
    id: catalogId,
    name: row.name,
    stage,
    attribute: attrEnumSafe,
    element,
    baseStats,
    skillPool: [],
    assets: {
      portrait: `/assets/digimon/${catalogId}/portrait.webp`,
      dot: `/assets/digimon/${catalogId}/dot.gif`,
    },
    sourceUrl: `https://api.skullbot.fr/digimon/${row.skullbot_id}`,
  };
  if (row.wikimon_slug) skeleton.wikimonSlug = row.wikimon_slug;
  skeleton.skillPool = chooseFourSkills(wikimon?.attacks ?? [], skeleton);
  if (evolvesInto.length > 0) skeleton.evolvesInto = evolvesInto;
  return skeleton;
}

async function runEnrich(limit: number): Promise<void> {
  const rows = await q<ScrapedRow>(SQL_SELECT_ENRICHABLE, limit);
  if (rows.length === 0) {
    log.info('scrape.enrich.empty');
    return;
  }
  log.info('scrape.enrich.begin', { candidates: rows.length });
  const catalog = loadCatalog();
  let mutated = catalog;
  let updated = 0;
  const now = Date.now();
  for (const row of rows) {
    const slug = row.wikimon_slug ?? row.name.replace(/\s+/g, '_');
    const wm = await fetchWikimonPage(slug);
    const detail = await fetchDigimonDetail(row.skullbot_id);
    const evolvesInto = detail?.evolvesInto.map((e) => `skb-${e.skullbot_id}`) ?? [];
    const template = buildTemplateFromScraped(row, wm, evolvesInto);
    mutated = upsertTemplate(mutated, template);
    updated += 1;
    let base: Record<string, unknown> = {};
    try { base = JSON.parse(row.raw_json) as Record<string, unknown>; } catch { base = {}; }
    const patched = { ...base, wikimon: wm ?? { attacks: [], profile: {} }, evolvesInto };
    await run(SQL_MARK_ENRICHED, JSON.stringify(patched), now, row.skullbot_id);
    await run(SQL_MARK_IN_CATALOG, row.skullbot_id);
  }
  saveCatalog(mutated);
  log.info('scrape.enrich.done', { updated, catalogSize: mutated.digimons.length });
}

// ---------------------------------------------------------------------------
// assets mode
// ---------------------------------------------------------------------------

async function runAssets(limit: number): Promise<void> {
  const catalog = loadCatalog();
  if (catalog.digimons.length === 0) {
    log.warn('scrape.assets.empty-catalog');
    return;
  }
  const jobs: AssetJob[] = [];
  for (const d of catalog.digimons) {
    if (hasLocalAssets(d.id)) continue;
    const skb = /^skb-(\d+)$/.exec(d.id);
    if (skb && skb[1]) {
      const id = Number(skb[1]);
      const row = await one<ScrapedRow>(SQL_SELECT_SCRAPED_BY_ID, id);
      if (row) {
        jobs.push({ catalogId: d.id, portraitUrl: row.portrait_url, dotUrl: row.dot_url });
        continue;
      }
    }
    if (/^https?:\/\//.test(d.assets.portrait) && /^https?:\/\//.test(d.assets.dot)) {
      jobs.push({ catalogId: d.id, portraitUrl: d.assets.portrait, dotUrl: d.assets.dot });
    }
    if (jobs.length >= limit) break;
  }
  if (jobs.length === 0) {
    log.info('scrape.assets.nothing-missing');
    return;
  }
  log.info('scrape.assets.begin', { jobs: jobs.length });
  const { summary } = await downloadAssetBatch(jobs);
  log.info('scrape.assets.done', summary);
}

// ---------------------------------------------------------------------------
// detail mode (sanity)
// ---------------------------------------------------------------------------

async function runDetail(id: number): Promise<void> {
  const d = await fetchDigimonDetail(id);
  if (!d) {
    process.stderr.write(`no detail for id=${id}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(JSON.stringify(d, null, 2) + '\n');
}

async function runResistances(limit: number): Promise<void> {
  const catalog = loadCatalog();
  const targets = catalog.digimons.filter((t) => !t.resistances);
  const bounded = targets.slice(0, Number.isFinite(limit) && limit > 0 ? limit : targets.length);
  log.info('scrape.resistances.begin', { candidates: targets.length, running: bounded.length });
  let updated = catalog;
  let count = 0;
  for (const tpl of bounded) {
    const map = await scrapeResistances(tpl.name, tpl.wikimonSlug);
    if (map !== null) {
      updated = upsertTemplate(updated, { ...tpl, resistances: map });
      count += 1;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (count > 0) {
    saveCatalog(updated);
  }
  log.info('scrape.resistances.done', { updated: count, attempted: bounded.length });
}

function resistancesEqual(a: TemplateDigimon['resistances'], b: TemplateDigimon['resistances']): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const k = aKeys[i] as keyof NonNullable<TemplateDigimon['resistances']>;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

async function runRefresh(limit: number): Promise<void> {
  const catalog = loadCatalog();
  const bounded = catalog.digimons.slice(0, Number.isFinite(limit) && limit > 0 ? limit : catalog.digimons.length);
  log.info('scrape.refresh.begin', { candidates: bounded.length });
  let updated = catalog;
  let attrChanges = 0;
  let resChanges = 0;
  let typeChanges = 0;
  let elementChanges = 0;
  let missing = 0;
  for (const tpl of bounded) {
    const info = await scrapeMonInfo(tpl.name, tpl.wikimonSlug);
    if (info === null) {
      missing += 1;
      await new Promise((r) => setTimeout(r, 250));
      continue;
    }
    const next: TemplateDigimon = { ...tpl };
    let touched = false;
    if (info.attribute && info.attribute !== tpl.attribute) {
      log.info('scrape.refresh.attribute-change', { id: tpl.id, name: tpl.name, from: tpl.attribute, to: info.attribute });
      next.attribute = info.attribute;
      attrChanges += 1;
      touched = true;
    }
    if (info.type && info.type !== tpl.type) {
      log.info('scrape.refresh.type-change', { id: tpl.id, name: tpl.name, from: tpl.type ?? null, to: info.type });
      next.type = info.type;
      typeChanges += 1;
      touched = true;
    }
    if (info.element && info.element !== tpl.element) {
      log.info('scrape.refresh.element-change', { id: tpl.id, name: tpl.name, from: tpl.element, to: info.element });
      next.element = info.element;
      elementChanges += 1;
      touched = true;
    }
    if (info.resistances !== null && !resistancesEqual(tpl.resistances, info.resistances)) {
      next.resistances = info.resistances;
      resChanges += 1;
      touched = true;
    }
    if (touched) {
      updated = upsertTemplate(updated, next);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (attrChanges > 0 || resChanges > 0 || typeChanges > 0 || elementChanges > 0) {
    saveCatalog(updated);
  }
  log.info('scrape.refresh.done', {
    attempted: bounded.length,
    missing,
    attributeChanges: attrChanges,
    typeChanges,
    elementChanges,
    resistanceChanges: resChanges,
  });
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'help') {
    printHelp();
    return;
  }
  try {
    if (args.mode === 'list') await runList();
    else if (args.mode === 'enrich') await runEnrich(args.limit);
    else if (args.mode === 'assets') await runAssets(args.limit);
    else if (args.mode === 'resistances') await runResistances(args.limit);
    else if (args.mode === 'refresh') await runRefresh(args.limit);
    else if (args.mode === 'detail') {
      if (args.detailId == null) {
        process.stderr.write('--detail requires an id\n');
        process.exitCode = 1;
        return;
      }
      await runDetail(args.detailId);
    } else if (args.mode === 'all') {
      await runList();
      await runEnrich(args.limit);
      await runAssets(args.limit);
      const cat = loadCatalog();
      if (cat.digimons.length > 0 && !findTemplate(cat, cat.digimons[0]!.id)) {
        log.warn('scrape.all.warn.catalog-lookup-mismatch');
      }
    }
  } finally {
    await closeDbAdapter();
  }
}

main().catch((err: unknown) => {
  log.error('scrape.cli.fail', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
