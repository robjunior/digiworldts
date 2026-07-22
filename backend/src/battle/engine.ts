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
import { log } from '../util/log.js';
import { affinity, attrAffinity, ATTR_MULT, ATTRS_TRIANGLE_ELIGIBLE, resolveResistance, scaleStatsForLevel } from '../digimon/element.js';
import { PARTY_SIZE, SKILLS_PER_DIGIMON, type Ailment, type Skill, type TemplateDigimon } from '../digimon/types.js';
import {
  AILMENT_TURNS_DEFAULT,
  CAPTURE_ANALYZED_MULT,
  CAPTURE_BASE,
  CAPTURE_HP_FACTOR,
  CAPTURE_MAX,
  CAPTURE_RARE_MULT,
  CHAIN_MULT,
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
  type BattleMode,
  type BattleOutcome,
  type BattleSide,
  type BattleUnit,
  type BattleView,
  type EnemyUnitView,
  type FriendlyUnitView,
  type ItemEffect,
  type SlotIndex,
  type TurnEntry,
  type UnitId,
  type WildInfo,
  MAX_WILD_PARTY_SIZE,
} from './types.js';

// ----- Loadout / unit construction ------------------------------------------

export type LoadoutMember = {
  monId: string;
  templateId: string;
  template: TemplateDigimon;
  level: number;
  nickname: string;
  statBonus: { hp: number; en: number; atk: number; def: number; int: number; spd: number };
  equippedSkills?: Skill[];
  downedAtStart?: boolean;
};

export type Loadout = {
  playerId: string;
  members: LoadoutMember[];
};

function unitFromLoadout(side: BattleSide, slot: SlotIndex, m: LoadoutMember, wildInfo?: WildInfo): BattleUnit {
  const scaled = scaleStatsForLevel(m.template.baseStats, m.level, m.statBonus);
  const rawSkills = m.equippedSkills && m.equippedSkills.length > 0
    ? m.equippedSkills.slice(0, SKILLS_PER_DIGIMON)
    : m.template.skillPool.slice(0, SKILLS_PER_DIGIMON);
  const skills = rawSkills.filter((s) => {
    if (s.energyCost <= scaled.en) return true;
    log.warn('battle.skill.unusable', { templateId: m.template.id, monId: m.monId, name: m.nickname, skill: s.name, cost: s.energyCost, enMax: scaled.en });
    return false;
  });
  const unit: BattleUnit = {
    id: `${side}:${slot}` as UnitId,
    side,
    slot,
    templateId: m.template.id,
    name: m.nickname || m.template.name,
    element: m.template.element,
    attribute: m.template.attribute,
    level: m.level,
    hp: m.downedAtStart ? 0 : scaled.hp,
    hpMax: scaled.hp,
    en: scaled.en,
    enMax: scaled.en,
    atk: scaled.atk,
    def: scaled.def,
    spd: scaled.spd,
    int: scaled.int,
    skills,
    ailments: [],
    guarding: false,
    analyzed: false,
  };
  if (m.template.resistances) unit.resistances = m.template.resistances;
  if (wildInfo) unit.wildInfo = wildInfo;
  return unit;
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
  entries.sort((a, b) => b.initiative - a.initiative);
  return entries;
}

/**
 * Move a unit's upcoming turn within `battle.turnQueue`. `delta` is added to
 * the entry's current queue index (positive = later, negative = sooner). The
 * entry is only moved if it appears AFTER `battle.turnCursor` (already-acted
 * or currently-acting units cannot be shifted this round).
 *
 * Skill DSL uses this via `{ kind: 'shift_initiative', target, delta }`.
 */
export function shiftInitiative(battle: Battle, unitId: UnitId, delta: number): boolean {
  const startIdx = battle.turnCursor + 1;
  const entryIdx = battle.turnQueue.findIndex((e, i) => i >= startIdx && e.unitId === unitId);
  if (entryIdx === -1) return false;
  const entry = battle.turnQueue[entryIdx]!;
  const target = Math.max(startIdx, Math.min(battle.turnQueue.length - 1, entryIdx + delta));
  if (target === entryIdx) return false;
  battle.turnQueue.splice(entryIdx, 1);
  battle.turnQueue.splice(target, 0, entry);
  return true;
}

function currentEntry(battle: Battle): TurnEntry | null {
  const entry = battle.turnQueue[battle.turnCursor];
  return entry ?? null;
}

// ----- Init -----------------------------------------------------------------

