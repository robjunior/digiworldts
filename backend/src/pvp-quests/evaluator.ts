import type { Battle, BattleEvent, BattleUnit, BattleSide, UnitId } from '@digiworld/shared/battle';
import type { Ailment, Element } from '@digiworld/shared/digimon';
import {
  DEBUFF_AILMENTS,
  type PvpBattleResult,
} from '@digiworld/shared/pvp-quest';
import { resolveResistance } from '@digiworld/shared/digimon';
import { tx } from '../db/index.js';
import { evaluateCategory } from './registry.js';
import { applyProgress } from './repo.js';
import { allWindows } from './periods.js';

/**
 * Turn an authoritative server `Battle` into a per-participant `PvpBattleResult`.
 *
 * Everything here is derived from `battle.log` + `battle.units`, both of which
 * are produced exclusively inside `applyAction` on the server. The client only
 * ever submits `Action` intents; it cannot fabricate a kill, a crit, or a
 * super-effective tag. So this function is the sole trust boundary for quest
 * progress — there is no client-supplied progress path.
 *
 * Called once per participant (A and B), each from their own perspective, so a
 * single battle advances both players' quests.
 */

interface DerivedMeta {
  selfSide: BattleSide;
  oppSide: BattleSide;
  result: 'win' | 'loss' | 'draw';
  valid: boolean;
  cause: PvpBattleResult['cause'];
}

function metaFor(battle: Battle, perspectiveUserId: string): DerivedMeta {
  const selfSide: BattleSide = battle.playerA === perspectiveUserId ? 'a' : 'b';
  const oppSide: BattleSide = selfSide === 'a' ? 'b' : 'a';
  const mode = battle.mode;
  // Only ranked/normal PvP counts. Friendly, bot, or non-pvp modes never reach
  // here (caller gates on mode === 'pvp'), but defensively treat anything else
  // as invalid.
  if (mode !== 'pvp') {
    return { selfSide, oppSide, result: 'draw', valid: false, cause: 'friendly' };
  }
  switch (battle.outcome) {
    case 'captured_a':
      // Capture victory — side A won. Same semantics as win_a for quest progress.
      return selfSide === 'a'
        ? { selfSide, oppSide, result: 'win', valid: true, cause: 'valid' }
        : { selfSide, oppSide, result: 'loss', valid: true, cause: 'valid' };
    case 'win_a':
      return selfSide === 'a'
        ? { selfSide, oppSide, result: 'win', valid: true, cause: 'valid' }
        : { selfSide, oppSide, result: 'loss', valid: true, cause: 'valid' };
    case 'win_b':
      return selfSide === 'b'
        ? { selfSide, oppSide, result: 'win', valid: true, cause: 'valid' }
        : { selfSide, oppSide, result: 'loss', valid: true, cause: 'valid' };
    case 'draw':
      return { selfSide, oppSide, result: 'draw', valid: false, cause: 'draw' };
    case 'abandoned':
      return { selfSide, oppSide, result: 'draw', valid: false, cause: 'abandon' };
    case 'fled_a':
    case 'fled_b':
      // A flee/surrender forfeits — no progress for anyone.
      return { selfSide, oppSide, result: 'draw', valid: false, cause: 'surrender' };
    default:
      return { selfSide, oppSide, result: 'draw', valid: false, cause: 'cancelled' };
  }
}

function unitById(battle: Battle, id: UnitId | null | undefined): BattleUnit | undefined {
  if (!id) return undefined;
  return battle.units.find((u) => u.id === id);
}

function isControlVsDebuff(a: Ailment): boolean {
  return (DEBUFF_AILMENTS as readonly Ailment[]).includes(a);
}

