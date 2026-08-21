/**
 * Dungeon zones + pool smoke test — pure function coverage of the S8 roll
 * pipeline (rollDungeonEncounter with 4-branch precedence). No DB needed;
 * rolls are deterministic when the container pool has one entry (uniform
 * pick with n=1).
 *
 * Run: pnpm --filter @digiworld/backend test:zones
 */
import type { Catalog, Dungeon, DungeonZone, TemplateDigimon } from '@digiworld/shared';
import { rollDungeonEncounter } from '../src/dungeons/random.ts';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function mkTemplate(id: string, element: TemplateDigimon['element'] = 'fire', stage: TemplateDigimon['stage'] = 'Rookie'): TemplateDigimon {
  return {
    id,
    name: id,
    stage,
    attribute: 'Vaccine',
    element,
    baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
    skillPool: [{ id: 's0', name: 'Basic', element: 'fire', energyCost: 0, power: 100 }],
    assets: { portrait: '', dot: '' },
  };
}

function mkDungeon(overrides: Partial<Dungeon> = {}): Dungeon {
  const now = Date.now();
  return {
    id: 'dun_test',
    worldObjectId: null,
    questId: null,
    parentId: null,
    name: 'Test',
    description: '',
    biome: 'forest',
    width: 20,
    height: 20,
    spawnX: 0,
    spawnY: 0,
    biomeRegion: null,
    randomEncountersEnabled: true,
    randomEncounterRate: 1.0,
    randomMinLevel: 1,
    randomMaxLevel: 5,
    randomMaxStage: 'Rookie',
    randomMinPartySize: 1,
    randomMaxPartySize: 1,
    randomAllowedElements: null,
    randomPool: [],
    unlockRequiresItems: null,
    challenge: { kind: 'none' },
    walkableMask: null,
    dungeonGroupId: null,
    floorIndex: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mkZone(overrides: Partial<DungeonZone> = {}): DungeonZone {
  const now = Date.now();
  return {
    id: 'dzn_test',
    dungeonId: 'dun_test',
    name: 'Zone',
    x: 0,
    y: 0,
    width: 5,
    height: 5,
    safe: false,
    pool: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const catalog: Catalog = {
  version: 'test',
  updatedAt: 0,
  digimons: [
    mkTemplate('agu', 'fire'),
    mkTemplate('gab', 'water'),
    mkTemplate('meta', 'plant'),
  ],
};

function main(): void {
  console.log('S8 — Dungeon zones + pool smoke\n');

  const d1 = mkDungeon({ randomEncountersEnabled: false });
  const r1 = rollDungeonEncounter(d1, [], { x: 10, y: 10 }, catalog);
  check('branch 4 disabled: empty pool + filter off = null', r1 === null);

  const d2 = mkDungeon({ randomEncountersEnabled: true });
  const r2 = rollDungeonEncounter(d2, [], { x: 10, y: 10 }, catalog);
  check('branch 4 grandfather: empty pool + filter on rate=1 = non-null', r2 !== null && r2.length > 0);

  const d3 = mkDungeon({ randomPool: [{ catalogId: 'agu' }] });
  const r3 = rollDungeonEncounter(d3, [], { x: 10, y: 10 }, catalog);
  check('branch 3 dungeon pool: fires agu', r3 !== null && r3[0]?.catalogId === 'agu');

  // Enabled is the master switch for ALL branches (pool + zone + legacy).
  const d3off = mkDungeon({ randomEncountersEnabled: false, randomPool: [{ catalogId: 'agu' }] });
  const r3off = rollDungeonEncounter(d3off, [], { x: 10, y: 10 }, catalog);
  check('branch 3 disabled: Enabled=OFF suppresses curated pool', r3off === null);

  const dPool = mkDungeon({ randomPool: [{ catalogId: 'agu' }] });
  const zonePool = mkZone({ pool: [{ catalogId: 'gab' }] });
  const r4 = rollDungeonEncounter(dPool, [zonePool], { x: 2, y: 2 }, catalog);
  check('branch 2 zone pool: overrides dungeon pool (gab wins over agu)', r4 !== null && r4[0]?.catalogId === 'gab');

  const safeZone = mkZone({ safe: true });
  const r5 = rollDungeonEncounter(dPool, [safeZone], { x: 2, y: 2 }, catalog);
  check('branch 1 safe zone: returns null even with dungeon pool', r5 === null);

  const emptyZone = mkZone({ pool: [], safe: false });
  const r6 = rollDungeonEncounter(dPool, [emptyZone], { x: 2, y: 2 }, catalog);
  check('branch 2→3 fallback: empty non-safe zone → dungeon pool (agu)', r6 !== null && r6[0]?.catalogId === 'agu');

  const smallZone = mkZone({ pool: [{ catalogId: 'gab' }] });
  const r7 = rollDungeonEncounter(dPool, [smallZone], { x: 10, y: 10 }, catalog);
  check('outside zone: uses dungeon pool (agu)', r7 !== null && r7[0]?.catalogId === 'agu');

  const bigZone = mkZone({ id: 'dzn_big', width: 10, height: 10, pool: [{ catalogId: 'gab' }] });
  const tinyZone = mkZone({ id: 'dzn_tiny', width: 2, height: 2, pool: [{ catalogId: 'meta' }] });
  const r8 = rollDungeonEncounter(dPool, [bigZone, tinyZone], { x: 1, y: 1 }, catalog);
  check('overlap tiebreak: smaller area wins (meta over gab)', r8 !== null && r8[0]?.catalogId === 'meta');

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
