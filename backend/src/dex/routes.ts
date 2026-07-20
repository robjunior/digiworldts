/**
 * Digdex — bestiary. Fog-of-war reveal per player.
 *
 * "Met" = the player has any of:
 *   - a row in `player_species_data` for that catalog_id (PVE encounter / kill),
 *   - a current mon in `player_roster` with that catalog_id, or
 *   - a catalog_id inside any of their owned mons' `evolution_history` JSON.
 *
 * Unmet entries return `template: null` so the client only renders a `?`
 * placeholder — no name/stats/evolutions leak through the API.
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { q } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import type { TemplateDigimon } from '../digimon/types.js';

const SQL_SPECIES_IDS = `SELECT catalog_id FROM player_species_data WHERE user_id = ?`;
const SQL_ROSTER_ROWS = `SELECT catalog_id, evolution_history FROM player_roster WHERE user_id = ?`;

export type DigdexEntry = {
  readonly catalogId: string;
  readonly met: boolean;
  readonly template: TemplateDigimon | null;
};

export type DigdexResponse = {
  readonly entries: readonly DigdexEntry[];
  readonly totalCount: number;
  readonly metCount: number;
};

async function computeMetSet(userId: string): Promise<Set<string>> {
  const met = new Set<string>();
  const speciesRows = await q<{ catalog_id: string }>(SQL_SPECIES_IDS, userId);
  for (const r of speciesRows) met.add(r.catalog_id);
  const rosterRows = await q<{ catalog_id: string; evolution_history: string | null }>(SQL_ROSTER_ROWS, userId);
  for (const r of rosterRows) {
    met.add(r.catalog_id);
    if (r.evolution_history) {
      try {
        const parsed: unknown = JSON.parse(r.evolution_history);
        if (Array.isArray(parsed)) {
          for (const id of parsed) if (typeof id === 'string') met.add(id);
        }
      } catch {
        // Corrupt evolution_history JSON — ignore this row's history.
      }
    }
  }
  return met;
}

export const digdexPlugin: FastifyPluginAsync = async (app) => {
  app.get('/api/digdex', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const catalog = loadCatalog();
    const metSet = await computeMetSet(user.id);
    let metCount = 0;
    const entries: DigdexEntry[] = catalog.digimons.map((t) => {
      const met = metSet.has(t.id);
      if (met) metCount += 1;
      return { catalogId: t.id, met, template: met ? t : null };
    });
    const response: DigdexResponse = {
      entries,
      totalCount: catalog.digimons.length,
      metCount,
    };
    return reply.send(response);
  });
};
