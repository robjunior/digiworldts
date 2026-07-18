import {
  applyAction,
  initPveBattle,
  serializeForSide,
  type Loadout,
  type LoadoutMember,
} from '../battle/engine.js';
import type { Action, Battle, BattleView } from '../battle/types.js';
import { q, run, tx, type RosterRow } from '../db/index.js';
import { findTemplate, loadCatalog } from '../digimon/xml.js';
import type { BaseStats, Stage } from '../digimon/types.js';
import { applyGrowth, awardXp, xpFromDefeats, xpToReach, type DefeatedFoe, type MatchOutcome } from '../progression/xp.js';
import { awardSpeciesData, type SpeciesAward } from '../nursery/data.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { generateItemDrop, type ItemDrop, type WildMon } from './engine.js';

const MAX_WILD_ACTIONS_PER_TURN = 6;

const ITEM_DROP_ON_WIN_RATE = 0.20;

const SQL_SELECT_PARTY = `SELECT * FROM player_roster WHERE user_id = ? AND status = 'party' ORDER BY slot_index`;
const SQL_INSERT_MON = `
  INSERT INTO player_roster
      (id, user_id, catalog_id, nickname,
       level, xp,
       hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus,
       mood, status, slot_index,
       created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 50, 'resting', NULL, ?, ?)
`;
const SQL_UPSERT_INVENTORY = `
  INSERT INTO player_inventory (user_id, item_id, qty, updated_at)
       VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, item_id) DO UPDATE
       SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at
`;
const SQL_UPDATE_MON_XP = `
  UPDATE player_roster
     SET level = ?, xp = ?,
         hp_bonus = ?, en_bonus = ?, atk_bonus = ?, def_bonus = ?, int_bonus = ?, spd_bonus = ?,
         updated_at = ?
   WHERE id = ?
`;
const SQL_SET_REVIVE_AT = `UPDATE player_roster SET revive_at = ?, updated_at = ? WHERE id = ?`;
const SQL_ADD_CREDITS = `
  INSERT INTO player_wallet (user_id, credits, streak_day, updated_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET credits = player_wallet.credits + excluded.credits, updated_at = excluded.updated_at
`;
const SQL_ADD_BITS = `
  INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, 'Bits', ?, ?)
       ON CONFLICT(user_id, resource) DO UPDATE SET amount = resources.amount + excluded.amount, updated_at = excluded.updated_at
`;

const REVIVE_COOLDOWN_MS = 5 * 60 * 1000;
const CREDITS_PER_WILD_LEVEL = 1;
const CREDITS_MIN_WIN = 5;
const BITS_PER_WILD_LEVEL = 2;
const BITS_MIN_WIN = 10;

function creditsForWin(defeated: readonly { level: number }[]): number {
  if (defeated.length === 0) return 0;
  const raw = defeated.reduce((sum, w) => sum + w.level, 0) * CREDITS_PER_WILD_LEVEL;
  return Math.max(CREDITS_MIN_WIN, raw);
}

function bitsForWin(defeated: readonly { level: number }[]): number {
  if (defeated.length === 0) return 0;
  const raw = defeated.reduce((sum, w) => sum + w.level, 0) * BITS_PER_WILD_LEVEL;
  return Math.max(BITS_MIN_WIN, raw);
}

const activeByUser = new Map<string, Battle>();

function advanceWildAI(battle: Battle): void {
  let safetyCount = 0;
  while (battle.status === 'active' && safetyCount < MAX_WILD_ACTIONS_PER_TURN) {
    const head = battle.turnQueue[battle.turnCursor];
    if (!head || head.side !== 'b') return;
    const wild = battle.units.find((u) => u.id === head.unitId);
    if (!wild || wild.hp <= 0) return;
    const alivePlayers = battle.units.filter((u) => u.side === 'a' && u.hp > 0);
    if (alivePlayers.length === 0) return;
    const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)]!;
    applyAction(battle, 'b', { type: 'fight', unitId: wild.id, targetId: target.id });
    safetyCount += 1;
  }
}