export function deriveBattleResult(battle: Battle, perspectiveUserId: string): PvpBattleResult {
  const meta = metaFor(battle, perspectiveUserId);
  const selfSide = meta.selfSide;
  const oppSide = meta.oppSide;

  const elementOf: Partial<Record<UnitId, Element>> = {};
  const resOf: Partial<Record<UnitId, import('@digiworld/shared/digimon').ResistanceMap | undefined>> = {};
  for (const u of battle.units) {
    elementOf[u.id] = u.element;
    resOf[u.id] = u.resistances;
  }

  let damageDealt = 0;
  let criticalHits = 0;
  let statusApplications = 0;
  const statusByType: Partial<Record<Ailment, number>> = {};
  let debuffApplications = 0;
  const debuffByType: Partial<Record<Ailment, number>> = {};

  const elementKills: Partial<Record<Element, number>> = {};
  let uniqueElementsKilled = 0;
  let superEffectiveKills = 0;
  let disadvantagedKills = 0;

  // Walk the log in order. The action immediately preceding a unit-down is the
  // killing blow; attribute the downed opponent unit to the self side's action.
  let pendingAction: Extract<BattleEvent, { type: 'action' }> | null = null;

  for (const ev of battle.log) {
    if (ev.type === 'action') {
      pendingAction = ev;
      if (ev.actor && ev.actor.startsWith(selfSide) && typeof ev.damage === 'number') {
        damageDealt += ev.damage;
        if (ev.cue === 'crit') criticalHits += 1;
        if (ev.applied && ev.applied.length > 0) {
          for (const a of ev.applied) {
            statusApplications += 1;
            statusByType[a.kind] = (statusByType[a.kind] ?? 0) + 1;
            if (isControlVsDebuff(a.kind)) {
              debuffApplications += 1;
              debuffByType[a.kind] = (debuffByType[a.kind] ?? 0) + 1;
            }
          }
        }
      }
    } else if (ev.type === 'unit-down') {
      const downed = unitById(battle, ev.unit);
      if (downed && downed.side === oppSide && pendingAction && pendingAction.actor && pendingAction.actor.startsWith(selfSide)) {
        const defenderEl = downed.element;
        const attackerEl = (pendingAction.skillElement ?? elementOf[pendingAction.actor]) as Element | undefined;
        const mult = attackerEl ? resolveResistance(attackerEl, defenderEl, downed.resistances) : 1;
        elementKills[defenderEl] = (elementKills[defenderEl] ?? 0) + 1;
        if (mult > 1) superEffectiveKills += 1;
        if (mult < 1) disadvantagedKills += 1;
      }
      pendingAction = null;
    }
  }

  uniqueElementsKilled = Object.keys(elementKills).length;

  // End-state derived from the authoritative final snapshot.
  const selfUnits = battle.units.filter((u) => u.side === selfSide);
  const oppUnits = battle.units.filter((u) => u.side === oppSide);
  const survivors = selfUnits.filter((u) => u.hp > 0).length;
  const kills = oppUnits.filter((u) => u.hp <= 0).length;

  const selfElements = new Set(selfUnits.map((u) => u.element));
  const oppElements = new Set(oppUnits.map((u) => u.element));
  const myElementsUnique = selfElements.size;
  const opponentElementsUnique = oppElements.size;
  const oppElementCounts = new Map<Element, number>();
  for (const u of oppUnits) oppElementCounts.set(u.element, (oppElementCounts.get(u.element) ?? 0) + 1);
  const opponentHasSameElementPair = [...oppElementCounts.values()].some((c) => c >= 2);

  // Comeback: self won after losing at least 2 Digimons (ended with <=1 alive).
  const comeback = meta.valid && meta.result === 'win' && survivors <= 1;

  // Disadvantaged win: self won while having at least one Digimon elementally
  // disadvantaged vs the opponent's team (opponent holds the super-effective
  // element against it). Server-derived; no per-tick tracking needed.
  let disadvantagedWin = false;
  if (meta.valid && meta.result === 'win') {
    for (const selfEl of selfElements) {
      for (const oppEl of oppElements) {
        if (resolveResistance(oppEl, selfEl, undefined) > 1) {
          disadvantagedWin = true;
          break;
        }
      }
      if (disadvantagedWin) break;
    }
  }

  return {
    battleId: battle.id,
    userId: perspectiveUserId,
    opponentId: selfSide === 'a' ? battle.playerB : battle.playerA,
    result: meta.result,
    valid: meta.valid,
    cause: meta.cause,
    turns: battle.round,
    durationMs: (battle.endedAt ?? battle.startedAt) - battle.startedAt,
    kills,
    survivors,
    damageDealt,
    criticalHits,
    statusApplications,
    statusByType,
    debuffApplications,
    debuffByType,
    myElementsUnique,
    opponentElementsUnique,
    opponentHasSameElementPair,
    elementKills,
    uniqueElementsKilled,
    superEffectiveKills,
    disadvantagedKills,
    disadvantagedWin,
    comeback,
  };
}

