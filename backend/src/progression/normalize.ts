import { q, tx, type RosterRow } from '../db/index.js';
import { findTemplate, loadCatalog } from '../digimon/xml.js';
import { log } from '../util/log.js';
import { xpToReach } from './xp.js';

const SQL_SELECT_ALL_MONS = `SELECT id, catalog_id, level, xp FROM player_roster`;
const SQL_UPDATE_XP = `UPDATE player_roster SET xp = ? WHERE id = ?`;

type MonXpRow = Pick<RosterRow, 'id' | 'catalog_id' | 'level' | 'xp'>;

export async function normalizeRosterXpFloor(): Promise<{ updated: number; scanned: number }> {
  const catalog = loadCatalog();
  if (catalog.digimons.length === 0) {
    return { updated: 0, scanned: 0 };
  }
  const rows = await q<MonXpRow>(SQL_SELECT_ALL_MONS);
  const patches: Array<[number, string]> = [];
  for (const row of rows) {
    const template = findTemplate(catalog, row.catalog_id);
    if (!template) continue;
    const floor = xpToReach(row.level, template.stage);
    if (row.xp < floor) patches.push([floor, row.id]);
  }
  if (patches.length > 0) {
    await tx(async (t) => {
      for (const [floor, id] of patches) await t.run(SQL_UPDATE_XP, [floor, id]);
    });
    log.info('boot.normalize-xp', { updated: patches.length, scanned: rows.length });
  }
  return { updated: patches.length, scanned: rows.length };
}