/** Fresh Battle instance. `matchId` and side ownership fixed for its lifetime. */
export function initBattle(input: {
  matchId?: string;
  loadoutA: Loadout;
  loadoutB: Loadout;
  mode?: BattleMode;
  wildFlags?: ReadonlyArray<WildInfo | undefined>;
  displayNames?: { a?: string; b?: string };
}): Battle {
  const id = input.matchId ?? newId('mtc');
  const mode = input.mode ?? 'pvp';
  const now = Date.now();
  const unitsA = input.loadoutA.members.map((m, i) => unitFromLoadout('a', i as SlotIndex, m));
  const unitsB = input.loadoutB.members.map((m, i) =>
    unitFromLoadout('b', i as SlotIndex, m, input.wildFlags?.[i]),
  );
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
  const battle: Battle = {
    id,
    mode,
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
    lastAction: null,
  };
  if (input.displayNames) {
    const dn: { a?: string; b?: string } = {};
    if (input.displayNames.a !== undefined) dn.a = input.displayNames.a;
    if (input.displayNames.b !== undefined) dn.b = input.displayNames.b;
    battle.displayNames = dn;
  }
  return battle;
}

/**
 * PVE variant. `wildParty` is 1-6 wild mons — remaining side-B slots up
 * to MAX_WILD_PARTY_SIZE get a phantom dead-from-start unit so the fixed
 * SlotIndex range works and dead units auto-skip in the queue.
 */
