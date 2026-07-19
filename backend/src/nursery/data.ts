import type { DbAdapter } from '../db/adapter.js';
import { one, q, tx, type PendingHatchRow, type SpeciesDataRow } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import { CHIP_ITEM_IDS, type Stage, type TemplateDigimon } from '../digimon/types.js';
import { xpToReach } from '../progression/xp.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

export type Tier = 'common' | 'uncommon' | 'rare';

const DATA_AMOUNT: Record<Tier, number> = {
  common: 25,
  uncommon: 10,
  rare: 1,
};

export const HATCH_DURATION_MS = 3 * 60 * 1000;
export const HATCH_LEVEL = 5;

export function rarityTier(rare: boolean, stage: Stage): Tier {
  if (rare) return 'rare';
  if (stage === 'Rookie' || stage === 'Baby' || stage === 'In-Training') return 'common';
  return 'uncommon';
}

export function dataAmountFor(tier: Tier): number {
  return DATA_AMOUNT[tier];
}

const SQL_UPSERT_DATA = `
  INSERT INTO player_species_data (user_id, catalog_id, percent, kills, updated_at)
       VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(user_id, catalog_id) DO UPDATE
       SET percent = LEAST(100, player_species_data.percent + excluded.percent),
           kills = player_species_data.kills + 1,
           updated_at = excluded.updated_at
`;

const SQL_ZERO_DATA = `UPDATE player_species_data SET percent = 0, updated_at = ? WHERE user_id = ? AND catalog_id = ?`;
const SQL_ZERO_ALL_DATA = `UPDATE player_species_data SET percent = 0, updated_at = ? WHERE user_id = ?`;
const SQL_SELECT_DATA_BY_ID = `SELECT * FROM player_species_data WHERE user_id = ? AND catalog_id = ?`;
const SQL_SELECT_ALL_DATA = `SELECT * FROM player_species_data WHERE user_id = ? ORDER BY percent DESC, kills DESC`;

const SQL_INSERT_PENDING = `INSERT INTO player_pending_hatches (id, user_id, target_catalog, rookie_catalog, chip_items, hatch_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`;
const SQL_SELECT_PENDING = `SELECT * FROM player_pending_hatches WHERE user_id = ? ORDER BY hatch_at`;
const SQL_SELECT_PENDING_BY_ID = `SELECT * FROM player_pending_hatches WHERE id = ? AND user_id = ?`;
const SQL_DELETE_PENDING = `DELETE FROM player_pending_hatches WHERE id = ? AND user_id = ?`;
const SQL_INSERT_ROSTER = `
  INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, hp_bonus, atk_bonus, def_bonus, spd_bonus, mood, status, slot_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 50, 'resting', NULL, ?, ?)
`;
const SQL_UPSERT_INVENTORY = `
  INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, item_id) DO UPDATE
       SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at
`;

export type SpeciesAward = { catalogId: string; tier: Tier; percent: number; kills: number };

export async function awardSpeciesData(userId: string, defeated: readonly { catalogId: string; stage: Stage; rare: boolean }[]): Promise<SpeciesAward[]> {
  if (defeated.length === 0) return [];
  const now = Date.now();
  const grouped = new Map<string, { tier: Tier; amount: number }>();
  for (const w of defeated) {
    const tier = rarityTier(w.rare, w.stage);
    const amount = dataAmountFor(tier);
    const prev = grouped.get(w.catalogId);
    if (prev) prev.amount += amount;
    else grouped.set(w.catalogId, { tier, amount });
  }
  const awards: SpeciesAward[] = [];
  await tx(async (t) => {
    for (const [catalogId, { tier, amount }] of grouped) {
      await t.run(SQL_UPSERT_DATA, [userId, catalogId, amount, now]);
      const row = await t.one<SpeciesDataRow>(SQL_SELECT_DATA_BY_ID, [userId, catalogId]);
      if (row) awards.push({ catalogId, tier, percent: row.percent, kills: row.kills });
    }
  });
  return awards;
}

const reverseGraphCache = new WeakMap<readonly TemplateDigimon[], Map<string, string[]>>();

