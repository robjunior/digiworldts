/**
 * Dungeon challenge smoke test — F4 of the dungeon extraction refactor.
 *
 * Locks in:
 *   - migration 058 records challenge_kind + challenge_config + challenge_progress
 *   - evaluateChallenge verdicts for each kind (none, boss_defeated,
 *     all_encounters_defeated, reach_tile, collect_item, survive_waves)
 *   - flag OFF: challenge does NOT auto-extract on defeatEncounter
 *   - flag ON: challenge cleared triggers extractRun('challenge_win')
 *     (state='cleared_challenge')
 *   - defeatEncounter response carries challengeCleared: true on success
 *
 * Run: pnpm --filter @digiworld/backend test:dungeon-challenge
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import {
  defeatEncounter,
  serializeChallenge,
  startOrGetRun,
} from '../src/dungeons/repo.ts';
import { evaluateChallenge } from '../src/dungeons/challenge.ts';
import { setFlag, clearFlag } from '../src/flags/repo.ts';
import type { ChallengeConfig } from '@digiworld/shared';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-dungeon-challenge-smoke.db';
const USER = 'usr_test_challenger';

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

async function seedDungeon(id: string, challenge: ChallengeConfig): Promise<void> {
  const { kind, configJson } = serializeChallenge(challenge);
  const now = Date.now();
  await run(
    'INSERT INTO dungeons (id, name, description, biome, width, height, spawn_x, spawn_y, random_encounters_enabled, random_encounter_rate, random_min_level, random_max_level, random_max_stage, random_min_party_size, random_max_party_size, random_allowed_elements, challenge_kind, challenge_config, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, `Dungeon ${id}`, 'seeded', 'null', 10, 10, 0, 0, 0, 0, 1, 1, 'Rookie', 3, 3, '[]', kind, configJson, now, now,
  );
}

async function seedEncounter(id: string, dungeonId: string, x: number, y: number, loots: unknown[]): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO dungeon_encounters (id, dungeon_id, x, y, difficulty, digimon_data, loots, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, dungeonId, x, y, 'boss',
    JSON.stringify([{ catalogId: 'test', level: 5 }]),
    JSON.stringify(loots),
    now, now,
  );
}

async function seedItem(id: string, name: string): Promise<void> {
  const now = Date.now();
  await run(
    "INSERT INTO shop_items (id, name, description, price_credits, price, currency, shop_category, featured, quick_offer, one_time, sort_order, kind, class, payload, enabled, is_quest_item, rarity, item_type, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id, name, 'seeded', 10, 10, 'credits', 'misc', 0, 0, 0, 0, 'consumable', 'item', '{}', 1, 0, 0, 'consumable', now,
  );
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();

  console.log('== migration ledger ==');
  const row = await one<{ version: string }>('SELECT version FROM schema_versions WHERE version = ?', '058_dungeons_challenge');
  assert(row !== null, 'migration 058_dungeons_challenge recorded');

  console.log('== new columns exist ==');
  const dCols = await q<{ name: string }>('PRAGMA table_info(dungeons)');
  const dNames = new Set(dCols.map((c) => c.name));
  assert(dNames.has('challenge_kind'), 'dungeons.challenge_kind exists');
  assert(dNames.has('challenge_config'), 'dungeons.challenge_config exists');
  const rCols = await q<{ name: string }>('PRAGMA table_info(user_dungeon_runs)');
  assert(rCols.some((c) => c.name === 'challenge_progress'), 'user_dungeon_runs.challenge_progress exists');

  console.log('== seed ==');
  await seedUser(USER);
  await seedItem('itm-loot', 'Test Loot');
  await seedItem('itm-key', 'Test Collectible');

  console.log('== evaluateChallenge: none ==');
  const D_NONE = 'dgn_none';
  await seedDungeon(D_NONE, { kind: 'none' });
  const noneView = await startOrGetRun(USER, D_NONE);
  assert(noneView !== null, 'run created for none dungeon');
  {
    const { getDungeon } = await import('../src/dungeons/repo.ts');
    const dungeon = await getDungeon(D_NONE);
    assert(dungeon?.challenge.kind === 'none', 'challenge round-trips as none');
    const verdict = await evaluateChallenge(dungeon!, noneView!.run);
    assert(verdict === 'no-op', 'evaluateChallenge(none) === no-op');
  }

  console.log('== evaluateChallenge: boss_defeated ==');
  const D_BOSS = 'dgn_boss';
  await seedDungeon(D_BOSS, { kind: 'boss_defeated', bossEncounterId: 'enc_boss_a' });
  await seedEncounter('enc_boss_a', D_BOSS, 1, 1, [{ itemId: 'itm-loot', qty: 1, chance: 1 }]);
  const bossView = await startOrGetRun(USER, D_BOSS);
  {
    const { getDungeon } = await import('../src/dungeons/repo.ts');
    const dungeon = await getDungeon(D_BOSS);
    assert(dungeon?.challenge.kind === 'boss_defeated', 'challenge round-trips as boss_defeated');
    if (dungeon?.challenge.kind === 'boss_defeated') {
      assert(dungeon.challenge.bossEncounterId === 'enc_boss_a', 'bossEncounterId preserved');
    }
    const before = await evaluateChallenge(dungeon!, bossView!.run);
    assert(before === 'in-progress', 'boss not yet defeated → in-progress');
  }

  console.log('== flag OFF: boss defeat does NOT auto-extract ==');
  await clearFlag(USER, 'dungeon-challenge');
  const legacyDefeat = await defeatEncounter(USER, D_BOSS, 'enc_boss_a');
  assert(legacyDefeat !== null, 'defeatEncounter returned result');
  assert(legacyDefeat?.run.state === 'active', 'flag off: run stays active after boss defeat');
  assert(!('challengeCleared' in (legacyDefeat as object)) || legacyDefeat?.challengeCleared !== true, 'flag off: challengeCleared not set');

  console.log('== flag ON: boss defeat auto-extracts ==');
  const D_BOSS2 = 'dgn_boss2';
  await seedDungeon(D_BOSS2, { kind: 'boss_defeated', bossEncounterId: 'enc_boss_b' });
  await seedEncounter('enc_boss_b', D_BOSS2, 1, 1, [{ itemId: 'itm-loot', qty: 1, chance: 1 }]);
  await startOrGetRun(USER, D_BOSS2);
  await setFlag(USER, 'dungeon-challenge');
  const activeDefeat = await defeatEncounter(USER, D_BOSS2, 'enc_boss_b');
  assert(activeDefeat !== null, 'defeatEncounter returned result');
  assert(activeDefeat?.run.state === 'cleared_challenge', 'flag on: run.state === cleared_challenge');
  assert(activeDefeat?.challengeCleared === true, 'flag on: challengeCleared === true');
  const bossStash = await one<{ n: number }>('SELECT COUNT(*) AS n FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ?', USER, D_BOSS2);
  assert(bossStash?.n === 0, 'flag on: stash cleared on auto-extract');

  console.log('== evaluateChallenge: all_encounters_defeated ==');
  const D_ALL = 'dgn_all_enc';
  await seedDungeon(D_ALL, { kind: 'all_encounters_defeated' });
  await seedEncounter('enc_all_a', D_ALL, 1, 1, []);
  await seedEncounter('enc_all_b', D_ALL, 2, 2, []);
  const allView = await startOrGetRun(USER, D_ALL);
  {
    const { getDungeon } = await import('../src/dungeons/repo.ts');
    const dungeon = await getDungeon(D_ALL);
    const before = await evaluateChallenge(dungeon!, allView!.run);
    assert(before === 'in-progress', 'all_enc: none defeated → in-progress');
  }
  const firstAll = await defeatEncounter(USER, D_ALL, 'enc_all_a');
  assert(firstAll?.run.state === 'active', 'all_enc: 1/2 defeated → still active');
  const secondAll = await defeatEncounter(USER, D_ALL, 'enc_all_b');
  assert(secondAll?.run.state === 'cleared_challenge', 'all_enc: 2/2 defeated → cleared_challenge');

  console.log('== evaluateChallenge: reach_tile (direct evaluation) ==');
  const D_REACH = 'dgn_reach';
  await seedDungeon(D_REACH, { kind: 'reach_tile', targetX: 5, targetY: 5 });
  await startOrGetRun(USER, D_REACH);
  {
    const { getDungeon } = await import('../src/dungeons/repo.ts');
    const dungeon = await getDungeon(D_REACH);
    const runAt00 = { userId: USER, dungeonId: D_REACH, currentX: 0, currentY: 0 } as unknown as import('@digiworld/shared').UserDungeonRun;
    assert((await evaluateChallenge(dungeon!, runAt00)) === 'in-progress', 'reach_tile: (0,0) → in-progress');
    const runAt55 = { userId: USER, dungeonId: D_REACH, currentX: 5, currentY: 5 } as unknown as import('@digiworld/shared').UserDungeonRun;
    assert((await evaluateChallenge(dungeon!, runAt55)) === 'cleared', 'reach_tile: (5,5) → cleared');
  }

  console.log('== evaluateChallenge: collect_item ==');
  const D_COL = 'dgn_collect';
  await seedDungeon(D_COL, { kind: 'collect_item', itemId: 'itm-key', qty: 3 });
  await startOrGetRun(USER, D_COL);
  {
    const { getDungeon } = await import('../src/dungeons/repo.ts');
    const dungeon = await getDungeon(D_COL);
    const before = await one<{ qty: number }>('SELECT qty FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ? AND item_id = ?', USER, D_COL, 'itm-key');
    assert(before === null, 'no stash rows before seeding');

    const now = Date.now();
    await run(
      "INSERT INTO dungeon_run_stash (user_id, dungeon_id, item_id, qty, origin, updated_at) VALUES (?, ?, ?, 2, 'loot', ?)",
      USER, D_COL, 'itm-key', now,
    );
    const runShort = { userId: USER, dungeonId: D_COL, currentX: 0, currentY: 0, defeatedEncounters: [] } as unknown as import('@digiworld/shared').UserDungeonRun;
    const shortVerdict = await evaluateChallenge(dungeon!, runShort);
    assert(shortVerdict === 'in-progress', 'collect_item: 2/3 → in-progress');

    await run(
      "UPDATE dungeon_run_stash SET qty = qty + 1 WHERE user_id = ? AND dungeon_id = ? AND item_id = ?",
      USER, D_COL, 'itm-key',
    );
    const okVerdict = await evaluateChallenge(dungeon!, runShort);
    assert(okVerdict === 'cleared', 'collect_item: 3/3 → cleared');
  }

  console.log('== evaluateChallenge: survive_waves ==');
  const D_WAVE = 'dgn_waves';
  await seedDungeon(D_WAVE, { kind: 'survive_waves', waveCount: 3 });
  await startOrGetRun(USER, D_WAVE);
  {
    const { getDungeon } = await import('../src/dungeons/repo.ts');
    const dungeon = await getDungeon(D_WAVE);
    const runProgress0 = { userId: USER, dungeonId: D_WAVE, challengeProgress: null } as unknown as import('@digiworld/shared').UserDungeonRun;
    assert((await evaluateChallenge(dungeon!, runProgress0)) === 'in-progress', 'survive_waves: no progress → in-progress');
    const runProgress2 = { userId: USER, dungeonId: D_WAVE, challengeProgress: { wavesCleared: 2 } } as unknown as import('@digiworld/shared').UserDungeonRun;
    assert((await evaluateChallenge(dungeon!, runProgress2)) === 'in-progress', 'survive_waves: 2/3 → in-progress');
    const runProgress3 = { userId: USER, dungeonId: D_WAVE, challengeProgress: { wavesCleared: 3 } } as unknown as import('@digiworld/shared').UserDungeonRun;
    assert((await evaluateChallenge(dungeon!, runProgress3)) === 'cleared', 'survive_waves: 3/3 → cleared');
  }

  console.log('== challenge round-trips through create + update ==');
  const D_UPDATE = 'dgn_update';
  await seedDungeon(D_UPDATE, { kind: 'reach_tile', targetX: 9, targetY: 9 });
  {
    const { getDungeon } = await import('../src/dungeons/repo.ts');
    const dungeon = await getDungeon(D_UPDATE);
    if (dungeon?.challenge.kind === 'reach_tile') {
      assert(dungeon.challenge.targetX === 9, 'reach_tile.targetX preserved');
      assert(dungeon.challenge.targetY === 9, 'reach_tile.targetY preserved');
    } else {
      assert(false, 'expected reach_tile challenge');
    }
  }

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== dungeon-challenge smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});