async function buildPlayerLoadout(userId: string): Promise<Loadout | null> {
  const rows = await q<RosterRow>(SQL_SELECT_PARTY, userId);
  if (rows.length !== 3) return null;
  const now = Date.now();
  const anyAlive = rows.some((r) => r.revive_at === null || r.revive_at <= now);
  if (!anyAlive) return null;
  const catalog = loadCatalog();
  const members: LoadoutMember[] = [];
  for (const row of rows) {
    const tpl = findTemplate(catalog, row.catalog_id);
    if (!tpl) return null;
    const isDown = row.revive_at !== null && row.revive_at > now;
    const member: LoadoutMember = {
      monId: row.id,
      templateId: row.catalog_id,
      template: tpl,
      level: row.level,
      nickname: row.nickname,
      statBonus: {
        hp: row.hp_bonus,
        en: row.en_bonus,
        atk: row.atk_bonus,
        def: row.def_bonus,
        int: row.int_bonus,
        spd: row.spd_bonus,
      },
    };
    if (isDown) member.downedAtStart = true;
    members.push(member);
  }
  return { playerId: userId, members: [members[0]!, members[1]!, members[2]!] };
}

export type StartResult =
  | { ok: true; view: BattleView }
  | { ok: false; error: 'party-invalid' | 'catalog-missing' | 'battle-in-progress' };

export async function startPveBattleFromEncounter(userId: string, wilds: WildMon[]): Promise<StartResult> {
  if (activeByUser.has(userId)) {
    return { ok: false, error: 'battle-in-progress' };
  }
  if (!wilds || wilds.length === 0) {
    return { ok: false, error: 'catalog-missing' };
  }
  const playerLoadout = await buildPlayerLoadout(userId);
  if (!playerLoadout) return { ok: false, error: 'party-invalid' };
  const catalog = loadCatalog();
  const wildParty: Array<{ member: LoadoutMember; wildInfo: { catalogId: string; rare: boolean } }> = [];
  for (const wildMon of wilds) {
    const tpl = findTemplate(catalog, wildMon.catalogId);
    if (!tpl) return { ok: false, error: 'catalog-missing' };
    // Grant wild mons the same per-level stat growth an allied mon would
    // accumulate leveling from 1 -> wildMon.level, so they're not stat-starved
    // vs. player Digimon who benefit from applyGrowth on every level up.
    const wildBonus = applyGrowth(
      { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 },
      tpl.stage as Stage,
      Math.max(0, wildMon.level - 1),
    );
    wildParty.push({
      member: {
        monId: newId('wild'),
        templateId: wildMon.catalogId,
        template: tpl,
        level: wildMon.level,
        nickname: wildMon.name,
        statBonus: wildBonus,
      },
      wildInfo: { catalogId: wildMon.catalogId, rare: wildMon.rare },
    });
  }
  const battle = initPveBattle({ playerLoadout, wildParty });
  activeByUser.set(userId, battle);
  advanceWildAI(battle);
  if (battle.status === 'ended') {
    activeByUser.delete(userId);
  }
  log.info('world.pve.start', {
    userId,
    matchId: battle.id,
    wildCount: wilds.length,
    catalogIds: wilds.map((w) => w.catalogId),
    levels: wilds.map((w) => w.level),
    rareCount: wilds.filter((w) => w.rare).length,
  });
  return { ok: true, view: serializeForSide(battle, 'a') };
}

export function getPveBattleView(userId: string): BattleView | null {
  const battle = activeByUser.get(userId);
  return battle ? serializeForSide(battle, 'a') : null;
}

export function abandonPveBattle(userId: string): boolean {
  return activeByUser.delete(userId);
}

export type XpAward = {
  monId: string;
  nickname: string;
  delta: number;
  previousLevel: number;
  newLevel: number;
  gainedLevels: number;
  xpBefore: number;
  xpAfter: number;
  xpFloor: number;
  xpNext: number;
  defeated: boolean;
};

export type ActResult =
  | {
      ok: true;
      view: BattleView;
      ended: boolean;
      capturedMonId?: string;
      xpAwards?: XpAward[];
      itemDrop?: ItemDrop;
      speciesAwards?: SpeciesAward[];
      creditsGained?: number;
      bitsGained?: number;
    }
  | { ok: false; error: string; code?: string };

