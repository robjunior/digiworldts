/**
 * Rarity tables — reusable weighted loot pools referenced by dungeon
 * encounters via `dungeon_encounters.rarity_table_id`. Each table declares:
 *   - `weights`: JSON map { rarity: weight } — the weighted probability of
 *     each rarity tier for one roll. Missing rarities are treated as zero
 *     weight. Weights don't need to sum to any specific value; the roller
 *     normalizes on the fly.
 *   - `pool_tag`: matched against `shop_items.drop_pool` to select the
 *     candidate SKUs for the roll (e.g. `shards`, `cyphers`, `chips`).
 *   - `min_rolls` / `max_rolls`: the roller picks a uniform int in this
 *     range for the number of items to drop.
 *
 * F6 ships 5 default tables covering the common encounter shapes; admin
 * CRUD lands with the other admin panels in F8. The rarity table roll
 * itself (defeatEncounter reading the table + dropping items) also ships
 * in a follow-up — F6 wires the schema, the pools, and the seeds so
 * downstream work can attach an encounter to a table without a further
 * migration.
 */
import { one, run, tx } from '../db/index.js';
import { log } from '../util/log.js';

const SQL_INSERT_RARITY_TABLE = `INSERT INTO dungeon_rarity_tables (id, weights, pool_tag, min_rolls, max_rolls)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`;
const SQL_GET_RARITY_TABLE = `SELECT * FROM dungeon_rarity_tables WHERE id = ?`;

export type RarityTable = {
  readonly id: string;
  readonly weights: Readonly<Record<number, number>>;
  readonly poolTag: string;
  readonly minRolls: number;
  readonly maxRolls: number;
};

type RarityTableRow = {
  readonly id: string;
  readonly weights: string;
  readonly pool_tag: string;
  readonly min_rolls: number;
  readonly max_rolls: number;
};

const DEFAULT_RARITY_TABLES: readonly RarityTable[] = [
  {
    id: 'rt_grunt_common',
    weights: { 0: 70, 1: 25, 2: 5, 3: 0, 4: 0 },
    poolTag: 'shards',
    minRolls: 1,
    maxRolls: 2,
  },
  {
    id: 'rt_boss_champion',
    weights: { 0: 30, 1: 45, 2: 20, 3: 4, 4: 1 },
    poolTag: 'shards',
    minRolls: 2,
    maxRolls: 4,
  },
  {
    id: 'rt_boss_ultimate',
    weights: { 0: 10, 1: 30, 2: 40, 3: 15, 4: 5 },
    poolTag: 'shards',
    minRolls: 3,
    maxRolls: 5,
  },
  {
    id: 'rt_boss_mega',
    weights: { 0: 5, 1: 15, 2: 35, 3: 30, 4: 15 },
    poolTag: 'cyphers',
    minRolls: 1,
    maxRolls: 2,
  },
  {
    id: 'rt_ambush_default',
    weights: { 0: 50, 1: 30, 2: 15, 3: 4, 4: 1 },
    poolTag: 'shards',
    minRolls: 1,
    maxRolls: 3,
  },
];

function parseWeightsSafe(json: string): Readonly<Record<number, number>> {
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const rank = Number.parseInt(k, 10);
      if (!Number.isFinite(rank) || rank < 0 || rank > 4) continue;
      if (typeof v !== 'number' || v <= 0 || !Number.isFinite(v)) continue;
      out[rank] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

function rowToTable(row: RarityTableRow): RarityTable {
  return {
    id: row.id,
    weights: parseWeightsSafe(row.weights),
    poolTag: row.pool_tag,
    minRolls: row.min_rolls,
    maxRolls: row.max_rolls,
  };
}

export async function seedDefaultRarityTables(): Promise<void> {
  await tx(async (t) => {
    for (const table of DEFAULT_RARITY_TABLES) {
      await t.run(SQL_INSERT_RARITY_TABLE, [
        table.id,
        JSON.stringify(table.weights),
        table.poolTag,
        table.minRolls,
        table.maxRolls,
      ]);
    }
  });
  log.info('dungeons.rarity-tables.seed.ok', { count: DEFAULT_RARITY_TABLES.length });
}

export async function getRarityTable(id: string): Promise<RarityTable | null> {
  const row = await one<RarityTableRow>(SQL_GET_RARITY_TABLE, id);
  return row ? rowToTable(row) : null;
}

export async function createRarityTable(input: RarityTable): Promise<void> {
  await run(
    SQL_INSERT_RARITY_TABLE,
    input.id,
    JSON.stringify(input.weights),
    input.poolTag,
    input.minRolls,
    input.maxRolls,
  );
}
