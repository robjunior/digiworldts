import type { Action, Amount, Condition, Target } from '../skills/dsl.js';
import { affinity, attrAffinity, ATTR_MULT, ATTRS_TRIANGLE_ELIGIBLE, resolveResistance } from '../digimon/element.js';
import {
  AILMENT_TURNS_DEFAULT,
  BASE_HIT_PCT,
  BLIND_ACCURACY_PENALTY,
  CHAIN_MULT,
  CRIT_CHANCE,
  CRIT_MULT,
  MAX_HIT_PCT,
  MIN_HIT_PCT,
  MISS_CHANCE,
  type Ailmented,
  type Battle,
  type BattleEvent,
  type BattleSide,
  type BattleUnit,
  type SlotIndex,
  type UnitId,
} from '@digiworld/shared/battle';
import type { Ailment, Element } from '@digiworld/shared/digimon';
import { shiftInitiative } from './engine.js';

// ---------------------------------------------------------------------------
// Local helpers (inlined to keep dsl-runtime.ts's imports from engine.ts to a
// single function; avoids circular-import risk as new mechanics land).
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function pushEvent(battle: Battle, event: BattleEvent): void {
  battle.log.push(event);
}

function applyAilment(unit: BattleUnit, kind: Ailment, turns: number): void {
  const existing = unit.ailments.find((a) => a.kind === kind);
  if (existing) {
    existing.turnsLeft = Math.max(existing.turnsLeft, turns);
  } else {
    unit.ailments.push({ kind, turnsLeft: turns });
  }
}

// ---------------------------------------------------------------------------
// Public entry: execute a skill's actions[] against the battle state.
// Called from engine.ts::applyAction when a skill has actions_json set.
// Returns events for the caller to append to the response.
// ---------------------------------------------------------------------------

export type ExecuteDSLResult = {
  events: BattleEvent[];
  error?: string;
};

export function executeDSL(
  battle: Battle,
  actor: BattleUnit,
  actions: readonly Action[],
  primaryTarget: BattleUnit | null,
  skillName: string,
  actingSide: BattleSide,
): ExecuteDSLResult {
  const eventsBefore = battle.log.length;
  for (const action of actions) {
    execAction(battle, actor, action, primaryTarget, skillName, actingSide);
  }
  return { events: battle.log.slice(eventsBefore) };
}

// ---------------------------------------------------------------------------
// Target resolution: 16 patterns → list of alive BattleUnits.
// ---------------------------------------------------------------------------

function aliveUnits(battle: Battle): BattleUnit[] {
  return battle.units.filter((u) => u.hp > 0);
}

function unitsOnSide(battle: Battle, side: BattleSide): BattleUnit[] {
  return aliveUnits(battle).filter((u) => u.side === side);
}

function unitsOnOtherSide(battle: Battle, side: BattleSide): BattleUnit[] {
  return aliveUnits(battle).filter((u) => u.side !== side);
}

function unitAtSlot(battle: Battle, side: BattleSide, slot: SlotIndex): BattleUnit | null {
  const found = battle.units.find((u) => u.side === side && u.slot === slot && u.hp > 0);
  return found ?? null;
}

