import type { Ailment, Attribute, BuffKind, Element, ResistanceMap, Skill } from './digimon.js';

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

export type ActiveBuff = {
  kind: BuffKind;
  amount: number;
  remainingTurns: number;
  sourceId: UnitId;
};

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
  int: number;
  skills: Skill[];
  ailments: Ailmented[];
  /** Optional for backward compat with pre-P1 `battle:snap:*` blobs; engine defaults to `[]` / `0`. */
  activeBuffs?: ActiveBuff[];
  evade?: number;
  skillCooldowns?: Record<string, number>;
  wildInfo?: WildInfo;
};

/**
 * Server-resolved item effect. The wire-type `use_item` action carries only
 * `itemId`; the server looks up the shop_item, decodes payload, and passes
 * the resolved `ItemEffect` to `applyAction` via `ApplyContext.itemEffect`.
 * Clients NEVER supply the effect — trust boundary lives in world/pve-battle.
 */
export type ItemEffect =
  | { kind: 'heal_pct'; pct: number }
  | { kind: 'en_pct'; pct: number }
  | { kind: 'clear_ailments' }
  | { kind: 'atk_bonus'; amount: number }
  | { kind: 'def_bonus'; amount: number }
  | { kind: 'revive' }
  | { kind: 'extract_dungeon' };

export type Action =
  | { type: 'fight'; unitId: UnitId; targetId: UnitId }
  | { type: 'skill'; unitId: UnitId; skillId: string; targetId: UnitId; extraTargetIds?: readonly UnitId[] }
  | { type: 'capture'; unitId: UnitId; targetId: UnitId }
  | { type: 'use_item'; unitId: UnitId; targetId: UnitId; itemId: string }
  | { type: 'flee' };

export type ActionCue = 'crit' | 'miss' | 'resist' | 'weak' | 'immune' | 'chain' | 'attr-advantage' | 'attr-disadvantage' | 'capture-hit' | 'capture-miss' | 'item-heal' | 'item-en' | 'item-cure' | 'item-buff' | 'item-revive' | null;

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
      skillElement?: Element;
      vfxPresetId?: string;
      cue: ActionCue;
      applied?: Ailmented[];
      captureChance?: number;
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
  /** Global damage multiplier fetched from `game_settings.damage_rate` at
   *  match init and frozen for the match's lifetime. Optional for backward
   *  compat with in-flight `battle:snap:*` blobs from before the field was
   *  added — `applyAction` falls back to `1.0` when absent. */
  damageRate?: number;
  sceneId?: string | null;
  /** Actions queued by the DSL's `schedule` kind, fired at the start of the
   *  round named by `firesAtRound`. Optional for backward compat with in-flight
   *  `battle:snap:*` blobs written before the field existed — readers must
   *  treat `undefined` as an empty queue. */
  pendingActions?: ScheduledAction[];
};

/** A `schedule` action parked on the battle until its round comes up.
 *
 *  Units are stored by id rather than by reference because a `Battle` is
 *  round-tripped through JSON into the cluster's `battle:snap:{matchId}` key
 *  between actions; object references would not survive. */
export type ScheduledAction = {
  /** The DSL action to run. Structurally an `Action` from the skills DSL, kept
   *  loose here because `shared` does not depend on the backend's schema. */
  action: unknown;
  actorId: UnitId;
  targetId: UnitId | null;
  extraPickIds: UnitId[];
  side: BattleSide;
  skillName: string;
  /** Preset id of the originating skill, so a delayed action still renders its effect. */
  vfxPresetId?: string;
  /** `battle.round` value at which this fires. */
  firesAtRound: number;
};

export type EnemyUnitView = {
  id: UnitId;
  slot: SlotIndex;
  templateId: string;
  name: string;
  element: Element;
  resistances?: ResistanceMap;
  level: number;
  hp: number;
  hpMax: number;
  ailments: Ailmented[];
  /**
   * Buffs and debuffs currently on the unit.
   *
   * `serializeForSide` redacts the enemy's EN, skills and combat stats, but buff
   * STATE is visible in fiction — a player can see that something is shielded or
   * has had its attack cut, and needs to, since debuffs land in `activeBuffs`
   * (`atk_down`, `def_down`, ...) rather than in `ailments`. Without this the
   * client can only draw status icons for its own side.
   */
  activeBuffs?: ActiveBuff[];
  down: boolean;
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
  sceneId?: string | null;
};

export const MISS_CHANCE = 0.08;
export const CRIT_CHANCE = 0.15;
export const CRIT_MULT = 1.6;
export const CHAIN_MULT = 1.4;
export const AILMENT_TURNS_DEFAULT = 3;
export const EN_REGEN_PER_TURN = 6;

export const BASE_HIT_PCT = 92;
export const MIN_HIT_PCT = 20;
export const MAX_HIT_PCT = 98;
export const BLIND_ACCURACY_PENALTY = 30;

export const CAPTURE_BASE = 0.15;
export const CAPTURE_HP_FACTOR = 0.75;
export const CAPTURE_RARE_MULT = 0.5;
export const CAPTURE_MAX = 0.95;

export const CONTROL_AILMENTS: readonly Ailment[] = ['freeze', 'stun', 'sleep', 'petrify', 'confusion', 'charm'];

export function isControlAilment(ailment: Ailment): boolean {
  return CONTROL_AILMENTS.includes(ailment);
}

export function skillPlayerPickCount(skill: Skill): 1 | 2 | 3 {
  const actions = skill.actions;
  if (!Array.isArray(actions)) return 1;
  let max: 1 | 2 | 3 = 1;
  for (const raw of actions) {
    if (raw === null || typeof raw !== 'object') continue;
    const target = (raw as { target?: unknown }).target;
    if (target === 'player_pick_3') return 3;
    if (target === 'player_pick_2' && max < 2) max = 2;
  }
  return max;
}
