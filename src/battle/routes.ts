/**
 * Battle coordinator on top of the Cluster abstraction.
 *
 * This file owns:
 *   - Persistence of every battle mutation to the cluster (`battle:snap:{id}`)
 *     so a server restart NO LONGER forfeits live matches (any node can
 *     hydrate + resume).
 *   - Pre-battle buff consumption (shop-item effects → mon stats) at match
 *     creation and xp_mult buff consumption at match end.
 *   - End-of-match match-history persistence + XP + DigiCredits reward.
 *
 * All persistence now routes through the async DbAdapter (SQLite or Postgres)
 * via the q/one/run/tx helpers from src/db/index.ts.
 */
import { one, q, run, tx, type ActiveMatchRow } from '../db/index.js';
import { log } from '../util/log.js';
import { newId } from '../util/ids.js';
import { awardXp, xpReward } from '../progression/xp.js';
import { loadPartyLoadout, partyAverageLevel } from '../roster/routes.js';
import { loadCatalog } from '../digimon/xml.js';
import type { Stage, TemplateDigimon } from '../digimon/types.js';
import { consumePreBattleBuffs, consumeXpMultBuffs, xpMultOf, type PendingBuff } from '../social/buffs.js';
import {
  abandonBattle,
  applyAction,
  initBattle,
  serializeForSide,
  sideForPlayerId,
  validateLoadout,
  type ApplyErrorCode,
  type Loadout,
} from './engine.js';
import type {
  Action,
  Battle,
  BattleEvent,
  BattleOutcome,
  BattleSide,
  BattleView,
} from './types.js';
import { getCluster } from '../cluster/index.js';

const SNAPSHOT_TTL_SEC = 30 * 60;
const LOCK_TTL_SEC = 3;
const K_SNAP = (id: string): string => `battle:snap:${id}`;
const K_USER = (uid: string): string => `battle:user:${uid}`;
const K_LOCK = (id: string): string => `battle:lock:${id}`;
const WSDELIVER = (uid: string): string => `wsdeliver:${uid}`;

