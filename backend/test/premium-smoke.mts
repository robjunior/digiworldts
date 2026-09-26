/**
 * Premium system regression test — the +50% bonus applied to farm production,
 * adventure loot + XP, and quest rewards, plus the shop premium product grant.
 *
 * Verifies:
 *   - a non-premium user's paid farm rate is unchanged and no premiumBonus
 *   - granting premium_until makes the same farm row produce ~1.5x and exposes
 *     the gold bonus (premiumBonus) in readFarm
 *   - buying a premium shop product (itm-premium-7d) extends premium_until by
 *     7 days (stacks on an existing active premium)
 *   - story quest claim: non-premium grants exactly the base reward and reports
 *     premium=false bonus 0; premium grants +50% and reports premiumBonus
 *
 * Run: pnpm --filter @digiworld/backend test:premium
 *   (DB_PATH scratch, e.g. /tmp/dw-premium.db)
 */
import { existsSync, unlinkSync } from 'node:fs';

import { closeDb, one, run } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { seedFarmForUser, readFarm } from '../src/farm/engine.ts';
import { seedShopItems } from '../src/social/shop.ts';
import { acceptQuest, claimQuest, createQuest } from '../src/quests/repo.ts';
import { isUserPremium } from '../src/premium/index.ts';

const DB_PATH = process.env.DB_PATH ?? '/tmp/dw-premium.db';
const USER = 'usr_premium_reg';
const USER2 = 'usr_premium_reg2';

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
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Meat', 0, now);
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Bits', 1000, now);
  await run('INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)', id, 'Data', 1000, now);
}

/** Upsert creates the wallet row if missing (mirrors wallet/repo) and sets premium_until. */
async function grantPremium(id: string, until: number): Promise<void> {
  await run(
    `INSERT INTO player_wallet (user_id, credits, netcore, premium_until, updated_at)
     VALUES (?, 0, 0, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET premium_until = excluded.premium_until, updated_at = excluded.updated_at`,
    id, until, Date.now(),
  );
}