function resolveTargets(
  battle: Battle,
  actor: BattleUnit,
  target: Target,
  primaryTarget: BattleUnit | null,
): BattleUnit[] {
  const enemySide: BattleSide = actor.side === 'a' ? 'b' : 'a';
  switch (target) {
    case 'self':
      return actor.hp > 0 ? [actor] : [];
    case 'primary_target':
      return primaryTarget !== null && primaryTarget.hp > 0 ? [primaryTarget] : [];
    case 'caster_ally_all':
      return unitsOnSide(battle, actor.side);
    case 'caster_ally_lowest_hp': {
      const allies = unitsOnSide(battle, actor.side);
      if (allies.length === 0) return [];
      let lowest = allies[0]!;
      for (const a of allies) {
        if (a.hp / a.hpMax < lowest.hp / lowest.hpMax) lowest = a;
      }
      return [lowest];
    }
    case 'caster_ally_slot_0':
    case 'caster_ally_slot_1':
    case 'caster_ally_slot_2': {
      const slot = Number(target.slice(-1)) as SlotIndex;
      const u = unitAtSlot(battle, actor.side, slot);
      return u === null ? [] : [u];
    }
    case 'enemy_all':
      return unitsOnOtherSide(battle, actor.side);
    case 'enemy_front': {
      const u = unitAtSlot(battle, enemySide, 0 as SlotIndex);
      return u === null ? [] : [u];
    }
    case 'enemy_center': {
      const u = unitAtSlot(battle, enemySide, 1 as SlotIndex);
      return u === null ? [] : [u];
    }
    case 'enemy_back': {
      const u = unitAtSlot(battle, enemySide, 2 as SlotIndex);
      return u === null ? [] : [u];
    }
    case 'enemy_random': {
      const enemies = unitsOnOtherSide(battle, actor.side);
      if (enemies.length === 0) return [];
      return [enemies[Math.floor(Math.random() * enemies.length)]!];
    }
    case 'enemy_first_two': {
      const enemies = unitsOnOtherSide(battle, actor.side);
      return enemies.filter((e) => e.slot === 0 || e.slot === 1);
    }
    case 'enemy_last_two': {
      const enemies = unitsOnOtherSide(battle, actor.side);
      return enemies.filter((e) => e.slot === 1 || e.slot === 2);
    }
    case 'enemy_slot_0':
    case 'enemy_slot_1':
    case 'enemy_slot_2': {
      const slot = Number(target.slice(-1)) as SlotIndex;
      const u = unitAtSlot(battle, enemySide, slot);
      return u === null ? [] : [u];
    }
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Amount resolution: flat integer OR scaled stat with base + factor.
// ---------------------------------------------------------------------------

function resolveAmount(actor: BattleUnit, amount: Amount): number {
  if (typeof amount === 'number') return amount;
  const statVal = amount.scale === 'atk' ? actor.atk
                : amount.scale === 'int' ? actor.int
                : amount.scale === 'spd' ? actor.spd
                : amount.scale === 'def' ? actor.def
                : actor.hpMax;
  return Math.round(amount.base + statVal * amount.factor);
}

// ---------------------------------------------------------------------------
// Condition evaluation for the `conditional` action kind.
// ---------------------------------------------------------------------------

function evalCondition(unit: BattleUnit, cond: Condition): boolean {
  switch (cond.kind) {
    case 'has_status':
      return unit.ailments.some((a) => a.kind === cond.status);
    case 'hp_below_pct':
      return (unit.hp / unit.hpMax) * 100 < cond.pct;
    case 'hp_above_pct':
      return (unit.hp / unit.hpMax) * 100 > cond.pct;
    default: {
      const exhaustive: never = cond;
      return exhaustive;
    }
  }
}

/** Sum accuracy_up minus accuracy_down from activeBuffs, minus blind penalty if present. */
export function getAccuracy(unit: BattleUnit): number {
  let acc = 0;
  for (const b of unit.activeBuffs ?? []) {
    if (b.kind === 'accuracy_up') acc += b.amount;
    else if (b.kind === 'accuracy_down') acc -= b.amount;
  }
  if (unit.ailments.some((a) => a.kind === 'blind')) acc -= BLIND_ACCURACY_PENALTY;
  return acc;
}

/** unit.evade base + sum of evasion_up minus evasion_down from activeBuffs. */
export function getEvade(unit: BattleUnit): number {
  let ev = unit.evade ?? 0;
  for (const b of unit.activeBuffs ?? []) {
    if (b.kind === 'evasion_up') ev += b.amount;
    else if (b.kind === 'evasion_down') ev -= b.amount;
  }
  return ev;
}

/** True = miss. Formula: BASE_HIT + accuracy - evade clamped [MIN, MAX]. */
export function rollMiss(actor: BattleUnit, target: BattleUnit): boolean {
  const hitChance = clamp(BASE_HIT_PCT + getAccuracy(actor) - getEvade(target), MIN_HIT_PCT, MAX_HIT_PCT);
  return Math.random() * 100 > hitChance;
}

/** Petrify grants +50% effective defense while active. */
export function effectiveDef(unit: BattleUnit): number {
  return unit.ailments.some((a) => a.kind === 'petrify') ? unit.def * 1.5 : unit.def;
}

/** Consume invulnerable → damage_reduction → shield_absorb in order; return HP-hit damage. */
export function applyDamageWithBuffs(target: BattleUnit, dmg: number): number {
  if (dmg <= 0) return 0;
  const buffs = target.activeBuffs ?? [];
  if (buffs.some((b) => b.kind === 'invulnerable')) return 0;
  const drMax = buffs.filter((b) => b.kind === 'damage_reduction').reduce((n, b) => Math.max(n, b.amount), 0);
  let remaining = drMax > 0 ? Math.max(0, Math.round(dmg * (1 - Math.min(100, drMax) / 100))) : dmg;
  const kept: typeof buffs = [];
  for (const buff of buffs) {
    if (buff.kind !== 'shield_absorb' || remaining <= 0) { kept.push(buff); continue; }
    if (buff.amount >= remaining) {
      const nextAmount = buff.amount - remaining;
      remaining = 0;
      if (nextAmount > 0) kept.push({ ...buff, amount: nextAmount });
    } else {
      remaining -= buff.amount;
    }
  }
  target.activeBuffs = kept;
  return remaining;
}

/** Tick activeBuffs.remainingTurns; drop expired. Matches ailment tick cadence. */
export function tickActorBuffs(unit: BattleUnit): void {
  const buffs = unit.activeBuffs;
  if (buffs === undefined || buffs.length === 0) return;
  const kept: typeof buffs = [];
  for (const b of buffs) {
    const next = b.remainingTurns - 1;
    if (next > 0) kept.push({ ...b, remainingTurns: next });
  }
  unit.activeBuffs = kept;
}

/** Tick skillCooldowns; drop entries that hit 0. Called at actor's own turn start. */
export function tickSkillCooldowns(unit: BattleUnit): void {
  const cd = unit.skillCooldowns;
  if (cd === undefined) return;
  for (const key of Object.keys(cd)) {
    const next = (cd[key] ?? 0) - 1;
    if (next > 0) cd[key] = next;
    else delete cd[key];
  }
}

// ---------------------------------------------------------------------------
// Action executors.
// ---------------------------------------------------------------------------

function execAction(
  battle: Battle,
  actor: BattleUnit,
  action: Action,
  primaryTarget: BattleUnit | null,
  skillName: string,
  actingSide: BattleSide,
): void {
  switch (action.kind) {
    case 'deal_damage':
      execDealDamage(battle, actor, action, primaryTarget, skillName, actingSide);
      return;
    case 'heal':
      execHeal(battle, actor, action, primaryTarget, skillName);
      return;
    case 'apply_status':
      execApplyStatus(battle, actor, action, primaryTarget, skillName);
      return;
    case 'modify_stat':
      execModifyStat(battle, actor, action, primaryTarget, skillName);
      return;
    case 'consume_en':
      execEnergy(battle, actor, action, primaryTarget, -action.amount, skillName);
      return;
    case 'restore_en':
      execEnergy(battle, actor, action, primaryTarget, action.amount, skillName);
      return;
    case 'shift_initiative':
      execShiftInitiative(battle, actor, action, primaryTarget, skillName);
      return;
    case 'schedule':
      // TODO(P2/Tier2): implement scheduled-action queue on Battle state.
      // For now schedule fires immediately (delay ignored) so callers can rely
      // on eventual execution without needing engine state changes.
      execAction(battle, actor, action.action, primaryTarget, skillName, actingSide);
      return;
    case 'conditional':
      execConditional(battle, actor, action, primaryTarget, skillName, actingSide);
      return;
    case 'drain':
      execDrain(battle, actor, action, primaryTarget, skillName, actingSide);
      return;
    case 'apply_buff':
      execApplyBuff(battle, actor, action, primaryTarget, skillName);
      return;
    case 'cleanse':
      execCleanse(battle, actor, action, primaryTarget, skillName);
      return;
    case 'dispel':
      execDispel(battle, actor, action, primaryTarget, skillName);
      return;
    case 'extra_turn':
      execExtraTurn(battle, actor, action, primaryTarget, skillName);
      return;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

function execDealDamage(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'deal_damage' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
  actingSide: BattleSide,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const element: Element = action.element ?? actor.element;
  const now = Date.now();
  const baseAmount = Math.max(0, resolveAmount(actor, action.amount));
  const prev = battle.lastAction;
  const chained = prev !== null
    && prev.wasHit
    && prev.side === actingSide
    && ((prev.element === element && element !== 'null')
      || (prev.attribute === actor.attribute && ATTRS_TRIANGLE_ELIGIBLE.has(actor.attribute)));
  const chainMult = chained ? CHAIN_MULT : 1;
  const rate = typeof battle.damageRate === 'number' && battle.damageRate > 0 ? battle.damageRate : 1.0;

  for (const target of targets) {
    const missed = rollMiss(actor, target);
    if (missed) {
      pushEvent(battle, {
        at: now,
        round: battle.round,
        type: 'action',
        actor: actor.id,
        actorName: actor.name,
        action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
        targetId: target.id,
        targetName: target.name,
        damage: 0,
        skillName,
        skillElement: element,
        cue: 'miss',
      });
      battle.lastAction = { side: actingSide, element, attribute: actor.attribute, wasHit: false };
      continue;
    }
    const critted = Math.random() < CRIT_CHANCE;
    const resMult = resolveResistance(element, target.element, target.resistances);
    const aff = affinity(element, target.element);
    const attrKind = attrAffinity(actor.attribute, target.attribute);
    const attrMult = attrKind ? ATTR_MULT[attrKind] : 1;
    const defMitigation = action.ignore_defense === true
      ? 1
      : 1 - clamp(effectiveDef(target) / (effectiveDef(target) + 400), 0, 0.65);
    const variance = 0.9 + Math.random() * 0.2;
    const dmgRaw = resMult === 0 ? 0 : Math.max(
      1,
      Math.round(baseAmount * (critted ? CRIT_MULT : 1) * attrMult * resMult * chainMult * defMitigation * variance * rate),
    );
    const dmg = applyDamageWithBuffs(target, dmgRaw);
    target.hp = clamp(target.hp - dmg, 0, target.hpMax);
    battle.lastAction = { side: actingSide, element, attribute: actor.attribute, wasHit: true };

    const cue = resMult === 0 ? 'immune'
      : chained ? 'chain'
      : critted ? 'crit'
      : attrKind === 'advantage' ? 'attr-advantage'
      : attrKind === 'disadvantage' ? 'attr-disadvantage'
      : (resMult >= 1.5 || aff === 'weak') ? 'weak'
      : (resMult <= 0.5 || aff === 'resist') ? 'resist'
      : null;

    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id,
      targetName: target.name,
      damage: dmg,
      skillName,
      skillElement: element,
      cue,
    });
    if (target.hp === 0) {
      pushEvent(battle, { at: now, round: battle.round, type: 'unit-down', unit: target.id, unitName: target.name });
    }
  }
}

function execHeal(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'heal' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const amount = Math.max(0, resolveAmount(actor, action.amount));
  const now = Date.now();
  for (const target of targets) {
    if (target.hp <= 0) continue;
    const restored = Math.min(amount, target.hpMax - target.hp);
    if (restored <= 0) continue;
    target.hp = clamp(target.hp + restored, 0, target.hpMax);
    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id,
      targetName: target.name,
      damage: -restored,
      skillName,
      skillElement: actor.element,
      cue: null,
    });
  }
}

