import { one, run, tx, type RosterRow } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import {
  CHIP_ITEM_IDS,
  EVOLUTION_LEVELS,
  MOOD_MIN_FOR_STAGE,
  nextStageAfter,
  type Stage,
  type TemplateDigimon,
} from '../digimon/types.js';
import { log } from '../util/log.js';

const SQL_SELECT_MON = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SELECT_INV_QTY = `SELECT qty FROM player_inventory WHERE user_id = ? AND item_id = ?`;
const SQL_DECREMENT_CHIP = `UPDATE player_inventory SET qty = qty - ?, updated_at = ? WHERE user_id = ? AND item_id = ? AND qty >= ?`;
const SQL_DELETE_EMPTY_INV = `DELETE FROM player_inventory WHERE user_id = ? AND item_id = ? AND qty <= 0`;
const SQL_SWAP_CATALOG = `UPDATE player_roster SET catalog_id = ?, nickname = ?, xp = 0, evolution_history = ?, equipped_skill_ids = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND catalog_id = ?`;

function parseHistory(raw: string | null): string[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

export type EvolveReason = 'no-paths' | 'level-too-low' | 'no-chip' | 'stage-cap' | 'no-mood';

export type EvolutionOption = {
  catalogId: string;
  name: string;
  stage: Stage;
  portrait: string;
};

export type EvolutionGate = {
  eligible: boolean;
  reason?: EvolveReason;
  currentStage: Stage;
  currentLevel: number;
  currentMood: number;
  nextStage: Stage | null;
  requiredLevel: number;
  requiredMood: number;
  requiredItemId: string | null;
  hasRequiredItem: boolean;
  options: EvolutionOption[];
};

function toOption(tpl: TemplateDigimon): EvolutionOption {
  return {
    catalogId: tpl.id,
    name: tpl.name,
    stage: tpl.stage,
    portrait: tpl.assets.portrait,
  };
}

export async function getEvolutionOptions(monId: string, userId: string): Promise<EvolutionGate | null> {
  const row = await one<RosterRow>(SQL_SELECT_MON, monId, userId);
  if (!row) return null;
  const catalog = loadCatalog();
  const current = catalog.digimons.find((d) => d.id === row.catalog_id);
  if (!current) return null;
  const nextStage = nextStageAfter(current.stage);
  const templateById = new Map(catalog.digimons.map((t) => [t.id, t]));
  const options: EvolutionOption[] = (current.evolvesInto ?? [])
    .map((id) => templateById.get(id))
    .filter((t): t is TemplateDigimon => Boolean(t))
    .map(toOption);
  const requiredLevel = nextStage ? EVOLUTION_LEVELS[nextStage] : Number.MAX_SAFE_INTEGER;
  const requiredMood = nextStage ? MOOD_MIN_FOR_STAGE[nextStage] ?? 0 : 0;
  const requiredItemId = nextStage ? CHIP_ITEM_IDS[nextStage] ?? null : null;
  let hasRequiredItem = false;
  if (requiredItemId) {
    const inv = await one<{ qty: number }>(SQL_SELECT_INV_QTY, userId, requiredItemId);
    hasRequiredItem = (inv?.qty ?? 0) > 0;
  }
  let eligible = true;
  let reason: EvolveReason | undefined;
  if (nextStage == null) { eligible = false; reason = 'stage-cap'; }
  else if (options.length === 0) { eligible = false; reason = 'no-paths'; }
  else if (row.level < requiredLevel) { eligible = false; reason = 'level-too-low'; }
  else if (row.mood < requiredMood) { eligible = false; reason = 'no-mood'; }
  else if (!hasRequiredItem) { eligible = false; reason = 'no-chip'; }
  return {
    eligible,
    ...(reason ? { reason } : {}),
    currentStage: current.stage,
    currentLevel: row.level,
    currentMood: row.mood,
    nextStage,
    requiredLevel,
    requiredMood,
    requiredItemId,
    hasRequiredItem,
    options,
  };
}

export type EvolveOutcome =
  | { ok: true; monId: string; fromCatalogId: string; toCatalogId: string; nickname: string; level: number; stage: Stage }
  | { ok: false; error: string };

export async function evolveRoster(
  monId: string,
  userId: string,
  targetCatalogId: string,
): Promise<EvolveOutcome> {
  const gate = await getEvolutionOptions(monId, userId);
  if (!gate) return { ok: false, error: 'mon not found' };
  if (!gate.eligible) return { ok: false, error: gate.reason ?? 'not-eligible' };
  if (!gate.options.some((o) => o.catalogId === targetCatalogId)) {
    return { ok: false, error: 'invalid target' };
  }
  const row = await one<RosterRow>(SQL_SELECT_MON, monId, userId);
  if (!row) return { ok: false, error: 'mon not found' };
  const catalog = loadCatalog();
  const current = catalog.digimons.find((d) => d.id === row.catalog_id);
  const target = catalog.digimons.find((d) => d.id === targetCatalogId);
  if (!current || !target) return { ok: false, error: 'template not found' };

  const newNickname = row.nickname === current.name ? target.name : row.nickname;
  const chipItemId = gate.requiredItemId as string;
  const now = Date.now();

  try {
    await tx(async (t) => {
      const consumed = await t.run(SQL_DECREMENT_CHIP, [1, now, userId, chipItemId, 1]);
      if (consumed.changes === 0) throw new Error('no-chip');
      const priorHistory = parseHistory(row.evolution_history);
      const nextHistory = priorHistory.includes(current.id) ? priorHistory : [...priorHistory, current.id];
      const historyJson = JSON.stringify(nextHistory);
      const swap = await t.run(SQL_SWAP_CATALOG, [target.id, newNickname, historyJson, now, monId, userId, current.id]);
      if (swap.changes === 0) throw new Error('race-conflict');
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'tx-failed';
    return { ok: false, error: msg };
  }
  await run(SQL_DELETE_EMPTY_INV, userId, chipItemId);
  log.info('roster.evolved', { userId, monId, from: current.id, to: target.id, nickname: newNickname });
  return { ok: true, monId, fromCatalogId: current.id, toCatalogId: target.id, nickname: newNickname, level: row.level, stage: target.stage };
}
