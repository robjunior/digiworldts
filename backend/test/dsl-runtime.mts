/**
 * P2 DSL runtime + Tier 1/2 mechanic verification driver.
 *
 * Uses Math.random stubbing for deterministic action outcomes. Each test
 * builds a fresh battle via initBattle, assigns a DSL-authored skill to the
 * actor, and calls applyAction — same path as the WS handler in production.
 *
 * Run: pnpm --filter @digiworld/backend exec tsx test/dsl-runtime.mts
 */
import { initBattle, applyAction } from '../src/battle/engine.js';
import { applyDamageWithBuffs, effectiveDef, getEvade, getAccuracy, rollMiss, tickActorBuffs } from '../src/battle/dsl-runtime.js';
import type { LoadoutMember, Loadout } from '../src/battle/engine.js';
import type { Action as DSLAction } from '../src/skills/dsl.js';
import type { BattleUnit, Skill } from '@digiworld/shared/battle';
import type { TemplateDigimon } from '../src/digimon/types.js';

const originalRandom = Math.random;
Math.random = () => 0.5;

function tmpl(id: string, name: string, element: 'fire' | 'water' | 'plant'): TemplateDigimon {
  return {
    id, name, stage: 'Rookie', attribute: 'Vaccine', element,
    baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
    skillPool: [], assets: { portrait: '', dot: '' },
  };
}

function mem(monId: string, template: TemplateDigimon, spdBonus: number, skillOverride?: Skill): LoadoutMember {
  return {
    monId, templateId: template.id, template, level: 10, nickname: template.name,
    statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: spdBonus },
    equippedSkills: skillOverride ? [skillOverride] : undefined,
  };
}

function dslSkill(id: string, name: string, actions: DSLAction[], energyCost = 0): Skill {
  return { id, name, element: 'fire', energyCost, power: 0, actions };
}

const fire = tmpl('fire-a', 'FireA', 'fire');
const water = tmpl('water-b', 'WaterB', 'water');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function battleWithActorSkill(skill: Skill): { b: ReturnType<typeof initBattle>; actor: BattleUnit; target: BattleUnit } {
  const loadoutA: Loadout = { playerId: 'usr_a', members: [mem('a0', fire, 200, skill), mem('a1', fire, 100), mem('a2', fire, 50)] };
  const loadoutB: Loadout = { playerId: 'usr_b', members: [mem('b0', water, -100), mem('b1', water, -110), mem('b2', water, -120)] };
  const b = initBattle({ loadoutA, loadoutB });
  const actor = b.units.find((u) => u.id === 'a:0')!;
  const target = b.units.find((u) => u.id === 'b:0')!;
  return { b, actor, target };
}

console.log('=== Test 1: DSL deal_damage routes through hybrid path ===');
{
  const skill = dslSkill('sk-fireball', 'Fireball', [
    { kind: 'deal_damage', target: 'primary_target', amount: { base: 30, scale: 'int', factor: 1.4 }, element: 'fire' },
  ]);
  const { b, target } = battleWithActorSkill(skill);
  const hpBefore = target.hp;
  const r = applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-fireball', targetId: 'b:0' });
  check('DSL deal_damage accepted', r.ok);
  check('target HP dropped', target.hp < hpBefore, `hpBefore=${hpBefore} hpAfter=${target.hp}`);
}

console.log('\n=== Test 2: DSL heal restores HP capped at hpMax ===');
{
  const skill = dslSkill('sk-heal', 'Heal', [{ kind: 'heal', target: 'self', amount: 100 }]);
  const { b, actor } = battleWithActorSkill(skill);
  actor.hp = 50;
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-heal', targetId: 'b:0' });
  check('actor healed to 150', actor.hp === 150, `hp=${actor.hp}`);
}
{
  const skill = dslSkill('sk-heal-cap', 'HealCap', [{ kind: 'heal', target: 'self', amount: 100 }]);
  const { b, actor } = battleWithActorSkill(skill);
  actor.hp = actor.hpMax - 10;
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-heal-cap', targetId: 'b:0' });
  check('heal capped at hpMax', actor.hp === actor.hpMax, `hp=${actor.hp} max=${actor.hpMax}`);
}

