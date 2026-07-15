/**
 * Server-authoritative 3v3 battle engine — SMT-style initiative queue.
 *
 * Turn order is not "alternating players" — it's a queue rebuilt at the top
 * of every round, sorted by `computeInitiative(unit)`:
 *
 *   initiative = unit.spd + unit.level * 2 + spd * random(0..0.2)
 *
 * Higher initiative acts first. Item-derived speed bonuses ride on `statBonus.spd`
 * (via pre-battle buffs consumed in battle/routes.ts), so faster gear moves you
 * up the queue automatically. When it's a unit's turn:
 *   - The action's `unitId` MUST match the queue head — the client shows
 *     the context menu at that unit (see public/combat.html).
 *   - Locked units (freeze/stun/sleep) auto-skip; the server still ticks
 *     their DoT ailments before advancing.
 *   - Dead units auto-skip.
 * At queue end, the round advances: EN regenerates, initiative is re-rolled,
 * and a `round-start` event is emitted so the UI can animate the transition.
 *
 * Everything remains a pure function over the `Battle` state — no I/O, no
 * timers, no clients. Transport + persistence live in battle/routes.ts.
 */
import { newId } from '../util/ids.js';
import { affinity, AFFINITY_MULT, scaleStatsForLevel } from '../digimon/element.js';
import { PARTY_SIZE, SKILLS_PER_DIGIMON, type Ailment, type Skill, type TemplateDigimon } from '../digimon/types.js';
import {
  AILMENT_TURNS_DEFAULT,
  CRIT_CHANCE,
  CRIT_MULT,
  EN_REGEN_PER_TURN,
  GUARD_MULT,
  MISS_CHANCE,
  isControlAilment,
  type Action,
  type ActionCue,
  type Ailmented,
  type Battle,
  type BattleEvent,
  type BattleOutcome,
  type BattleSide,
  type BattleUnit,
  type BattleView,
  type EnemyUnitView,
  type FriendlyUnitView,
  type SlotIndex,
  type TurnEntry,
  type UnitId,
} from './types.js';

// ----- Loadout / unit construction ------------------------------------------

export type LoadoutMember = {
  monId: string;
  templateId: string;
  template: TemplateDigimon;
  level: number;
  nickname: string;
  statBonus: { hp: number; en: number; atk: number; def: number; int: number; spd: number };
};

export type Loadout = {
  playerId: string;
  members: [LoadoutMember, LoadoutMember, LoadoutMember];
};

function unitFromLoadout(side: BattleSide, slot: SlotIndex, m: LoadoutMember): BattleUnit {
  const scaled = scaleStatsForLevel(m.template.baseStats, m.level, m.statBonus);
  const skills = m.template.skillPool.slice(0, SKILLS_PER_DIGIMON);
  return {
    id: `${side}:${slot}` as UnitId,
    side,
    slot,
    templateId: m.template.id,
    name: m.nickname || m.template.name,
    element: m.template.element,
    level: m.level,
    hp: scaled.hp,
    hpMax: scaled.hp,
    en: scaled.en,
    enMax: scaled.en,
    atk: scaled.atk,
    def: scaled.def,
    spd: scaled.spd,
    skills,
    ailments: [],
    guarding: false,
  };
}

// ----- Initiative + turn queue ----------------------------------------------

/**
 * SMT-style initiative. Deterministic base + small variance so ties don't
 * always favor the same unit round after round.
 *   initiative = spd + level * 2 + random(0..spd*0.2)
 */
export function computeInitiative(unit: BattleUnit): number {
  return unit.spd + unit.level * 2 + Math.random() * unit.spd * 0.2;
}

/** Build a fresh turn queue for a round from the currently-living units. */
export function buildTurnQueue(units: BattleUnit[]): TurnEntry[] {
  const alive = units.filter((u) => u.hp > 0);
  const entries: TurnEntry[] = alive.map((u) => ({
    unitId: u.id,
    side: u.side,
    name: u.name,
    initiative: computeInitiative(u),
  }));
  return entries.sort((a, b) => b.initiative - a.initiative);
}

function currentEntry(battle: Battle): TurnEntry | null {
  const entry = battle.turnQueue[battle.turnCursor];
  return entry ?? null;
}

// ----- Init -----------------------------------------------------------------