export function initPveBattle(input: {
  matchId?: string;
  playerLoadout: Loadout;
  wildParty: ReadonlyArray<{ member: LoadoutMember; wildInfo: WildInfo }>;
}): Battle {
  if (input.wildParty.length < 1 || input.wildParty.length > MAX_WILD_PARTY_SIZE) {
    throw new Error(`initPveBattle: wildParty must be 1-${MAX_WILD_PARTY_SIZE} mons, got ${input.wildParty.length}`);
  }
  const first = input.wildParty[0]!;
  const phantomTemplate = first.member.template;
  const phantomMember: LoadoutMember = {
    monId: 'phantom',
    templateId: phantomTemplate.id,
    template: phantomTemplate,
    level: 1,
    nickname: '—',
    statBonus: { hp: -9999, en: 0, atk: 0, def: 0, int: 0, spd: 0 },
  };
  const wildMembers: LoadoutMember[] = [];
  const wildFlags: Array<WildInfo | undefined> = [];
  for (let i = 0; i < MAX_WILD_PARTY_SIZE; i++) {
    const w = input.wildParty[i];
    if (w) {
      wildMembers.push(w.member);
      wildFlags.push(w.wildInfo);
    } else {
      wildMembers.push(phantomMember);
      wildFlags.push(undefined);
    }
  }
  const wildLoadout: Loadout = {
    playerId: 'wild',
    members: wildMembers,
  };
  const battle = initBattle({
    ...(input.matchId ? { matchId: input.matchId } : {}),
    loadoutA: input.playerLoadout,
    loadoutB: wildLoadout,
    mode: 'pve',
    wildFlags,
  });
  for (let i = input.wildParty.length; i < MAX_WILD_PARTY_SIZE; i++) {
    const phantom = battle.units.find((u) => u.id === (`b:${i}` as UnitId));
    if (phantom) {
      phantom.hp = 0;
      phantom.hpMax = 0;
    }
  }
  return battle;
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

const BATTLE_LOG_MAX = 200;

function pushEvent(battle: Battle, event: BattleEvent): void {
  battle.log.push(event);
  if (battle.log.length > BATTLE_LOG_MAX) battle.log.splice(0, battle.log.length - BATTLE_LOG_MAX);
}

// ----- Rules resolution -----------------------------------------------------

export type ApplyErrorCode =
  | 'not-your-turn'
  | 'unit-invalid'
  | 'target-invalid'
  | 'skill-invalid'
  | 'no-energy'
  | 'battle-over'
  | 'item-invalid';

export type ApplyResult =
  | { ok: true; battle: Battle; events: BattleEvent[] }
  | { ok: false; error: string; code: ApplyErrorCode };

export type ApplyContext = {
  readonly itemEffect?: ItemEffect;
};

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
  ctx?: ApplyContext,
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
    battle.lastAction = { side: actingSide, element: 'null', attribute: actor.attribute, wasHit: false };
    tickActorAilments(battle, actor);
    advanceTurnQueue(battle);
    return { ok: true, battle, events: battle.log.slice(eventsBefore) };
  }

  if (action.type === 'use_item') {
    if (battle.mode !== 'pve') {
      return { ok: false, error: 'items are PVE-only', code: 'item-invalid' };
    }
    const effect = ctx?.itemEffect;
    if (!effect) {
      return { ok: false, error: 'item effect not resolved server-side', code: 'item-invalid' };
    }
    const itemTarget = unitBy(battle, action.targetId);
    if (!itemTarget || itemTarget.side !== actingSide) {
      return { ok: false, error: 'item target must be your own Digimon', code: 'target-invalid' };
    }
    if (effect.kind !== 'revive' && itemTarget.hp <= 0) {
      return { ok: false, error: 'target is defeated (need a revive)', code: 'target-invalid' };
    }
    if (effect.kind === 'revive' && itemTarget.hp > 0) {
      return { ok: false, error: 'target is not defeated', code: 'target-invalid' };
    }
    const cue: ActionCue = applyItemEffect(itemTarget, effect);
    const now = Date.now();
    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action,
      targetId: itemTarget.id,
      targetName: itemTarget.name,
      cue,
    });
    battle.lastAction = { side: actingSide, element: 'null', attribute: actor.attribute, wasHit: false };
    tickActorAilments(battle, actor);
    advanceTurnQueue(battle);
    return { ok: true, battle, events: battle.log.slice(eventsBefore) };
  }

  const target = unitBy(battle, action.targetId);
  if (!target || target.side !== opponentOf(actingSide) || target.hp <= 0) {
    return { ok: false, error: 'invalid target', code: 'target-invalid' };
  }

  if (action.type === 'analyze') {
    target.analyzed = true;
    const now = Date.now();
    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action,
      targetId: target.id,
      targetName: target.name,
      cue: 'analyzed',
      analyzedInfo: {
        name: target.name,
        element: target.element,
        level: target.level,
        hp: target.hp,
        hpMax: target.hpMax,
        en: target.en,
        enMax: target.enMax,
        atk: target.atk,
        def: target.def,
        spd: target.spd,
        int: target.int,
        skills: target.skills.map((s) => ({ name: s.name, element: s.element, power: s.power, energyCost: s.energyCost })),
        ...(target.wildInfo ? { wild: target.wildInfo } : {}),
      },
    });
    battle.lastAction = { side: actingSide, element: 'null', attribute: actor.attribute, wasHit: false };
    tickActorAilments(battle, actor);
    advanceTurnQueue(battle);
    return { ok: true, battle, events: battle.log.slice(eventsBefore) };
  }

  if (action.type === 'capture') {
    if (battle.mode !== 'pve') {
      return { ok: false, error: 'capture only allowed in PVE battles', code: 'target-invalid' };
    }
    if (!target.wildInfo) {
      return { ok: false, error: 'target is not a wild mon', code: 'target-invalid' };
    }
    const hpFactor = 1 - target.hp / target.hpMax;
    const rareMult = target.wildInfo.rare ? CAPTURE_RARE_MULT : 1;
    const analyzedMult = target.analyzed ? CAPTURE_ANALYZED_MULT : 1;
    const rawChance = (CAPTURE_BASE + CAPTURE_HP_FACTOR * hpFactor) * rareMult * analyzedMult;
    const chance = clamp(rawChance, 0, CAPTURE_MAX);
    const roll = Math.random();
    const captured = roll < chance;
    const now = Date.now();
    if (captured) {
      target.hp = 0;
      pushEvent(battle, {
        at: now,
        round: battle.round,
        type: 'action',
        actor: actor.id,
        actorName: actor.name,
        action,
        targetId: target.id,
        targetName: target.name,
        cue: 'capture-hit',
        captureChance: chance,
      });
      battle.status = 'ended';
      battle.outcome = 'captured_a';
      battle.winner = actingSide;
      battle.endedAt = now;
      pushEvent(battle, {
        at: now,
        round: battle.round,
        type: 'end',
        outcome: 'captured_a',
        winner: actingSide,
        capturedUnitId: target.id,
      });
      return { ok: true, battle, events: battle.log.slice(eventsBefore) };
    }
    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action,
      targetId: target.id,
      targetName: target.name,
      cue: 'capture-miss',
      captureChance: chance,
    });
    battle.lastAction = { side: actingSide, element: 'null', attribute: actor.attribute, wasHit: false };
    tickActorAilments(battle, actor);
    advanceTurnQueue(battle);
    return { ok: true, battle, events: battle.log.slice(eventsBefore) };
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
      skillElement: skill.element,
      cue: 'miss',
    });
    battle.lastAction = { side: actingSide, element: skill.element, attribute: actor.attribute, wasHit: false };
  } else {
    const critted = Math.random() < CRIT_CHANCE;
    const resMult = resolveResistance(skill.element, target.element, target.resistances);
    const aff = affinity(skill.element, target.element);
    const attrKind = attrAffinity(actor.attribute, target.attribute);
    const attrMult = attrKind ? ATTR_MULT[attrKind] : 1;
    const prev = battle.lastAction;
    const chained =
      prev !== null &&
      prev.wasHit &&
      prev.side === actingSide &&
      ((prev.element === skill.element && skill.element !== 'null') ||
        (prev.attribute === actor.attribute && ATTRS_TRIANGLE_ELIGIBLE.has(actor.attribute)));
    const chainMult = chained ? CHAIN_MULT : 1;
    const attackStat = skill.element === 'null' ? actor.atk : actor.int;
    const baseDamage = attackStat * 0.4 + skill.power;
    const defMitigation = 1 - clamp(target.def / (target.def + 400), 0, 0.65);
    const guardMult = target.guarding ? GUARD_MULT : 1;
    const variance = 0.9 + Math.random() * 0.2;
    const dmg = resMult === 0 ? 0 : Math.max(
      1,
      Math.round(baseDamage * (critted ? CRIT_MULT : 1) * attrMult * resMult * chainMult * defMitigation * guardMult * variance),
    );
    target.hp = clamp(target.hp - dmg, 0, target.hpMax);
    target.guarding = false;

    const applied: Ailmented[] = [];
    if (skill.effect && Math.random() < skill.effect.chance) {
      applyAilment(target, skill.effect.kind, skill.effect.turns || AILMENT_TURNS_DEFAULT);
      applied.push({ kind: skill.effect.kind, turnsLeft: skill.effect.turns || AILMENT_TURNS_DEFAULT });
    }

    const cue: ActionCue = resMult === 0
      ? 'immune'
      : chained
        ? 'chain'
        : critted
          ? 'crit'
          : attrKind === 'advantage'
            ? 'attr-advantage'
            : attrKind === 'disadvantage'
              ? 'attr-disadvantage'
              : resMult >= 1.5 || aff === 'weak'
                ? 'weak'
                : resMult <= 0.5 || aff === 'resist'
                  ? 'resist'
                  : null;
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
      skillElement: skill.element,
      cue,
    };
    if (applied.length > 0) hitEvent.applied = applied;
    pushEvent(battle, hitEvent);
    battle.lastAction = { side: actingSide, element: skill.element, attribute: actor.attribute, wasHit: true };
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