function reverseGraph(catalog: readonly TemplateDigimon[]): Map<string, string[]> {
  const cached = reverseGraphCache.get(catalog);
  if (cached) return cached;
  const graph = new Map<string, string[]>();
  for (const t of catalog) {
    for (const target of t.evolvesInto ?? []) {
      const list = graph.get(target) ?? [];
      list.push(t.id);
      graph.set(target, list);
    }
  }
  reverseGraphCache.set(catalog, graph);
  return graph;
}

export type HatchPath = { rookieId: string; targetId: string; chain: string[]; chipItems: string[] };

export function hatchPathTo(catalogId: string, catalog: readonly TemplateDigimon[]): HatchPath | null {
  const templateById = new Map(catalog.map((t) => [t.id, t] as const));
  const target = templateById.get(catalogId);
  if (!target) return null;
  if (target.stage === 'Rookie') {
    return { rookieId: target.id, targetId: target.id, chain: [target.id], chipItems: [] };
  }
  const rev = reverseGraph(catalog);
  const queue: Array<{ id: string; path: string[] }> = [{ id: catalogId, path: [catalogId] }];
  const seen = new Set<string>([catalogId]);
  while (queue.length > 0) {
    const node = queue.shift()!;
    const tpl = templateById.get(node.id);
    if (!tpl) continue;
    if (tpl.stage === 'Rookie') {
      const chain = node.path.slice().reverse();
      const chipItems: string[] = [];
      for (let i = 1; i < chain.length; i++) {
        const step = templateById.get(chain[i]!);
        if (!step) continue;
        const chip = CHIP_ITEM_IDS[step.stage];
        if (chip) chipItems.push(chip);
      }
      return { rookieId: tpl.id, targetId: catalogId, chain, chipItems };
    }
    for (const parent of rev.get(node.id) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      queue.push({ id: parent, path: [...node.path, parent] });
    }
  }
  return null;
}

export type PendingHatchView = {
  id: string;
  targetCatalogId: string;
  targetName: string;
  targetStage: string;
  rookieCatalogId: string;
  rookieName: string;
  rookieDot: string;
  chipItemIds: string[];
  hatchAt: number;
  ready: boolean;
};

function toPendingView(row: PendingHatchRow, catalog: readonly TemplateDigimon[], now: number): PendingHatchView {
  const templateById = new Map(catalog.map((t) => [t.id, t] as const));
  const target = templateById.get(row.target_catalog);
  const rookie = templateById.get(row.rookie_catalog);
  const chipItemIds = row.chip_items ? tryParseStringArray(row.chip_items) : [];
  return {
    id: row.id,
    targetCatalogId: row.target_catalog,
    targetName: target?.name ?? row.target_catalog,
    targetStage: target?.stage ?? '?',
    rookieCatalogId: row.rookie_catalog,
    rookieName: rookie?.name ?? row.rookie_catalog,
    rookieDot: rookie?.assets.dot ?? `/assets/digimon/${row.rookie_catalog}/dot.gif`,
    chipItemIds,
    hatchAt: row.hatch_at,
    ready: row.hatch_at <= now,
  };
}

function tryParseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

export async function listSpeciesData(userId: string): Promise<SpeciesDataRow[]> {
  return q<SpeciesDataRow>(SQL_SELECT_ALL_DATA, userId);
}

export async function listPendingHatches(userId: string): Promise<PendingHatchView[]> {
  const rows = await q<PendingHatchRow>(SQL_SELECT_PENDING, userId);
  const now = Date.now();
  return rows.map((r) => toPendingView(r, loadCatalog().digimons, now));
}

export type HatchStartResult =
  | { ok: true; pending: PendingHatchView }
  | { ok: false; error: 'not-enough-data' | 'template-missing' | 'no-path' | 'unknown' };

export async function startDirectHatch(userId: string, catalogId: string): Promise<HatchStartResult> {
  const catalog = loadCatalog().digimons;
  const path = hatchPathTo(catalogId, catalog);
  if (!path) return { ok: false, error: 'no-path' };
  const row = await one<SpeciesDataRow>(SQL_SELECT_DATA_BY_ID, userId, catalogId);
  if (!row || row.percent < 100) return { ok: false, error: 'not-enough-data' };
  return insertPending(userId, path, () => runZeroSingle(userId, catalogId));
}

export type MixHatchResult =
  | { ok: true; pending: PendingHatchView; rolledCatalogId: string; totalWeight: number }
  | { ok: false; error: 'no-data' | 'no-path' };

