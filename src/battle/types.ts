/**
 * Battle types — the wire format for a live 3v3 match.
 *
 * Design decisions:
 *   - Turn-based (alternating players) rather than true ATB. Cleaner over WS
 *     and matches how the base/combat.html loop actually plays.
 *   - Each turn, the active player picks ONE alive unit + ONE action. Turn
 *     then flips.
 *   - Ailments tick at the end of the acting player's turn (burn/poison do
 *     damage, freeze/stun/sleep just decrement).
 *   - The server keeps the AUTHORITATIVE state; clients receive a view
 *     tailored to their side (own units full detail; enemy units hide EN).
 *   - No `analyse` action here (base/combat.html analyse is a PvE
 *     egg-capture mechanic and doesn't apply to PvP).
 */
import type { Ailment, Element, Skill } from '../digimon/types.js';

export type BattleSide = 'a' | 'b';
export type SlotIndex = 0 | 1 | 2;
export type UnitId = `${BattleSide}:${SlotIndex}`;

export type Ailmented = { kind: Ailment; turnsLeft: number };

export type BattleUnit = {
  id: UnitId;
  side: BattleSide;
  slot: SlotIndex;
  templateId: string;
  name: string;
  element: Element;
  level: number;
  hp: number;
  hpMax: number;
  en: number;
  enMax: number;
  atk: number;
  def: number;
  spd: number;
  skills: Skill[];
  ailments: Ailmented[];
  guarding: boolean;
};

export type Action =
  | { type: 'fight'; unitId: UnitId; targetId: UnitId }
  | { type: 'skill'; unitId: UnitId; skillId: string; targetId: UnitId }
  | { type: 'guard'; unitId: UnitId }
  | { type: 'flee' };

export type ActionCue = 'crit' | 'miss' | 'resist' | 'weak' | null;

export type EventBase = { at: number; round: number };

export type BattleEvent =
  | (EventBase & {
      type: 'action';
      actor: UnitId | null;
      actorName?: string;
      action: Action;
      targetId?: UnitId | null;
      targetName?: string;
      damage?: number;
      skillName?: string;
      cue: ActionCue;
      applied?: Ailmented[];
    })
  | (EventBase & { type: 'ailment-tick'; unit: UnitId; kind: Ailment; damage: number })
  | (EventBase & { type: 'ailment-expired'; unit: UnitId; kind: Ailment })
  | (EventBase & { type: 'unit-down'; unit: UnitId; unitName: string })
  | (EventBase & { type: 'turn'; side: BattleSide; unit: UnitId | null; unitName?: string })
  | (EventBase & { type: 'turn-skip'; unit: UnitId; unitName: string; reason: 'defeated' | 'locked' })
  | (EventBase & { type: 'round-start'; round: number; order: Array<{ unit: UnitId; name: string; side: BattleSide; initiative: number }> })
  | (EventBase & {
      type: 'end';
      outcome: BattleOutcome;
      winner: BattleSide | null;
    });

export type BattleStatus = 'awaiting-loadout' | 'active' | 'ended';

export type BattleOutcome = 'win_a' | 'win_b' | 'draw' | 'fled_a' | 'fled_b' | 'abandoned';

export type TurnEntry = {
  unitId: UnitId;
  side: BattleSide;
  name: string;
  initiative: number;
};

export type Battle = {
  id: string;
  playerA: string;
  playerB: string;
  units: BattleUnit[];
  activeSide: BattleSide;
  turnQueue: TurnEntry[];
  turnCursor: number;
  round: number;
  log: BattleEvent[];
  status: BattleStatus;
  outcome: BattleOutcome | null;
  winner: BattleSide | null;
  startedAt: number;
  endedAt: number | null;
};

// ----- Views (per-side redacted state) ---------------------------------------

export type EnemyUnitView = {
  id: UnitId;
  slot: SlotIndex;
  name: string;
  element: Element;
  level: number;
  hp: number;
  hpMax: number;
  ailments: Ailmented[];
  down: boolean;
};

export type FriendlyUnitView = BattleUnit & { down: boolean };

export type BattleView = {
  id: string;
  round: number;
  status: BattleStatus;
  activeSide: BattleSide;
  yourSide: BattleSide;
  yourTurn: boolean;
  currentTurnUnitId: UnitId | null;
  currentTurnBelongsToYou: boolean;
  upcomingTurns: TurnEntry[];
  outcome: BattleOutcome | null;
  winner: BattleSide | null;
  friendly: FriendlyUnitView[];
  enemy: EnemyUnitView[];
  log: BattleEvent[];
};

// ----- Rules constants -------------------------------------------------------

export const MISS_CHANCE = 0.08;
export const CRIT_CHANCE = 0.15;
export const CRIT_MULT = 1.6;
export const GUARD_MULT = 0.5;
export const AILMENT_TURNS_DEFAULT = 3;
export const EN_REGEN_PER_TURN = 6;

// Ailments that make a unit lose its turn if active at the START of its side.
export const CONTROL_AILMENTS: readonly Ailment[] = ['freeze', 'stun', 'sleep'];

export function isControlAilment(ailment: Ailment): boolean {
  return CONTROL_AILMENTS.includes(ailment);
}
