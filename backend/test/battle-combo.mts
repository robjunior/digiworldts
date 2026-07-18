/**
 * Phase A verification driver — proves:
 *   1. Chain multiplier applies on consecutive same-side same-element hits
 *   2. Chain breaks when element or side changes
 *   3. Guard resets the chain (wasHit=false)
 *   4. shiftInitiative reorders the turn queue correctly
 *
 * Uses fixed Math.random for deterministic damage math (variance/crit/miss).
 * Runs standalone: `pnpm tsx test/battle-combo.mts`
 */
import { initBattle, initPveBattle, applyAction, shiftInitiative } from '../src/battle/engine.js';
import type { LoadoutMember, Loadout } from '../src/battle/engine.js';
import type { TemplateDigimon } from '../src/digimon/types.js';

const originalRandom = Math.random;
Math.random = () => 0.5;

function tmpl(id: string, name: string, element: 'fire' | 'water' | 'nature'): TemplateDigimon {
  return {
    id,
    name,
    stage: 'Rookie',
    attribute: 'Vaccine',
    element,
    baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
    skillPool: [],
    assets: { portrait: '', dot: '' },
  };
}

function mem(monId: string, template: TemplateDigimon, spdBonus: number): LoadoutMember {
  return {
    monId,
    templateId: template.id,
    template,
    level: 10,
    nickname: template.name,
    statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: spdBonus },
  };
}

const fireA = tmpl('fire-a', 'FireA', 'fire');
const fireB = tmpl('fire-b', 'FireB', 'fire');
const waterA = tmpl('water-a', 'WaterA', 'water');
const natureB = tmpl('nature-b', 'NatureB', 'nature');

const loadoutA: Loadout = {
  playerId: 'usr_a',
  members: [mem('a0', fireA, 200), mem('a1', fireB, 100), mem('a2', waterA, 50)],
};
const loadoutB: Loadout = {
  playerId: 'usr_b',
  members: [mem('b0', natureB, -100), mem('b1', natureB, -110), mem('b2', natureB, -120)],
};

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

console.log('=== Test 1: Chain multiplier applies + cue emitted ===');
{
  const b = initBattle({ loadoutA, loadoutB });
  check('lastAction starts null', b.lastAction === null);
  check('queue order is A0,A1,A2,B0,B1,B2 (A units are faster)',
    b.turnQueue.map((e) => e.unitId).join(',') === 'a:0,a:1,a:2,b:0,b:1,b:2',
    'got: ' + b.turnQueue.map((e) => e.unitId).join(','));

  const r1 = applyAction(b, 'a', { type: 'fight', unitId: 'a:0', targetId: 'b:0' });
  check('A0 fire hit accepted', r1.ok);
  const hit1 = b.log.find((e) => e.type === 'action' && e.actor === 'a:0');
  const d1 = (hit1 as { damage: number }).damage;
  check('A0 damage > 0', d1 > 0, `dmg=${d1}`);
  check('lastAction={a,fire,true}', b.lastAction?.side === 'a' && b.lastAction?.element === 'fire' && b.lastAction?.wasHit === true);

  const r2 = applyAction(b, 'a', { type: 'fight', unitId: 'a:1', targetId: 'b:0' });
  check('A1 fire chain hit accepted', r2.ok);
  const hit2 = b.log.find((e) => e.type === 'action' && e.actor === 'a:1');
  const d2 = (hit2 as { damage: number }).damage;
  const cue2 = (hit2 as { cue: string }).cue;
  check('A1 cue is chain', cue2 === 'chain', `cue=${cue2}`);
  check('A1 damage ~2x A0 damage', Math.abs(d2 / d1 - 2.0) < 0.05, `d1=${d1} d2=${d2} ratio=${(d2/d1).toFixed(2)}`);
}

console.log('\n=== Test 2: Chain BREAKS when element changes ===');
{
  const b = initBattle({ loadoutA, loadoutB });
  applyAction(b, 'a', { type: 'fight', unitId: 'a:0', targetId: 'b:0' });
  applyAction(b, 'a', { type: 'fight', unitId: 'a:1', targetId: 'b:0' });
  const r3 = applyAction(b, 'a', { type: 'fight', unitId: 'a:2', targetId: 'b:0' });
  check('A2 water hit accepted', r3.ok);
  const hit3 = b.log.filter((e) => e.type === 'action').at(-1);
  const cue3 = (hit3 as { cue: string }).cue;
  check('A2 cue is NOT chain (element changed fire→water)', cue3 !== 'chain', `cue=${cue3}`);
  check('lastAction={a,water,true}', b.lastAction?.side === 'a' && b.lastAction?.element === 'water' && b.lastAction?.wasHit === true);
}

