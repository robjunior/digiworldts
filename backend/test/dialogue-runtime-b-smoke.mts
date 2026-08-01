/**
 * Dialogue runtime Option B smoke — new actions, predicates, and facts.
 *
 * Covers the runtime expansion added in this pass:
 *
 * Actions: add_ntc, add_xp, teleport, unlock_area
 * Predicates: has_ntc, has_credits, party_has_element
 * Facts: ntc, credits, party_lead_element (injected into buildContext)
 *
 * Runs each against a real SQLite DB with fixture user/party/wallet rows, then
 * checks the DB actually mutated (wallet.netcore incremented, world_position
 * upserted, user_flags contains area.unlocked.*, player_roster.xp bumped for
 * party mons).
 *
 * Also verifies the simulator's Option B mirror in simulate.ts — same
 * predicates/actions evaluate identically in dry-run mode.
 *
 * Run: pnpm --filter @digiworld/backend test:dialogue-runtime-b
 */
import { existsSync, unlinkSync } from 'node:fs';

import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { closeDb, one, run } from '../src/db/index.ts';
import {
  applyEntryActions,
  evaluateCondition,
  isKnownAction,
  isKnownPredicate,
  parseAndValidate,
  type DialogueRuntimeContext,
} from '../src/dialogues/runtime.ts';
import { simulate } from '../src/dialogues/simulate.ts';
import { saveDialogue } from '../src/dialogues/repo.ts';
import { getBalances } from '../src/wallet/repo.ts';
import { hasFlag } from '../src/flags/repo.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-dlg-b.db';
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(DB + suffix)) unlinkSync(DB + suffix);
}

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

await getDb();

const USER = 'usr_dlg_b';
const now = Date.now();

await run(
  `INSERT INTO users (id, username, display_name, password_hash, is_admin, disabled, created_at, updated_at)
   VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
  [USER, 'dlg_b_user', 'Runtime B Tester', 'stub', now, now],
);

await run(
  `INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at)
   VALUES (?, 50, 25, 0, ?)`,
  [USER, now],
);

await run(
  `INSERT INTO world_position (user_id, world_seed, x, y, steps_taken, last_move_at, updated_at)
   VALUES (?, 42, 0, 0, 0, ?, ?)`,
  [USER, now, now],
);

const CATALOG_ID = 'skb-50';
await run(
  `INSERT INTO player_roster
    (id, user_id, catalog_id, nickname, level, xp,
     hp_bonus, en_bonus, atk_bonus, def_bonus, int_bonus, spd_bonus,
     mood, status, slot_index, equipped_skill_ids, created_at, updated_at)
   VALUES (?, ?, ?, 'Fireheart', 5, 0, 0, 0, 0, 0, 0, 0, 50, 'party', 0, '[]', ?, ?)`,
  ['mon_dlg_b_1', USER, CATALOG_ID, now, now],
);

const ctx = (dialogueId: string): DialogueRuntimeContext => ({
  userId: USER,
  dialogueId,
  facts: { level: 5, ntc: 25, credits: 50, party_lead_element: 'fire' },
  variables: { player_name: 'Runtime B Tester' },
});

await test('all new predicates + actions are known', async () => {
  for (const name of ['has_ntc', 'has_credits', 'party_has_element']) {
    assert(isKnownPredicate(name), `predicate ${name} not registered`);
  }
  for (const name of ['add_ntc', 'add_xp', 'teleport', 'unlock_area']) {
    assert(isKnownAction(name), `action ${name} not registered`);
  }
});

await test('add_ntc bumps wallet.netcore', async () => {
  const source = `:: StoryTitle\nAdd ntc\n\n:: start [start]\n@do add_ntc(100)\n\nGranted.\n\n* [[End->END]] #end\n`;
  const parsed = parseAndValidate(source, 'add-ntc-fixture');
  assert(parsed.definition !== null, `parse failed: ${JSON.stringify(parsed.errors)}`);
  await saveDialogue({ definition: parsed.definition!, sourceTwee: source, sourcePath: null });
  const before = await getBalances(USER);
  await applyEntryActions(parsed.definition!.nodes['start']!, ctx('add-ntc-fixture'));
  const after = await getBalances(USER);
  assert(after.netcore === before.netcore + 100, `expected netcore ${before.netcore + 100}, got ${after.netcore}`);
});

await test('add_ntc is idempotent via action ledger', async () => {
  const parsed = parseAndValidate(
    `:: StoryTitle\nAdd ntc idempotent\n\n:: start [start]\n@do add_ntc(50)\n\nGranted.\n\n* [[End->END]] #end\n`,
    'add-ntc-idem',
  );
  await saveDialogue({ definition: parsed.definition!, sourceTwee: 'x', sourcePath: null });
  const before = await getBalances(USER);
  await applyEntryActions(parsed.definition!.nodes['start']!, ctx('add-ntc-idem'));
  const midway = await getBalances(USER);
  await applyEntryActions(parsed.definition!.nodes['start']!, ctx('add-ntc-idem'));
  const after = await getBalances(USER);
  assert(midway.netcore === before.netcore + 50, `first application should add 50, got ${midway.netcore - before.netcore}`);
  assert(after.netcore === midway.netcore, `re-application must NOT grant again, got ${after.netcore - midway.netcore}`);
});

