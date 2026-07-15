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
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import type { ItemDrop, WildMon } from './engine.js';

const MAX_WILD_ACTIONS_PER_TURN = 6;

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

export async function startPveBattleFromEncounter(userId: string, wildMon: WildMon): Promise<StartResult> {
  if (activeByUser.has(userId)) {
    return { ok: false, error: 'battle-in-progress' };
  }
  const playerLoadout = await buildPlayerLoadout(userId);
  if (!playerLoadout) return { ok: false, error: 'party-invalid' };
  const catalog = loadCatalog();
  const tpl = findTemplate(catalog, wildMon.catalogId);
  if (!tpl) return { ok: false, error: 'catalog-missing' };
  const wildMember: LoadoutMember = {
    monId: newId('wild'),
    templateId: wildMon.catalogId,
    template: tpl,
    level: wildMon.level,
    nickname: wildMon.name,
    statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 },
  };
  const battle = initPveBattle({
    playerLoadout,
    wildParty: [{ member: wildMember, wildInfo: { catalogId: wildMon.catalogId, rare: wildMon.rare } }],
  });
  activeByUser.set(userId, battle);
  advanceWildAI(battle);
  if (battle.status === 'ended') {
    activeByUser.delete(userId);
  }
  log.info('world.pve.start', {
    userId,
    matchId: battle.id,
    catalogId: wildMon.catalogId,
    level: wildMon.level,
    rare: wildMon.rare,
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

export type ActResult =
  | {
      ok: true;
      view: BattleView;
      ended: boolean;
      capturedMonId?: string;
    }
  | { ok: false; error: string; code?: string };

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
    activeByUser.delete(userId);
  }

  return {
    ok: true,
    view: serializeForSide(battle, 'a'),
    ended,
    ...(capturedMonId ? { capturedMonId } : {}),
  };
}

export async function grantItemDrop(userId: string, drop: ItemDrop): Promise<void> {
  const now = Date.now();
  await run(SQL_UPSERT_INVENTORY, [userId, drop.itemId, drop.qty, now]);
  log.info('world.drop.grant', { userId, itemId: drop.itemId, qty: drop.qty });
}

export function hasActivePveBattle(userId: string): boolean {
  return activeByUser.has(userId);
}
