/**
 * PvE species-data reward smoke test.
 *
 * Regression guard for "PVE battles not rewarding digimon data on victory":
 * a PvE match won by the player must upsert `player_species_data` for every
 * defeated wild mon (Digidex met / hatch meter) inside the same reward tx as
 * XP/NetCore/Bits, and surface the grants as `speciesDrops` in the returned
 * `BattleEndRewards` so the EndCard can render them.
 *
 * Run:  DATABASE=sqlite DB_PATH=/tmp/dw-pve-species-data-smoke.db \
 *       npx tsx test/pve-species-data-smoke.mts
 */
import { existsSync, unlinkSync } from 'node:fs';

import { initPveBattle } from '../src/battle/engine.ts';
import type { Loadout, LoadoutMember } from '../src/battle/engine.ts';
import type { Battle, BattleSide } from '../src/battle/types.ts';
import type { BaseStats, Skill, Stage, TemplateDigimon } from '../src/digimon/types.ts';
import type { Element } from '@digiworld/shared/digimon';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { one, q, run } from '../src/db/index.ts';
import { persistAndAwardEnd } from '../src/battle/routes.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-pve-species-data-smoke.db';
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

const SKILL_POOL: Skill[] = [
  { id: 's0', name: 'Basic', element: 'null', energyCost: 0, power: 20 },
  { id: 's1', name: 'Slash', element: 'null', energyCost: 8, power: 140 },
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

const ZERO: BaseStats = { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 };

function mkPartyMember(prefix: string, i: number, level: number): LoadoutMember {
  return {
    monId: `${prefix}-mon-${i}`,
    templateId: `t-${prefix}-${i}`,
    template: tmpl(`t-${prefix}-${i}`),
    level,
    nickname: `${prefix}-${i}`,
    statBonus: { ...ZERO },
  };
}

function mkLoadout(playerId: string, level: number): Loadout {
  return { playerId, members: [0, 1, 2].map((i) => mkPartyMember(playerId, i, level)) };
}

async function main(): Promise<void> {
  const USER_A = 'usr_pve_data_a';
  const now = Date.now();

  await getDb();
  await run(`INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)`, [USER_A, 'pve_data_a', 'PvE Data A', 'x', now, now]);

  // Pre-existing partial data so the kill increments kills and the percent
  // accumulates rather than seeding from zero (proves the ON CONFLICT path).
  await run(
    `INSERT INTO player_species_data (user_id, catalog_id, percent, kills, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [USER_A, 'wild-gabumon', 12, 3, now],
  );

  await test('PvE win awards digimon data for every defeated wild mon', async () => {
    const wild: Array<{ member: LoadoutMember; wildInfo: { catalogId: string; rare: boolean } }> = [
      { member: mkPartyMember('w0', 0, 10), wildInfo: { catalogId: 'wild-agumon', rare: false } },
      { member: mkPartyMember('w1', 1, 10), wildInfo: { catalogId: 'wild-greymon', rare: true } },
      { member: mkPartyMember('w2', 2, 9), wildInfo: { catalogId: 'wild-gabumon', rare: false } },
    ];
    const battle = await initPveBattle({ playerLoadout: mkLoadout(USER_A, 12), wildParty: wild });
    // Force a clean player (side a) win: all wild mons defeated, player alive.
    for (const unit of battle.units) {
      if (unit.side !== 'a') unit.hp = 0;
    }
    battle.status = 'ended';
    battle.outcome = 'win_a';
    battle.endedAt = now;

    const end = await persistAndAwardEnd(battle);
    assert(end !== null, 'persistAndAwardEnd returned null');
    assert(end!.rewardsA.speciesDrops !== undefined, 'speciesDrops missing from rewardsA');
    const drops = end!.rewardsA.speciesDrops!;
    assert(drops.length === 3, `expected 3 species drops, got ${drops.length}: ${JSON.stringify(drops)}`);

    const byCatalog = new Map(drops.map((d) => [d.catalogId, d] as const));
    const agumon = byCatalog.get('wild-agumon');
    const greymon = byCatalog.get('wild-greymon');
    assert(agumon !== undefined, 'wild-agumon not awarded');
    assert(agumon!.kills === 1 && agumon!.percent > 0, `wild-agumon malformed: ${JSON.stringify(agumon)}`);
    assert(greymon !== undefined && greymon!.tier === 'rare', 'rare wild-greymon not tiered rare');

    const rows = await q<{ catalog_id: string; percent: number; kills: number }>(
      `SELECT catalog_id, percent, kills FROM player_species_data WHERE user_id = ?`,
      USER_A,
    );
    const persisted = new Map(rows.map((r) => [r.catalog_id, r] as const));
    assert(persisted.size === 3, `expected 3 persisted data rows, got ${persisted.size}`);

    const gabumon = persisted.get('wild-gabumon');
    assert(gabumon !== undefined, 'wild-gabumon row missing');
    assert(gabumon!.kills === 4, `wild-gabumon kills did not increment (expected 4, got ${gabumon!.kills})`);
    assert(gabumon!.percent > 12, `wild-gabumon percent did not accumulate (expected >12, got ${gabumon!.percent})`);
  });

  await test('PvE loss grants no digimon data', async () => {
    const battle = await initPveBattle({ playerLoadout: mkLoadout(USER_A, 1), wildParty: [
      { member: mkPartyMember('d0', 0, 5), wildInfo: { catalogId: 'wild-loss-mon', rare: false } },
    ] });
    for (const unit of battle.units) {
      if (unit.side === 'a') unit.hp = 0;
    }
    battle.status = 'ended';
    battle.outcome = 'win_b';
    battle.endedAt = now;

    const end = await persistAndAwardEnd(battle);
    assert(end !== null, 'persistAndAwardEnd returned null');
    assert(end!.rewardsA.speciesDrops === undefined || end!.rewardsA.speciesDrops!.length === 0,
      'loss unexpectedly granted species data');
    const row = await one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM player_species_data WHERE user_id = ? AND catalog_id = 'wild-loss-mon'`,
      USER_A,
    );
    assert(row?.n === 0, `loss persisted a species-data row for the wild mon (n=${row?.n})`);
  });

  await closeDbAdapter();

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

void main();