async function awardPveBattleRewards(
  userId: string,
  battle: Battle,
): Promise<{ xpAwards: XpAward[]; itemDrop?: ItemDrop; speciesAwards?: SpeciesAward[]; creditsGained?: number; bitsGained?: number }> {
  const outcome = battle.outcome;
  if (!outcome) return { xpAwards: [] };

  let matchOutcome: MatchOutcome;
  if (outcome === 'win_a' || outcome === 'captured_a') matchOutcome = 'win';
  else if (outcome === 'win_b') matchOutcome = 'loss';
  else if (outcome === 'fled_a') matchOutcome = 'fled';
  else return { xpAwards: [] };

  const catalog = loadCatalog();
  const myUnits = battle.units.filter((u) => u.side === 'a');
  const participantSlots = new Set<number>(myUnits.map((u) => u.slot));
  const defeatedForXp: DefeatedFoe[] = matchOutcome === 'win'
    ? battle.units
        .filter((u) => u.side === 'b')
        .map((u) => {
          const catalogId = u.wildInfo?.catalogId ?? u.templateId;
          const stage = findTemplate(catalog, catalogId)?.stage ?? 'Rookie';
          return { stage, level: u.level };
        })
    : [];
  const defeatedForData: Array<{ catalogId: string; stage: Stage; rare: boolean }> = matchOutcome === 'win'
    ? battle.units
        .filter((u) => u.side === 'b' && u.wildInfo)
        .map((u) => {
          const wi = u.wildInfo!;
          const stage = findTemplate(catalog, wi.catalogId)?.stage ?? 'Rookie';
          return { catalogId: wi.catalogId, stage, rare: wi.rare };
        })
    : [];
  const xpPerParticipant = xpFromDefeats(defeatedForXp, myUnits.length, false);
  const speciesAwards = defeatedForData.length > 0 ? await awardSpeciesData(userId, defeatedForData) : [];
  const creditsGained = matchOutcome === 'win' ? creditsForWin(defeatedForXp) : 0;
  const bitsGained = matchOutcome === 'win' ? bitsForWin(defeatedForXp) : 0;
  if (creditsGained > 0 || bitsGained > 0) {
    const now = Date.now();
    await tx(async (t) => {
      if (creditsGained > 0) await t.run(SQL_ADD_CREDITS, [userId, creditsGained, now]);
      if (bitsGained > 0) await t.run(SQL_ADD_BITS, [userId, bitsGained, now]);
    });
  }

  const partyRows = await q<RosterRow>(SQL_SELECT_PARTY, userId);
  const now = Date.now();
  const xpAwards: XpAward[] = [];

  for (const row of partyRows) {
    if (row.slot_index === null || !participantSlots.has(row.slot_index)) continue;
    const template = findTemplate(catalog, row.catalog_id);
    if (!template) continue;

    const unit = battle.units.find((u) => u.side === 'a' && u.slot === row.slot_index);
    const isDefeated = unit ? unit.hp <= 0 : false;
    const previousLevel = row.level;
    const previousXp = row.xp;
    const currentBonus: BaseStats = {
      hp: row.hp_bonus,
      en: row.en_bonus,
      atk: row.atk_bonus,
      def: row.def_bonus,
      int: row.int_bonus,
      spd: row.spd_bonus,
    };

    let delta = 0;
    let nextLevel = previousLevel;
    let nextXp = previousXp;
    let nextBonus = currentBonus;
    let gainedLevels = 0;
    let didChange = false;

    if (isDefeated) {
      const penalty = Math.round(previousXp * 0.1);
      if (penalty > 0) {
        const currentLevelFloor = xpToReach(previousLevel, template.stage);
        nextXp = Math.max(currentLevelFloor, previousXp - penalty);
        delta = nextXp - previousXp;
        didChange = delta !== 0;
      }
    } else if (matchOutcome === 'win' && xpPerParticipant > 0) {
      const result = awardXp(previousLevel, previousXp, currentBonus, template.stage, xpPerParticipant);
      const grownFloor = xpToReach(result.level, template.stage);
      nextXp = Math.max(grownFloor, result.xp);
      nextLevel = result.level;
      nextBonus = result.bonus;
      gainedLevels = result.gainedLevels;
      delta = xpPerParticipant;
      didChange = true;
    }

    if (didChange) {
      await run(SQL_UPDATE_MON_XP, [
        nextLevel,
        nextXp,
        nextBonus.hp,
        nextBonus.en,
        nextBonus.atk,
        nextBonus.def,
        nextBonus.int,
        nextBonus.spd,
        now,
        row.id,
      ]);
    }

    xpAwards.push({
      monId: row.id,
      nickname: row.nickname,
      delta,
      previousLevel,
      newLevel: nextLevel,
      gainedLevels,
      xpBefore: previousXp,
      xpAfter: nextXp,
      xpFloor: xpToReach(nextLevel, template.stage),
      xpNext: xpToReach(nextLevel + 1, template.stage),
      defeated: isDefeated,
    });
  }

  let itemDrop: ItemDrop | undefined;
  if (matchOutcome === 'win' && Math.random() < ITEM_DROP_ON_WIN_RATE) {
    const drop = await generateItemDrop();
    if (drop) {
      await grantItemDrop(userId, drop);
      itemDrop = drop;
    }
  }

  // A KO'd ally goes on a revive cooldown regardless of match outcome — they
  // are unavailable for the next PVE battle until the timer expires or a
  // revive item is used from the roster page.
  const reviveDeadline = now + REVIVE_COOLDOWN_MS;
  const downedIds: string[] = [];
  for (const row of partyRows) {
    if (row.slot_index === null) continue;
    const unit = battle.units.find((u) => u.side === 'a' && u.slot === row.slot_index);
    if (unit && unit.hp <= 0) {
      await run(SQL_SET_REVIVE_AT, [reviveDeadline, now, row.id]);
      downedIds.push(row.id);
    }
  }

  if (xpAwards.length > 0 || itemDrop || downedIds.length > 0 || speciesAwards.length > 0 || creditsGained > 0 || bitsGained > 0) {
    log.info('world.pve.rewards', {
      userId,
      outcome,
      wildLevels: battle.units.filter((u) => u.side === 'b').map((u) => u.level),
      xpDeltas: xpAwards.map((a) => a.delta),
      leveledUpMons: xpAwards.filter((a) => a.gainedLevels > 0).map((a) => a.nickname),
      itemDrop: itemDrop?.itemId,
      downedMonIds: downedIds,
      speciesAwards: speciesAwards.map((a) => ({ id: a.catalogId, tier: a.tier, pct: a.percent })),
      creditsGained,
      bitsGained,
    });
  }

  const result: { xpAwards: XpAward[]; itemDrop?: ItemDrop; speciesAwards?: SpeciesAward[]; creditsGained?: number; bitsGained?: number } = { xpAwards };
  if (itemDrop) result.itemDrop = itemDrop;
  if (speciesAwards.length > 0) result.speciesAwards = speciesAwards;
  if (creditsGained > 0) result.creditsGained = creditsGained;
  if (bitsGained > 0) result.bitsGained = bitsGained;
  return result;
}

