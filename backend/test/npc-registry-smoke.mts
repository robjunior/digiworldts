/**
 * NPC registry + cross-ref + simulator smoke test.
 *
 * Covers the entire Option A next-pass surface end to end against a real
 * SQLite DB:
 *
 *  1. NPC CRUD — create / list / get / update / delete.
 *  2. Cross-ref validation refuses .twee that reference unknown NPCs,
 *     undeclared expressions, unknown quests, unknown items.
 *  3. Cross-ref validation ACCEPTS .twee that references only valid ids.
 *  4. Simulator dry-run — replays history, evaluates conditions, tracks
 *     simulated flags/items, does NOT touch the ledger or real user state.
 *
 * Run: pnpm --filter @digiworld/backend test:npc-registry
 */
import { existsSync, unlinkSync } from 'node:fs';

import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { closeDb, one, run } from '../src/db/index.ts';
import { parseAndValidateWithRefs } from '../src/dialogues/runtime.ts';
import { saveDialogue } from '../src/dialogues/repo.ts';
import { simulate } from '../src/dialogues/simulate.ts';
import { buildCrossRefChecker } from '../src/dialogues/xref.ts';
import { deleteNpc, getNpc, listNpcs, npcExists, saveNpc } from '../src/npcs/repo.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-npc-registry.db';
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