/** Fresh Battle instance. `matchId` and side ownership fixed for its lifetime. */
export function initBattle(input: { matchId?: string; loadoutA: Loadout; loadoutB: Loadout }): Battle {
  const id = input.matchId ?? newId('mtc');
  const now = Date.now();
  const unitsA = input.loadoutA.members.map((m, i) => unitFromLoadout('a', i as SlotIndex, m));
  const unitsB = input.loadoutB.members.map((m, i) => unitFromLoadout('b', i as SlotIndex, m));
  const units = [...unitsA, ...unitsB];
  const queue = buildTurnQueue(units);
  const firstEntry = queue[0];
  const activeSide: BattleSide = firstEntry ? firstEntry.side : 'a';
  const log: BattleEvent[] = [
    {
      at: now,
      round: 1,
      type: 'round-start',
      order: queue.map((e) => ({ unit: e.unitId, name: e.name, side: e.side, initiative: e.initiative })),
    },
    firstEntry
      ? { at: now, round: 1, type: 'turn', side: activeSide, unit: firstEntry.unitId, unitName: firstEntry.name }
      : { at: now, round: 1, type: 'turn', side: activeSide, unit: null },
  ];
  return {
    id,
    playerA: input.loadoutA.playerId,
    playerB: input.loadoutB.playerId,
    units,
    activeSide,
    turnQueue: queue,
    turnCursor: 0,
    round: 1,
    log,
    status: 'active',
    outcome: null,
    winner: null,
    startedAt: now,
    endedAt: null,
  };
}

// ----- Helpers --------------------------------------------------------------

function unitBy(battle: Battle, id: UnitId): BattleUnit | undefined {
  return battle.units.find((u) => u.id === id);
}

function livingOnSide(battle: Battle, side: BattleSide): BattleUnit[] {
  return battle.units.filter((u) => u.side === side && u.hp > 0);
}

