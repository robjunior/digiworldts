/**
 * Evolution item-requirement smoke test — the runtime half of the
 * `<evolve requiredItemId="…" requiredItemQty="…"/>` catalog contract.
 *
 * Covers the paths the admin editor + XML schema exercise but existing tests
 * do not:
 *   - `missing-item` reason surfaces with correct `itemQtyAvailable`;
 *   - gate priority — `attribute-mismatch` wins over `missing-item`;
 *   - `evolveRoster` refuses when the balance is short;
 *   - `evolveRoster` consumes EXACTLY `requiredItemQty` in the same tx as the
 *     catalog swap (proves inventory is not double-decremented, not silently
 *     zeroed);
 *   - a second evolve on the swapped mon fails cleanly (no runaway spend);
 *   - a non-item edge (`requiredItemId` unset) is BLOCKED with reason
 *     `no-item-assigned` — every evolution path requires a chosen item
 *     (content-gating), so it neither reads nor writes the inventory.
 *
 * The catalog is written to a real file via `saveCatalog` and read back via
 * `loadCatalog` so the XML round-trip layer is exercised too — the same code
 * path production uses on every startup.
 *
 * Run: pnpm --filter @digiworld/backend test:evolve-item
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { saveCatalog } from '../src/digimon/xml.ts';
import type { Catalog, TemplateDigimon } from '../src/digimon/types.ts';
import { getEvolutionOptions, evolveRoster } from '../src/roster/evolve.ts';
import { grantItem, countItem } from '../src/items/grant.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-evolve-item-smoke.db';
const CATALOG = process.env.CATALOG_XML ?? '/tmp/dw-evolve-item-smoke-catalog.xml';
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(DB + suffix)) unlinkSync(DB + suffix);
}
if (existsSync(CATALOG)) unlinkSync(CATALOG);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Fixture: 3 templates.
//   rookie → champ           (Vaccine → Vaccine, requiredItem qty 2)
//   rookie → champ-virus     (Vaccine → Virus,   requiredItem qty 1)   -- attribute-mismatch
//   rookie → champ-freebie   (Vaccine → Vaccine, no item required)     -- pair-invariant probe
// ---------------------------------------------------------------------------
const USER_A = 'usr_evo_a';
const USER_B = 'usr_evo_b';
const MON_A = 'mon_evo_a';
const MON_B = 'mon_evo_b';
const STONE = 'itm-evo-stone';

const rookie: TemplateDigimon = {
  id: 'mon-rookie',
  name: 'TestRookie',
  stage: 'Rookie',
  attribute: 'Vaccine',
  element: 'fire',
  baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
  skillPool: [{ id: 's0', name: 'Basic Attack', element: 'fire', energyCost: 0, power: 120 }],
  assets: { portrait: '/test/rookie/portrait.webp', dot: '/test/rookie/dot.gif' },
  evolvesInto: [
    { targetId: 'mon-champ', requiredItemId: STONE, requiredItemQty: 2 },
    { targetId: 'mon-champ-virus', requiredAttribute: 'Virus', requiredItemId: STONE, requiredItemQty: 1 },
    { targetId: 'mon-champ-freebie' },
  ],
};
const champ: TemplateDigimon = {
  id: 'mon-champ',
  name: 'TestChamp',
  stage: 'Champion',
  attribute: 'Vaccine',
  element: 'fire',
  baseStats: { hp: 900, en: 40, atk: 160, def: 120, int: 130, spd: 140 },
  skillPool: [{ id: 's0', name: 'Fire Blast', element: 'fire', energyCost: 10, power: 200 }],
  assets: { portrait: '/test/champ/portrait.webp', dot: '/test/champ/dot.gif' },
};
const champVirus: TemplateDigimon = {
  id: 'mon-champ-virus',
  name: 'TestChampVirus',
  stage: 'Champion',
  attribute: 'Virus',
  element: 'fire',
  baseStats: { hp: 900, en: 40, atk: 160, def: 120, int: 130, spd: 140 },
  skillPool: [{ id: 's0', name: 'Virus Wave', element: 'dark', energyCost: 10, power: 200 }],
  assets: { portrait: '/test/champv/portrait.webp', dot: '/test/champv/dot.gif' },
};
const champFreebie: TemplateDigimon = {
  id: 'mon-champ-freebie',
  name: 'TestChampFreebie',
  stage: 'Champion',
  attribute: 'Vaccine',
  element: 'fire',
  baseStats: { hp: 900, en: 40, atk: 160, def: 120, int: 130, spd: 140 },
  skillPool: [{ id: 's0', name: 'Solar Flare', element: 'fire', energyCost: 10, power: 200 }],
  assets: { portrait: '/test/champf/portrait.webp', dot: '/test/champf/dot.gif' },
};

const catalog: Catalog = {
  version: '1',
  updatedAt: Date.now(),
  digimons: [rookie, champ, champVirus, champFreebie],
};
saveCatalog(catalog);

await getDb();

const now = Date.now();
// Users
for (const id of [USER_A, USER_B]) {
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, id, id, 'x', 0, now, now],
  );
}
// Shop item
await run(
  'INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  [STONE, 'Evolution Stone', 'Consumed to force an evolution', 0, 'quest', 'item', '{}', 1, now],
);

// Rosters — level 25, mood 50 clears the Champion level (20) + mood (40) gates.
// Nickname matches the template name so we can exercise the "template-named
// mon gets renamed on evolve" branch inside evolveRoster.
async function seedMon(monId: string, userId: string): Promise<void> {
  await run(
    'INSERT INTO player_roster (id, user_id, catalog_id, nickname, level, xp, hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus, mood, status, slot_index, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [monId, userId, 'mon-rookie', 'TestRookie', 25, 500, 0, 0, 0, 0, 0, 0, 50, 'resting', null, now, now],
  );
}
await seedMon(MON_A, USER_A);
await seedMon(MON_B, USER_B);

// ---------------------------------------------------------------------------
// Read paths — `getEvolutionOptions` surfaces the correct reason.
// ---------------------------------------------------------------------------

await test('with zero items, the item-gated option carries reason=missing-item and itemQtyAvailable=0', async () => {
  const gate = await getEvolutionOptions(MON_A, USER_A);
  assert(gate !== null, 'expected gate for the seeded rookie');
  const opt = gate!.options.find((o) => o.catalogId === 'mon-champ');
  assert(opt !== undefined, 'expected an option for mon-champ');
  assert(opt!.eligible === false, 'expected the option to be ineligible');
  assert(opt!.reason === 'missing-item', `expected reason=missing-item, got ${opt!.reason}`);
  assert(opt!.requiredItemId === STONE, `expected requiredItemId=${STONE}, got ${opt!.requiredItemId}`);
  assert(opt!.requiredItemName === 'Evolution Stone', `expected the shop_items.name to surface, got ${opt!.requiredItemName}`);
  assert(opt!.requiredItemQty === 2, `expected requiredItemQty=2, got ${opt!.requiredItemQty}`);
  assert(opt!.itemQtyAvailable === 0, `expected itemQtyAvailable=0, got ${opt!.itemQtyAvailable}`);
});

await test('gate priority: attribute-mismatch beats missing-item when both would apply', async () => {
  const gate = await getEvolutionOptions(MON_A, USER_A);
  const opt = gate!.options.find((o) => o.catalogId === 'mon-champ-virus');
  assert(opt !== undefined, 'expected an option for mon-champ-virus');
  assert(opt!.eligible === false, 'expected ineligible');
  assert(
    opt!.reason === 'attribute-mismatch',
    `attribute check must run before item check — got reason=${opt!.reason}`,
  );
});

await test('a no-item edge is blocked with reason=no-item-assigned (content-gating: every evolution needs a chosen item)', async () => {
  const gate = await getEvolutionOptions(MON_A, USER_A);
  const opt = gate!.options.find((o) => o.catalogId === 'mon-champ-freebie');
  assert(opt !== undefined, 'expected an option for mon-champ-freebie');
  assert(opt!.eligible === false, `expected the no-item edge to be blocked, got reason=${opt!.reason}`);
  assert(opt!.reason === 'no-item-assigned', `expected reason=no-item-assigned, got ${opt!.reason}`);
  assert(opt!.requiredItemId === null, 'expected requiredItemId=null on the no-item edge');
  assert(opt!.requiredItemQty === 0, 'expected requiredItemQty=0 when no item is required');
});

await test('evolveRoster refuses with error=missing-item when the balance is short', async () => {
  const outcome = await evolveRoster(MON_A, USER_A, 'mon-champ');
  assert(outcome.ok === false, 'expected the evolve to be refused');
  assert(!outcome.ok && outcome.error === 'missing-item', `expected error=missing-item, got ${!outcome.ok ? outcome.error : ''}`);
  const balance = await countItem(USER_A, STONE);
  assert(balance === 0, `refused evolve must not touch inventory — balance is ${balance}`);
});

await test('a partial balance (1 of 2) still surfaces missing-item and blocks evolveRoster', async () => {
  await grantItem(USER_A, STONE, 1);
  const gate = await getEvolutionOptions(MON_A, USER_A);
  const opt = gate!.options.find((o) => o.catalogId === 'mon-champ');
  assert(opt!.reason === 'missing-item', `expected reason=missing-item at qty 1/2, got ${opt!.reason}`);
  assert(opt!.itemQtyAvailable === 1, `expected itemQtyAvailable=1, got ${opt!.itemQtyAvailable}`);
  const outcome = await evolveRoster(MON_A, USER_A, 'mon-champ');
  assert(outcome.ok === false, 'expected the evolve to still be refused at 1/2');
  assert((await countItem(USER_A, STONE)) === 1, 'partial balance leaked from a refused evolve');
});

// ---------------------------------------------------------------------------
// Write path — the consumption happens INSIDE the swap tx.
// ---------------------------------------------------------------------------

await test('meeting the requirement flips eligible=true and clears the reason', async () => {
  await grantItem(USER_A, STONE, 1); // 1 + 1 = 2 == requiredItemQty
  const gate = await getEvolutionOptions(MON_A, USER_A);
  const opt = gate!.options.find((o) => o.catalogId === 'mon-champ');
  assert(opt!.eligible === true, `expected eligible=true at qty 2/2, got reason=${opt!.reason}`);
  assert(opt!.reason === undefined, 'expected no reason on an eligible option');
  assert(opt!.itemQtyAvailable === 2, `expected itemQtyAvailable=2, got ${opt!.itemQtyAvailable}`);
});

await test('evolveRoster consumes EXACTLY requiredItemQty, swaps catalog_id, resets xp', async () => {
  const before = await countItem(USER_A, STONE);
  assert(before === 2, `precondition: expected 2 stones, got ${before}`);
  const outcome = await evolveRoster(MON_A, USER_A, 'mon-champ');
  assert(outcome.ok === true, `expected the evolve to succeed, got error=${!outcome.ok ? outcome.error : ''}`);
  const after = await countItem(USER_A, STONE);
  assert(after === 0, `expected balance 0 after consuming 2, got ${after}`);

  const row = await one<{ catalog_id: string; xp: number; nickname: string }>(
    'SELECT catalog_id, xp, nickname FROM player_roster WHERE id = ? AND user_id = ?',
    MON_A, USER_A,
  );
  assert(row !== null && row.catalog_id === 'mon-champ', `expected catalog_id=mon-champ, got ${row?.catalog_id}`);
  assert(row!.xp === 0, `evolve must reset xp — got xp=${row!.xp}`);
  // Nickname was the rookie's template name, so it renames to the champ's.
  assert(row!.nickname === 'TestChamp', `nickname must follow the template rename, got ${row!.nickname}`);
});

await test('a second evolveRoster on the swapped mon fails cleanly (no runaway spend)', async () => {
  await grantItem(USER_A, STONE, 5); // top up
  const outcome = await evolveRoster(MON_A, USER_A, 'mon-champ');
  assert(outcome.ok === false, 'expected the second evolve to be refused — the mon is no longer a rookie');
  // The champ has no evolvesInto in the fixture, so options=[] ⇒ 'invalid target'.
  assert((await countItem(USER_A, STONE)) === 5, 'refused evolve must not touch the inventory top-up');
});

// ---------------------------------------------------------------------------
// Cross-user isolation & no-item consumption invariant.
// ---------------------------------------------------------------------------

await test("a blocked (no-item-assigned) edge refuses evolveRoster and does not touch a user's inventory", async () => {
  await grantItem(USER_B, STONE, 5);
  const outcome = await evolveRoster(MON_B, USER_B, 'mon-champ-freebie');
  assert(outcome.ok === false, `expected the freebie evolve to be refused (no item assigned), got ${outcome.ok ? 'ok' : ''}`);
  assert(!outcome.ok && outcome.error === 'no-item-assigned', `expected error=no-item-assigned, got ${!outcome.ok ? outcome.error : ''}`);
  const balance = await countItem(USER_B, STONE);
  assert(balance === 5, `blocked edge must not consume inventory — balance is ${balance}`);
});

process.stdout.write(`evolve item tests: ${passed} passed, ${failed} failed\n`);
closeDb();
await closeDbAdapter();
if (existsSync(CATALOG)) unlinkSync(CATALOG);
process.exit(failed === 0 ? 0 : 1);
