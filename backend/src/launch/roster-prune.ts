/**
 * Launch-roster prune — remove player-owned digimons whose species is NOT on
 * the active (launch) roster.
 *
 * The launch roster (LAUNCH_PLACES / rosterUniverse) is the source of truth for
 * WHICH species are obtainable in the current build (v1: Rookie + Champion of a
 * curated ~10-place universe; every other template is drafted). When the roster
 * changes, players may legitimately hold a species that was removed from the
 * obtainable pool (an old Ultimate/Mega, a drafted species no longer in any
 * place pool). This step deletes those `player_roster` rows (and their cascade:
 * team memberships null out, market/farm/pending-buff rows cascade), so the
 * live game only ever shows digimons the user could actually obtain.
 *
 * It is served from the `content-deploy` CLI as `--prune-roster` and run as its
 * OWN deploy step AFTER the bundle apply — it is deliberately NOT part of the
 * content apply path (content-deploy must never touch player_* tables).
 *
 * Idempotent + safe to re-run: the DELETE only touches rows whose catalog_id is
 * not in the roster, so a clean DB deletes nothing.
 */

import { getDb } from '../db/adapter.js';
import { q, tx } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import { rosterUniverse } from './roster.js';

export type RosterPruneSummary = {
  deleted: number;
  kept: number;
  rosterIds: number;
};

export async function seedLaunchRosterPrune(): Promise<RosterPruneSummary> {
  await getDb();
  const catalog = loadCatalog();
  const universe = rosterUniverse();
  const index = new Map(catalog.digimons.map((t) => [t.name, t]));

  // Resolve every active roster name -> real catalog id. Fail loudly on unknown
  // names (mirrors launch:seed) rather than silently pruning against a partial set.
  const rosterIds = new Set<string>();
  for (const name of universe.keys()) {
    const tpl = index.get(name);
    if (tpl) rosterIds.add(tpl.id);
  }
  const ids = [...rosterIds];
  if (ids.length === 0) {
    throw new Error('prune-roster: active roster resolved to zero catalog ids — refusing to delete all player digimons');
  }

  const total = await q<{ n: number }>('SELECT COUNT(*) AS n FROM player_roster');
  const before = total[0]?.n ?? 0;

  // Portable NOT IN over a parameter list (json_each is SQLite-only; PG needs its
  // own json functions — placeholders work identically on both backends).
  const placeholders = ids.map(() => '?').join(', ');
  const deleted = await tx(async (t) => {
    const info = await t.run(
      `DELETE FROM player_roster WHERE catalog_id NOT IN (${placeholders})`,
      ids,
    );
    return info.changes;
  });
  return { deleted, kept: before - deleted, rosterIds: ids.length };
}