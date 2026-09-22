import { one, q, tx, type RosterRow } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import {
  EVOLUTION_LEVELS,
  MOOD_MIN_FOR_STAGE,
  STAGES,
  STAGE_COMBAT_POOL,
  STAGE_HPEN_POOL,
  defaultMaxedPools,
  nextStageAfter,
  type Attribute,
  type EvolveEdge,
  type Stage,
  type StageAlloc,
  type StagePools,
  type TemplateDigimon,
} from '../digimon/types.js';
import { getDefaultEquippedForStage } from '../skills/pool.js';
import { computeMetSet } from '../dex/met.js';
import { countItem, removeItem } from '../items/grant.js';
import { hasFlag } from '../flags/repo.js';
import { rarityFromRankOrCommon, type Rarity } from '@digiworld/shared/item-rarity';
import { applyRarityEvolutionBonus } from './rarity-bonus.js';
import { log } from '../util/log.js';

const SQL_SELECT_MON = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SWAP_CATALOG = `UPDATE player_roster SET catalog_id = ?, nickname = ?, xp = 0, evolution_history = ?, equipped_skill_ids = ?, stage_pools = ?, updated_at = ? WHERE id = ? AND user_id = ? AND catalog_id = ?`;

function freezeCurrentStagePool(row: RosterRow, currentStage: Stage): StagePools {
  const priorPools = row.stage_pools
    ? JSON.parse(row.stage_pools) as StagePools
    : defaultMaxedPools(currentStage);
  let priorCombat = 0;
  let priorHpen = 0;
  for (const s of STAGES) {
    if (s === currentStage) break;
    priorCombat += priorPools[s]?.combat ?? 0;
    priorHpen += priorPools[s]?.hpen ?? 0;
  }
  const bonusCombat = row.atk_bonus + row.def_bonus + row.int_bonus + row.spd_bonus;
  const bonusHpen = row.hp_bonus + row.en_bonus;
  const currentAlloc: StageAlloc = {
    combat: Math.max(0, Math.min(STAGE_COMBAT_POOL[currentStage], bonusCombat - priorCombat)),
    hpen: Math.max(0, Math.min(STAGE_HPEN_POOL[currentStage], bonusHpen - priorHpen)),
  };
  return { ...priorPools, [currentStage]: currentAlloc };
}

