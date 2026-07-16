import {
  applyAction,
  initPveBattle,
  serializeForSide,
  type Loadout,
  type LoadoutMember,
} from '../battle/engine.js';
import type { Action, Battle, BattleView } from '../battle/types.js';
import { one, q, run, type RosterRow } from '../db/index.js';
import { findTemplate, loadCatalog } from '../digimon/xml.js';
import type { BaseStats, Stage } from '../digimon/types.js';
import { applyGrowth, awardXp, xpReward, xpToReach, type MatchOutcome } from '../progression/xp.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { generateItemDrop, type ItemDrop, type WildMon } from './engine.js';

const MAX_WILD_ACTIONS_PER_TURN = 6;

// PVE reward calibration.
//   Target: 10 encounters at L1 vs same-level wild = ~1 level up.
//   xpReward('win', 1, 1) = 45. 45 * PVE_XP_SCALE(0.8) = 36 XP/win.
//   10 wins = 360 XP; xpToReach(2) = 352 XP -> exactly 1 level. Curve
//   is L^1.55 so higher levels take proportionally more encounters.
//   Losses subtract PVE_LOSS_XP_FACTOR(0.4) of what a win would grant,
//   clamped so you can never DEMOTE below your current level's floor.
const PVE_XP_SCALE = 0.8;
const PVE_LOSS_XP_FACTOR = 0.4;
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

const REVIVE_COOLDOWN_MS = 5 * 60 * 1000;

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
  if (rows.some((r) => r.revive_at !== null && r.revive_at > now)) return null;
  const catalog = loadCatalog();
  const members: LoadoutMember[] = [];
  for (const row of rows) {
    const tpl = findTemplate(catalog, row.catalog_id);
    if (!tpl) return null;
    members.push({
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
    });
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
  newLevel: number;
  gainedLevels: number;
};

export type ActResult =
  | {
      ok: true;
      view: BattleView;
      ended: boolean;
      capturedMonId?: string;
      xpAwards?: XpAward[];
      itemDrop?: ItemDrop;
    }
  | { ok: false; error: string; code?: string };

async function awardPveBattleRewards(
  userId: string,
  battle: Battle,
): Promise<{ xpAwards: XpAward[]; itemDrop?: ItemDrop }> {
  const outcome = battle.outcome;
  if (!outcome) return { xpAwards: [] };

  let matchOutcome: MatchOutcome;
  if (outcome === 'win_a' || outcome === 'captured_a') matchOutcome = 'win';
  else if (outcome === 'win_b') matchOutcome = 'loss';
  else if (outcome === 'fled_a') matchOutcome = 'fled';
  else return { xpAwards: [] };

  const wildUnit = battle.units.find((u) => u.side === 'b' && u.wildInfo);
  const wildLevel = wildUnit?.level ?? 1;

  const partyRows = await q<RosterRow>(SQL_SELECT_PARTY, userId);
  const catalog = loadCatalog();
  const now = Date.now();
  const xpAwards: XpAward[] = [];

  for (const row of partyRows) {
    const template = findTemplate(catalog, row.catalog_id);
    if (!template) continue;

    let delta: number;
    if (matchOutcome === 'win') {
      const win = xpReward('win', row.level, wildLevel);
      delta = Math.round(win * PVE_XP_SCALE);
    } else if (matchOutcome === 'loss') {
      const wouldWin = xpReward('win', row.level, wildLevel);
      delta = -Math.round(wouldWin * PVE_XP_SCALE * PVE_LOSS_XP_FACTOR);
    } else {
      delta = 0;
    }
    if (delta === 0) continue;

    const currentBonus: BaseStats = {
      hp: row.hp_bonus,
      en: row.en_bonus,
      atk: row.atk_bonus,
      def: row.def_bonus,
      int: row.int_bonus,
      spd: row.spd_bonus,
    };
    const result = awardXp(row.level, row.xp, currentBonus, template.stage, delta);
    const floor = xpToReach(row.level);
    const clampedXp = Math.max(floor, result.xp);
    const clampedLevel = Math.max(row.level, result.level);

    await run(SQL_UPDATE_MON_XP, [
      clampedLevel,
      clampedXp,
      result.bonus.hp,
      result.bonus.en,
      result.bonus.atk,
      result.bonus.def,
      result.bonus.int,
      result.bonus.spd,
      now,
      row.id,
    ]);

    xpAwards.push({
      monId: row.id,
      nickname: row.nickname,
      delta,
      newLevel: clampedLevel,
      gainedLevels: Math.max(0, clampedLevel - row.level),
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

  if (xpAwards.length > 0 || itemDrop || downedIds.length > 0) {
    log.info('world.pve.rewards', {
      userId,
      outcome,
      wildLevel,
      xpDeltas: xpAwards.map((a) => a.delta),
      leveledUpMons: xpAwards.filter((a) => a.gainedLevels > 0).map((a) => a.nickname),
      itemDrop: itemDrop?.itemId,
      downedMonIds: downedIds,
    });
  }

  return itemDrop ? { xpAwards, itemDrop } : { xpAwards };
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