// ---------------------------------------------------------------------------
// SQL for durable persistence + rewards
// ---------------------------------------------------------------------------
const SQL_INSERT_MATCH = `INSERT INTO matches (id, player_a, player_b, winner, outcome, rounds, started_at, ended_at, log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SQL_SELECT_PARTY = `SELECT id, catalog_id, level, xp, hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus FROM player_roster WHERE user_id = ? AND slot_index IS NOT NULL ORDER BY slot_index`;
const SQL_UPDATE_MON = `UPDATE player_roster SET level = ?, xp = ?, hp_bonus = ?, en_bonus = ?, atk_bonus = ?, def_bonus = ?, int_bonus = ?, spd_bonus = ?, updated_at = ? WHERE id = ?`;
const SQL_ADD_CREDITS = `INSERT INTO player_wallet (user_id, credits, streak_day, updated_at) VALUES (?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET credits = player_wallet.credits + excluded.credits, updated_at = excluded.updated_at`;

type PartyRow = {
  id: string;
  catalog_id: string;
  level: number;
  xp: number;
  hp_bonus: number;
  en_bonus: number;
  atk_bonus: number;
  def_bonus: number;
  int_bonus: number;
  spd_bonus: number;
};

// ---------------------------------------------------------------------------
// Cluster helpers
// ---------------------------------------------------------------------------

async function saveSnapshot(battle: Battle): Promise<void> {
  const cluster = await getCluster();
  const json = JSON.stringify(battle);
  await cluster.set(K_SNAP(battle.id), json, SNAPSHOT_TTL_SEC);
  await cluster.set(K_USER(battle.playerA), battle.id, SNAPSHOT_TTL_SEC);
  await cluster.set(K_USER(battle.playerB), battle.id, SNAPSHOT_TTL_SEC);
}

async function loadSnapshot(matchId: string): Promise<Battle | null> {
  const cluster = await getCluster();
  const raw = await cluster.get(K_SNAP(matchId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Battle;
  } catch {
    return null;
  }
}

async function deleteBattleState(battle: Battle): Promise<void> {
  const cluster = await getCluster();
  await cluster.del(K_SNAP(battle.id));
  await cluster.del(K_USER(battle.playerA));
  await cluster.del(K_USER(battle.playerB));
}

async function deliverToUser(userId: string, payload: unknown): Promise<void> {
  const cluster = await getCluster();
  await cluster.publish(WSDELIVER(userId), JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Pre-battle buff application (mutates loadout in place)
// ---------------------------------------------------------------------------

async function applyPreBattleBuffs(loadout: Loadout): Promise<PendingBuff[]> {
  const applied: PendingBuff[] = [];
  for (const m of loadout.members) {
    const consumed = await consumePreBattleBuffs(loadout.playerId, m.monId);
    for (const b of consumed) {
      if (b.effectKind === 'hp_pct') {
        const extra = Math.max(0, Math.round(m.template.baseStats.hp * b.magnitude));
        m.statBonus.hp += extra;
      } else if (b.effectKind === 'en_pct') {
        const extra = Math.max(0, Math.round(m.template.baseStats.en * b.magnitude));
        m.statBonus.en += extra;
      }
      applied.push(b);
    }
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CreateMatchResult =
  | {
      ok: true;
      matchId: string;
      viewA: BattleView;
      viewB: BattleView;
      playerA: string;
      playerB: string;
    }
  | { ok: false; error: string; who?: string };

export async function createBattleForPair(userA: string, userB: string): Promise<CreateMatchResult> {
  if (userA === userB) return { ok: false, error: 'cannot fight yourself' };
  const cluster = await getCluster();
  if (await cluster.get(K_USER(userA))) return { ok: false, error: 'player A already in a match', who: userA };
  if (await cluster.get(K_USER(userB))) return { ok: false, error: 'player B already in a match', who: userB };

  const loadA = await loadPartyLoadout(userA);
  if ('error' in loadA) return { ok: false, error: `${userA} loadout: ${loadA.error}`, who: userA };
  const loadB = await loadPartyLoadout(userB);
  if ('error' in loadB) return { ok: false, error: `${userB} loadout: ${loadB.error}`, who: userB };

  const vA = validateLoadout(loadA);
  if (!vA.ok) return { ok: false, error: `${userA} loadout invalid: ${vA.reason}`, who: userA };
  const vB = validateLoadout(loadB);
  if (!vB.ok) return { ok: false, error: `${userB} loadout invalid: ${vB.reason}`, who: userB };

  const buffsA = await applyPreBattleBuffs(loadA);
  const buffsB = await applyPreBattleBuffs(loadB);

  const battle = initBattle({ matchId: newId('mtc'), loadoutA: loadA, loadoutB: loadB });
  await saveSnapshot(battle);

  const viewA = serializeForSide(battle, 'a');
  const viewB = serializeForSide(battle, 'b');
  await deliverToUser(userA, { type: 'match', matchId: battle.id, view: viewA });
  await deliverToUser(userB, { type: 'match', matchId: battle.id, view: viewB });
  await deliverToUser(userA, { type: 'queue', status: 'matched', size: 0 });
  await deliverToUser(userB, { type: 'queue', status: 'matched', size: 0 });

  log.info('battle.start', { matchId: battle.id, a: userA, b: userB, buffsA: buffsA.length, buffsB: buffsB.length });
  return { ok: true, matchId: battle.id, viewA, viewB, playerA: userA, playerB: userB };
}

export type DispatchResult =
  | {
      ok: true;
      matchId: string;
      viewA: BattleView;
      viewB: BattleView;
      newEvents: BattleEvent[];
      ended: boolean;
    }
  | { ok: false; error: string; code: ApplyErrorCode };

export async function dispatchAction(userId: string, matchId: string, action: Action): Promise<DispatchResult> {
  const cluster = await getCluster();
  const lockToken = await cluster.lock(K_LOCK(matchId), LOCK_TTL_SEC);
  if (!lockToken) return { ok: false, error: 'another action is in flight', code: 'battle-over' };
  try {
    const battle = await loadSnapshot(matchId);
    if (!battle) return { ok: false, error: 'match not found', code: 'battle-over' };
    const side = sideForPlayerId(battle, userId);
    if (!side) return { ok: false, error: 'you are not in this match', code: 'not-your-turn' };
    const result = applyAction(battle, side, action);
    if (!result.ok) return { ok: false, error: result.error, code: result.code };
    const viewA = serializeForSide(battle, 'a');
    const viewB = serializeForSide(battle, 'b');
    const ended = battle.status === 'ended';
    if (ended) {
      await persistAndAwardEnd(battle);
      await deleteBattleState(battle);
    } else {
      await saveSnapshot(battle);
    }
    await deliverToUser(battle.playerA, { type: 'event', matchId: battle.id, events: result.events });
    await deliverToUser(battle.playerB, { type: 'event', matchId: battle.id, events: result.events });
    await deliverToUser(battle.playerA, { type: 'battle', matchId: battle.id, view: viewA });
    await deliverToUser(battle.playerB, { type: 'battle', matchId: battle.id, view: viewB });
    if (ended) {
      await deliverToUser(battle.playerA, { type: 'end', matchId: battle.id, view: viewA, outcome: viewA.outcome });
      await deliverToUser(battle.playerB, { type: 'end', matchId: battle.id, view: viewB, outcome: viewB.outcome });
    }
    return { ok: true, matchId: battle.id, viewA, viewB, newEvents: result.events, ended };
  } finally {
    await cluster.unlock(K_LOCK(matchId), lockToken);
  }
}

export async function handleDisconnect(userId: string): Promise<{ matchId: string; opponentView: BattleView; opponentId: string } | null> {
  const cluster = await getCluster();
  const matchId = await cluster.get(K_USER(userId));
  if (!matchId) return null;
  const lockToken = await cluster.lock(K_LOCK(matchId), LOCK_TTL_SEC);
  if (!lockToken) return null;
  try {
    const battle = await loadSnapshot(matchId);
    if (!battle) {
      await cluster.del(K_USER(userId));
      return null;
    }
    const side = sideForPlayerId(battle, userId);
    abandonBattle(battle, side ?? null);
    await persistAndAwardEnd(battle);
    await deleteBattleState(battle);
    const opponentId = battle.playerA === userId ? battle.playerB : battle.playerA;
    const opponentSide: BattleSide = battle.playerA === userId ? 'b' : 'a';
    return { matchId, opponentId, opponentView: serializeForSide(battle, opponentSide) };
  } finally {
    await cluster.unlock(K_LOCK(matchId), lockToken);
  }
}

export async function getMatchView(userId: string): Promise<{ matchId: string; view: BattleView } | null> {
  const cluster = await getCluster();
  const matchId = await cluster.get(K_USER(userId));
  if (!matchId) return null;
  const battle = await loadSnapshot(matchId);
  if (!battle) return null;
  const side = sideForPlayerId(battle, userId);
  if (!side) return null;
  return { matchId, view: serializeForSide(battle, side) };
}

export async function isInMatch(userId: string): Promise<boolean> {
  const cluster = await getCluster();
  return (await cluster.get(K_USER(userId))) !== null;
}

export async function activeMatchCount(): Promise<number> {
  const cluster = await getCluster();
  const keys = await cluster.keys('battle:snap:*');
  return keys.length;
}

/** State lives in cluster — this is a status ping for boot logging. */
export async function hydrateActiveMatches(): Promise<number> {
  const cluster = await getCluster();
  const keys = await cluster.keys('battle:snap:*');
  if (keys.length > 0) log.info('battle.hydrate.detected', { count: keys.length });
  // Legacy: attempt to hydrate any orphaned SQLite active_matches rows so an
  // upgrade from the pre-cluster shape doesn't lose live matches.
  try {
    const legacy = await q<ActiveMatchRow>(`SELECT * FROM active_matches`);
    for (const row of legacy) {
      try {
        const battle = JSON.parse(row.snapshot) as Battle;
        if (battle.status !== 'active') continue;
        await cluster.set(K_SNAP(battle.id), row.snapshot, SNAPSHOT_TTL_SEC);
        await cluster.set(K_USER(battle.playerA), battle.id, SNAPSHOT_TTL_SEC);
        await cluster.set(K_USER(battle.playerB), battle.id, SNAPSHOT_TTL_SEC);
      } catch {}
    }
    if (legacy.length > 0) {
      await run(`DELETE FROM active_matches`);
      log.info('battle.hydrate.migrated-legacy', { count: legacy.length });
    }
  } catch {}
  return keys.length;
}

// ---------------------------------------------------------------------------
// End-of-match persistence + rewards
// ---------------------------------------------------------------------------

const CREDITS_PER_WIN = 60;
const CREDITS_PER_LOSS = 15;
const CREDITS_PER_DRAW = 25;

function outcomeToSummary(outcome: BattleOutcome): {
  winnerId: 'a' | 'b' | null;
  aResult: 'win' | 'loss' | 'draw' | 'fled';
  bResult: 'win' | 'loss' | 'draw' | 'fled';
} {
  switch (outcome) {
    case 'win_a': return { winnerId: 'a', aResult: 'win', bResult: 'loss' };
    case 'win_b': return { winnerId: 'b', aResult: 'loss', bResult: 'win' };
    case 'fled_a': return { winnerId: 'b', aResult: 'fled', bResult: 'win' };
    case 'fled_b': return { winnerId: 'a', aResult: 'win', bResult: 'fled' };
    case 'draw':
    case 'abandoned': return { winnerId: null, aResult: 'draw', bResult: 'draw' };
  }
}

async function persistAndAwardEnd(battle: Battle): Promise<void> {
  if (!battle.outcome || !battle.endedAt) return;
  const summary = outcomeToSummary(battle.outcome);
  const winnerUserId = summary.winnerId === 'a' ? battle.playerA : summary.winnerId === 'b' ? battle.playerB : null;
  const rowLog = battle.log.slice(-120);
  const templates = new Map<string, TemplateDigimon>();
  for (const t of loadCatalog().digimons) templates.set(t.id, t);
  await tx(async (t) => {
    await t.run(SQL_INSERT_MATCH, [
      battle.id,
      battle.playerA,
      battle.playerB,
      winnerUserId,
      battle.outcome!,
      battle.round,
      battle.startedAt,
      battle.endedAt!,
      JSON.stringify(rowLog),
    ]);
    await grantRewardsInTx(t, battle, 'a', summary.aResult, templates);
    await grantRewardsInTx(t, battle, 'b', summary.bResult, templates);
    if (summary.aResult === 'win') await t.run(SQL_ADD_CREDITS, [battle.playerA, CREDITS_PER_WIN, battle.endedAt!]);
    else if (summary.aResult === 'loss') await t.run(SQL_ADD_CREDITS, [battle.playerA, CREDITS_PER_LOSS, battle.endedAt!]);
    else if (summary.aResult === 'draw') await t.run(SQL_ADD_CREDITS, [battle.playerA, CREDITS_PER_DRAW, battle.endedAt!]);
    if (summary.bResult === 'win') await t.run(SQL_ADD_CREDITS, [battle.playerB, CREDITS_PER_WIN, battle.endedAt!]);
    else if (summary.bResult === 'loss') await t.run(SQL_ADD_CREDITS, [battle.playerB, CREDITS_PER_LOSS, battle.endedAt!]);
    else if (summary.bResult === 'draw') await t.run(SQL_ADD_CREDITS, [battle.playerB, CREDITS_PER_DRAW, battle.endedAt!]);
  });
  log.info('battle.end', { matchId: battle.id, outcome: battle.outcome, winner: winnerUserId, rounds: battle.round });
}

async function grantRewardsInTx(
  txAdapter: import('../db/adapter.js').DbAdapter,
  battle: Battle,
  side: BattleSide,
  result: 'win' | 'loss' | 'draw' | 'fled',
  templates: Map<string, TemplateDigimon>,
): Promise<void> {
  const userId = side === 'a' ? battle.playerA : battle.playerB;
  const myUnits = battle.units.filter((u) => u.side === side);
  const oppUnits = battle.units.filter((u) => u.side !== side);
  const myLvl = Math.max(1, Math.round(myUnits.reduce((s, u) => s + u.level, 0) / myUnits.length));
  const oppLvl = Math.max(1, Math.round(oppUnits.reduce((s, u) => s + u.level, 0) / oppUnits.length));
  let xp = xpReward(result, myLvl, oppLvl);
  if (result === 'win') {
    // xp_mult buff consumption happens OUTSIDE the tx to keep the tx short;
    // the buff commit is idempotent w.r.t. the reward calc (we take the max).
    const mult = xpMultOf(await consumeXpMultBuffs(userId));
    if (mult > 1) xp = Math.round(xp * mult);
  }
  const rows = await txAdapter.query<PartyRow>(SQL_SELECT_PARTY, [userId]);
  const now = Date.now();
  for (const r of rows) {
    const stage: Stage = templates.get(r.catalog_id)?.stage ?? 'Rookie';
    const grown = awardXp(
      r.level,
      r.xp,
      { hp: r.hp_bonus, en: r.en_bonus, atk: r.atk_bonus, def: r.def_bonus, int: r.int_bonus, spd: r.spd_bonus },
      stage,
      xp,
    );
    await txAdapter.run(SQL_UPDATE_MON, [
      grown.level,
      grown.xp,
      grown.bonus.hp,
      grown.bonus.en,
      grown.bonus.atk,
      grown.bonus.def,
      grown.bonus.int,
      grown.bonus.spd,
      now,
      r.id,
    ]);
  }
}

export { partyAverageLevel };