export async function actInPveBattle(userId: string, action: Action): Promise<ActResult> {
  const battle = activeByUser.get(userId);
  if (!battle) return { ok: false, error: 'no active PVE battle', code: 'no-battle' };
  const result = applyAction(battle, 'a', action);
  if (!result.ok) return { ok: false, error: result.error, ...(result.code ? { code: result.code } : {}) };

  if (battle.status === 'active') {
    advanceWildAI(battle);
  }

  let capturedMonId: string | undefined;
  const ended = battle.status === 'ended';
  let xpAwards: XpAward[] = [];
  let itemDrop: ItemDrop | undefined;
  let speciesAwards: SpeciesAward[] | undefined;
  let creditsGained: number | undefined;
  let bitsGained: number | undefined;

  if (ended) {
    if (battle.outcome === 'captured_a') {
      const wildUnit = battle.units.find((u) => u.side === 'b' && u.wildInfo);
      if (wildUnit && wildUnit.wildInfo) {
        const monId = newId('mon');
        const now = Date.now();
        await run(SQL_INSERT_MON, [
          monId,
          userId,
          wildUnit.wildInfo.catalogId,
          wildUnit.name,
          wildUnit.level,
          now,
          now,
        ]);
        capturedMonId = monId;
        log.info('world.pve.captured', {
          userId,
          monId,
          catalogId: wildUnit.wildInfo.catalogId,
          level: wildUnit.level,
        });
      }
    }
    const rewards = await awardPveBattleRewards(userId, battle);
    xpAwards = rewards.xpAwards;
    itemDrop = rewards.itemDrop;
    speciesAwards = rewards.speciesAwards;
    creditsGained = rewards.creditsGained;
    bitsGained = rewards.bitsGained;
    activeByUser.delete(userId);
  }

  const response: ActResult = {
    ok: true,
    view: serializeForSide(battle, 'a'),
    ended,
  };
  if (capturedMonId) response.capturedMonId = capturedMonId;
  if (xpAwards.length > 0) response.xpAwards = xpAwards;
  if (itemDrop) response.itemDrop = itemDrop;
  if (speciesAwards && speciesAwards.length > 0) response.speciesAwards = speciesAwards;
  if (creditsGained !== undefined && creditsGained > 0) response.creditsGained = creditsGained;
  if (bitsGained !== undefined && bitsGained > 0) response.bitsGained = bitsGained;
  return response;
}

export async function grantItemDrop(userId: string, drop: ItemDrop): Promise<void> {
  const now = Date.now();
  await run(SQL_UPSERT_INVENTORY, [userId, drop.itemId, drop.qty, now]);
  log.info('world.drop.grant', { userId, itemId: drop.itemId, qty: drop.qty });
}

export function hasActivePveBattle(userId: string): boolean {
  return activeByUser.has(userId);
}
