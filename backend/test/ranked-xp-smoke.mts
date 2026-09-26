/**
 * Ranked (PvP) end-of-battle rewards smoke test.
 *
 * Regression guard for the "ranked grants XP like PvE" change:
 *   - the WINNER's party gains XP computed from the defeated opponent's levels
 *     (xpFromDefeats, trainer multiplier), exactly like the PvE path;
 *   - the LOSER gets no monster XP (wallet rows still granted);
 *   - the returned `BattleEndRewards` payload matches what is persisted
 *     (roster xp deltas, NetCore/Bits, MMR) inside the same transaction;
 *   - per-mon xpAwards carry xpFloor/xpNext brackets for the EndCard UI.
 *
 * Run:  DATABASE=sqlite DB_PATH=/tmp/dw-ranked-xp-smoke.db npx tsx test/ranked-xp-smoke.mts
 */
import { existsSync, unlinkSync } from 'node:fs';

import { applyAction, initBattle } from '../src/battle/engine.ts';
import type { Loadout, LoadoutMember } from '../src/battle/engine.ts';
import type { Action, Battle, BattleSide } from '../src/battle/types.ts';
import type { BaseStats, Skill, Stage, TemplateDigimon } from '../src/digimon/types.ts';
import type { Element } from '@digiworld/shared/digimon';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { one, run } from '../src/db/index.ts';
import { persistAndAwardEnd } from '../src/battle/routes.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-ranked-xp-smoke.db';
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(DB + suffix)) unlinkSync(DB + suffix);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Fixtures — Rookie teams, no catalog dependency (templateInlined skills).
// ---------------------------------------------------------------------------

const SKILL_POOL: Skill[] = [
  { id: 's0', name: 'Basic', element: 'null', energyCost: 0, power: 20 },
  { id: 's1', name: 'Slash', element: 'null', energyCost: 8, power: 140 },
  { id: 's2', name: 'Ember', element: 'fire', energyCost: 12, power: 210 },
];

function tmpl(id: string, element: Element = 'fire', stage: Stage = 'Rookie'): TemplateDigimon {
  return {
    id,
    name: id,
    stage,
    attribute: 'Vaccine',
    element,
    baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
    skillPool: SKILL_POOL,
    assets: { portrait: '', dot: '' },
  };
}

function mkLoadout(playerId: string, level: number): Loadout {
  return {
    playerId,
    members: [0, 1, 2].map((i): LoadoutMember => ({
      monId: `${playerId}-mon-${i}`,
      templateId: `t-${playerId}-${i}`,
      template: tmpl(`t-${playerId}-${i}`),
      level,
      nickname: `${playerId}-${i}`,
      statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 },
    })),
  };
}

const ZERO: BaseStats = { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 };

/** Cheapest attack on the first living enemy — deterministic enough for a 8x level gap. */
function pickAction(battle: Battle, side: BattleSide): Action | null {
  const active = battle.turnQueue[battle.turnCursor];
  if (!active || active.side !== side) return null;
  const unit = battle.units.find((u) => u.id === active.unitId);
  if (!unit || unit.hp <= 0) return null;
  const enemy = battle.units.find((u) => u.side !== side && u.hp > 0);
  if (!enemy) return null;
  const basic = unit.skills.find((s) => s.energyCost === 0) ?? unit.skills[0];
  if (basic) return { type: 'skill', unitId: unit.id, skillId: basic.id, targetId: enemy.id };
  return { type: 'fight', unitId: unit.id, targetId: enemy.id };
}

