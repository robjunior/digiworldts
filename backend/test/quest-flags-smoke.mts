import { existsSync, unlinkSync } from 'node:fs';

import { BIOMES } from '@digiworld/shared/world';
import type { Quest } from '@digiworld/shared/quest';

import { closeDb, run } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { setFlag, clearFlag, hasFlag } from '../src/flags/repo.ts';
import {
  acceptQuest,
  claimQuest,
  createQuest,
  createWorldObject,
  listAvailableQuests,
  listQuestsForUser,
  listWorldObjects,
} from '../src/quests/repo.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-quest-flags-smoke.db';
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

async function mkUser(id: string): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, id, id, 'x', 0, now, now],
  );
}

type QuestSeed = Partial<Omit<Quest, 'id' | 'createdAt' | 'updatedAt'>> & { readonly name: string };

async function mkQuest(seed: QuestSeed): Promise<Quest> {
  return createQuest({
    name: seed.name,
    description: seed.description ?? '',
    requiredLevel: seed.requiredLevel ?? 1,
    introDialogueId: seed.introDialogueId ?? null,
    steps: seed.steps ?? [],
    finalReward: seed.finalReward ?? { items: [], pickCount: 0 },
    unlocksQuestIds: seed.unlocksQuestIds ?? [],
    ...(seed.objectives !== undefined ? { objectives: seed.objectives } : {}),
    ...(seed.giver !== undefined ? { giver: seed.giver } : {}),
    ...(seed.rewardText !== undefined ? { rewardText: seed.rewardText } : {}),
    ...(seed.lockHint !== undefined ? { lockHint: seed.lockHint } : {}),
    ...(seed.requiredFlags !== undefined ? { requiredFlags: seed.requiredFlags } : {}),
    ...(seed.completesFlag !== undefined ? { completesFlag: seed.completesFlag } : {}),
  });
}

async function markQuestComplete(userId: string, questId: string): Promise<void> {
  await run(
    'UPDATE user_quest_progress SET completed_at = ? WHERE user_id = ? AND quest_id = ?',
    [Date.now(), userId, questId],
  );
}

await getDb();
await mkUser('usr_qf_a');
await mkUser('usr_qf_b');

const meanLevel = 99;
const singleObjective = [{ kind: 'travel' as const, biome: BIOMES[0], text: 'go there' }];

await test('acceptQuest rejects a quest whose requiredFlags are unmet', async () => {
  const gated = await mkQuest({ name: 'GatedA', requiredFlags: ['tutorial_done'] });
  const result = await acceptQuest('usr_qf_a', gated.id, meanLevel);
  assert(result === null, 'gated quest should return null when flag is missing');
});

await test('acceptQuest succeeds once the requiredFlags are all set', async () => {
  const gated = await mkQuest({ name: 'GatedB', requiredFlags: ['can_accept'] });
  await setFlag('usr_qf_a', 'can_accept');
  const result = await acceptQuest('usr_qf_a', gated.id, meanLevel);
  assert(result !== null, 'gated quest should accept once flag is present');
  assert(result?.id === gated.id, 'accepted quest id should match');
});

await test('acceptQuest enforces all-required-flags (AND-semantics)', async () => {
  const gated = await mkQuest({ name: 'GatedC', requiredFlags: ['flag_x', 'flag_y'] });
  await setFlag('usr_qf_a', 'flag_x');
  const partial = await acceptQuest('usr_qf_a', gated.id, meanLevel);
  assert(partial === null, 'partial flag coverage should still refuse');
  await setFlag('usr_qf_a', 'flag_y');
  const full = await acceptQuest('usr_qf_a', gated.id, meanLevel);
  assert(full !== null, 'all flags met should accept');
});

await test('listAvailableQuests filters out gated quests when flags are missing', async () => {
  const open = await mkQuest({ name: 'OpenQuest' });
  await mkQuest({ name: 'GatedD', requiredFlags: ['unheld_flag_d'] });
  const available = await listAvailableQuests('usr_qf_b', meanLevel);
  const names = available.map((q) => q.name);
  assert(names.includes(open.name), `open quest should be listed; got ${names.join(',')}`);
  assert(!names.includes('GatedD'), `GatedD should be filtered when flag is missing; got ${names.join(',')}`);
});