function execApplyStatus(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'apply_status' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const now = Date.now();
  const turns = action.turns > 0 ? action.turns : AILMENT_TURNS_DEFAULT;
  for (const target of targets) {
    if (Math.random() >= action.chance) continue;
    applyAilment(target, action.status, turns);
    const applied: Ailmented[] = [{ kind: action.status, turnsLeft: turns }];
    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id,
      targetName: target.name,
      damage: 0,
      skillName,
      skillElement: actor.element,
      cue: null,
      applied,
    });
  }
}

function execModifyStat(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'modify_stat' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const now = Date.now();
  const kind = (action.delta >= 0 ? `${action.stat}_up` : `${action.stat}_down`) as
    | 'atk_up' | 'def_up' | 'spd_up' | 'int_up'
    | 'atk_down' | 'def_down' | 'spd_down' | 'int_down';
  for (const target of targets) {
    if (target.hp <= 0) continue;
    const buffs = target.activeBuffs ?? [];
    buffs.push({ kind, amount: Math.abs(action.delta), remainingTurns: action.turns, sourceId: actor.id });
    target.activeBuffs = buffs;
    pushEvent(battle, {
      at: now,
      round: battle.round,
      type: 'action',
      actor: actor.id,
      actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id,
      targetName: target.name,
      damage: 0,
      skillName,
      skillElement: actor.element,
      cue: null,
    });
  }
}

