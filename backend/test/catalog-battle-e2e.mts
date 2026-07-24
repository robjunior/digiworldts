/**
 * End-to-end regression for the full skills-v2 pipeline delivered across
 * P3 (seed), P4 (pool + wire-up), P4c/d/e (auto-populate + backfill),
 * P4f/h (cooldown engine + data), P4g (env flag), P5 Day 1-3 (API + UI +
 * i18n foundation).
 *
 * Rather than mock a battle, this test walks the actual path a real match
 * would take:
 *   1. Scratch DB with all 264 skills seeded via seedSkillsCatalogV2
 *   2. resolveCatalogSkills materializes Skill objects with .actions +
 *      .cooldown + .name_pt + .description_pt populated
 *   3. Two LoadoutMembers built with those Skill[] as equippedSkills
 *   4. initBattle wires them into BattleUnits (P4 unitFromLoadout slicing
 *      respects the passed equippedSkills — no fallback to skillPool)
 *   5. applyAction casts a catalog skill → DSL runtime fires (damage
 *      dealt via P2 dsl-runtime executeDSL)
 *   6. Cooldown-annotated cast blocks recast on next own turn (P4f gate)
 *
 * Run: DB_PATH=/tmp/dw-catalog-e2e.db pnpm --filter @digiworld/backend test:catalog-e2e
 */
import { existsSync, unlinkSync } from 'node:fs';
import { seedSkillsCatalogV2 } from '../src/skills/seed-catalog.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { resolveCatalogSkills } from '../src/skills/pool.ts';
import { initBattle, applyAction } from '../src/battle/engine.ts';
import type { Loadout, LoadoutMember } from '../src/battle/engine.ts';
import type { Skill, TemplateDigimon } from '../src/digimon/types.ts';

const DB_PATH = process.env.DB_PATH!;
if (!DB_PATH) {
  console.error('FAIL: set DB_PATH env (e.g. /tmp/dw-catalog-e2e.db)');
  process.exit(1);
}
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

await getDb();
const seed = await seedSkillsCatalogV2();
if (seed.validationErrors.length > 0) {
  console.error(`FAIL: seed had ${seed.validationErrors.length} validation errors`);
  process.exit(1);
}

const originalRandom = Math.random;
Math.random = () => 0.5;

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

function tmpl(id: string, element: 'fire' | 'water'): TemplateDigimon {
  return {
    id,
    name: `Test${id}`,
    stage: 'Rookie',
    attribute: 'Vaccine',
    element,
    baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
    skillPool: [],
    assets: { portrait: '', dot: '' },
  };
}

function mem(monId: string, template: TemplateDigimon, skills: Skill[]): LoadoutMember {
  return {
    monId,
    templateId: template.id,
    template,
    level: 10,
    nickname: template.name,
    statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 },
    equippedSkills: skills,
  };
}

console.log(`\n=== Fetching Fire Rookie catalog skills via resolveCatalogSkills ===`);
const fireRookieIds = ['sk-fire-pa-r', 'sk-fire-sd-r', 'sk-fire-ct-r', 'sk-fire-bs-r'];
const fireRookieSkills = await resolveCatalogSkills(fireRookieIds);
check('resolved 4 fire Rookie skills', fireRookieSkills.length === 4, `got ${fireRookieSkills.length}`);
const fireball = fireRookieSkills.find((s) => s.id === 'sk-fire-pa-r');
check('sk-fire-pa-r (Fireball) exists in resolved set', fireball !== undefined);
check('Fireball has .actions populated (DSL path enabled)', Array.isArray(fireball?.actions) && (fireball?.actions.length ?? 0) > 0);
check('Fireball has name_pt populated (P5 Day 3)', fireball?.name_pt === 'Bola de Fogo', `got "${fireball?.name_pt}"`);
check('Fireball has description_pt populated (P5 Day 3)', typeof fireball?.description_pt === 'string' && (fireball?.description_pt?.length ?? 0) > 0);
check('Fireball has no cooldown (Rookie skill, cooldown=0)', fireball?.cooldown === undefined || fireball?.cooldown === 0);