function opponentOf(side: BattleSide): BattleSide {
  return side === 'a' ? 'b' : 'a';
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function pushEvent(battle: Battle, event: BattleEvent): void {
  battle.log.push(event);
}

// ----- Rules resolution -----------------------------------------------------

export type ApplyErrorCode =
  | 'not-your-turn'
  | 'unit-invalid'
  | 'target-invalid'
  | 'skill-invalid'
  | 'no-energy'
  | 'battle-over';

export type ApplyResult =
  | { ok: true; battle: Battle; events: BattleEvent[] }
  | { ok: false; error: string; code: ApplyErrorCode };

/**
 * Apply one action from the CURRENT turn's actor. Validates:
 *   - battle is active
 *   - actingSide matches the queue-head's side
 *   - action.unitId matches the queue-head's unitId (for actions that carry
 *     one; `flee` doesn't)
 *   - target is alive and on the opposing side (for offensive actions)
 *   - actor has enough EN for a skill
 * On success, resolves damage/status, ticks the acting unit's DoT ailments,
 * then advances the queue (skipping dead/locked, recomputing on round end).
 */
export function applyAction(
  battle: Battle,
  actingSide: BattleSide,
  action: Action,
): ApplyResult {
  if (battle.status !== 'active') return { ok: false, error: 'battle already ended', code: 'battle-over' };

  const head = currentEntry(battle);
  if (!head) return { ok: false, error: 'no active turn', code: 'battle-over' };
  if (head.side !== actingSide) return { ok: false, error: 'not your turn', code: 'not-your-turn' };

  const eventsBefore = battle.log.length;

  // Flee is unit-less: forfeits the match for actingSide.
  if (action.type === 'flee') {
    battle.status = 'ended';
    battle.outcome = actingSide === 'a' ? 'fled_a' : 'fled_b';
    battle.winner = opponentOf(actingSide);
    battle.endedAt = Date.now();
    pushEvent(battle, {
      at: battle.endedAt,
      round: battle.round,
      type: 'action',
      actor: null,
      action,
      cue: null,
    });
    pushEvent(battle, {
      at: battle.endedAt,
      round: battle.round,
      type: 'end',
      outcome: battle.outcome,
      winner: battle.winner,
    });
    return { ok: true, battle, events: battle.log.slice(eventsBefore) };
  }

  const actor = unitBy(battle, action.unitId);
  if (!actor || actor.side !== actingSide) {
    return { ok: false, error: 'unit does not belong to you', code: 'unit-invalid' };
  }
  if (actor.id !== head.unitId) {
    return { ok: false, error: `${actor.name} is not the current turn's actor`, code: 'not-your-turn' };
  }
  if (actor.hp <= 0) {
    return { ok: false, error: 'unit is defeated', code: 'unit-invalid' };
  }

  // Guard resolves without a target.
  if (action.type === 'guard') {
    actor.guarding = true;
    pushEvent(battle, {
      at: Date.now(),
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action,
      cue: null,
    });
    tickActorAilments(battle, actor);
    advanceTurnQueue(battle);
    return { ok: true, battle, events: battle.log.slice(eventsBefore) };
  }

  const target = unitBy(battle, action.targetId);
  if (!target || target.side !== opponentOf(actingSide) || target.hp <= 0) {
    return { ok: false, error: 'invalid target', code: 'target-invalid' };
  }

  let skill: Skill;
  if (action.type === 'skill') {
    const s = actor.skills.find((sk) => sk.id === action.skillId);
    if (!s) return { ok: false, error: 'unknown skill', code: 'skill-invalid' };
    if (actor.en < s.energyCost) return { ok: false, error: 'not enough energy', code: 'no-energy' };
    skill = s;
  } else {
    skill = { id: 'basic', name: 'Attack', element: actor.element, energyCost: 0, power: 100 };
  }

  actor.en = clamp(actor.en - skill.energyCost, 0, actor.enMax);

  const now = Date.now();
  const missed = Math.random() < MISS_CHANCE;
  if (missed) {
    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action,
      targetId: target.id,
      targetName: target.name,
      damage: 0,
      skillName: skill.name,
      cue: 'miss',
    });
  } else {
    const critted = Math.random() < CRIT_CHANCE;
    const aff = affinity(skill.element, target.element);
    const affMult = aff ? AFFINITY_MULT[aff] : 1;
    const baseDamage = actor.atk * 0.4 + skill.power;
    const defMitigation = 1 - clamp(target.def / (target.def + 400), 0, 0.65);
    const guardMult = target.guarding ? GUARD_MULT : 1;
    const variance = 0.9 + Math.random() * 0.2;
    const dmg = Math.max(
      1,
      Math.round(baseDamage * (critted ? CRIT_MULT : 1) * affMult * defMitigation * guardMult * variance),
    );
    target.hp = clamp(target.hp - dmg, 0, target.hpMax);
    target.guarding = false;

    const applied: Ailmented[] = [];
    if (skill.effect && Math.random() < skill.effect.chance) {
      applyAilment(target, skill.effect.kind, skill.effect.turns || AILMENT_TURNS_DEFAULT);
      applied.push({ kind: skill.effect.kind, turnsLeft: skill.effect.turns || AILMENT_TURNS_DEFAULT });
    }

    const cue: ActionCue = critted ? 'crit' : aff === 'resist' ? 'resist' : aff === 'weak' ? 'weak' : null;
    const hitEvent: BattleEvent = {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action,
      targetId: target.id,
      targetName: target.name,
      damage: dmg,
      skillName: skill.name,
      cue,
    };
    if (applied.length > 0) hitEvent.applied = applied;
    pushEvent(battle, hitEvent);
    if (target.hp === 0) {
      pushEvent(battle, {
        at: now,
        round: battle.round,
        type: 'unit-down',
        unit: target.id,
        unitName: target.name,
      });
    }
  }

  tickActorAilments(battle, actor);
  advanceTurnQueue(battle);
  return { ok: true, battle, events: battle.log.slice(eventsBefore) };
}

function applyAilment(unit: BattleUnit, kind: Ailment, turns: number): void {
  const existing = unit.ailments.find((a) => a.kind === kind);
  if (existing) {
    existing.turnsLeft = Math.max(existing.turnsLeft, turns);
  } else {
    unit.ailments.push({ kind, turnsLeft: turns });
  }
}

/**
 * DoT tick + expiry check for ONE unit — called right after that unit acted
 * (or was auto-skipped). SMT-style: your ailments hurt you on your own turn.
 */