console.log('\n=== Test 3: apply_status adds ailment; conditional 100% chance ===');
{
  const skill = dslSkill('sk-poison', 'Poison', [
    { kind: 'apply_status', target: 'primary_target', status: 'poison', chance: 1.0, turns: 3 },
  ]);
  const { b, target } = battleWithActorSkill(skill);
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-poison', targetId: 'b:0' });
  const poisoned = target.ailments.find((a) => a.kind === 'poison');
  check('poison applied', poisoned !== undefined);
  check('turnsLeft=3', poisoned?.turnsLeft === 3);
}

console.log('\n=== Test 4: apply_buff adds shield_absorb to activeBuffs ===');
{
  const skill = dslSkill('sk-shield', 'Shield', [
    { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 200, turns: 3 },
  ]);
  const { b, actor } = battleWithActorSkill(skill);
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-shield', targetId: 'b:0' });
  const shield = (actor.activeBuffs ?? []).find((buf) => buf.kind === 'shield_absorb');
  check('shield_absorb buff added', shield !== undefined);
  check('shield amount=200', shield?.amount === 200);
}

console.log('\n=== Test 5: applyDamageWithBuffs consumes shield before HP ===');
{
  const { b, target } = battleWithActorSkill(dslSkill('_', '_', [{ kind: 'heal', target: 'self', amount: 1 }]));
  target.activeBuffs = [{ kind: 'shield_absorb', amount: 100, remainingTurns: 3, sourceId: 'a:0' }];
  const hpToHp = applyDamageWithBuffs(target, 80);
  check('80 dmg fully absorbed', hpToHp === 0, `hp-dmg=${hpToHp}`);
  check('shield remaining=20', (target.activeBuffs?.[0]?.amount ?? 0) === 20);
  const hpToHp2 = applyDamageWithBuffs(target, 50);
  check('overflow 50-20=30 hits HP', hpToHp2 === 30, `hp-dmg=${hpToHp2}`);
  check('shield gone', (target.activeBuffs ?? []).filter((b) => b.kind === 'shield_absorb').length === 0);
}

console.log('\n=== Test 6: invulnerable buff zeros damage ===');
{
  const { target } = battleWithActorSkill(dslSkill('_', '_', [{ kind: 'heal', target: 'self', amount: 1 }]));
  target.activeBuffs = [{ kind: 'invulnerable', amount: 1, remainingTurns: 3, sourceId: 'a:0' }];
  const hpDmg = applyDamageWithBuffs(target, 999);
  check('invulnerable → 0 dmg', hpDmg === 0);
}

console.log('\n=== Test 7: damage_reduction cuts damage by pct ===');
{
  const { target } = battleWithActorSkill(dslSkill('_', '_', [{ kind: 'heal', target: 'self', amount: 1 }]));
  target.activeBuffs = [{ kind: 'damage_reduction', amount: 50, remainingTurns: 3, sourceId: 'a:0' }];
  const hpDmg = applyDamageWithBuffs(target, 100);
  check('50% DR → 50 dmg', hpDmg === 50, `hp-dmg=${hpDmg}`);
}

console.log('\n=== Test 8: cleanse removes ailments; filter-by-ailment removes only one ===');
{
  const cleanseAll = dslSkill('sk-cleanse', 'Cleanse', [{ kind: 'cleanse', target: 'self' }]);
  const { b, actor } = battleWithActorSkill(cleanseAll);
  actor.ailments = [{ kind: 'burn', turnsLeft: 3 }, { kind: 'poison', turnsLeft: 3 }];
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-cleanse', targetId: 'b:0' });
  check('cleanse-all removed both', actor.ailments.length === 0, `remaining=${actor.ailments.length}`);
}
{
  const cleanseBurn = dslSkill('sk-cleanse2', 'Cleanse Burn', [{ kind: 'cleanse', target: 'self', ailment: 'burn' }]);
  const { b, actor } = battleWithActorSkill(cleanseBurn);
  actor.ailments = [{ kind: 'burn', turnsLeft: 3 }, { kind: 'poison', turnsLeft: 3 }];
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-cleanse2', targetId: 'b:0' });
  check('cleanse burn kept poison', actor.ailments.length === 1 && actor.ailments[0]?.kind === 'poison',
    `remaining=${actor.ailments.map((a) => a.kind).join(',')}`);
}