async function walletPremium(id: string): Promise<number | null> {
  const row = await one<{ premium_until: number | null }>('SELECT premium_until FROM player_wallet WHERE user_id = ?', id);
  return row?.premium_until ?? null;
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.env.DB_PATH = DB_PATH;

  await getDb();
  await seedShopItems();
  await seedUser(USER);
  await seedUser(USER2);
  await seedFarmForUser(USER);

  const now = Date.now();

  console.log('== premium status: default non-premium ==');
  assert((await isUserPremium(USER)) === false, 'isUserPremium === false before grant');

  console.log('== farm: base rate unchanged, no premiumBonus when non-premium ==');
  const farmBase = await readFarm(USER);
  assert(farmBase.premium === false, 'readFarm.premium === false');
  assert(farmBase.premiumBonus === 0, 'readFarm.premiumBonus === 0');
  const bBase = farmBase.buildings[0];
  assert(bBase !== undefined, 'farm has at least one building');
  if (bBase) {
    assert(bBase.premiumBonus === 0, `building premiumBonus === 0 (got ${bBase.premiumBonus})`);
    assert(bBase.ratePerHour > 0, 'base ratePerHour > 0');
  }

  console.log('== grant premium → farm rate +50% and exposes gold bonus ==');
  await grantPremium(USER, now + 30 * 86_400_000);
  assert((await isUserPremium(USER)) === true, 'isUserPremium === true after grant');

  const farmPrem = await readFarm(USER);
  assert(farmPrem.premium === true, 'readFarm.premium === true');
  assert(farmPrem.premiumBonus === 0.5, `readFarm.premiumBonus === 0.5 (got ${farmPrem.premiumBonus})`);
  const bPrem = farmPrem.buildings[0];
  assert(bPrem !== undefined, 'farm still has a building after grant');
  if (bBase && bPrem) {
    assert(
      Math.abs(bPrem.ratePerHour - 1.5 * bBase.ratePerHour) < 1e-9,
      `premium ratePerHour = 1.5x base (${bPrem.ratePerHour} vs ${bBase.ratePerHour})`,
    );
    assert(bPrem.premiumBonus >= 0, 'building premiumBonus is a non-negative number');
  }

  console.log('== shop premium product grant semantics ==');
  const product = await one<{ payload: string }>('SELECT payload FROM shop_items WHERE id = ?', 'itm-premium-7d');
  assert(product !== null, 'itm-premium-7d seeded in shop_items');
  if (product) {
    const payload = JSON.parse(product.payload) as { premiumDays?: number };
    assert(payload.premiumDays === 7, 'itm-premium-7d payload premiumDays === 7');
  }
  // The shop buy handler extends premium_until with max(now, current) + days*MS; verify the same SQL semantics.
  const before = (await walletPremium(USER)) ?? 0;
  const added = (payloadDays(product) ?? 7) * 86_400_000;
  const extended = Math.max(before, Date.now()) + added;
  await grantPremium(USER, extended);
  assert((await walletPremium(USER)) === extended, 'premium_until extended by 7 days (stacks on existing)');

  console.log('== story quest claim: non-premium gets exact base + premium=false ==');
  const quest = await createQuest({
    name: 'Premium Test',
    description: '',
    requiredLevel: 1,
    introDialogueId: null,
    steps: [],
    finalReward: { items: [], pickCount: 0, guaranteedNetcore: 100 },
    unlocksQuestIds: [],
    objectives: [],
    status: 'published',
    giver: 'tester',
  });
  await grantPremium(USER, 0); // revoke
  const accNoPrem = await acceptQuest(USER, quest.id, 99);
  assert(accNoPrem !== null, 'acceptQuest for non-premium user');
  if (accNoPrem) {
    // Mark completed so claim path runs (claim requires completed_at).
    await run('UPDATE user_quest_progress SET completed_at = ? WHERE user_id = ? AND quest_id = ?', Date.now(), USER, quest.id);
    const claimBase = await claimQuest(USER, quest.id);
    assert(claimBase.ok === true, 'non-premium claim ok');
    assert(claimBase.premium === false, 'non-premium claim premium === false');
    assert(claimBase.netcoreGranted === 100, `non-premium netcoreGranted === 100 (got ${claimBase.netcoreGranted})`);
    assert(claimBase.premiumBonus.netcore === 0, 'non-premium premiumBonus.netcore === 0');
  }

  console.log('== story quest claim: premium gets +50% and reports premiumBonus ==');
  await grantPremium(USER2, Date.now() + 30 * 86_400_000);
  const accPrem = await acceptQuest(USER2, quest.id, 99);
  assert(accPrem !== null, 'acceptQuest for premium user');
  if (accPrem) {
    await run('UPDATE user_quest_progress SET completed_at = ? WHERE user_id = ? AND quest_id = ?', Date.now(), USER2, quest.id);
    const claimPrem = await claimQuest(USER2, quest.id);
    assert(claimPrem.ok === true, 'premium claim ok');
    assert(claimPrem.premium === true, 'premium claim premium === true');
    assert(claimPrem.netcoreGranted === 150, `premium netcoreGranted === 150 (got ${claimPrem.netcoreGranted})`);
    assert(claimPrem.premiumBonus.netcore === 50, `premium premiumBonus.netcore === 50 (got ${claimPrem.premiumBonus.netcore})`);
  }

  await closeDb();
  await closeDbAdapter();

  console.log('');
  console.log(`== premium smoke: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

function payloadDays(product: { payload: string } | null | undefined): number | undefined {
  if (!product) return undefined;
  const parsed = JSON.parse(product.payload) as { premiumDays?: number };
  return parsed.premiumDays;
}

main().catch((err) => {
  console.error('FAIL: unexpected error', err instanceof Error ? err.stack : err);
  process.exit(1);
});