async function playOut(loadA: Loadout, loadB: Loadout): Promise<Battle> {
  const battle = await initBattle({ loadoutA: loadA, loadoutB: loadB, damageRate: 1 });
  let turns = 0;
  while (battle.status !== 'ended' && turns < 300) {
    const active = battle.turnQueue[battle.turnCursor];
    if (!active) break;
    const action = pickAction(battle, active.side);
    if (!action) break;
    const r = applyAction(battle, active.side, action);
    if (!r.ok) break;
    turns += 1;
  }
  assert(battle.status === 'ended', `battle did not end (status=${battle.status})`);
  assert(battle.outcome !== null, 'battle ended without outcome');
  return battle;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const USER_A = 'usr_ranked_a';
  const USER_B = 'usr_ranked_b';
  const now = Date.now();

  await getDb();
  await run(`INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at, mmr)
             VALUES (?, ?, ?, ?, 0, ?, ?, 1000)`, [USER_A, 'ranked_a', 'Ranked A', 'x', now, now]);
  await run(`INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at, mmr)
             VALUES (?, ?, ?, ?, 0, ?, ?, 1000)`, [USER_B, 'ranked_b', 'Ranked B', 'x', now, now]);

  for (const [userId, prefix, level] of [
    [USER_A, 'a', 40],
    [USER_B, 'b', 5],
  ] as const) {
    for (let slot = 0; slot < 3; slot++) {
      await run(
        `INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, slot_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 66500, ?, ?, ?)`,
        [`mon_${prefix}_${slot}`, userId, `fake-catalog-${prefix}-${slot}`, `Mon ${prefix}${slot}`, level, slot, now, now],
      );
    }
  }

  await test('winner gains XP like PvE (xpAwards + persisted), loser gains none', async () => {
    const battle = await playOut(mkLoadout(USER_A, 40), mkLoadout(USER_B, 5));
    assert(['win_a', 'win_b'].includes(battle.outcome!), `expected a decisive win, got ${battle.outcome}`);
    const winnerIsA = battle.outcome === 'win_a';

    const beforeA = await one<{ xp: number }>(`SELECT xp FROM player_roster WHERE id = 'mon_a_0'`);
    const beforeB = await one<{ xp: number }>(`SELECT xp FROM player_roster WHERE id = 'mon_b_0'`);
    assert(beforeA?.xp === 66500 && beforeB?.xp === 66500, 'fixture xp baseline wrong');

    const end = await persistAndAwardEnd(battle);
    assert(end !== null, 'persistAndAwardEnd returned null');
    const endResult = end!;
    assert(endResult.mmr !== null, 'pvp mmr result missing');

    const winRewards = winnerIsA ? endResult.rewardsA : endResult.rewardsB;
    const lossRewards = winnerIsA ? endResult.rewardsB : endResult.rewardsA;
    const winUserId = winnerIsA ? USER_A : USER_B;
    const lossUserId = winnerIsA ? USER_B : USER_A;

    // Winner: 3 xp awards, every delta > 0, aligned with the persisted xp.
    assert(winRewards.xpAwards.length === 3, `winner should get 3 xpAwards, got ${winRewards.xpAwards.length}`);
    for (const award of winRewards.xpAwards) {
      assert(award.delta > 0, `winner xpAward delta should be > 0, got ${award.delta}`);
      assert(award.gainedLevels >= 0, 'gainedLevels can not be negative');
      assert(award.xpAfter === award.xpBefore + award.delta, 'xpAfter must equal xpBefore + delta');
      assert(award.xpFloor <= award.xpAfter && award.xpAfter <= award.xpNext, 'xpAfter outside its floor/next bracket');
    }
    const persistedWin = await one<{ xp: number }>(`SELECT xp FROM player_roster WHERE user_id = ? AND slot_index = 0`, [winUserId]);
    assert(persistedWin?.xp === 66500 + winRewards.xpAwards[0]!.delta, 'winner roster xp does not match the deltas');

    // Loser: no XP awards, roster untouched.
    assert(lossRewards.xpAwards.length === 0, 'loser must get no xpAwards');
    const persistedLoss = await one<{ xp: number }>(`SELECT xp FROM player_roster WHERE user_id = ? AND slot_index = 0`, [lossUserId]);
    assert(persistedLoss?.xp === 66500, 'loser roster xp must be untouched');

    // Wallet rows: 60/30 on win, 15/5 on loss, surfaced in the payload.
    assert(winRewards.netcoreGained === 60, `winner netcore should be 60, got ${winRewards.netcoreGained}`);
    assert(winRewards.bitsGained === 30, `winner bits should be 30, got ${winRewards.bitsGained}`);
    assert(lossRewards.netcoreGained === 15, `loser netcore should be 15, got ${lossRewards.netcoreGained}`);
    assert(lossRewards.bitsGained === 5, `loser bits should be 5, got ${lossRewards.bitsGained}`);
    const winWallet = await one<{ netcore: number }>(`SELECT netcore FROM player_wallet WHERE user_id = ?`, [winUserId]);
    const lossWallet = await one<{ netcore: number }>(`SELECT netcore FROM player_wallet WHERE user_id = ?`, [lossUserId]);
    assert(winWallet?.netcore === 60, `winner wallet netcore should be 60, got ${winWallet?.netcore}`);
    assert(lossWallet?.netcore === 15, `loser wallet netcore should be 15, got ${lossWallet?.netcore}`);

    // MMR moved toward the winner.
    const mmrWin = await one<{ mmr: number }>(`SELECT mmr FROM users WHERE id = ?`, [winUserId]);
    const mmrLoss = await one<{ mmr: number }>(`SELECT mmr FROM users WHERE id = ?`, [lossUserId]);
    assert((mmrWin?.mmr ?? 0) > 1000, `winner mmr should rise above 1000, got ${mmrWin?.mmr}`);
    assert((mmrLoss?.mmr ?? 0) < 1000, `loser mmr should drop below 1000, got ${mmrLoss?.mmr}`);

    // Match row persisted.
    const match = await one<{ winner: string | null }>(`SELECT winner FROM matches WHERE id = ?`, [battle.id]);
    assert(match?.winner === winUserId, 'matches.winner must be the winning user');
  });

  await test('draw grants no XP but wallet rows', async () => {
    // Forced draw: abandon the battle (outcome 'abandoned' => both draw).
    const battle = await initBattle({ loadoutA: mkLoadout(USER_A, 5), loadoutB: mkLoadout(USER_B, 5), damageRate: 1 });
    // Set an outcome + endedAt directly is not how the engine ends a draw; use a
    // real one: wipe both sides is not feasible, so simulate via engine.fled path
    // is also one-sided. Instead assert the guard at the unit level: no XP when
    // the side did not win.
    battle.outcome = 'draw';
    battle.status = 'ended';
    battle.endedAt = Date.now();
    // Manually damage one unit so the rewards path has something to look at.
    for (const u of battle.units) u.hp = 1;
    const endDraw = await persistAndAwardEnd(battle);
    assert(endDraw !== null, 'persistAndAwardEnd returned null');
    const drawResult = endDraw!;
    assert(drawResult.rewardsA.xpAwards.length === 0, 'draw side A must get no XP');
    assert(drawResult.rewardsB.xpAwards.length === 0, 'draw side B must get no XP');
    assert(drawResult.rewardsA.netcoreGained === 25 && drawResult.rewardsB.netcoreGained === 25, 'draws grant 25 netcore each');
    assert(drawResult.rewardsA.bitsGained === 15 && drawResult.rewardsB.bitsGained === 15, 'draws grant 15 bits each');
  });

  await closeDbAdapter();

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});