await test('add_xp bumps party mons xp column', async () => {
  const parsed = parseAndValidate(
    `:: StoryTitle\nAdd xp\n\n:: start [start]\n@do add_xp(120)\n\nGranted.\n\n* [[End->END]] #end\n`,
    'add-xp-fixture',
  );
  await saveDialogue({ definition: parsed.definition!, sourceTwee: 'x', sourcePath: null });
  const before = await one<{ xp: number }>(`SELECT xp FROM player_roster WHERE id = ?`, 'mon_dlg_b_1');
  await applyEntryActions(parsed.definition!.nodes['start']!, ctx('add-xp-fixture'));
  const after = await one<{ xp: number }>(`SELECT xp FROM player_roster WHERE id = ?`, 'mon_dlg_b_1');
  assert(after !== null && before !== null && after.xp === before.xp + 120, `expected xp ${(before?.xp ?? -1) + 120}, got ${after?.xp}`);
});

await test('teleport upserts world_position x/y and preserves seed', async () => {
  const parsed = parseAndValidate(
    `:: StoryTitle\nTeleport\n\n:: start [start]\n@do teleport(7, 12)\n\nMoved.\n\n* [[End->END]] #end\n`,
    'teleport-fixture',
  );
  await saveDialogue({ definition: parsed.definition!, sourceTwee: 'x', sourcePath: null });
  await applyEntryActions(parsed.definition!.nodes['start']!, ctx('teleport-fixture'));
  const pos = await one<{ x: number; y: number; world_seed: number }>(
    `SELECT x, y, world_seed FROM world_position WHERE user_id = ?`,
    USER,
  );
  assert(pos !== null && pos.x === 7 && pos.y === 12, `expected (7,12), got ${JSON.stringify(pos)}`);
  assert(pos.world_seed === 42, `expected seed preserved (42), got ${pos.world_seed}`);
});

await test('unlock_area sets area.unlocked.<id> flag', async () => {
  const parsed = parseAndValidate(
    `:: StoryTitle\nUnlock area\n\n:: start [start]\n@do unlock_area("shrine_of_embers")\n\nOpen.\n\n* [[End->END]] #end\n`,
    'unlock-area-fixture',
  );
  await saveDialogue({ definition: parsed.definition!, sourceTwee: 'x', sourcePath: null });
  await applyEntryActions(parsed.definition!.nodes['start']!, ctx('unlock-area-fixture'));
  const ok = await hasFlag(USER, 'area.unlocked.shrine_of_embers');
  assert(ok, 'area.unlocked.shrine_of_embers flag should be set');
});

await test('has_ntc predicate reads real wallet balance', async () => {
  const source = `:: StoryTitle\nHas ntc\n\n:: start [start]\n\nBuy.\n\n* [[Yes->END]] #yes {if: has_ntc(100)}\n* [[No->END]] #no {if: not has_ntc(100)}\n`;
  const parsed = parseAndValidate(source, 'has-ntc-fixture');
  const node = parsed.definition!.nodes['start']!;
  const yesCond = node.choices.find((c) => c.id === 'yes')!.condition!;
  const noCond = node.choices.find((c) => c.id === 'no')!.condition!;
  const nowBalance = await getBalances(USER);
  const enoughForYes = await evaluateCondition(yesCond, ctx('has-ntc-fixture'));
  const enoughForNo = await evaluateCondition(noCond, ctx('has-ntc-fixture'));
  const expected = nowBalance.netcore >= 100;
  assert(enoughForYes === expected, `has_ntc(100) should be ${expected} when balance is ${nowBalance.netcore}, got ${enoughForYes}`);
  assert(enoughForNo === !expected, `not has_ntc(100) should be ${!expected}, got ${enoughForNo}`);
});

await test('has_credits predicate reads real wallet balance', async () => {
  const source = `:: StoryTitle\nHas credits\n\n:: start [start]\n\n.\n\n* [[Yes->END]] #yes {if: has_credits(1)}\n* [[No->END]] #no {if: has_credits(9999999)}\n`;
  const parsed = parseAndValidate(source, 'has-credits-fixture');
  const node = parsed.definition!.nodes['start']!;
  const yesCond = node.choices.find((c) => c.id === 'yes')!.condition!;
  const noCond = node.choices.find((c) => c.id === 'no')!.condition!;
  assert(await evaluateCondition(yesCond, ctx('has-credits-fixture')), 'has_credits(1) should be true (fixture has 50)');
  assert(!(await evaluateCondition(noCond, ctx('has-credits-fixture'))), 'has_credits(9999999) should be false');
});