function tickActorAilments(battle: Battle, unit: BattleUnit): void {
  const now = Date.now();
  const kept: Ailmented[] = [];
  for (const a of unit.ailments) {
    let damage = 0;
    if (a.kind === 'burn') damage = Math.max(1, Math.round(unit.hpMax * 0.06));
    else if (a.kind === 'poison') damage = Math.max(1, Math.round(unit.hpMax * 0.05));
    if (damage > 0 && unit.hp > 0) {
      unit.hp = clamp(unit.hp - damage, 0, unit.hpMax);
      pushEvent(battle, { at: now, round: battle.round, type: 'ailment-tick', unit: unit.id, kind: a.kind, damage });
      if (unit.hp === 0) {
        pushEvent(battle, { at: now, round: battle.round, type: 'unit-down', unit: unit.id, unitName: unit.name });
      }
    }
    const remaining = a.turnsLeft - 1;
    if (remaining <= 0) {
      pushEvent(battle, { at: now, round: battle.round, type: 'ailment-expired', unit: unit.id, kind: a.kind });
    } else {
      kept.push({ kind: a.kind, turnsLeft: remaining });
    }
  }
  unit.ailments = kept;
}

/**
 * Advance the turn cursor after an action. Auto-skips dead / control-locked
 * units (still ticking their DoT). Recomputes the queue and awards EN regen
 * when the round rolls over. Emits `turn-skip`, `round-start`, and `turn`
 * events so the UI can animate every transition.
 */
function advanceTurnQueue(battle: Battle): void {
  // End of match takes priority.
  const outcome = checkOutcome(battle);
  if (outcome) {
    battle.status = 'ended';
    battle.outcome = outcome;
    battle.winner = outcome === 'win_a' ? 'a' : outcome === 'win_b' ? 'b' : null;
    battle.endedAt = Date.now();
    pushEvent(battle, {
      at: battle.endedAt,
      round: battle.round,
      type: 'end',
      outcome,
      winner: battle.winner,
    });
    return;
  }

  battle.turnCursor += 1;

  // Skip forward past dead / locked entries, ticking DoT for skipped locked
  // units. Multiple skips in a row are collapsed into individual events.
  while (battle.turnCursor < battle.turnQueue.length) {
    const entry = battle.turnQueue[battle.turnCursor]!;
    const unit = unitBy(battle, entry.unitId);
    if (!unit || unit.hp <= 0) {
      if (unit) {
        pushEvent(battle, {
          at: Date.now(),
          round: battle.round,
          type: 'turn-skip',
          unit: unit.id,
          unitName: unit.name,
          reason: 'defeated',
        });
      }
      battle.turnCursor += 1;
      continue;
    }
    const locked = unit.ailments.find((a) => isControlAilment(a.kind));
    if (locked) {
      pushEvent(battle, {
        at: Date.now(),
        round: battle.round,
        type: 'turn-skip',
        unit: unit.id,
        unitName: unit.name,
        reason: 'locked',
      });
      tickActorAilments(battle, unit);
      const outcome2 = checkOutcome(battle);
      if (outcome2) {
        battle.status = 'ended';
        battle.outcome = outcome2;
        battle.winner = outcome2 === 'win_a' ? 'a' : outcome2 === 'win_b' ? 'b' : null;
        battle.endedAt = Date.now();
        pushEvent(battle, {
          at: battle.endedAt,
          round: battle.round,
          type: 'end',
          outcome: outcome2,
          winner: battle.winner,
        });
        return;
      }
      battle.turnCursor += 1;
      continue;
    }
    break;
  }

  // End of round → recompute + regen.
  if (battle.turnCursor >= battle.turnQueue.length) {
    battle.round += 1;
    for (const u of battle.units.filter((x) => x.hp > 0)) {
      u.en = clamp(u.en + EN_REGEN_PER_TURN, 0, u.enMax);
      u.guarding = false;
    }
    battle.turnQueue = buildTurnQueue(battle.units);
    battle.turnCursor = 0;
    pushEvent(battle, {
      at: Date.now(),
      round: battle.round,
      type: 'round-start',
      order: battle.turnQueue.map((e) => ({ unit: e.unitId, name: e.name, side: e.side, initiative: e.initiative })),
    });
    while (battle.turnCursor < battle.turnQueue.length) {
      const entry = battle.turnQueue[battle.turnCursor]!;
      const unit = unitBy(battle, entry.unitId);
      if (!unit || unit.hp <= 0) { battle.turnCursor += 1; continue; }
      const locked = unit.ailments.find((a) => isControlAilment(a.kind));
      if (locked) {
        pushEvent(battle, {
          at: Date.now(),
          round: battle.round,
          type: 'turn-skip',
          unit: unit.id,
          unitName: unit.name,
          reason: 'locked',
        });
        tickActorAilments(battle, unit);
        battle.turnCursor += 1;
        continue;
      }
      break;
    }
    if (battle.turnCursor >= battle.turnQueue.length) {
      battle.status = 'ended';
      battle.outcome = 'draw';
      battle.winner = null;
      battle.endedAt = Date.now();
      pushEvent(battle, {
        at: battle.endedAt,
        round: battle.round,
        type: 'end',
        outcome: 'draw',
        winner: null,
      });
      return;
    }
  }

  const nextEntry = battle.turnQueue[battle.turnCursor]!;
  battle.activeSide = nextEntry.side;
  pushEvent(battle, {
    at: Date.now(),
    round: battle.round,
    type: 'turn',
    side: nextEntry.side,
    unit: nextEntry.unitId,
    unitName: nextEntry.name,
  });
}