console.log(`\n=== Fetching Fire Mega Solar Sacrifice (cooldown=2 per P4h) ===`);
const solarSacrificeSet = await resolveCatalogSkills(['sk-fire-id-m']);
const solarSacrifice = solarSacrificeSet[0];
check('sk-fire-id-m (Solar Sacrifice) resolved', solarSacrifice !== undefined);
check('Solar Sacrifice has cooldown=2 (P4h data)', solarSacrifice?.cooldown === 2, `got ${solarSacrifice?.cooldown}`);
check('Solar Sacrifice has name_pt=Sacrifício Solar', solarSacrifice?.name_pt === 'Sacrifício Solar', `got "${solarSacrifice?.name_pt}"`);

console.log(`\n=== initBattle wires catalog Skill[] into BattleUnit.skills (P4) ===`);
const fireTpl = tmpl('fire-mon', 'fire');
const waterTpl = tmpl('water-mon', 'water');
const attacker = mem('m1', fireTpl, [fireball!, solarSacrifice!]);
const defender = mem('m2', waterTpl, [fireRookieSkills[1]!]);
const loadoutA: Loadout = { playerId: 'u1', members: [attacker] };
const loadoutB: Loadout = { playerId: 'u2', members: [defender] };
const battle = initBattle({ matchId: 'match-1', loadoutA, loadoutB });
const actorUnit = battle.units.find((u) => u.side === 'a')!;
const targetUnit = battle.units.find((u) => u.side === 'b')!;
check('actor unit has 2 skills equipped (from LoadoutMember.equippedSkills)', actorUnit.skills.length === 2);
check('actor unit skill 0 is sk-fire-pa-r (Fireball)', actorUnit.skills[0]?.id === 'sk-fire-pa-r');
check('actor unit skill 1 is sk-fire-id-m (Solar Sacrifice)', actorUnit.skills[1]?.id === 'sk-fire-id-m');
check('actor unit inherits Fireball .actions for DSL dispatch', Array.isArray(actorUnit.skills[0]?.actions) && (actorUnit.skills[0]?.actions?.length ?? 0) > 0);

console.log(`\n=== applyAction dispatches catalog skill through DSL runtime (P2 executeDSL) ===`);
const targetHpBefore = targetUnit.hp;
const casterEnBefore = actorUnit.en;
const result = applyAction(battle, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-fire-pa-r', targetId: 'b:0' });
check('applyAction returned ok', result.ok === true);
check('target HP reduced (DSL deal_damage fired)', targetUnit.hp < targetHpBefore, `${targetHpBefore} → ${targetUnit.hp}`);
check('actor EN consumed (energyCost 8)', actorUnit.en === casterEnBefore - 8, `${casterEnBefore} → ${actorUnit.en}`);
check('no cooldown entry for Fireball (cooldown=0)', actorUnit.skillCooldowns?.['sk-fire-pa-r'] === undefined);

console.log(`\n=== Cooldown gate blocks recast of Solar Sacrifice (P4f + P4h) ===`);
actorUnit.en = actorUnit.enMax;
battle.turnCursor = 0;
const solarCastResult = applyAction(battle, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-fire-id-m', targetId: 'b:0' });
check('Solar Sacrifice cast succeeded', solarCastResult.ok === true);
check(
  'skillCooldowns[sk-fire-id-m] === 2 after cast (set to 3, immediate tick to 2)',
  actorUnit.skillCooldowns?.['sk-fire-id-m'] === 2,
  `got ${actorUnit.skillCooldowns?.['sk-fire-id-m']}`,
);
actorUnit.en = actorUnit.enMax;
battle.turnCursor = 0;
const recastResult = applyAction(battle, 'a', { type: 'skill', unitId: 'a:0', skillId: 'sk-fire-id-m', targetId: 'b:0' });
check('Solar Sacrifice recast blocked', recastResult.ok === false);
if (recastResult.ok === false) {
  check('recast error code is on-cooldown', recastResult.code === 'on-cooldown', `got ${recastResult.code}`);
  check('recast error message mentions cooldown', recastResult.error.includes('cooldown'));
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);

Math.random = originalRandom;
await closeDbAdapter();
process.exit(failed === 0 ? 0 : 1);
