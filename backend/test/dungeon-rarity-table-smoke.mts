/**
 * Dungeon rarity table smoke test — F6b of the dungeon extraction refactor.
 *
 * Verifies the defeatEncounter runtime path for encounters with a rarity_table_id:
 *   - Encounter with rarity_table_id rolls the table on defeat
 *   - Roll count falls within [min_rolls, max_rolls] over many trials
 *   - Rolled item rarities respect the weights (statistical sanity check)
 *   - Rolled items all come from the table's drop_pool
 *   - Flag OFF: grants go to player_inventory (legacy path)
 *   - Flag ON: grants go to dungeon_run_stash (F3 stash redirect)
 *   - Encounter with NO rarity_table_id: no table roll happens (regression)
 *
 * Statistical assertion: over 500 defeat rolls with weights
 *   {0:70, 1:25, 2:5, 3:0, 4:0}, the observed r0 count should exceed r2 count
 *   with high confidence — we assert observedR0 > observedR2 * 3 (the
 *   expected ratio is 14, so 3 leaves a very wide margin against flakiness).
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-rarity-table
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { seedFarmRecipes } from '../src/farm/engine.ts';
import { getRarityTable, rollRarityTable, seedDefaultRarityTables } from '../src/dungeons/rarity-tables.ts';
import { defeatEncounter, startOrGetRun } from '../src/dungeons/repo.ts';
import { setFlag, clearFlag } from '../src/flags/repo.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-rarity-table-smoke.db';
const USER = 'usr_test_looter';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

async function seedUser(id: string): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, `${id}-name`, `${id}-display`, 'x', 0, now, now,
  );
}

async function seedDungeon(id: string): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, challenge_kind, challenge_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, `Dungeon ${id}`, 'seeded', 'null', 10, 10, 0, 0, 0, 0, 1, 1, 'Rookie', 1, 1, '[]', 'none', null, now, now,
  );
}

async function seedEncounter(id: string, dungeonId: string, rarityTableId: string | null): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeon_encounters (id, dungeon_id, x, y, difficulty, digimon_data, loots, rarity_table_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, dungeonId, 1, 1, 'normal',
    JSON.stringify([{ catalogId: 'test', level: 5 }]),
    '[]',
    rarityTableId,
    now, now,
  );
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();
  await seedShopItems();
  await seedFarmRecipes();
  await seedDefaultRarityTables();
  await seedUser(USER);

  console.log('== rollRarityTable roll count stays within [min, max] ==');
  const table = await getRarityTable('rt_grunt_common');
  assert(table !== null, 'rt_grunt_common loaded');
  if (table !== null) {
    let minSeen = Infinity;
    let maxSeen = -Infinity;
    for (let i = 0; i < 200; i += 1) {
      const rolls = await rollRarityTable(table);
      if (rolls.length < minSeen) minSeen = rolls.length;
      if (rolls.length > maxSeen) maxSeen = rolls.length;
    }
    assert(minSeen >= table.minRolls, `rollCount minSeen >= minRolls (${minSeen} >= ${table.minRolls})`);
    assert(maxSeen <= table.maxRolls, `rollCount maxSeen <= maxRolls (${maxSeen} <= ${table.maxRolls})`);
  }

  console.log('== rolled items all match drop_pool ==');
  if (table !== null) {
    let allInPool = true;
    let sampledAny = false;
    const allowed = new Set((await q<{ id: string }>('SELECT id FROM shop_items WHERE drop_pool = ?', table.poolTag)).map((r) => r.id));
    for (let i = 0; i < 20; i += 1) {
      const rolls = await rollRarityTable(table);
      for (const drop of rolls) {
        sampledAny = true;
        if (!allowed.has(drop.itemId)) allInPool = false;
      }
    }
    assert(sampledAny, 'at least one roll produced items');
    assert(allInPool, 'every rolled itemId is inside the drop_pool');
  }

  console.log('== weights are respected (statistical) ==');
  if (table !== null) {
    const rarityCount: Record<number, number> = {};
    for (let i = 0; i < 500; i += 1) {
      const rolls = await rollRarityTable(table);
      for (const drop of rolls) {
        const rank = Number.parseInt(drop.itemId.split('-r').pop() ?? '0', 10);
        rarityCount[rank] = (rarityCount[rank] ?? 0) + 1;
      }
    }
    const r0 = rarityCount[0] ?? 0;
    const r1 = rarityCount[1] ?? 0;
    const r2 = rarityCount[2] ?? 0;
    console.log(`     observed counts: r0=${r0}, r1=${r1}, r2=${r2}`);
    assert(r0 > r1, `r0 count > r1 count (${r0} > ${r1}) — expected weights[0]=70 dominates weights[1]=25`);
    assert(r0 > r2 * 3, `r0 count > r2 count × 3 (${r0} > ${r2 * 3}) — expected ratio ~14, slack ×3`);
  }

  console.log('== defeatEncounter: no rarity_table_id → no extra loot (regression) ==');
  const D_NO_TABLE = 'dgn_no_table';
  await seedDungeon(D_NO_TABLE);
  await seedEncounter('enc_no_table', D_NO_TABLE, null);
  await startOrGetRun(USER, D_NO_TABLE);
  await clearFlag(USER, 'dungeon-extraction');
  const noTable = await defeatEncounter(USER, D_NO_TABLE, 'enc_no_table');
  assert(noTable !== null, 'defeatEncounter returned result');
  assert((noTable?.grantedLoots.length ?? 0) === 0, 'no loots granted (empty loots + no rarity table)');

  console.log('== defeatEncounter with rarity_table_id → grants pool items ==');
  const D_TABLE = 'dgn_with_table';
  await seedDungeon(D_TABLE);
  await seedEncounter('enc_with_table', D_TABLE, 'rt_boss_ultimate');
  await startOrGetRun(USER, D_TABLE);
  const withTable = await defeatEncounter(USER, D_TABLE, 'enc_with_table');
  assert(withTable !== null, 'defeatEncounter with table returned result');
  const gotTable = withTable?.grantedLoots ?? [];
  const boss = await getRarityTable('rt_boss_ultimate');
  assert(boss !== null, 'rt_boss_ultimate loaded');
  if (boss !== null) {
    assert(gotTable.length >= boss.minRolls, `granted at least minRolls items (${gotTable.length} >= ${boss.minRolls})`);
    assert(gotTable.length <= boss.maxRolls, `granted at most maxRolls items (${gotTable.length} <= ${boss.maxRolls})`);
    const bossPool = new Set((await q<{ id: string }>('SELECT id FROM shop_items WHERE drop_pool = ?', boss.poolTag)).map((r) => r.id));
    for (const g of gotTable) assert(bossPool.has(g.itemId), `granted item ${g.itemId} is in the drop_pool`);
  }

  console.log('== flag OFF: granted loot lands in player_inventory ==');
  const inv = await q<{ item_id: string; qty: number }>('SELECT item_id, qty FROM player_inventory WHERE user_id = ?', USER);
  assert(inv.length > 0, 'player_inventory received rows on flag off');

  console.log('== flag ON: granted loot lands in dungeon_run_stash ==');
  const D_STASH = 'dgn_stash';
  await seedDungeon(D_STASH);
  await seedEncounter('enc_stash', D_STASH, 'rt_ambush_default');
  await startOrGetRun(USER, D_STASH);
  await setFlag(USER, 'dungeon-extraction');
  const stashResult = await defeatEncounter(USER, D_STASH, 'enc_stash');
  assert(stashResult !== null, 'defeat with flag on returned result');
  const stashRows = await q<{ item_id: string; qty: number }>('SELECT item_id, qty FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ?', USER, D_STASH);
  assert(stashRows.length > 0, 'stash received rolled items when flag on');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== dungeon-rarity-table smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
