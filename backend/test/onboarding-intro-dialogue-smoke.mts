/**
 * Onboarding intro-dialogue-id smoke test.
 *
 * Covers the wire between onboarding_config.intro_dialogue_id and the
 * dialogue registry:
 *
 *  1. Config roundtrip — updateConfig persists introDialogueId; getConfig
 *     returns it.
 *  2. Null clears the field back to paragraph-only mode.
 *  3. Cross-ref refuse — updateConfig with a dialogueId that isn't in
 *     dialogue_definitions returns an invalid-input outcome.
 *  4. Fresh install seeds with introDialogueId = null (paragraph mode).
 *
 * Run: pnpm --filter @digiworld/backend test:onboarding-intro
 */
import { existsSync, unlinkSync } from 'node:fs';

import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { closeDb, run } from '../src/db/index.ts';
import { getConfig, seedDefaultOnboarding, updateConfig } from '../src/onboarding/engine.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-onboarding-intro.db';
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

const now = Date.now();
await run(
  `INSERT OR REPLACE INTO dialogue_definitions
    (dialogue_id, title, source_path, source_hash, source_twee, start_node_id, npc_ids, ir_json, node_count, imported_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ['test-intro', 'Test intro', null, 'hash', ':: start\nhi', 'start', '[]', '{"nodes":{}}', 1, now, now],
);

await test('fresh install seeds config with introDialogueId=null', async () => {
  const seedResult = await seedDefaultOnboarding();
  assert(seedResult.configSeeded, `expected config seed on fresh DB, got: ${JSON.stringify(seedResult)}`);
  const config = await getConfig();
  assert(config.introDialogueId === null, `expected null on fresh seed, got ${JSON.stringify(config.introDialogueId)}`);
  assert(config.introDialogue.length > 0, 'paragraph text seeded');
});

await test('updateConfig accepts a valid dialogue id and roundtrips it', async () => {
  const result = await updateConfig({
    introDialogue: 'ignored when interactive mode is on but still required',
    bgImage: '',
    introDialogueId: 'test-intro',
  });
  assert(result.ok, `expected success, got: ${JSON.stringify(result)}`);
  const config = await getConfig();
  assert(config.introDialogueId === 'test-intro', `expected id persisted, got ${JSON.stringify(config.introDialogueId)}`);
});

await test('updateConfig accepts null to switch back to paragraph mode', async () => {
  const result = await updateConfig({
    introDialogue: 'back to paragraphs',
    bgImage: '',
    introDialogueId: null,
  });
  assert(result.ok, `expected success clearing id, got: ${JSON.stringify(result)}`);
  const config = await getConfig();
  assert(config.introDialogueId === null, `expected null after clear, got ${JSON.stringify(config.introDialogueId)}`);
});

await test('updateConfig treats empty string as null (no interactive mode)', async () => {
  const result = await updateConfig({
    introDialogue: 'still paragraphs',
    bgImage: '',
    introDialogueId: '   ',
  });
  assert(result.ok, `expected success with blank id, got: ${JSON.stringify(result)}`);
  const config = await getConfig();
  assert(config.introDialogueId === null, `expected null after blank id, got ${JSON.stringify(config.introDialogueId)}`);
});

await test('updateConfig refuses an unknown dialogueId (cross-ref check)', async () => {
  const result = await updateConfig({
    introDialogue: 'paragraphs',
    bgImage: '',
    introDialogueId: 'never-imported',
  });
  assert(!result.ok, `expected refusal for unknown id, got: ${JSON.stringify(result)}`);
  assert(!result.ok && result.error === 'invalid-input', `expected invalid-input error, got: ${result.ok ? '?' : result.error}`);
  assert(
    !result.ok && (result.message ?? '').includes('never-imported'),
    `expected message to name the missing id, got: ${result.ok ? '?' : result.message}`,
  );
});

await test('updateConfig refuses an id with disallowed characters', async () => {
  const result = await updateConfig({
    introDialogue: 'paragraphs',
    bgImage: '',
    introDialogueId: 'bad id with spaces!',
  });
  assert(!result.ok, `expected refusal for bad chars, got: ${JSON.stringify(result)}`);
});

await test('updateConfig refuses paragraph text longer than 4000 chars', async () => {
  const result = await updateConfig({
    introDialogue: 'x'.repeat(4001),
    bgImage: '',
    introDialogueId: null,
  });
  assert(!result.ok, `expected refusal, got: ${JSON.stringify(result)}`);
});

await test('re-seed is idempotent (does not overwrite admin edits)', async () => {
  const before = await getConfig();
  const seedResult = await seedDefaultOnboarding();
  assert(!seedResult.configSeeded, `expected config seed to skip (already exists), got: ${JSON.stringify(seedResult)}`);
  const after = await getConfig();
  assert(after.introDialogue === before.introDialogue, 'paragraph text preserved across re-seed');
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
await closeDbAdapter();
closeDb();
process.exit(failed === 0 ? 0 : 1);