console.log('\n=== Test 9: dispel removes buffs; filter-by-buff removes only one ===');
{
  const dispelAll = dslSkill('sk-dispel', 'Dispel', [{ kind: 'dispel', target: 'primary_target' }]);
  const { b, target } = battleWithActorSkill(dispelAll);
  target.activeBuffs = [
    { kind: 'atk_up', amount: 20, remainingTurns: 3, sourceId: 'b:0' },
    { kind: 'shield_absorb', amount: 100, remainingTurns: 3, sourceId: 'b:0' },
  ];
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-dispel', targetId: 'b:0' });
  check('dispel-all removed both buffs', (target.activeBuffs?.length ?? 0) === 0);
}

console.log('\n=== Test 10: silence rejects skill action with code=silenced ===');
{
  const skill = dslSkill('sk-any', 'Any', [{ kind: 'heal', target: 'self', amount: 1 }]);
  const { b, actor } = battleWithActorSkill(skill);
  actor.ailments = [{ kind: 'silence', turnsLeft: 3 }];
  const r = applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-any', targetId: 'b:0' });
  check('applyAction rejected', !r.ok);
  check('code=silenced', !r.ok && r.code === 'silenced', `code=${!r.ok ? r.code : 'ok'}`);
}

console.log('\n=== Test 11: confusion re-targets to random ally (rand=0.4 triggers 50% roll) ===');
{
  const skill = dslSkill('sk-hit', 'Hit', [
    { kind: 'deal_damage', target: 'primary_target', amount: 50, element: 'fire' },
  ]);
  const { b, actor } = battleWithActorSkill(skill);
  actor.ailments = [{ kind: 'confusion', turnsLeft: 3 }];
  const enemyHpBefore = b.units.find((u) => u.id === 'b:0')!.hp;
  const a1Before = b.units.find((u) => u.id === 'a:1')!.hp;
  const a2Before = b.units.find((u) => u.id === 'a:2')!.hp;
  Math.random = () => 0.4;
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-hit', targetId: 'b:0' });
  Math.random = () => 0.5;
  const enemyHpAfter = b.units.find((u) => u.id === 'b:0')!.hp;
  const a1After = b.units.find((u) => u.id === 'a:1')!.hp;
  const a2After = b.units.find((u) => u.id === 'a:2')!.hp;
  check('enemy HP unchanged (re-targeted)', enemyHpAfter === enemyHpBefore, `enemy=${enemyHpAfter}/${enemyHpBefore}`);
  check('an ally took damage', a1After < a1Before || a2After < a2Before, `a1=${a1After}/${a1Before} a2=${a2After}/${a2Before}`);
}

console.log('\n=== Test 12: extra_turn inserts TurnEntry at turnCursor+1 ===');
{
  const skill = dslSkill('sk-quick', 'Quick', [{ kind: 'extra_turn', target: 'caster_ally_slot_1' }]);
  const { b } = battleWithActorSkill(skill);
  const cursorBefore = b.turnCursor;
  const queueLenBefore = b.turnQueue.length;
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-quick', targetId: 'b:0' });
  check('queue grew by 1+', b.turnQueue.length > queueLenBefore, `len=${b.turnQueue.length} was=${queueLenBefore}`);
  const insertedIdx = b.turnQueue.findIndex((e, i) => i > cursorBefore && e.unitId === 'a:1');
  check('a:1 inserted after cursor', insertedIdx >= 0, `idx=${insertedIdx} cursor=${cursorBefore}`);
}