function parseHistory(raw: string | null): string[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

export type EvolveReason =
  | 'no-paths'
  | 'level-too-low'
  | 'stage-cap'
  | 'no-mood'
  | 'attribute-mismatch'
  | 'missing-item'
  | 'no-item-assigned';

export type EvolutionOption = {
  catalogId: string;
  name: string;
  stage: Stage;
  portrait: string;
  /** Has the player ever seen this species? (Not "meets requirements" — that's `eligible`.) */
  met: boolean;
  eligible: boolean;
  reason?: EvolveReason;
  requiredLevel: number;
  requiredMood: number;
  requiredAttribute: Attribute | null;
  requiredItemId: string | null;
  requiredItemName: string | null;
  requiredItemQty: number;
  itemQtyAvailable: number;
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
  options: EvolutionOption[];
};

function resolveEdgeRequirements(edge: EvolveEdge, targetStage: Stage): {
  requiredLevel: number;
  requiredMood: number;
  requiredAttribute: Attribute | null;
  requiredItemId: string | null;
  requiredItemQty: number;
} {
  const requiredLevel = edge.requiredLevel ?? EVOLUTION_LEVELS[targetStage];
  const requiredMood = edge.requiredMood ?? MOOD_MIN_FOR_STAGE[targetStage] ?? 0;
  const requiredAttribute = edge.requiredAttribute ?? null;
  const requiredItemId = edge.requiredItemId ?? null;
  const requiredItemQty = requiredItemId === null ? 0 : Math.max(1, edge.requiredItemQty ?? 1);
  return { requiredLevel, requiredMood, requiredAttribute, requiredItemId, requiredItemQty };
}

export async function getEvolutionOptions(monId: string, userId: string): Promise<EvolutionGate | null> {
  const row = await one<RosterRow>(SQL_SELECT_MON, monId, userId);
  if (!row) return null;
  const catalog = loadCatalog();
  const current = catalog.digimons.find((d) => d.id === row.catalog_id);
  if (!current) return null;
  const nextStage = nextStageAfter(current.stage);
  const templateById = new Map<string, TemplateDigimon>(catalog.digimons.map((t) => [t.id, t]));
  const metSet = await computeMetSet(userId);

  const edges = current.evolvesInto ?? [];
  const itemIdsNeeded = new Set<string>();
  for (const edge of edges) {
    if (edge.requiredItemId !== undefined) itemIdsNeeded.add(edge.requiredItemId);
  }
  const itemCounts = new Map<string, number>();
  for (const itemId of itemIdsNeeded) {
    itemCounts.set(itemId, await countItem(userId, itemId));
  }
  const itemNames = new Map<string, string>();
  if (itemIdsNeeded.size > 0) {
    const ids = Array.from(itemIdsNeeded);
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await q<{ readonly id: string; readonly name: string }>(
      `SELECT id, name FROM shop_items WHERE id IN (${placeholders})`,
      ...ids,
    );
    for (const row of rows) itemNames.set(row.id, row.name);
  }

  const options: EvolutionOption[] = [];
  for (const edge of edges) {
    const target = templateById.get(edge.targetId);
    if (!target) continue;
    const req = resolveEdgeRequirements(edge, target.stage);
    const itemQtyAvailable = req.requiredItemId === null ? 0 : itemCounts.get(req.requiredItemId) ?? 0;
    const requiredItemName = req.requiredItemId === null ? null : itemNames.get(req.requiredItemId) ?? req.requiredItemId;

    let reason: EvolveReason | undefined;
    if (req.requiredAttribute !== null && current.attribute !== req.requiredAttribute) reason = 'attribute-mismatch';
    else if (row.level < req.requiredLevel) reason = 'level-too-low';
    else if (row.mood < req.requiredMood) reason = 'no-mood';
    // Content pipeline: EVERY evolution requires a chosen item. An edge with no
    // assigned item is blocked (the admin unlocks paths by creating items and
    // assigning them to edges — see digimon-content-deploy skill).
    else if (req.requiredItemId === null) reason = 'no-item-assigned';
    else if (itemQtyAvailable < req.requiredItemQty) reason = 'missing-item';

    const option: EvolutionOption = {
      catalogId: target.id,
      name: target.name,
      stage: target.stage,
      portrait: target.assets.portrait,
      met: metSet.has(target.id),
      eligible: reason === undefined,
      requiredLevel: req.requiredLevel,
      requiredMood: req.requiredMood,
      requiredAttribute: req.requiredAttribute,
      requiredItemId: req.requiredItemId,
      requiredItemName,
      requiredItemQty: req.requiredItemQty,
      itemQtyAvailable,
    };
    if (reason !== undefined) option.reason = reason;
    options.push(option);
  }

  const topRequiredLevel = nextStage ? EVOLUTION_LEVELS[nextStage] : Number.MAX_SAFE_INTEGER;
  const topRequiredMood = nextStage ? MOOD_MIN_FOR_STAGE[nextStage] ?? 0 : 0;

  const anyEligibleOption = options.some((o) => o.eligible);
  let eligible = true;
  let topReason: EvolveReason | undefined;
  if (nextStage == null) { eligible = false; topReason = 'stage-cap'; }
  else if (options.length === 0) { eligible = false; topReason = 'no-paths'; }
  else if (!anyEligibleOption) {
    eligible = false;
    const firstOption = options[0];
    topReason = firstOption?.reason ?? 'level-too-low';
  }

  return {
    eligible,
    ...(topReason ? { reason: topReason } : {}),
    currentStage: current.stage,
    currentLevel: row.level,
    currentMood: row.mood,
    nextStage,
    requiredLevel: topRequiredLevel,
    requiredMood: topRequiredMood,
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
  const selectedOption = gate.options.find((o) => o.catalogId === targetCatalogId);
  if (!selectedOption) return { ok: false, error: 'invalid target' };
  if (!selectedOption.eligible) return { ok: false, error: selectedOption.reason ?? 'not-eligible' };

  const row = await one<RosterRow>(SQL_SELECT_MON, monId, userId);
  if (!row) return { ok: false, error: 'mon not found' };
  const catalog = loadCatalog();
  const current = catalog.digimons.find((d) => d.id === row.catalog_id);
  const target = catalog.digimons.find((d) => d.id === targetCatalogId);
  if (!current || !target) return { ok: false, error: 'template not found' };

  const newNickname = row.nickname === current.name ? target.name : row.nickname;
  const now = Date.now();

  let consumedRarity: Rarity | null = null;
  let applyBonusEnabled = false;
  if (selectedOption.requiredItemId !== null) {
    const itemRow = await one<{ rarity: number }>('SELECT rarity FROM shop_items WHERE id = ?', selectedOption.requiredItemId);
    if (itemRow) {
      consumedRarity = rarityFromRankOrCommon(itemRow.rarity);
      applyBonusEnabled = consumedRarity !== 'common' && await hasFlag(userId, 'rarity-bonuses');
    }
  }

  const equippedDefaults = await getDefaultEquippedForStage(
    target.element,
    target.stage,
    applyBonusEnabled ? consumedRarity ?? undefined : undefined,
  );
  const equippedJson = JSON.stringify(equippedDefaults);

  try {
    await tx(async (t) => {
      const priorHistory = parseHistory(row.evolution_history);
      const nextHistory = priorHistory.includes(current.id) ? priorHistory : [...priorHistory, current.id];
      const historyJson = JSON.stringify(nextHistory);
      const frozenPools = freezeCurrentStagePool(row, current.stage);
      const stagePoolsJson = JSON.stringify(frozenPools);
      const swap = await t.run(SQL_SWAP_CATALOG, [target.id, newNickname, historyJson, equippedJson, stagePoolsJson, now, monId, userId, current.id]);
      if (swap.changes === 0) throw new Error('race-conflict');
      if (selectedOption.requiredItemId !== null) {
        const removed = await removeItem(userId, selectedOption.requiredItemId, selectedOption.requiredItemQty, now, t);
        if (!removed) throw new Error('missing-item');
      }
      if (applyBonusEnabled && consumedRarity !== null) {
        await applyRarityEvolutionBonus(monId, userId, consumedRarity, now, t);
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'tx-failed';
    return { ok: false, error: msg };
  }
  log.info('roster.evolved', {
    userId,
    monId,
    from: current.id,
    to: target.id,
    nickname: newNickname,
    ...(selectedOption.requiredItemId !== null ? { consumedItemId: selectedOption.requiredItemId, consumedItemQty: selectedOption.requiredItemQty } : {}),
    ...(applyBonusEnabled && consumedRarity !== null ? { rarityBonus: consumedRarity } : {}),
  });
  return { ok: true, monId, fromCatalogId: current.id, toCatalogId: target.id, nickname: newNickname, level: row.level, stage: target.stage };
}
