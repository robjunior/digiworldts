/**
 * Dialogue runtime smoke test — condition evaluation and the at-most-once,
 * all-or-nothing application of entry actions that the server cursor rides on.
 *
 * The re-entry case parses the real data/dialogues/elder.twee rather than a
 * fixture, because the loop it guards against is authored there:
 * elder/who exits with [[Back->elder/start]] and elder/start carries
 * @do set_flag("dialogue.elder.met").
 *
 * Run: pnpm --filter @digiworld/backend test:dialogue-runtime
 */
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';

import { parseTwee } from '../../shared/src/dialogue-parser.ts';
import { one, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import {
  applyEntryActions,
  evaluateCondition,
  visibleChoices,
  isKnownAction,
  parseAndValidate,
  type DialogueRuntimeContext,
} from '../src/dialogues/runtime.ts';
import { hasFlag } from '../src/flags/repo.ts';
import { countItem, grantItem } from '../src/items/grant.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-dlg-runtime.db';
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

async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return false; } catch { return true; }
}

const USER = 'usr_dlg_rt';
const RELIC = 'itm_dlg_relic';
const REWARD = 'itm_dlg_reward';
const QUEST = 'qst_dlg_fixture';

await getDb();
const now = Date.now();
await run(
  'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
  [USER, USER, USER, 'x', 0, now, now],
);
for (const [id, name] of [[RELIC, 'Relic'], [REWARD, 'Reward']]) {
  await run(
    'INSERT INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, name, 'fixture', 0, 'quest', 'item', '{}', 1, now],
  );
}

const ctx = (level: number, dialogueId = 'elder'): DialogueRuntimeContext => ({
  userId: USER,
  dialogueId,
  facts: { level },
  variables: { player_name: 'Tester' },
});

const elder = parseTwee(readFileSync('data/dialogues/elder.twee', 'utf8'), { dialogueId: 'elder' });
assert(elder.definition !== null, 'elder.twee must parse for this suite to mean anything');
const elderDef = elder.definition!;
const elderStart = elderDef.nodes[elderDef.startNodeId]!;

await test('a level-gated choice is hidden below the threshold', async () => {
  const shown = await visibleChoices(elderStart, ctx(1));
  assert(!shown.some((c) => c.id === 'ask_shrine'), 'the shrine choice leaked at level 1');
  assert(shown.some((c) => c.id === 'leave'), 'ungated choices must still show');
});

await test('the same choice appears once the fact satisfies it', async () => {
  const shown = await visibleChoices(elderStart, ctx(3));
  assert(shown.some((c) => c.id === 'ask_shrine'), 'the shrine choice stayed hidden at level 3');
});

await test('an unknown fact is refused instead of read as undefined', async () => {
  const orphan = { userId: USER, facts: {}, variables: {} };
  assert(await throws(() => visibleChoices(elderStart, orphan)), 'a missing fact evaluated silently');
});

await test('an unknown predicate is refused', async () => {
  const parsed = parseTwee(`:: StoryTitle
X

:: start
@speaker g neutral
@if totally_made_up("x")

Body.

* [[Go->END]]
`, { dialogueId: 'x' });
  const node = parsed.definition!.nodes['start']!;
  assert(await throws(() => evaluateCondition(node.condition!, ctx(9))), 'an unknown predicate passed');
});

await test('an unknown action is refused rather than skipped', async () => {
  const parsed = parseTwee(`:: StoryTitle
X

:: start
@speaker g neutral
@do wipe_everything("now")

Body.

* [[Go->END]]
`, { dialogueId: 'x2' });
  assert(!isKnownAction('wipe_everything'), 'the registry claims to know a bogus action');
  assert(await throws(() => applyEntryActions(parsed.definition!.nodes['start']!, ctx(9, parsed.definition!.dialogueId))), 'an unknown action ran');
});

await test('entry actions apply on first arrival', async () => {
  const ids = await applyEntryActions(elderStart, ctx(5));
  assert(ids.length === 1, `expected one action to fire, got ${ids.length}`);
  assert((await hasFlag(USER, 'dialogue.elder.met')) === true, 'set_flag did not land');
});

await test('re-entering through the authored Back loop does not re-fire', async () => {
  const ids = await applyEntryActions(elderStart, ctx(5));
  assert(ids.length === 0, 'the action fired a second time on re-entry');
});

await test('player_has_item gates on the real inventory', async () => {
  const parsed = parseTwee(`:: StoryTitle
X

:: start
@speaker g neutral

Body.

* [[Enter->END]] #gate {if: player_has_item("${RELIC}", 1)}
`, { dialogueId: 'x3' });
  const node = parsed.definition!.nodes['start']!;
  assert((await visibleChoices(node, ctx(9))).length === 0, 'the gate opened without the relic');
  await grantItem(USER, RELIC, 1);
  assert((await visibleChoices(node, ctx(9))).length === 1, 'the gate stayed shut while holding the relic');
});

await test('a refused remove_item rolls back the give_item beside it', async () => {
  const parsed = parseTwee(`:: StoryTitle
Trade

:: start
@speaker g neutral
@do remove_item("${RELIC}", 5)
@do give_item("${REWARD}", 1)

Body.

* [[Go->END]]
`, { dialogueId: 'trade' });
  const node = parsed.definition!.nodes['start']!;
  assert(await throws(() => applyEntryActions(node, ctx(9, parsed.definition!.dialogueId))), 'the short trade was allowed');
  assert((await countItem(USER, REWARD)) === 0, 'the reward was handed out despite the rollback');
  assert((await countItem(USER, RELIC)) === 1, 'the relic balance moved despite the rollback');
});

