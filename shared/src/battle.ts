import type { Ailment, Attribute, Element, ResistanceMap, Skill } from './digimon.js';

export type BattleSide = 'a' | 'b';
export type SlotIndex = 0 | 1 | 2 | 3 | 4 | 5;
export type UnitId = `${BattleSide}:${SlotIndex}`;

export const MAX_PARTY_SIZE = 3;
export const MAX_WILD_PARTY_SIZE = 6;

export type BattleMode = 'pvp' | 'pve';

export type WildInfo = {
  catalogId: string;
  rare: boolean;
};

export type Ailmented = { kind: Ailment; turnsLeft: number };

export type BattleUnit = {
  id: UnitId;
  side: BattleSide;
  slot: SlotIndex;
  templateId: string;
  name: string;
  element: Element;
  attribute: Attribute;
  resistances?: ResistanceMap;
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
  wildInfo?: WildInfo;
  analyzed: boolean;
};

export type Action =
  | { type: 'fight'; unitId: UnitId; targetId: UnitId }
  | { type: 'skill'; unitId: UnitId; skillId: string; targetId: UnitId }
  | { type: 'guard'; unitId: UnitId }
  | { type: 'analyze'; unitId: UnitId; targetId: UnitId }
  | { type: 'capture'; unitId: UnitId; targetId: UnitId }
  | { type: 'flee' };

export type ActionCue = 'crit' | 'miss' | 'resist' | 'weak' | 'immune' | 'chain' | 'attr-advantage' | 'attr-disadvantage' | 'analyzed' | 'capture-hit' | 'capture-miss' | null;

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
      captureChance?: number;
      analyzedInfo?: { name: string; element: Element; level: number; hp: number; hpMax: number; en: number; enMax: number; atk: number; def: number; spd: number; skills: Array<{ name: string; element: Element; power: number; energyCost: number }>; wild?: WildInfo };
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
      capturedUnitId?: UnitId;
      pvpMmr?: { before: number; after: number; delta: number };
    });

export type BattleStatus = 'awaiting-loadout' | 'active' | 'ended';

export type BattleOutcome = 'win_a' | 'win_b' | 'draw' | 'fled_a' | 'fled_b' | 'abandoned' | 'captured_a';

export type TurnEntry = {
  unitId: UnitId;
  side: BattleSide;
  name: string;
  initiative: number;
};

export type Battle = {
  id: string;
  mode: BattleMode;
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
  lastAction: { side: BattleSide; element: Element; attribute: Attribute; wasHit: boolean } | null;
  displayNames?: { a?: string; b?: string };
};

export type EnemyUnitView = {
  id: UnitId;
  slot: SlotIndex;
  templateId: string;
  name: string;
  element: Element;
  level: number;
  hp: number;
  hpMax: number;
  ailments: Ailmented[];
  down: boolean;
  analyzed?: boolean;
  wild?: WildInfo;
};

export type FriendlyUnitView = BattleUnit & { down: boolean };

export type BattleView = {
  id: string;
  mode: BattleMode;
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
  opponentDisplayName?: string;
};

export const MISS_CHANCE = 0.08;
export const CRIT_CHANCE = 0.15;
export const CRIT_MULT = 1.6;
export const GUARD_MULT = 0.5;
export const CHAIN_MULT = 2.0;
export const AILMENT_TURNS_DEFAULT = 3;
export const EN_REGEN_PER_TURN = 6;

export const CAPTURE_BASE = 0.15;
export const CAPTURE_HP_FACTOR = 0.75;
export const CAPTURE_RARE_MULT = 0.5;
export const CAPTURE_ANALYZED_MULT = 1.3;
export const CAPTURE_MAX = 0.95;

export const CONTROL_AILMENTS: readonly Ailment[] = ['freeze', 'stun', 'sleep'];

export function isControlAilment(ailment: Ailment): boolean {
  return CONTROL_AILMENTS.includes(ailment);
}
