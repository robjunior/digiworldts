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
import { log } from '../util/log.js';
import { essenceIdFor, coreIdFor, sigilIdFor, rarityForStage } from '../evolution/items.js';

const SQL_SELECT_MON = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SWAP_CATALOG = `UPDATE player_roster SET catalog_id = ?, nickname = ?, xp = 0, evolution_history = ?, equipped_skill_ids = ?, stage_pools = ?, signature_skill_id = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND catalog_id = ?`;

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
  /** All items required for this evolution (essence + core + sigil). */
  requiredItems?: { itemId: string; name: string; qty: number; available: number }[];
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

  // Every evolution requires 3 items derived from the TARGET digimon:
  //   1. Elemental Essence (element of target)
  //   2. Rarity Core (rarity of target's stage)
  //   3. Archetype Sigil (type of target)
  const options: EvolutionOption[] = [];
  for (const edge of edges) {
    const target = templateById.get(edge.targetId);
    if (!target) continue;
    const req = resolveEdgeRequirements(edge, target.stage);

    // Compute the 3 required items for this target
    const essenceId = essenceIdFor(target.element);
    const coreId = coreIdFor(rarityForStage(target.stage));
    const sigilId = sigilIdFor(target.type ?? 'unknown');

    const [essenceQty, coreQty, sigilQty] = await Promise.all([
      countItem(userId, essenceId),
      countItem(userId, coreId),
      countItem(userId, sigilId),
    ]);

    const [essenceName, coreName, sigilName] = await Promise.all([
      one<{ name: string }>('SELECT name FROM shop_items WHERE id = ?', essenceId).then(r => r?.name ?? essenceId),
      one<{ name: string }>('SELECT name FROM shop_items WHERE id = ?', coreId).then(r => r?.name ?? coreId),
      one<{ name: string }>('SELECT name FROM shop_items WHERE id = ?', sigilId).then(r => r?.name ?? sigilId),
    ]);

    let reason: EvolveReason | undefined;
    if (req.requiredAttribute !== null && current.attribute !== req.requiredAttribute) reason = 'attribute-mismatch';
    else if (row.level < req.requiredLevel) reason = 'level-too-low';
    else if (row.mood < req.requiredMood) reason = 'no-mood';
    else if (essenceQty < 1) reason = 'missing-item';
    else if (coreQty < 1) reason = 'missing-item';
    else if (sigilQty < 1) reason = 'missing-item';

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
      requiredItemId: essenceId,
      requiredItemName: essenceName,
      requiredItemQty: 1,
      itemQtyAvailable: essenceQty,
      requiredItems: [
        { itemId: essenceId, name: essenceName, qty: 1, available: essenceQty },
        { itemId: coreId, name: coreName, qty: 1, available: coreQty },
        { itemId: sigilId, name: sigilName, qty: 1, available: sigilQty },
      ],
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

  // Consume all 3 required items (essence + core + sigil)
  const requiredItems = selectedOption.requiredItems ?? [];
  if (requiredItems.length === 0) return { ok: false, error: 'no-items-assigned' };

  const equippedDefaults = await getDefaultEquippedForStage(
    target.element,
    target.stage,
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
      for (const item of requiredItems) {
        const removed = await removeItem(userId, item.itemId, item.qty, now, t);
        if (!removed) throw new Error('missing-item');
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
    consumedItems: requiredItems.map((i) => `${i.itemId}×${i.qty}`),
  });
  return { ok: true, monId, fromCatalogId: current.id, toCatalogId: target.id, nickname: newNickname, level: row.level, stage: target.stage };
}