export async function startMixHatch(userId: string): Promise<MixHatchResult> {
  const dataRows = await listSpeciesData(userId);
  const entries = dataRows.filter((r) => r.percent > 0);
  const totalWeight = entries.reduce((sum, r) => sum + r.percent, 0);
  if (entries.length === 0 || totalWeight === 0) return { ok: false, error: 'no-data' };
  let roll = Math.random() * totalWeight;
  let picked: SpeciesDataRow | null = null;
  for (const entry of entries) {
    roll -= entry.percent;
    if (roll <= 0) { picked = entry; break; }
  }
  if (picked === null) picked = entries[entries.length - 1]!;
  const catalog = loadCatalog().digimons;
  const path = hatchPathTo(picked.catalog_id, catalog);
  if (!path) return { ok: false, error: 'no-path' };
  const started = await insertPending(userId, path, () => runZeroAll(userId));
  if (!started.ok) return { ok: false, error: 'no-path' };
  return { ok: true, pending: started.pending, rolledCatalogId: picked.catalog_id, totalWeight };
}

async function runZeroSingle(userId: string, catalogId: string): Promise<(t: DbAdapter) => Promise<void>> {
  return async (t: DbAdapter): Promise<void> => {
    await t.run(SQL_ZERO_DATA, [Date.now(), userId, catalogId]);
  };
}

async function runZeroAll(userId: string): Promise<(t: DbAdapter) => Promise<void>> {
  return async (t: DbAdapter): Promise<void> => {
    await t.run(SQL_ZERO_ALL_DATA, [Date.now(), userId]);
  };
}

async function insertPending(userId: string, path: HatchPath, cleanup: () => Promise<(t: DbAdapter) => Promise<void>>): Promise<HatchStartResult> {
  const catalog = loadCatalog().digimons;
  const now = Date.now();
  const id = newId('hatch');
  const chipItemsJson = path.chipItems.length > 0 ? JSON.stringify(path.chipItems) : null;
  const runCleanup = await cleanup();
  await tx(async (t) => {
    await runCleanup(t);
    await t.run(SQL_INSERT_PENDING, [id, userId, path.targetId, path.rookieId, chipItemsJson, now + HATCH_DURATION_MS, now]);
  });
  const row = await one<PendingHatchRow>(SQL_SELECT_PENDING_BY_ID, id, userId);
  if (!row) return { ok: false, error: 'unknown' };
  log.info('nursery.hatch.start', { userId, hatchId: id, target: path.targetId, rookie: path.rookieId, chipItems: path.chipItems });
  return { ok: true, pending: toPendingView(row, catalog, Date.now()) };
}

export type CollectResult =
  | { ok: true; monId: string; rookieCatalogId: string; nickname: string; chipItemIds: string[] }
  | { ok: false; error: 'not-found' | 'not-ready' | 'template-missing' };

export async function collectHatch(userId: string, hatchId: string): Promise<CollectResult> {
  const row = await one<PendingHatchRow>(SQL_SELECT_PENDING_BY_ID, hatchId, userId);
  if (!row) return { ok: false, error: 'not-found' };
  const now = Date.now();
  if (row.hatch_at > now) return { ok: false, error: 'not-ready' };
  const catalog = loadCatalog().digimons;
  const rookieTpl = catalog.find((t) => t.id === row.rookie_catalog);
  if (!rookieTpl) return { ok: false, error: 'template-missing' };
  const monId = newId('mon');
  const nickname = rookieTpl.name;
  const startingXp = xpToReach(HATCH_LEVEL, 'Rookie');
  const chipItems = row.chip_items ? tryParseStringArray(row.chip_items) : [];
  await tx(async (t) => {
    await t.run(SQL_INSERT_ROSTER, [monId, userId, rookieTpl.id, nickname, HATCH_LEVEL, startingXp, now, now]);
    for (const chipId of chipItems) {
      await t.run(SQL_UPSERT_INVENTORY, [userId, chipId, 1, now]);
    }
    await t.run(SQL_DELETE_PENDING, [hatchId, userId]);
  });
  log.info('nursery.hatch.collect', { userId, hatchId, monId, rookie: rookieTpl.id, chipItems });
  return { ok: true, monId, rookieCatalogId: rookieTpl.id, nickname, chipItemIds: chipItems };
}