console.log('\n=== Test 13: effectiveDef +50% under petrify ===');
{
  const { target } = battleWithActorSkill(dslSkill('_', '_', [{ kind: 'heal', target: 'self', amount: 1 }]));
  const baseDef = target.def;
  const normalDef = effectiveDef(target);
  target.ailments = [{ kind: 'petrify', turnsLeft: 3 }];
  const petrifiedDef = effectiveDef(target);
  check('normal def = base', normalDef === baseDef, `def=${normalDef}`);
  check('petrified def = base*1.5', petrifiedDef === baseDef * 1.5, `def=${petrifiedDef}`);
}

console.log('\n=== Test 14: getAccuracy/getEvade + blind penalty ===');
{
  const { actor, target } = battleWithActorSkill(dslSkill('_', '_', [{ kind: 'heal', target: 'self', amount: 1 }]));
  check('baseline accuracy = 0', getAccuracy(actor) === 0);
  check('baseline evade = 0', getEvade(target) === 0);
  actor.ailments = [{ kind: 'blind', turnsLeft: 3 }];
  check('blind → accuracy = -30', getAccuracy(actor) === -30, `acc=${getAccuracy(actor)}`);
  actor.activeBuffs = [{ kind: 'accuracy_up', amount: 20, remainingTurns: 3, sourceId: 'a:0' }];
  check('blind + accuracy_up 20 = -10', getAccuracy(actor) === -10, `acc=${getAccuracy(actor)}`);
  target.activeBuffs = [{ kind: 'evasion_up', amount: 25, remainingTurns: 3, sourceId: 'b:0' }];
  check('evasion_up 25 → evade = 25', getEvade(target) === 25);
}

console.log('\n=== Test 15: rollMiss respects accuracy - evade ===');
{
  const { actor, target } = battleWithActorSkill(dslSkill('_', '_', [{ kind: 'heal', target: 'self', amount: 1 }]));
  // With stub rand=0.5, roll = 50. hitChance = 92 + 0 - 0 = 92. missed = 50 > 92 = false.
  check('baseline: 92% hit → no miss at rand=0.5', !rollMiss(actor, target));
  // Set evasion so hitChance drops below 50.
  target.activeBuffs = [{ kind: 'evasion_up', amount: 60, remainingTurns: 3, sourceId: 'b:0' }];
  // hitChance = 92 - 60 = 32, roll = 50. missed = 50 > 32 = true.
  check('evasion 60 → miss at rand=0.5', rollMiss(actor, target));
}

console.log('\n=== Test 16: tickActorBuffs decrements + drops expired ===');
{
  const { actor } = battleWithActorSkill(dslSkill('_', '_', [{ kind: 'heal', target: 'self', amount: 1 }]));
  actor.activeBuffs = [
    { kind: 'atk_up', amount: 10, remainingTurns: 2, sourceId: 'a:0' },
    { kind: 'shield_absorb', amount: 100, remainingTurns: 1, sourceId: 'a:0' },
  ];
  tickActorBuffs(actor);
  check('atk_up decremented to 1', actor.activeBuffs?.[0]?.remainingTurns === 1);
  check('shield_absorb expired (1→0 dropped)', (actor.activeBuffs ?? []).find((b) => b.kind === 'shield_absorb') === undefined);
  tickActorBuffs(actor);
  check('atk_up expired (1→0 dropped)', (actor.activeBuffs ?? []).length === 0);
}

console.log('\n=== Test 17: drain damages target + heals caster ===');
{
  const skill = dslSkill('sk-drain', 'Drain', [
    { kind: 'drain', target: 'primary_target', damage: { base: 100, scale: 'int', factor: 0.5 }, heal_pct: 0.5, element: 'plant' },
  ]);
  const { b, actor, target } = battleWithActorSkill(skill);
  actor.hp = actor.hpMax - 200;
  const enemyHpBefore = target.hp;
  const casterHpBefore = actor.hp;
  applyAction(b, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-drain', targetId: 'b:0' });
  const enemyHpAfter = target.hp;
  const casterHpAfter = actor.hp;
  check('target damaged', enemyHpAfter < enemyHpBefore);
  check('caster healed', casterHpAfter > casterHpBefore, `caster ${casterHpBefore}→${casterHpAfter}`);
}

Math.random = originalRandom;

console.log('\n=== Summary ===');
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
if (failed > 0) process.exit(1);