function applyItemEffect(target: BattleUnit, effect: ItemEffect): ActionCue {
  switch (effect.kind) {
    case 'heal_pct': {
      const restored = Math.round(target.hpMax * effect.pct);
      target.hp = clamp(target.hp + restored, 0, target.hpMax);
      return 'item-heal';
    }
    case 'en_pct': {
      const restored = Math.round(target.enMax * effect.pct);
      target.en = clamp(target.en + restored, 0, target.enMax);
      return 'item-en';
    }
    case 'clear_ailments': {
      target.ailments = [];
      return 'item-cure';
    }
    case 'atk_bonus': {
      target.atk += effect.amount;
      return 'item-buff';
    }
    case 'def_bonus': {
      target.def += effect.amount;
      return 'item-buff';
    }
    case 'revive': {
      target.hp = target.hpMax;
      target.ailments = [];
      return 'item-revive';
    }
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
  const friendly: FriendlyUnitView[] = [];
  const enemy: EnemyUnitView[] = [];
  const aliveUnitIds = new Set<UnitId>();
  for (const u of battle.units) {
    if (u.hp > 0) aliveUnitIds.add(u.id);
    if (u.side === side) {
      friendly.push({ ...u, down: u.hp === 0 });
    } else if (u.hpMax > 0) {
      const view: EnemyUnitView = {
        id: u.id,
        slot: u.slot,
        templateId: u.templateId,
        name: u.name,
        element: u.element,
        level: u.level,
        hp: u.hp,
        hpMax: u.hpMax,
        ailments: u.ailments,
        down: u.hp === 0,
      };
      if (u.resistances) view.resistances = u.resistances;
      if (u.analyzed) view.analyzed = true;
      if (u.wildInfo) view.wild = u.wildInfo;
      enemy.push(view);
    }
  }
  const head = currentEntry(battle);
  const upcoming: TurnEntry[] = [];
  for (let i = battle.turnCursor; i < battle.turnQueue.length && upcoming.length < 10; i++) {
    const entry = battle.turnQueue[i]!;
    if (aliveUnitIds.has(entry.unitId)) upcoming.push(entry);
  }
  const oppSide: BattleSide = side === 'a' ? 'b' : 'a';
  const oppName = battle.displayNames?.[oppSide];
  const view: BattleView = {
    id: battle.id,
    mode: battle.mode,
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
  if (oppName !== undefined && oppName.length > 0) {
    view.opponentDisplayName = oppName;
  }
  return view;
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
