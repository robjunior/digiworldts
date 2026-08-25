import { loadCatalog } from './src/digimon/xml.ts';
import { rollDungeonEncounter, rollRandomEncounter } from './src/dungeons/random.ts';
import type { Dungeon } from '@digiworld/shared';

const STAGES = ['Fresh', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega', 'Ultra'] as const;
const stageRank = (s: string) => STAGES.indexOf(s as (typeof STAGES)[number]);

const catalog = loadCatalog();
console.log('catalog digimons:', catalog.digimons.length);

// Exactly the dun_plant_1 config from the DB.
const dungeon = {
  id: 'dun_plant_1',
  randomEncountersEnabled: true,
  randomEncounterRate: 0.18,
  randomMinLevel: 3,
  randomMaxLevel: 7,
  randomMaxStage: 'Rookie',
  randomMinPartySize: 1,
  randomMaxPartySize: 1,
  randomAllowedElements: ['plant'],
  randomPool: [],
} as unknown as Dungeon;

const zones: never[] = [];
const pos = { x: 5, y: 5 };

// Manually inspect the filtered pool size.
const maxStageRank = stageRank(dungeon.randomMaxStage);
const allowed = new Set(dungeon.randomAllowedElements);
const pool = catalog.digimons.filter(
  (e) => stageRank(e.stage) <= maxStageRank && allowed.has(e.element),
);
console.log('plant+Rookie pool size:', pool.length);
console.log('sample:', pool.slice(0, 5).map((p) => `${p.name}(${p.element}/${p.stage})`));

let hits = 0;
const N = 5000;
for (let i = 0; i < N; i += 1) {
  const r = rollDungeonEncounter(dungeon, zones, pos, catalog);
  if (r && r.length > 0) hits += 1;
}
console.log(`rollDungeonEncounter(dun_plant_1) non-null: ${hits}/${N} (${((hits / N) * 100).toFixed(1)}%)`);

// Control: unfiltered (no allowed elements) to compare.
const dungeonAll = { ...dungeon, randomAllowedElements: [] } as unknown as Dungeon;
let hitsAll = 0;
for (let i = 0; i < N; i += 1) {
  const r = rollRandomEncounter(dungeonAll, catalog);
  if (r && r.length > 0) hitsAll += 1;
}
console.log(`rollRandomEncounter(unfiltered) non-null: ${hitsAll}/${N} (${((hitsAll / N) * 100).toFixed(1)}%)`);