await test('party_has_element predicate finds party mon by element', async () => {
  const source = `:: StoryTitle\nElement\n\n:: start [start]\n\n.\n\n* [[Yes->END]] #yes {if: party_has_element("fire")}\n* [[No->END]] #no {if: party_has_element("ice")}\n`;
  const parsed = parseAndValidate(source, 'party-elem-fixture');
  const node = parsed.definition!.nodes['start']!;
  const yesCond = node.choices.find((c) => c.id === 'yes')!.condition!;
  const noCond = node.choices.find((c) => c.id === 'no')!.condition!;
  assert(await evaluateCondition(yesCond, ctx('party-elem-fixture')), 'party_has_element("fire") should be true (skb-50 = Agumon = fire)');
  assert(!(await evaluateCondition(noCond, ctx('party-elem-fixture'))), 'party_has_element("ice") should be false');
});

await test('simulator mirrors add_ntc + has_ntc without touching the DB', async () => {
  const source = `:: StoryTitle\nSim ntc\n\n:: start [start]\n@do add_ntc(30)\n\nSim.\n\n* [[Big->END]] #big {if: has_ntc(1000)}\n* [[Small->END]] #small\n`;
  const parsed = parseAndValidate(source, 'sim-ntc-fixture');
  await saveDialogue({ definition: parsed.definition!, sourceTwee: source, sourcePath: null });
  const before = await getBalances(USER);
  const result = await simulate({
    dialogueId: 'sim-ntc-fixture',
    overrides: { ntc: 500 },
    history: [],
  });
  assert(result.ok, `simulate failed: ${JSON.stringify(result)}`);
  assert(result.ok && result.view.ntc === 530, `simulator ntc should reflect 500 + 30, got ${result.ok ? result.view.ntc : '?'}`);
  const bigChoice = result.ok ? result.view.choices.find((c) => c.label === 'Big') : undefined;
  assert(!!bigChoice && bigChoice.visible === false, `has_ntc(1000) should hide "Big" with only 530 simulated, got ${JSON.stringify(bigChoice)}`);
  const after = await getBalances(USER);
  assert(after.netcore === before.netcore, `simulate must NOT touch DB, got ${after.netcore} vs ${before.netcore}`);
});

await test('simulator mirrors teleport + unlock_area', async () => {
  const source = `:: StoryTitle\nSim teleport\n\n:: start [start]\n@do teleport(3, 4)\n@do unlock_area("dark_grove")\n\nSim.\n\n* [[End->END]] #end\n`;
  const parsed = parseAndValidate(source, 'sim-tele-fixture');
  await saveDialogue({ definition: parsed.definition!, sourceTwee: source, sourcePath: null });
  const before = await one<{ x: number; y: number }>(`SELECT x, y FROM world_position WHERE user_id = ?`, USER);
  const result = await simulate({ dialogueId: 'sim-tele-fixture', overrides: {}, history: [] });
  assert(result.ok, `simulate failed: ${JSON.stringify(result)}`);
  assert(result.ok && result.view.teleportedTo?.x === 3 && result.view.teleportedTo?.y === 4, `expected simulated (3,4), got ${JSON.stringify(result.ok ? result.view.teleportedTo : '?')}`);
  assert(result.ok && result.view.flags.includes('area.unlocked.dark_grove'), `expected area flag in simulated state, got ${JSON.stringify(result.ok ? result.view.flags : '?')}`);
  const after = await one<{ x: number; y: number }>(`SELECT x, y FROM world_position WHERE user_id = ?`, USER);
  assert(after !== null && before !== null && after.x === before.x && after.y === before.y, `simulate teleport must NOT touch real world_position (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`);
});

await test('simulator mirrors party_has_element with override', async () => {
  const source = `:: StoryTitle\nSim elem\n\n:: start [start]\n\nSim.\n\n* [[Yes->END]] #yes {if: party_has_element("ice")}\n`;
  const parsed = parseAndValidate(source, 'sim-elem-fixture');
  await saveDialogue({ definition: parsed.definition!, sourceTwee: source, sourcePath: null });
  const withIce = await simulate({
    dialogueId: 'sim-elem-fixture',
    overrides: { partyElements: ['ice', 'fire'] },
    history: [],
  });
  assert(withIce.ok && withIce.view.choices.find((c) => c.label === 'Yes')?.visible === true, 'ice override should unlock yes');
  const withoutIce = await simulate({ dialogueId: 'sim-elem-fixture', overrides: { partyElements: ['fire'] }, history: [] });
  assert(withoutIce.ok && withoutIce.view.choices.find((c) => c.label === 'Yes')?.visible === false, 'no-ice override should hide yes');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
await closeDbAdapter();
closeDb();
process.exit(failed === 0 ? 0 : 1);
