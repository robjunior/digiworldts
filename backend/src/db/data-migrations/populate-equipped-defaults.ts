/**
 * P4d follow-up: backfill historical player_roster rows.
 *
 * The P4c evolve auto-populate and P4d insert-seam wiring only fire on NEW
 * rows created from those commits forward. Pre-existing rows (evolved or
 * created before the auto-populate landed) still have equipped_skill_ids IS
 * NULL and fall through to template.skillPool via unitFromLoadout — the
 * legacy wikimon path.
 *
 * This one-shot backfill closes the gap: it UPDATEs every NULL row to the
 * catalog defaults for its (element, stage). Idempotent — rerunning finds
 * zero rows to update because the WHERE clause filters equipped_skill_ids
 * IS NULL.
 *
 * Grouping by catalog_id caches the defaults per template (~200 templates
 * vs potentially many rosters) — one getDefaultEquippedForStage call per
 * unique catalog_id, not per row.
 *
 * Run: pnpm --filter @digiworld/backend db:backfill-equipped
 * Test: DB_PATH=... pnpm --filter @digiworld/backend test:backfill
 */
import { q, run } from '../index.js';
import { loadCatalog } from '../../digimon/xml.js';
import { getDefaultEquippedForStage } from '../../skills/catalog-pool.js';
import { log } from '../../util/log.js';

const SQL_SELECT_NULL_EQUIPPED = `SELECT id, catalog_id FROM player_roster WHERE equipped_skill_ids IS NULL`;
const SQL_BACKFILL_EQUIPPED = `UPDATE player_roster SET equipped_skill_ids = ?, updated_at = ? WHERE id = ? AND equipped_skill_ids IS NULL`;

export type BackfillResult = {
  scanned: number;
  updated: number;
  skippedTemplateMissing: number;
  skippedEmptyDefaults: number;
};

export async function backfillEquippedDefaults(): Promise<BackfillResult> {
  const catalog = loadCatalog();
  const templateById = new Map(catalog.digimons.map((t) => [t.id, t] as const));
  const rows = await q<{ id: string; catalog_id: string }>(SQL_SELECT_NULL_EQUIPPED);

  const result: BackfillResult = {
    scanned: rows.length,
    updated: 0,
    skippedTemplateMissing: 0,
    skippedEmptyDefaults: 0,
  };
  const defaultsCache = new Map<string, string>();

  for (const row of rows) {
    let equippedJson = defaultsCache.get(row.catalog_id);
    if (equippedJson === undefined) {
      const tpl = templateById.get(row.catalog_id);
      if (!tpl) {
        result.skippedTemplateMissing++;
        continue;
      }
      const defaults = await getDefaultEquippedForStage(tpl.element, tpl.stage);
      if (defaults.length === 0) {
        result.skippedEmptyDefaults++;
        continue;
      }
      equippedJson = JSON.stringify(defaults);
      defaultsCache.set(row.catalog_id, equippedJson);
    }
    const res = await run(SQL_BACKFILL_EQUIPPED, equippedJson, Date.now(), row.id);
    if (res.changes > 0) result.updated++;
  }

  log.info('backfill.equipped_defaults.done', { ...result });
  return result;
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const { getDb, closeDbAdapter } = await import('../adapter.js');
  await getDb();
  const result = await backfillEquippedDefaults();
  console.log('=== Backfill equipped_skill_ids defaults ===');
  console.log(`  scanned: ${result.scanned}`);
  console.log(`  updated: ${result.updated}`);
  console.log(`  skippedTemplateMissing: ${result.skippedTemplateMissing}`);
  console.log(`  skippedEmptyDefaults: ${result.skippedEmptyDefaults}`);
  await closeDbAdapter();
  process.exit(0);
}