// ---------------------------------------------------------------------------
// Applying a result to all three period boards, atomically.
// ---------------------------------------------------------------------------

interface AssignmentStub {
  instance_id: string;
  category: string;
  params: string;
  target: number;
}

const SQL_ASSIGNMENTS_FOR_WINDOW = `SELECT a.instance_id, b.category, b.params, b.target
  FROM pvp_quest_assignments a JOIN pvp_quest_boards b
    ON b.period = a.period AND b.window_id = a.window_id AND b.instance_id = a.instance_id
  WHERE a.user_id = ? AND a.period = ? AND a.window_id = ? AND a.completed_at IS NULL AND a.claimed_at IS NULL`;

/**
 * Evaluate one battle result against all three period boards for this user and
 * persist progress atomically. Returns the number of assignments that changed.
 *
 * Security:
 *  - `result` must come from `deriveBattleResult` (server-derived). The function
 *    never reads progress deltas from outside.
 *  - Invalid battles (draw/abandon/surrender/etc.) produce `valid:false` and the
 *    per-category handlers short-circuit to delta 0, so no progress is granted.
 *  - A per-battle idempotency ledger (`pvp_quest_battle_log`) guarantees a
 *    battle-end event is processed at most once per user, so replayed/duplicate
 *    end events cannot inflate progress or farm rewards.
 *  - `applyProgress` still refuses to move an already-completed assignment as a
 *    second line of defense.
 */
export async function applyBattleResult(result: PvpBattleResult): Promise<number> {
  if (!result.valid) return 0;
  const now = Date.now();
  // Idempotency: if this (battle, user) was already processed, skip entirely.
  let already = false;
  await tx(async (t) => {
    await t.run(
      `INSERT INTO pvp_quest_battle_log (battle_id, user_id, processed_at) VALUES (?, ?, ?)`,
      [result.battleId, result.userId, now],
    ).catch(() => { already = true; });
  });
  if (already) return 0;
  let changed = 0;
  await tx(async (t) => {
    for (const window of allWindows(now)) {
      const period = window.period;
      const rows = await t.query<AssignmentStub>(SQL_ASSIGNMENTS_FOR_WINDOW, [result.userId, period, window.windowId]);
      for (const row of rows) {
        const category = row.category as import('@digiworld/shared/pvp-quest').PvpQuestCategory;
        const params = JSON.parse(row.params) as import('@digiworld/shared/pvp-quest').PvpQuestParams;
        const cur = await t.one<{ state: string; progress: number }>(
          `SELECT state, progress FROM pvp_quest_assignments WHERE user_id = ? AND period = ? AND window_id = ? AND instance_id = ?`,
          [result.userId, period, window.windowId, row.instance_id],
        );
        const curState = cur ? (JSON.parse(cur.state) as Record<string, unknown>) : {};
        const { delta: finalDelta, state: finalState } = evaluateCategory(category, result, params, curState);
        if (finalDelta <= 0) continue;
        const ok = await applyProgress(
          t, result.userId, period, window.windowId, row.instance_id, finalDelta, finalState, row.target, now,
        );
        if (ok) changed += 1;
      }
    }
  });
  return changed;
}

/**
 * Convenience for the battle routes: derive + apply for BOTH participants inside
 * one call. Each participant's result is independent and applied in its own tx.
 */
export async function processPvpBattle(battle: Battle): Promise<{ forA: number; forB: number }> {
  if (battle.mode !== 'pvp' || !battle.outcome || !battle.endedAt) return { forA: 0, forB: 0 };
  const a = deriveBattleResult(battle, battle.playerA);
  const b = deriveBattleResult(battle, battle.playerB);
  const [forA, forB] = await Promise.all([applyBattleResult(a), applyBattleResult(b)]);
  return { forA, forB };
}