await test('a rolled-back action is not left claimed in the ledger', async () => {
  await grantItem(USER, RELIC, 4);
  const parsed = parseTwee(`:: StoryTitle
Trade

:: start
@speaker g neutral
@do remove_item("${RELIC}", 5)
@do give_item("${REWARD}", 1)

Body.

* [[Go->END]]
`, { dialogueId: 'trade' });
  const ids = await applyEntryActions(parsed.definition!.nodes['start']!, ctx(9, parsed.definition!.dialogueId));
  assert(ids.length === 2, `expected both actions to fire once affordable, got ${ids.length}`);
  assert((await countItem(USER, RELIC)) === 0, 'the relics were not consumed');
  assert((await countItem(USER, REWARD)) === 1, 'the reward was not granted');
});

await test('start_quest is refused when the quest does not exist', async () => {
  const parsed = parseTwee(`:: StoryTitle
Q

:: start
@speaker g neutral
@do start_quest("qst-does-not-exist")

Body.

* [[Go->END]]
`, { dialogueId: 'q-missing' });
  assert(await throws(() => applyEntryActions(parsed.definition!.nodes['start']!, ctx(9, parsed.definition!.dialogueId))), 'an unknown quest was started');
});

await test('start_quest rolls back with a failing sibling instead of staying started', async () => {
  await run(
    'INSERT INTO quests (id, name, description, required_level, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [QUEST, 'Fixture Quest', 'fixture', 1, JSON.stringify({ id: QUEST, name: 'Fixture Quest', description: 'fixture', objectives: [] }), now, now],
  );
  const parsed = parseTwee(`:: StoryTitle
Q

:: start
@speaker g neutral
@do start_quest("${QUEST}")
@do remove_item("${RELIC}", 99)

Body.

* [[Go->END]]
`, { dialogueId: 'q-rollback' });
  assert(await throws(() => applyEntryActions(parsed.definition!.nodes['start']!, ctx(9, parsed.definition!.dialogueId))), 'the short trade was allowed');
  const progress = await one<{ readonly quest_id: string }>(
    'SELECT quest_id FROM user_quest_progress WHERE user_id = ? AND quest_id = ?', USER, QUEST,
  );
  assert(progress === null, 'the quest stayed started after the rollback');
});

await test('start_quest lands when nothing beside it fails', async () => {
  const parsed = parseTwee(`:: StoryTitle
Q

:: start
@speaker g neutral
@do start_quest("${QUEST}")

Body.

* [[Go->END]]
`, { dialogueId: 'q-ok' });
  const ids = await applyEntryActions(parsed.definition!.nodes['start']!, ctx(9, parsed.definition!.dialogueId));
  assert(ids.length === 1, `expected the quest action to fire, got ${ids.length}`);
  const progress = await one<{ readonly quest_id: string }>(
    'SELECT quest_id FROM user_quest_progress WHERE user_id = ? AND quest_id = ?', USER, QUEST,
  );
  assert(progress !== null, 'the quest was not started');
});

await test('two dialogues sharing a passage name do not suppress each other', async () => {
  const body = (flag: string): string => `:: StoryTitle
Intro

:: start
@speaker g neutral
@do set_flag("${flag}")

Body.

* [[Go->END]]
`;
  const first = parseTwee(body('collide.first'), { dialogueId: 'collide-a' });
  const second = parseTwee(body('collide.second'), { dialogueId: 'collide-b' });
  const idA = first.definition!.nodes['start']!.entryActions[0]!.id;
  const idB = second.definition!.nodes['start']!.entryActions[0]!.id;
  assert(idA === idB, 'this test is pointless unless the parser really reuses the id');

  await applyEntryActions(first.definition!.nodes['start']!, ctx(9, 'collide-a'));
  await applyEntryActions(second.definition!.nodes['start']!, ctx(9, 'collide-b'));
  assert((await hasFlag(USER, 'collide.first')) === true, 'the first dialogue did not apply');
  assert((await hasFlag(USER, 'collide.second')) === true, 'the second dialogue was suppressed by the first');
});

await test('import refuses an unknown action instead of accepting a silent no-op', async () => {
  const res = parseAndValidate(`:: StoryTitle
Typo

:: start
@speaker g neutral
@do give_itme("x", 1)

Body.

* [[Go->END]]
`, 'typo');
  assert(res.definition === null, 'a typo\'d action was accepted at import');
  assert(res.errors.some((e) => e.message.includes('give_itme')), 'the error does not name the offending action');
  assert(res.errors.some((e) => e.passage === 'start'), 'the error does not name the passage');
});

await test('import refuses an unknown predicate', async () => {
  const res = parseAndValidate(`:: StoryTitle
Typo

:: start
@speaker g neutral

Body.

* [[Go->END]] {if: player_has_itme("x")}
`, 'typo2');
  assert(res.definition === null, 'an unknown predicate was accepted at import');
  assert(res.errors.some((e) => e.message.includes('player_has_itme')), 'the error does not name the predicate');
});

await test('every authored dialogue still passes the registry gate', async () => {
  const dir = 'data/dialogues';
  const files = readdirSync(dir).filter((f) => f.endsWith('.twee'));
  assert(files.length > 0, 'no authored dialogues found to check');
  for (const file of files) {
    const res = parseAndValidate(readFileSync(`${dir}/${file}`, 'utf8'), file.replace(/\.twee$/, ''));
    assert(res.definition !== null, `${file} was rejected: ${res.errors.map((e) => e.message).join('; ')}`);
  }
});

process.stdout.write(`dialogue runtime tests: ${passed} passed, ${failed} failed\n`);
closeDb();
await closeDbAdapter();
process.exit(failed === 0 ? 0 : 1);