await test('listAvailableQuests unfilters a gated quest after the flag is set', async () => {
  const gated = await mkQuest({ name: 'GatedE', requiredFlags: ['unlock_e'] });
  const before = (await listAvailableQuests('usr_qf_b', meanLevel)).map((q) => q.name);
  assert(!before.includes(gated.name), 'gated quest should be hidden before flag');
  await setFlag('usr_qf_b', 'unlock_e');
  const after = (await listAvailableQuests('usr_qf_b', meanLevel)).map((q) => q.name);
  assert(after.includes(gated.name), 'gated quest should be visible after flag is set');
});

await test('listQuestsForUser keeps a started quest visible even after its flag is cleared', async () => {
  const gated = await mkQuest({ name: 'StartedGated', objectives: singleObjective, requiredFlags: ['start_flag'] });
  await setFlag('usr_qf_a', 'start_flag');
  const accepted = await acceptQuest('usr_qf_a', gated.id, meanLevel);
  assert(accepted !== null, 'precondition: accept while flag is set');
  await clearFlag('usr_qf_a', 'start_flag');
  const forUser = await listQuestsForUser('usr_qf_a', meanLevel);
  const found = forUser.find((q) => q.id === gated.id);
  assert(found !== undefined, 'started gated quest should remain visible after flag is cleared');
});

await test('listQuestsForUser hides gated quests that have no progress row', async () => {
  const gated = await mkQuest({ name: 'UnstartedGated', objectives: singleObjective, requiredFlags: ['never_seen_flag'] });
  const forUser = await listQuestsForUser('usr_qf_b', meanLevel);
  assert(!forUser.some((q) => q.id === gated.id), 'unstarted gated quest should be filtered');
});

await test('claimQuest auto-sets completesFlag on the user', async () => {
  const quest = await mkQuest({ name: 'ClaimSetsFlag', completesFlag: 'chapter_one_done' });
  const accepted = await acceptQuest('usr_qf_a', quest.id, meanLevel);
  assert(accepted !== null, 'precondition: accept quest');
  await markQuestComplete('usr_qf_a', quest.id);
  const result = await claimQuest('usr_qf_a', quest.id);
  assert(result.ok, 'claim should succeed after completion');
  assert(await hasFlag('usr_qf_a', 'chapter_one_done'), 'completesFlag should be set on user after claim');
});

await test('claimQuest without completesFlag does not touch flag state', async () => {
  const before = ((await hasFlag('usr_qf_a', 'noise_flag')) ? 1 : 0);
  const quest = await mkQuest({ name: 'ClaimNoFlag' });
  const accepted = await acceptQuest('usr_qf_a', quest.id, meanLevel);
  assert(accepted !== null, 'precondition: accept quest');
  await markQuestComplete('usr_qf_a', quest.id);
  const result = await claimQuest('usr_qf_a', quest.id);
  assert(result.ok, 'claim should succeed');
  const after = ((await hasFlag('usr_qf_a', 'noise_flag')) ? 1 : 0);
  assert(before === after, 'unrelated flags must not change on claim');
});

await test('listWorldObjects filters world_objects with unmet hiddenUntilFlag', async () => {
  await createWorldObject({ x: 10, y: 10, lat: 0, lon: 0, kind: 'shrine', scale: 1, passable: true, hiddenUntilFlag: 'discovered_shrine' });
  await createWorldObject({ x: 20, y: 20, lat: 0, lon: 0, kind: 'tower', scale: 1, passable: true });
  const objects = await listWorldObjects('usr_qf_b');
  assert(objects.some((o) => o.kind === 'tower' && o.x === 20), 'always-visible object should be returned');
  assert(!objects.some((o) => o.kind === 'shrine' && o.x === 10), 'hidden object should be filtered when flag is missing');
});

await test('listWorldObjects reveals a hidden world_object once its flag is set', async () => {
  await createWorldObject({ x: 30, y: 30, lat: 0, lon: 0, kind: 'obelisk', scale: 1, passable: true, hiddenUntilFlag: 'obelisk_seen' });
  const before = await listWorldObjects('usr_qf_b');
  assert(!before.some((o) => o.kind === 'obelisk' && o.x === 30), 'obelisk should be hidden before flag');
  await setFlag('usr_qf_b', 'obelisk_seen');
  const after = await listWorldObjects('usr_qf_b');
  assert(after.some((o) => o.kind === 'obelisk' && o.x === 30), 'obelisk should be visible once flag is set');
});

await closeDb();
await closeDbAdapter();

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