function checkOutcome(battle: Battle): BattleOutcome | null {
  const aAlive = livingOnSide(battle, 'a').length;
  const bAlive = livingOnSide(battle, 'b').length;
  if (aAlive === 0 && bAlive === 0) return 'draw';
  if (aAlive === 0) return 'win_b';
  if (bAlive === 0) return 'win_a';
  return null;
}

/**
 * Force-end a battle from outside (disconnect, admin action).
 * `culprit` is the side that abandoned; the other side is credited the win.
 */
export function abandonBattle(battle: Battle, culprit: BattleSide | null): void {
  if (battle.status === 'ended') return;
  battle.status = 'ended';
  battle.outcome = 'abandoned';
  battle.winner = culprit ? opponentOf(culprit) : null;
  battle.endedAt = Date.now();
  pushEvent(battle, {
    at: battle.endedAt,
    round: battle.round,
    type: 'end',
    outcome: battle.outcome,
    winner: battle.winner,
  });
}

// ----- Views ---------------------------------------------------------------

/** Redact the enemy side's EN / skills / atk / def / spd for a side view. */
export function serializeForSide(battle: Battle, side: BattleSide): BattleView {
  const friendly: FriendlyUnitView[] = battle.units
    .filter((u) => u.side === side)
    .map((u) => ({ ...u, down: u.hp === 0 }));
  const enemy: EnemyUnitView[] = battle.units
    .filter((u) => u.side !== side)
    .map((u) => ({
      id: u.id,
      slot: u.slot,
      name: u.name,
      element: u.element,
      level: u.level,
      hp: u.hp,
      hpMax: u.hpMax,
      ailments: u.ailments,
      down: u.hp === 0,
    }));
  const head = currentEntry(battle);
  const upcoming = battle.turnQueue.slice(battle.turnCursor, battle.turnCursor + 8);
  return {
    id: battle.id,
    round: battle.round,
    status: battle.status,
    activeSide: battle.activeSide,
    yourSide: side,
    yourTurn: head?.side === side,
    currentTurnUnitId: head?.unitId ?? null,
    currentTurnBelongsToYou: head?.side === side,
    upcomingTurns: upcoming,
    outcome: battle.outcome,
    winner: battle.winner,
    friendly,
    enemy,
    log: battle.log.slice(-40),
  };
}

/** Which player id owns `side`? */
export function playerIdForSide(battle: Battle, side: BattleSide): string {
  return side === 'a' ? battle.playerA : battle.playerB;
}

/** Reverse: which side does this player id play? Returns null if not a party. */
export function sideForPlayerId(battle: Battle, userId: string): BattleSide | null {
  if (battle.playerA === userId) return 'a';
  if (battle.playerB === userId) return 'b';
  return null;
}

/** Sanity: verify a loadout has PARTY_SIZE members. */
export function validateLoadout(loadout: Loadout): { ok: true } | { ok: false; reason: string } {
  if (loadout.members.length !== PARTY_SIZE) return { ok: false, reason: `party must be exactly ${PARTY_SIZE} members` };
  const seen = new Set<string>();
  for (const m of loadout.members) {
    if (!m.template) return { ok: false, reason: 'each member needs a template' };
    if (seen.has(m.templateId)) return { ok: false, reason: 'duplicate templates in party' };
    seen.add(m.templateId);
    if (m.template.skillPool.length < 1) return { ok: false, reason: `${m.template.name} has no skills` };
  }
  return { ok: true };
}