console.log('\n=== Test 3: Chain BREAKS across enemy turn ===');
{
  const b = initBattle({ loadoutA, loadoutB });
  applyAction(b, 'a', { type: 'fight', unitId: 'a:0', targetId: 'b:0' });
  applyAction(b, 'a', { type: 'fight', unitId: 'a:1', targetId: 'b:0' });
  applyAction(b, 'a', { type: 'fight', unitId: 'a:2', targetId: 'b:0' });
  const rB = applyAction(b, 'b', { type: 'fight', unitId: 'b:0', targetId: 'a:0' });
  check('B0 fire hit accepted', rB.ok);
  check('lastAction now side=b', b.lastAction?.side === 'b');
}

console.log('\n=== Test 4: Guard breaks chain ===');
{
  const b = initBattle({ loadoutA, loadoutB });
  applyAction(b, 'a', { type: 'fight', unitId: 'a:0', targetId: 'b:0' });
  const rG = applyAction(b, 'a', { type: 'guard', unitId: 'a:1' });
  check('Guard accepted', rG.ok);
  check('Guard resets lastAction.wasHit=false', b.lastAction?.wasHit === false);
  check('Guard resets lastAction.element=neutral', b.lastAction?.element === 'neutral');
}

console.log('\n=== Test 5: shiftInitiative reorders queue ===');
{
  const b = initBattle({ loadoutA, loadoutB });
  const beforeOrder = b.turnQueue.map((e) => e.unitId).join(',');
  check('starting order A0,A1,A2,B0,B1,B2', beforeOrder === 'a:0,a:1,a:2,b:0,b:1,b:2');

  const ok = shiftInitiative(b, 'a:2', -1);
  check('shift A2 by -1 accepted', ok);
  const afterOrder = b.turnQueue.map((e) => e.unitId).join(',');
  check('A2 moved 1 slot sooner (A0,A2,A1,B0,B1,B2)', afterOrder === 'a:0,a:2,a:1,b:0,b:1,b:2', `got: ${afterOrder}`);

  const ok2 = shiftInitiative(b, 'a:2', 3);
  check('shift A2 by +3 accepted', ok2);
  const finalOrder = b.turnQueue.map((e) => e.unitId).join(',');
  check('A2 moved to near end (A0,A1,B0,B1,A2,B2 or similar)', finalOrder !== afterOrder, `got: ${finalOrder}`);
}

Math.random = originalRandom;

console.log('\n=== Test 6: initPveBattle sets mode=pve + phantom slots ===');
{
  Math.random = () => 0.5;
  const wildMember: LoadoutMember = mem('wild-0', fireB, 0);
  const b = initPveBattle({
    playerLoadout: loadoutA,
    wildParty: [{ member: wildMember, wildInfo: { catalogId: fireB.id, rare: false } }],
  });
  check('battle.mode = pve', b.mode === 'pve');
  const wildUnit = b.units.find((u) => u.id === 'b:0')!;
  check('wild unit has wildInfo', wildUnit.wildInfo !== undefined, `wildInfo=${JSON.stringify(wildUnit.wildInfo)}`);
  check('wild unit analyzed=false initially', wildUnit.analyzed === false);
  const phantom1 = b.units.find((u) => u.id === 'b:1')!;
  const phantom2 = b.units.find((u) => u.id === 'b:2')!;
  check('phantom b:1 dead from init (hp=0)', phantom1.hp === 0, `hp=${phantom1.hp}`);
  check('phantom b:2 dead from init (hp=0)', phantom2.hp === 0);
  check('phantoms have no wildInfo', phantom1.wildInfo === undefined && phantom2.wildInfo === undefined);
  Math.random = originalRandom;
}

console.log('\n=== Test 7: Analyze action marks target + emits analyzedInfo ===');
{
  Math.random = () => 0.5;
  const wildMember: LoadoutMember = mem('wild-a', fireB, -1000);
  const b = initPveBattle({
    playerLoadout: loadoutA,
    wildParty: [{ member: wildMember, wildInfo: { catalogId: fireB.id, rare: false } }],
  });
  const r = applyAction(b, 'a', { type: 'analyze', unitId: 'a:0', targetId: 'b:0' });
  check('analyze accepted', r.ok);
  const wildUnit = b.units.find((u) => u.id === 'b:0')!;
  check('target.analyzed=true after analyze', wildUnit.analyzed === true);
  const evt = b.log.filter((e) => e.type === 'action').at(-1);
  check('event cue=analyzed', (evt as { cue: string }).cue === 'analyzed');
  const info = (evt as { analyzedInfo?: { name: string; level: number; hp: number; skills: Array<{ name: string }> } }).analyzedInfo;
  check('analyzedInfo populated with name+stats+skills', info !== undefined && info.name === wildUnit.name && info.hp === wildUnit.hp);
  Math.random = originalRandom;
}

