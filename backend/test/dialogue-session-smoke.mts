/**
 * Dialogue session smoke test — the server cursor. These assertions are the
 * reason the tier exists: a client holding the whole definition must still be
 * unable to enter a branch it has not earned, or to replay one for profit.
 *
 * Run: pnpm --filter @digiworld/backend test:dialogue-session
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';

import { parseTwee } from '../../shared/src/dialogue-parser.ts';
import { run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { saveDialogue } from '../src/dialogues/repo.ts';
import { startDialogue, advanceDialogue, abandonDialogue } from '../src/dialogues/session.ts';
import { closeCluster } from '../src/cluster/index.ts';
import { hasFlag } from '../src/flags/repo.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-dlg-session.db';
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

const A = 'usr_sess_a';
const B = 'usr_sess_b';

await getDb();
const now = Date.now();
for (const id of [A, B]) {
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, id, id, 'x', 0, now, now],
  );
}

const source = readFileSync('data/dialogues/elder.twee', 'utf8');
const parsed = parseTwee(source, { dialogueId: 'elder' });
assert(parsed.definition !== null, 'elder.twee must parse');
await saveDialogue({ definition: parsed.definition!, sourceTwee: source, sourcePath: 'elder.twee' });

await test('starting a dialogue seats the cursor on the start node', async () => {
  const res = await startDialogue(A, 'Tester', 'elder');
  assert(res.ok, `start failed: ${res.ok ? '' : res.error}`);
  assert(res.ok && res.view.nodeId === 'elder/start', 'cursor did not land on elder/start');
});

await test('the start node applied its entry action', async () => {
  assert((await hasFlag(A, 'dialogue.elder.met')) === true, 'set_flag did not run on entry');
});

await test('a level-gated choice is withheld from the allowed list', async () => {
  const res = await startDialogue(A, 'Tester', 'elder');
  assert(res.ok, 'restart failed');
  const ids = res.ok ? res.view.allowedChoiceIds : [];
  assert(!ids.includes('ask_shrine'), 'the level gate leaked into the allowed list');
  assert(ids.includes('ask_who'), 'an ungated choice went missing');
});

await test('advancing into the withheld choice is refused, not merely hidden', async () => {
  const res = await advanceDialogue(A, 'Tester', 'elder', 'ask_shrine');
  assert(!res.ok && res.error === 'choice-not-available', `expected a refusal, got ${JSON.stringify(res)}`);
});

await test('a fabricated choice id is refused', async () => {
  const res = await advanceDialogue(A, 'Tester', 'elder', 'not_a_real_choice');
  assert(!res.ok && res.error === 'choice-not-available', 'an invented choice was accepted');
});

await test('an allowed choice moves the cursor', async () => {
  const res = await advanceDialogue(A, 'Tester', 'elder', 'ask_who');
  assert(res.ok && res.view.nodeId === 'elder/who', `expected elder/who, got ${JSON.stringify(res)}`);
});

await test('a choice from the previous node is refused after the cursor moved', async () => {
  const res = await advanceDialogue(A, 'Tester', 'elder', 'ask_who');
  assert(!res.ok && res.error === 'choice-not-available', 'a stale choice was replayed');
});

await test('looping back does not re-fire the entry action', async () => {
  const back = await advanceDialogue(A, 'Tester', 'elder', 'back');
  assert(back.ok && back.view.nodeId === 'elder/start', `expected the Back loop, got ${JSON.stringify(back)}`);
});

await test('reaching END clears the cursor', async () => {
  const done = await advanceDialogue(A, 'Tester', 'elder', 'leave');
  assert(done.ok && done.view.done, 'END did not report done');
  const after = await advanceDialogue(A, 'Tester', 'elder', 'ask_who');
  assert(!after.ok && after.error === 'no-cursor', 'the cursor survived END');
});

await test('advancing without a cursor is refused', async () => {
  await abandonDialogue(B);
  const res = await advanceDialogue(B, 'Other', 'elder', 'ask_who');
  assert(!res.ok && res.error === 'no-cursor', 'advanced with no cursor');
});

await test('a cursor is not shared between users', async () => {
  await startDialogue(A, 'Tester', 'elder');
  const res = await advanceDialogue(B, 'Other', 'elder', 'ask_who');
  assert(!res.ok && res.error === 'no-cursor', "another user's cursor was reachable");
});

await test('advancing against the wrong dialogue id is refused', async () => {
  const res = await advanceDialogue(A, 'Tester', 'some-other-dialogue', 'ask_who');
  assert(!res.ok && res.error === 'wrong-dialogue', 'a mismatched dialogue id was accepted');
});

process.stdout.write(`dialogue session tests: ${passed} passed, ${failed} failed\n`);
closeDb();
await closeDbAdapter();
await closeCluster();
process.exit(failed === 0 ? 0 : 1);
