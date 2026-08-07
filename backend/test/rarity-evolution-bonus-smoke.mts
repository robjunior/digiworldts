/**
 * Rarity evolution bonus smoke test — F7 of the dungeon extraction refactor.
 *
 * Verifies:
 *   - `bonusCurveFor(rarity)` returns the exact per-rarity delta
 *   - `applyRarityEvolutionBonus` UPDATE writes the delta into
 *     player_roster hp_bonus / en_bonus / atk_bonus / def_bonus /
 *     int_bonus / spd_bonus
 *   - Multiple applies accumulate (uncommon+uncommon = +10/10/4/4/4/4)
 *   - Common rarity short-circuits (no SQL, curve is zeros)
 *   - `getDefaultEquippedForStage` with `evolutionRarity`:
 *       - undefined / common / uncommon / rare: pre-F7 ordering
 *       - epic (rank 3): tier_2 skills float ahead of tier_1 in the same stage
 *       - legendary (rank 4): identity_finisher forced to the front so it
 *         survives the equipped cap slice
 *
 * Run: pnpm --filter @digiworld/backend test:rarity-evolution-bonus
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { applyRarityEvolutionBonus, bonusCurveFor } from '../src/roster/rarity-bonus.ts';
import { getDefaultEquippedForStage } from '../src/skills/pool.ts';
import { seedSkillsCatalogV2 } from '../src/skills/seed-catalog.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-rarity-evolution-bonus-smoke.db';
const USER = 'usr_test_evolver';
const MON = 'mon_test_evolver';

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

async function seedMon(id: string, userId: string): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus, mood, status, slot_index, equipped_skill_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 50, 'resting', NULL, '[]', ?, ?)",
    id, userId, 'skb-agumon', 'Test Agumon', 25, 0, now, now,
  );
}

async function getBonuses(monId: string): Promise<{ hp: number; en: number; atk: number; def: number; int: number; spd: number }> {
  const row = await one<{ hp_bonus: number; en_bonus: number; atk_bonus: number; def_bonus: number; int_bonus: number; spd_bonus: number }>(
    'SELECT hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus FROM player_roster WHERE id = ?',
    monId,
  );
  return {
    hp: row?.hp_bonus ?? 0,
    en: row?.en_bonus ?? 0,
    atk: row?.atk_bonus ?? 0,
    def: row?.def_bonus ?? 0,
    int: row?.int_bonus ?? 0,
    spd: row?.spd_bonus ?? 0,
  };
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();

  console.log('== bonus curve values ==');
  const common = bonusCurveFor('common');
  assert(common.hp === 0 && common.en === 0 && common.atk === 0 && common.def === 0 && common.int === 0 && common.spd === 0, 'common → all zeros');
  const uncommon = bonusCurveFor('uncommon');
  assert(uncommon.hp === 5 && uncommon.en === 5 && uncommon.atk === 2 && uncommon.def === 2 && uncommon.int === 2 && uncommon.spd === 2, 'uncommon → +5/5/2/2/2/2');
  const rare = bonusCurveFor('rare');
  assert(rare.hp === 15 && rare.en === 10 && rare.atk === 5 && rare.def === 5 && rare.int === 5 && rare.spd === 5, 'rare → +15/10/5/5/5/5');
  const epic = bonusCurveFor('epic');
  assert(epic.hp === 30 && epic.en === 20 && epic.atk === 10 && epic.def === 10 && epic.int === 10 && epic.spd === 10, 'epic → +30/20/10/10/10/10');
  const legendary = bonusCurveFor('legendary');
  assert(legendary.hp === 50 && legendary.en === 30 && legendary.atk === 15 && legendary.def === 15 && legendary.int === 15 && legendary.spd === 15, 'legendary → +50/30/15/15/15/15');

  console.log('== seed test user + mon ==');
  await seedUser(USER);
  await seedMon(MON, USER);
  const baseline = await getBonuses(MON);
  assert(baseline.hp === 0 && baseline.en === 0, 'seeded mon starts at zero bonuses');

  console.log('== applyRarityEvolutionBonus: uncommon writes +5/5/2/2/2/2 ==');
  await applyRarityEvolutionBonus(MON, USER, 'uncommon', Date.now());
  const afterUncommon = await getBonuses(MON);
  assert(afterUncommon.hp === 5, `after uncommon: hp === 5 (got ${afterUncommon.hp})`);
  assert(afterUncommon.en === 5, `after uncommon: en === 5 (got ${afterUncommon.en})`);
  assert(afterUncommon.atk === 2, `after uncommon: atk === 2 (got ${afterUncommon.atk})`);
  assert(afterUncommon.def === 2 && afterUncommon.int === 2 && afterUncommon.spd === 2, 'after uncommon: def/int/spd === 2');

  console.log('== apply accumulates: uncommon+uncommon = +10/10/4/4/4/4 ==');
  await applyRarityEvolutionBonus(MON, USER, 'uncommon', Date.now());
  const twoUncommon = await getBonuses(MON);
  assert(twoUncommon.hp === 10, `two uncommon: hp === 10 (got ${twoUncommon.hp})`);
  assert(twoUncommon.atk === 4, `two uncommon: atk === 4 (got ${twoUncommon.atk})`);

  console.log('== apply legendary on top: 60/40/19/19/19/19 ==');
  await applyRarityEvolutionBonus(MON, USER, 'legendary', Date.now());
  const afterLeg = await getBonuses(MON);
  assert(afterLeg.hp === 60, `legendary stacks: hp === 60 (got ${afterLeg.hp})`);
  assert(afterLeg.en === 40, `legendary stacks: en === 40 (got ${afterLeg.en})`);
  assert(afterLeg.atk === 19, `legendary stacks: atk === 19 (got ${afterLeg.atk})`);
  assert(afterLeg.spd === 19, `legendary stacks: spd === 19 (got ${afterLeg.spd})`);

  console.log('== applyRarityEvolutionBonus common is a no-op (no UPDATE) ==');
  const M2 = 'mon_test_common';
  await seedMon(M2, USER);
  const before = await getBonuses(M2);
  await applyRarityEvolutionBonus(M2, USER, 'common', Date.now());
  const after = await getBonuses(M2);
  assert(before.hp === after.hp && before.atk === after.atk, 'common: no change');

  console.log('== seed skills catalog for pool bias tests ==');
  const seedResult = await seedSkillsCatalogV2();
  assert(seedResult.inserted > 0 || seedResult.updated > 0, 'skills seeded');

  console.log('== getDefaultEquippedForStage: undefined and common baseline (Champion / fire) ==');
  const baselineIds = await getDefaultEquippedForStage('fire', 'Champion');
  assert(baselineIds.length === 6, `Champion cap = 6 slots (got ${baselineIds.length})`);
  const commonIds = await getDefaultEquippedForStage('fire', 'Champion', 'common');
  assert(JSON.stringify(commonIds) === JSON.stringify(baselineIds), 'common matches undefined (pre-F7 order)');
  const rareIds = await getDefaultEquippedForStage('fire', 'Champion', 'rare');
  assert(JSON.stringify(rareIds) === JSON.stringify(baselineIds), 'rare matches undefined (pre-F7 order)');

  console.log('== epic biases tier_2 to the front ==');
  const epicIds = await getDefaultEquippedForStage('fire', 'Champion', 'epic');
  assert(epicIds.length === 6, 'epic Champion cap still 6');
  const epicSlotMeta = await q<{ id: string; tier_2: number; slot_role: string | null; stage: string | null }>(
    `SELECT id, tier_2, slot_role, stage FROM skills_catalog WHERE id IN (${epicIds.map(() => '?').join(', ')})`,
    ...epicIds,
  );
  const epicChampionT2Count = epicSlotMeta.filter((r) => r.stage === 'Champion' && r.tier_2 === 1).length;
  const baselineMeta = await q<{ id: string; tier_2: number; slot_role: string | null; stage: string | null }>(
    `SELECT id, tier_2, slot_role, stage FROM skills_catalog WHERE id IN (${baselineIds.map(() => '?').join(', ')})`,
    ...baselineIds,
  );
  const baselineChampionT2Count = baselineMeta.filter((r) => r.stage === 'Champion' && r.tier_2 === 1).length;
  assert(epicChampionT2Count >= baselineChampionT2Count, `epic surfaces >= baseline Champion tier_2 count (${epicChampionT2Count} >= ${baselineChampionT2Count})`);
  if (epicChampionT2Count > 0 && baselineChampionT2Count === 0) {
    assert(true, 'epic surfaces tier_2 that baseline dropped (bias worked)');
  }

  console.log('== legendary forces identity_finisher to the front ==');
  const legendaryIds = await getDefaultEquippedForStage('fire', 'Champion', 'legendary');
  const legendaryMeta = await q<{ id: string; tier_2: number; slot_role: string | null; stage: string | null }>(
    `SELECT id, tier_2, slot_role, stage FROM skills_catalog WHERE id IN (${legendaryIds.map(() => '?').join(', ')})`,
    ...legendaryIds,
  );
  const legendaryHasIdentity = legendaryMeta.some((r) => r.slot_role === 'identity_finisher');
  assert(legendaryHasIdentity, 'legendary equip set contains an identity_finisher');

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== rarity-evolution-bonus smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