function execEnergy(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'consume_en' | 'restore_en' }>,
  primaryTarget: BattleUnit | null,
  delta: number,
  _skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  for (const target of targets) {
    target.en = clamp(target.en + delta, 0, target.enMax);
  }
}

function execShiftInitiative(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'shift_initiative' }>,
  primaryTarget: BattleUnit | null,
  _skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  for (const target of targets) {
    shiftInitiative(battle, target.id as UnitId, action.delta);
  }
}

function execConditional(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'conditional' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
  actingSide: BattleSide,
): void {
  const subject = primaryTarget ?? actor;
  const branch = evalCondition(subject, action.if) ? action.then : action.else;
  if (branch === undefined) return;
  for (const inner of branch) {
    execAction(battle, actor, inner, primaryTarget, skillName, actingSide);
  }
}

function computeMitigatedDamage(
  actor: BattleUnit,
  target: BattleUnit,
  baseAmount: number,
  element: Element,
  ignoreDefense: boolean,
  chained: boolean,
  rate: number,
): { dmg: number; critted: boolean; resMult: number; attrKind: 'advantage' | 'disadvantage' | null } {
  const critted = Math.random() < CRIT_CHANCE;
  const resMult = resolveResistance(element, target.element, target.resistances);
  const attrKind = attrAffinity(actor.attribute, target.attribute);
  const attrMult = attrKind ? ATTR_MULT[attrKind] : 1;
  const chainMult = chained ? CHAIN_MULT : 1;
  const defMitigation = ignoreDefense ? 1 : 1 - clamp(effectiveDef(target) / (effectiveDef(target) + 400), 0, 0.65);
  const variance = 0.9 + Math.random() * 0.2;
  const dmg = resMult === 0 ? 0 : Math.max(
    1,
    Math.round(baseAmount * (critted ? CRIT_MULT : 1) * attrMult * resMult * chainMult * defMitigation * variance * rate),
  );
  return { dmg, critted, resMult, attrKind };
}

