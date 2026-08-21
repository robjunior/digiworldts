/**
 * Regression for the random-encounter "added + configured -> nothing happens"
 * bug (branch 3 curated pool).
 *
 * Before the fix: rollFromPool applied the legacy filter's allowedElements /
 * maxStage to the curated pool, silently emptying it; and rollDungeonEncounter
 * / the start guard could reject curated-pool encounters. After the fix:
 *   - curated pool entries always roll (legacy filter doesn't exclude them)
 *   - Enabled gates the entire auto-roll path (pool + zone + legacy)
 *   - start guard accepts curated-pool encounters under level/party bounds
 *
 * Run: tsx test/dungeon-random-fix.mts
 */
import type { Catalog, Dungeon, DungeonZone, TemplateDigimon } from '@digiworld/shared';
import { rollDungeonEncounter, randomEncounterMatchesDungeonConfig } from '../src/dungeons/random.ts';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}
type Element = 'fire' | 'water' | 'plant';
function mkTemplate(id: string, element: Element, stage: TemplateDigimon['stage'] = 'Rookie'): TemplateDigimon {
  return { id, name: id, stage, attribute: 'Vaccine', element, baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 }, skillPool: [{ id: 's0', name: 'Basic', element: 'fire', energyCost: 0, power: 100 }], assets: { portrait: '', dot: '' } };
}
function mkDungeon(overrides: Partial<Dungeon> = {}): Dungeon {
  const now = Date.now();
  return { id: 'dun', worldObjectId: null, questId: null, parentId: null, name: 'T', description: '', biome: 'forest', width: 20, height: 20, spawnX: 0, spawnY: 0, biomeRegion: null, randomEncountersEnabled: false, randomEncounterRate: 1.0, randomMinLevel: 1, randomMaxLevel: 5, randomMaxStage: 'Rookie', randomMinPartySize: 1, randomMaxPartySize: 1, randomAllowedElements: null, randomPool: [], unlockRequiresItems: null, challenge: { kind: 'none' }, walkableMask: null, dungeonGroupId: null, floorIndex: null, createdAt: now, updatedAt: now, ...overrides };
}
const catalog: Catalog = { version: 't', updatedAt: 0, digimons: [mkTemplate('agu', 'fire'), mkTemplate('gab', 'water'), mkTemplate('meta', 'plant', 'Mega')] };
const emptyZones: readonly DungeonZone[] = [];
const pos = { x: 10, y: 10 };

console.log('Regression — curated pool + legacy filter interaction\n');

// 1. Curated pool with a legacy filter that EXCLUDES the pool element must STILL roll.
const poolExcludedByFilter = mkDungeon({
  randomEncountersEnabled: true,
  randomEncounterRate: 1,
  randomAllowedElements: ['water'], // excludes agu(fire) in the pool
  randomPool: [{ catalogId: 'agu' }],
});
let fired = false;
for (let i = 0; i < 50; i += 1) {
  const r = rollDungeonEncounter(poolExcludedByFilter, emptyZones, pos, catalog);
  if (r && r.length > 0 && r[0].catalogId === 'agu') fired = true;
}
check('1. pool entry rolls even when legacy filter excludes its element', fired === true);

// 2. Enabled OFF must suppress the curated pool too (previously it did not).
const poolEnabledOff = mkDungeon({
  randomEncountersEnabled: false,
  randomEncounterRate: 1,
  randomPool: [{ catalogId: 'agu' }],
});
check('2. Enabled=OFF suppresses curated pool', rollDungeonEncounter(poolEnabledOff, emptyZones, pos, catalog) === null);

// 3. Level bounds from the legacy filter still apply as defaults to pool entries.
const poolLevelDefault = mkDungeon({
  randomEncountersEnabled: true,
  randomEncounterRate: 1,
  randomMinLevel: 40, randomMaxLevel: 40,
  randomPool: [{ catalogId: 'agu' }], // no per-entry level
});
let lvlOk = true;
for (let i = 0; i < 50; i += 1) {
  const r = rollDungeonEncounter(poolLevelDefault, emptyZones, pos, catalog);
  if (r) for (const m of r) if (m.level !== 40) lvlOk = false;
}
check('3. pool entry inherits legacy level default (40)', lvlOk === true);

// 4. Start guard accepts a curated-pool encounter even under the legacy filter.
const startGuardDungeon = mkDungeon({
  randomEncountersEnabled: true,
  randomMinLevel: 1, randomMaxLevel: 5, randomMinPartySize: 1, randomMaxPartySize: 1,
  randomAllowedElements: ['water'], // would reject fire under the old guard
  randomPool: [{ catalogId: 'agu' }],
});
check('4. start guard accepts curated-pool mon regardless of legacy element filter', randomEncounterMatchesDungeonConfig(startGuardDungeon, catalog, [{ catalogId: 'agu', level: 3 }]) === true);
check('4b. start guard still rejects out-of-level mon', randomEncounterMatchesDungeonConfig(startGuardDungeon, catalog, [{ catalogId: 'agu', level: 50 }]) === false);

// 5. Zone pool also rolls through the Enabled gate and is accepted by start guard.
const zonePoolDungeon = mkDungeon({ randomEncountersEnabled: true, randomEncounterRate: 1, randomPool: [] });
const zone: DungeonZone = { id: 'z', dungeonId: 'dun', name: 'Z', x: 0, y: 0, width: 20, height: 20, safe: false, pool: [{ catalogId: 'gab' }], createdAt: 0, updatedAt: 0 };
let zoneFired = false;
for (let i = 0; i < 50; i += 1) {
  const r = rollDungeonEncounter(zonePoolDungeon, [zone], pos, catalog);
  if (r && r[0]?.catalogId === 'gab') zoneFired = true;
}
check('5. zone pool rolls when Enabled=ON', zoneFired === true);
check('5b. start guard accepts zone-pool mon', randomEncounterMatchesDungeonConfig(zonePoolDungeon, catalog, [{ catalogId: 'gab', level: 2 }]) === true);

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