console.log('\n=== Test 8: Capture miss at full HP (non-rare) - chance 0.15 vs roll 0.5 ===');
{
  Math.random = () => 0.5;
  const wildMember: LoadoutMember = mem('wild-cap', fireB, -1000);
  const b = initPveBattle({
    playerLoadout: loadoutA,
    wildParty: [{ member: wildMember, wildInfo: { catalogId: fireB.id, rare: false } }],
  });
  const r = applyAction(b, 'a', { type: 'capture', unitId: 'a:0', targetId: 'b:0' });
  check('capture accepted', r.ok);
  const evt = b.log.filter((e) => e.type === 'action').at(-1);
  const cue = (evt as { cue: string }).cue;
  check('cue is capture-miss at full HP non-rare', cue === 'capture-miss', `cue=${cue}`);
  const chance = (evt as { captureChance?: number }).captureChance;
  check('captureChance = 0.15', Math.abs((chance ?? 0) - 0.15) < 0.001, `chance=${chance}`);
  check('battle not ended', b.status === 'active');
  Math.random = originalRandom;
}

console.log('\n=== Test 9: Capture HIT at 50% HP (non-rare) - chance 0.525 vs roll 0.5 ===');
{
  Math.random = () => 0.5;
  const wildMember: LoadoutMember = mem('wild-half', fireB, -1000);
  const b = initPveBattle({
    playerLoadout: loadoutA,
    wildParty: [{ member: wildMember, wildInfo: { catalogId: fireB.id, rare: false } }],
  });
  const wild = b.units.find((u) => u.id === 'b:0')!;
  wild.hp = Math.floor(wild.hpMax * 0.5);
  const r = applyAction(b, 'a', { type: 'capture', unitId: 'a:0', targetId: 'b:0' });
  check('capture accepted at 50% HP', r.ok);
  const evt = b.log.filter((e) => e.type === 'action').at(-1);
  const cue = (evt as { cue: string }).cue;
  check('cue is capture-hit at 50% HP', cue === 'capture-hit', `cue=${cue}`);
  const chance = (evt as { captureChance?: number }).captureChance;
  check('captureChance ≈ 0.525', Math.abs((chance ?? 0) - 0.525) < 0.005, `chance=${chance}`);
  check('battle ended with captured_a', b.status === 'ended' && b.outcome === 'captured_a');
  check('winner=a', b.winner === 'a');
  const endEvt = b.log.find((e) => e.type === 'end');
  check('end event has capturedUnitId', (endEvt as { capturedUnitId?: string }).capturedUnitId === 'b:0');
  Math.random = originalRandom;
}

console.log('\n=== Test 10: Rare mon halves capture chance ===');
{
  Math.random = () => 0.5;
  const wildMember: LoadoutMember = mem('wild-rare', fireB, -1000);
  const b = initPveBattle({
    playerLoadout: loadoutA,
    wildParty: [{ member: wildMember, wildInfo: { catalogId: fireB.id, rare: true } }],
  });
  const wild = b.units.find((u) => u.id === 'b:0')!;
  wild.hp = Math.floor(wild.hpMax * 0.5);
  const r = applyAction(b, 'a', { type: 'capture', unitId: 'a:0', targetId: 'b:0' });
  check('capture accepted', r.ok);
  const evt = b.log.filter((e) => e.type === 'action').at(-1);
  const chance = (evt as { captureChance?: number }).captureChance;
  check('rare captureChance ≈ 0.2625 (half of 0.525)', Math.abs((chance ?? 0) - 0.2625) < 0.005, `chance=${chance}`);
  const cue = (evt as { cue: string }).cue;
  check('rare 50% HP miss (chance 0.26 < roll 0.5)', cue === 'capture-miss', `cue=${cue}`);
  Math.random = originalRandom;
}

console.log('\n=== Test 11: Analyzed bonus boosts capture chance (1.3x) ===');
{
  Math.random = () => 0.5;
  const wildMember: LoadoutMember = mem('wild-anal', fireB, -1000);
  const b = initPveBattle({
    playerLoadout: loadoutA,
    wildParty: [{ member: wildMember, wildInfo: { catalogId: fireB.id, rare: false } }],
  });
  const wild = b.units.find((u) => u.id === 'b:0')!;
  wild.analyzed = true;
  wild.hp = Math.floor(wild.hpMax * 0.5);
  const r = applyAction(b, 'a', { type: 'capture', unitId: 'a:0', targetId: 'b:0' });
  check('capture accepted', r.ok);
  const evt = b.log.filter((e) => e.type === 'action').at(-1);
  const chance = (evt as { captureChance?: number }).captureChance;
  check('analyzed captureChance ≈ 0.6825 (0.525 * 1.3)', Math.abs((chance ?? 0) - 0.6825) < 0.005, `chance=${chance}`);
  Math.random = originalRandom;
}

console.log('\n=== Test 12: Capture in PVP mode is rejected ===');
{
  const b = initBattle({ loadoutA, loadoutB });
  const r = applyAction(b, 'a', { type: 'capture', unitId: 'a:0', targetId: 'b:0' });
  check('capture rejected in PVP', !r.ok, `error=${!r.ok ? r.error : 'none'}`);
}

console.log(`\n=== Summary ===`);
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