function execDrain(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'drain' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
  actingSide: BattleSide,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const element: Element = action.element ?? actor.element;
  const now = Date.now();
  const baseAmount = Math.max(0, resolveAmount(actor, action.damage));
  const prev = battle.lastAction;
  const chained = prev !== null
    && prev.wasHit
    && prev.side === actingSide
    && ((prev.element === element && element !== 'null')
      || (prev.attribute === actor.attribute && ATTRS_TRIANGLE_ELIGIBLE.has(actor.attribute)));
  const rate = typeof battle.damageRate === 'number' && battle.damageRate > 0 ? battle.damageRate : 1.0;

  let totalDrained = 0;
  for (const target of targets) {
    const missed = rollMiss(actor, target);
    if (missed) {
      pushEvent(battle, {
        at: now, round: battle.round, type: 'action',
        actor: actor.id, actorName: actor.name,
        action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
        targetId: target.id, targetName: target.name,
        damage: 0, skillName, skillElement: element, cue: 'miss',
      });
      battle.lastAction = { side: actingSide, element, attribute: actor.attribute, wasHit: false };
      continue;
    }
    const { dmg, critted, resMult, attrKind } = computeMitigatedDamage(actor, target, baseAmount, element, false, chained, rate);
    const finalDmg = applyDamageWithBuffs(target, dmg);
    target.hp = clamp(target.hp - finalDmg, 0, target.hpMax);
    totalDrained += finalDmg;
    battle.lastAction = { side: actingSide, element, attribute: actor.attribute, wasHit: true };
    const cue = resMult === 0 ? 'immune' : chained ? 'chain' : critted ? 'crit'
      : attrKind === 'advantage' ? 'attr-advantage' : attrKind === 'disadvantage' ? 'attr-disadvantage'
      : resMult >= 1.5 ? 'weak' : resMult <= 0.5 ? 'resist' : null;
    pushEvent(battle, {
      at: now, round: battle.round, type: 'action',
      actor: actor.id, actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id, targetName: target.name,
      damage: finalDmg, skillName, skillElement: element, cue,
    });
    if (target.hp === 0) {
      pushEvent(battle, { at: now, round: battle.round, type: 'unit-down', unit: target.id, unitName: target.name });
    }
  }

  if (totalDrained > 0 && actor.hp > 0) {
    const healed = Math.min(Math.round(totalDrained * action.heal_pct), actor.hpMax - actor.hp);
    if (healed > 0) {
      actor.hp = clamp(actor.hp + healed, 0, actor.hpMax);
      pushEvent(battle, {
        at: now, round: battle.round, type: 'action',
        actor: actor.id, actorName: actor.name,
        action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: actor.id },
        targetId: actor.id, targetName: actor.name,
        damage: -healed, skillName, skillElement: element, cue: null,
      });
    }
  }
}

