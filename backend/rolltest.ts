import { readFileSync } from 'node:fs';
import { rollDungeonEncounter, rollRandomEncounter } from './src/dungeons/random.ts';
import { parseCatalogXml } from './src/digimon/xml.ts';

const raw = readFileSync('./data/catalog/digimons.xml', 'utf8');
const catalog = parseCatalogXml(raw);
console.log('catalog digimons:', catalog.digimons.length);

// Mirror dun_plant_1 exactly (from DB query):
// random_encounters_enabled=1, rate=0.18, min=3, max=7, maxStage='Rookie', minParty=1, maxParty=2, pool=[]
const dungeon = {
  id: 'dun_plant_1',
  randomEncountersEnabled: true,
  randomEncounterRate: 0.18,
  randomMinLevel: 3,
  randomMaxLevel: 7,
  randomMaxStage: 'Rookie',
  randomMinPartySize: 1,
  randomMaxPartySize: 2,
  randomAllowedElements: null,
  randomPool: [] as unknown[],
} as unknown as Parameters<typeof rollDungeonEncounter>[0];

let hits = 0;
const N = 5000;
for (let i = 0; i < N; i++) {
  const r = rollDungeonEncounter(dungeon, [], { x: 5, y: 5 }, catalog);
  if (r) hits++;
}
console.log(`rollDungeonEncounter non-null: ${hits}/${N} (${((hits / N) * 100).toFixed(1)}%)`);

let hits2 = 0;
for (let i = 0; i < N; i++) {
  const r = rollRandomEncounter(dungeon, catalog);
  if (r) hits2++;
}
console.log(`rollRandomEncounter non-null: ${hits2}/${N} (${((hits2 / N) * 100).toFixed(1)}%)`);
