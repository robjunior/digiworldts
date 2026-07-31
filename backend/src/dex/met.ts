/**
 * Shared "met" (fog-of-war) resolution.
 *
 * A species counts as met when the player has any of:
 *   - a row in `player_species_data` for that catalog_id (PVE encounter / kill),
 *   - a current mon in `player_roster` with that catalog_id, or
 *   - a catalog_id inside any of their owned mons' `evolution_history` JSON.
 *
 * Consumed by the Digdex bestiary and by the evolution gate, which must agree
 * on what the player is allowed to see — a species hidden in one and revealed
 * in the other would leak the roster's future forms.
 */
import { q } from '../db/index.js';

const SQL_SPECIES_IDS = `SELECT catalog_id FROM player_species_data WHERE user_id = ?`;
const SQL_ROSTER_ROWS = `SELECT catalog_id, evolution_history FROM player_roster WHERE user_id = ?`;

export async function computeMetSet(userId: string): Promise<Set<string>> {
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
