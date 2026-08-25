import { loadCatalog } from './src/digimon/xml.ts';
import { config } from './src/config.ts';

console.log('config.paths.catalogXml =', config.paths.catalogXml);
const catalog = loadCatalog();
console.log('loadCatalog digimons:', catalog.digimons.length);
console.log('sample:', catalog.digimons.slice(0, 3).map((d) => `${d.id}:${d.stage}:${d.element}`));