function execApplyBuff(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'apply_buff' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const now = Date.now();
  for (const target of targets) {
    if (target.hp <= 0) continue;
    const buffs = target.activeBuffs ?? [];
    buffs.push({ kind: action.buff, amount: action.amount, remainingTurns: action.turns, sourceId: actor.id });
    target.activeBuffs = buffs;
    pushEvent(battle, {
      at: now, round: battle.round, type: 'action',
      actor: actor.id, actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id, targetName: target.name,
      damage: 0, skillName, skillElement: actor.element, cue: null,
    });
  }
}

function execCleanse(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'cleanse' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const now = Date.now();
  for (const target of targets) {
    const before = target.ailments.length;
    target.ailments = action.ailment === undefined
      ? []
      : target.ailments.filter((a) => a.kind !== action.ailment);
    if (target.ailments.length === before) continue;
    pushEvent(battle, {
      at: now, round: battle.round, type: 'action',
      actor: actor.id, actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id, targetName: target.name,
      damage: 0, skillName, skillElement: actor.element, cue: null,
    });
  }
}

function execDispel(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'dispel' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const now = Date.now();
  for (const target of targets) {
    const buffs = target.activeBuffs ?? [];
    const before = buffs.length;
    target.activeBuffs = action.buff === undefined
      ? []
      : buffs.filter((b) => b.kind !== action.buff);
    if ((target.activeBuffs?.length ?? 0) === before) continue;
    pushEvent(battle, {
      at: now, round: battle.round, type: 'action',
      actor: actor.id, actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id, targetName: target.name,
      damage: 0, skillName, skillElement: actor.element, cue: null,
    });
  }
}

function execExtraTurn(
  battle: Battle,
  actor: BattleUnit,
  action: Extract<Action, { kind: 'extra_turn' }>,
  primaryTarget: BattleUnit | null,
  skillName: string,
): void {
  const targets = resolveTargets(battle, actor, action.target, primaryTarget);
  const now = Date.now();
  for (const target of targets) {
    if (target.hp <= 0) continue;
    battle.turnQueue.splice(battle.turnCursor + 1, 0, {
      unitId: target.id,
      side: target.side,
      name: target.name,
      initiative: 9999,
    });
    pushEvent(battle, {
      at: now, round: battle.round, type: 'action',
      actor: actor.id, actorName: actor.name,
      action: { type: 'skill', unitId: actor.id, skillId: skillName, targetId: target.id },
      targetId: target.id, targetName: target.name,
      damage: 0, skillName, skillElement: actor.element, cue: null,
    });
  }
}