await run(
  `INSERT OR REPLACE INTO shop_items (id, name, description, price_credits, kind, class, payload, enabled, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['itm_relic', 'Relic Fragment', '', 0, 'consumable', 'item', '{}', 1, Date.now()],
);
await run(
  `INSERT OR REPLACE INTO quests (id, name, description, required_level, data, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ['qst_shrine', 'Find the Shrine', '', 1, '{}', Date.now(), Date.now()],
);

await test('npc.save + npc.get roundtrips', async () => {
  const created = await saveNpc({
    id: 'test_elder',
    displayName: 'Test Elder',
    expressions: [{ key: 'neutral' }, { key: 'concerned', label: 'Concerned' }],
  });
  assert(created.id === 'test_elder', 'id survived');
  assert(created.displayName === 'Test Elder', 'displayName survived');
  assert(created.expressions.length === 2, 'expressions saved');
  assert(created.expressions[0]!.key === 'neutral', 'first expression key');
  assert(created.expressions[1]!.label === 'Concerned', 'second expression label');
  assert(created.expressions.every((e) => e.hasPortrait === false), 'hasPortrait is false without files on disk');

  const fetched = await getNpc('test_elder');
  assert(fetched !== null, 'get returns the row');
  assert(fetched!.displayName === 'Test Elder', 'fetched displayName');
});

await test('npc.list contains the seeded row', async () => {
  const npcs = await listNpcs();
  assert(npcs.some((n) => n.id === 'test_elder'), 'listNpcs contains test_elder');
});

await test('npc.saveNpc upserts by id', async () => {
  await saveNpc({
    id: 'test_elder',
    displayName: 'Test Elder (updated)',
    expressions: [{ key: 'neutral' }],
  });
  const fetched = await getNpc('test_elder');
  assert(fetched!.displayName === 'Test Elder (updated)', 'displayName updated');
  assert(fetched!.expressions.length === 1, 'expressions replaced (not merged)');
});

await test('npc.delete removes the row', async () => {
  const removed = await deleteNpc('test_elder');
  assert(removed, 'delete returns true when row existed');
  assert(!(await npcExists('test_elder')), 'row is gone');
});

await test('cross-ref checker sees all fixtures', async () => {
  await saveNpc({
    id: 'test_speaker',
    displayName: 'Test Speaker',
    expressions: [{ key: 'neutral' }, { key: 'angry' }],
  });
  const checker = await buildCrossRefChecker();
  assert(checker.npcExists('test_speaker'), 'npcExists sees seeded NPC');
  assert(checker.npcHasExpression('test_speaker', 'neutral'), 'npcHasExpression finds declared expression');
  assert(!checker.npcHasExpression('test_speaker', 'unknown'), 'npcHasExpression rejects undeclared expression');
  assert(!checker.npcExists('never_existed'), 'npcExists rejects unknown NPC');
  assert(checker.itemExists('itm_relic'), 'itemExists sees fixture item');
  assert(!checker.itemExists('itm_bogus'), 'itemExists rejects unknown item');
  assert(checker.questExists('qst_shrine'), 'questExists sees fixture quest');
  assert(!checker.questExists('qst_fake'), 'questExists rejects unknown quest');
});

await test('parseAndValidateWithRefs accepts refs that resolve', async () => {
  const source = `:: StoryTitle
Test dialogue

:: start [start]
@speaker test_speaker neutral

Hello.

* [[End->END]] #end
`;
  const checker = await buildCrossRefChecker();
  const result = parseAndValidateWithRefs(source, 'test-good', checker);
  assert(result.definition !== null, `expected clean parse, got errors: ${JSON.stringify(result.errors)}`);
  assert(result.errors.length === 0, 'no errors on happy path');
});

await test('parseAndValidateWithRefs refuses unknown NPC', async () => {
  const source = `:: StoryTitle
Test bad NPC

:: start [start]
@speaker never_existed neutral

Nope.

* [[End->END]] #end
`;
  const checker = await buildCrossRefChecker();
  const result = parseAndValidateWithRefs(source, 'test-bad-npc', checker);
  assert(result.definition === null, 'definition should be null when NPC is unknown');
  assert(
    result.errors.some((e) => e.message.includes('unknown NPC "never_existed"')),
    `expected unknown-NPC error, got: ${JSON.stringify(result.errors)}`,
  );
});

await test('parseAndValidateWithRefs refuses undeclared expression', async () => {
  const source = `:: StoryTitle
Test bad expression

:: start [start]
@speaker test_speaker confused

Nope.

* [[End->END]] #end
`;
  const checker = await buildCrossRefChecker();
  const result = parseAndValidateWithRefs(source, 'test-bad-expr', checker);
  assert(result.definition === null, 'definition should be null when expression is undeclared');
  assert(
    result.errors.some((e) => e.message.includes('"confused"')),
    `expected undeclared-expression error, got: ${JSON.stringify(result.errors)}`,
  );
});

await test('parseAndValidateWithRefs refuses unknown item', async () => {
  const source = `:: StoryTitle
Test bad item

:: start [start]
@speaker test_speaker neutral
@do give_item("itm_bogus_ref")

Nope.

* [[End->END]] #end
`;
  const checker = await buildCrossRefChecker();
  const result = parseAndValidateWithRefs(source, 'test-bad-item', checker);
  assert(result.definition === null, 'definition should be null when item is unknown');
  assert(
    result.errors.some((e) => e.message.includes('itm_bogus_ref')),
    `expected unknown-item error, got: ${JSON.stringify(result.errors)}`,
  );
});

await test('parseAndValidateWithRefs refuses unknown quest', async () => {
  const source = `:: StoryTitle
Test bad quest

:: start [start]
@speaker test_speaker neutral
@do start_quest("qst_ghost")

Nope.

* [[End->END]] #end
`;
  const checker = await buildCrossRefChecker();
  const result = parseAndValidateWithRefs(source, 'test-bad-quest', checker);
  assert(result.definition === null, 'definition should be null when quest is unknown');
  assert(
    result.errors.some((e) => e.message.includes('qst_ghost')),
    `expected unknown-quest error, got: ${JSON.stringify(result.errors)}`,
  );
});

await test('simulator walks from start and returns node view', async () => {
  const source = `:: StoryTitle
Sim test

:: start [start]
@speaker test_speaker neutral
@do set_flag("visited_start")

Welcome, {player_name}.

* [[Ask about relic->ask_relic]] #ask
* [[Ask about shrine->ask_shrine]] #shrine {if: level >= 5}
* [[Leave->END]] #leave

:: ask_relic
@speaker test_speaker neutral

Here is the relic.

* [[Take it->END]] #take

:: ask_shrine
@speaker test_speaker neutral

The shrine is far.

* [[Back->start]] #back
`;
  const checker = await buildCrossRefChecker();
  const parsed = parseAndValidateWithRefs(source, 'sim-fixture', checker);
  assert(parsed.definition !== null, `parse must succeed, got: ${JSON.stringify(parsed.errors)}`);
  await saveDialogue({ definition: parsed.definition!, sourceTwee: source, sourcePath: null });

  const first = await simulate({
    dialogueId: 'sim-fixture',
    overrides: { level: 1, playerName: 'Aster' },
    history: [],
  });
  assert(first.ok, `first simulate must succeed: ${JSON.stringify(first)}`);
  assert(first.ok && first.view.nodeId === 'start', `expected start node, got ${first.ok ? first.view.nodeId : '???'}`);
  assert(first.ok && first.view.text.includes('Aster'), 'variable substitution places player_name into text');
  assert(first.ok && first.view.actionsAtEntry.length === 1, 'one entry action (set_flag) preview');
  assert(first.ok && first.view.flags.includes('visited_start'), 'set_flag was recorded in simulated state');

  const shrineChoice = first.ok ? first.view.choices.find((c) => c.label.toLowerCase().includes('shrine')) : undefined;
  assert(!!shrineChoice && shrineChoice.visible === false, `shrine choice must be hidden at level 1, got ${JSON.stringify(shrineChoice)}`);
  assert(!!shrineChoice && shrineChoice.conditionSummary !== null, 'shrine choice condition summary present');
});

await test('simulator honors level override to unlock gated choice', async () => {
  const first = await simulate({
    dialogueId: 'sim-fixture',
    overrides: { level: 5, playerName: 'Aster' },
    history: [],
  });
  const shrineChoice = first.ok ? first.view.choices.find((c) => c.label.toLowerCase().includes('shrine')) : undefined;
  assert(!!shrineChoice && shrineChoice.visible === true, `shrine choice must be visible at level 5, got ${JSON.stringify(shrineChoice)}`);
});

await test('simulator replays history correctly', async () => {
  const start = await simulate({
    dialogueId: 'sim-fixture',
    overrides: { level: 1, playerName: 'Aster' },
    history: [],
  });
  assert(start.ok, `initial simulate must succeed: ${JSON.stringify(start)}`);
  const askChoice = start.ok ? start.view.choices.find((c) => c.label.toLowerCase().includes('relic')) : undefined;
  assert(!!askChoice, 'ask-about-relic choice exists');

  const advanced = await simulate({
    dialogueId: 'sim-fixture',
    overrides: { level: 1, playerName: 'Aster' },
    history: [{ nodeId: 'start', choiceId: askChoice!.id }],
  });
  assert(advanced.ok, `simulate must succeed with history: ${JSON.stringify(advanced)}`);
  assert(advanced.ok && advanced.view.nodeId === 'ask_relic', `expected ask_relic, got ${advanced.ok ? advanced.view.nodeId : '???'}`);
});

await test('simulator refuses invalid history step', async () => {
  const bad = await simulate({
    dialogueId: 'sim-fixture',
    overrides: {},
    history: [{ nodeId: 'start', choiceId: 'never_defined' }],
  });
  assert(!bad.ok, 'invalid choice should fail');
  assert(!bad.ok && bad.failure.kind === 'invalid-history', `expected invalid-history, got ${bad.ok ? '?' : bad.failure.kind}`);
});

await test('simulator does NOT persist flags to the DB (no side effects)', async () => {
  const before = await one<{ readonly n: number }>(
    `SELECT COUNT(*) AS n FROM user_dialogue_actions WHERE action_id LIKE 'sim-fixture:%'`,
  );
  assert(before !== null && before.n === 0, 'no ledger rows before simulate');
  const start = await simulate({ dialogueId: 'sim-fixture', overrides: {}, history: [] });
  const askChoice = start.ok ? start.view.choices.find((c) => c.label.toLowerCase().includes('relic')) : undefined;
  await simulate({
    dialogueId: 'sim-fixture',
    overrides: {},
    history: [{ nodeId: 'start', choiceId: askChoice!.id }],
  });
  const after = await one<{ readonly n: number }>(
    `SELECT COUNT(*) AS n FROM user_dialogue_actions WHERE action_id LIKE 'sim-fixture:%'`,
  );
  assert(after !== null && after.n === 0, 'still no ledger rows after simulate (dry-run)');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
await closeDbAdapter();
closeDb();
process.exit(failed === 0 ? 0 : 1);
