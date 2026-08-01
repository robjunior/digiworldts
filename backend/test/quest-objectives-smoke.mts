import { existsSync, unlinkSync } from 'node:fs';

import { BIOMES } from '@digiworld/shared/world';
import type { Quest, QuestObjective, QuestWithProgress } from '@digiworld/shared/quest';

import { closeDb, run } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import {
  acceptQuest,
  bumpCaptureObjectives,
  bumpCollectObjectives,
  bumpDefeatObjectives,
  bumpTalkObjectives,
  bumpTravelObjectives,
  createQuest,
  listQuestsForUser,
} from '../src/quests/repo.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-quest-objectives-smoke.db';
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

const meanLevel = 99;

async function seedAndAccept(userId: string, name: string, objectives: readonly QuestObjective[]): Promise<Quest> {
  const quest = await createQuest({
    name,
    description: '',
    requiredLevel: 1,
    introDialogueId: null,
    steps: [],
    finalReward: { items: [], pickCount: 0 },
    unlocksQuestIds: [],
    objectives,
  });
  const accepted = await acceptQuest(userId, quest.id, meanLevel);
  if (accepted === null) throw new Error(`precondition failed: could not accept ${name}`);
  return quest;
}

async function readObjective(userId: string, questId: string, index: number): Promise<QuestWithProgress['objectives'][number]> {
  const list = await listQuestsForUser(userId, meanLevel);
  const found = list.find((q) => q.id === questId);
  if (!found) throw new Error(`quest ${questId} not visible to ${userId}`);
  const obj = found.objectives[index];
  if (!obj) throw new Error(`objective ${index} missing on ${questId}`);
  return obj;
}

await getDb();
await mkUser('usr_obj_a');

await test('bumpTravelObjectives sets counter=1 and doneAt on matching biome', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'TravelA', [
    { kind: 'travel', biome: BIOMES[0], text: 'go to first biome' },
  ]);
  await bumpTravelObjectives('usr_obj_a', BIOMES[0]);
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 1, `expected counter=1, got ${obj.counter}`);
  assert(obj.doneAt !== null, 'expected doneAt to be set on completion');
});

await test('bumpTravelObjectives is a no-op for non-matching biome', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'TravelB', [
    { kind: 'travel', biome: BIOMES[1], text: 'go to second biome' },
  ]);
  await bumpTravelObjectives('usr_obj_a', BIOMES[2]);
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 0, `expected counter=0, got ${obj.counter}`);
  assert(obj.doneAt === null, 'expected doneAt still null');
});

await test('bumpDefeatObjectives accumulates across multiple bumps', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'DefeatCumulative', [
    { kind: 'defeat', biome: BIOMES[3], count: 3, text: 'defeat 3' },
  ]);
  await bumpDefeatObjectives('usr_obj_a', BIOMES[3], 'fire');
  await bumpDefeatObjectives('usr_obj_a', BIOMES[3], 'fire');
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 2, `expected counter=2, got ${obj.counter}`);
  assert(obj.doneAt === null, 'expected doneAt still null before hitting count');
});

await test('bumpDefeatObjectives sets doneAt when count is reached', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'DefeatComplete', [
    { kind: 'defeat', biome: BIOMES[4], count: 2, text: 'defeat 2' },
  ]);
  await bumpDefeatObjectives('usr_obj_a', BIOMES[4], 'water', 2);
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 2, `expected counter=2, got ${obj.counter}`);
  assert(obj.doneAt !== null, 'expected doneAt to be set');
});

await test('bumpDefeatObjectives without element filter matches any element', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'DefeatAnyElement', [
    { kind: 'defeat', biome: BIOMES[5], count: 2, text: 'defeat any' },
  ]);
  await bumpDefeatObjectives('usr_obj_a', BIOMES[5], 'fire');
  await bumpDefeatObjectives('usr_obj_a', BIOMES[5], 'water');
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 2, `expected counter=2, got ${obj.counter}`);
});

await test('bumpDefeatObjectives with element filter rejects wrong element', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'DefeatOnlyFire', [
    { kind: 'defeat', biome: BIOMES[6], element: 'fire', count: 2, text: 'defeat fire only' },
  ]);
  await bumpDefeatObjectives('usr_obj_a', BIOMES[6], 'water');
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 0, `expected counter=0 after wrong-element bump, got ${obj.counter}`);
});

await test('bumpTalkObjectives marks done on matching npcId', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'TalkMatch', [
    { kind: 'talk', npcId: 'npc_elder', text: 'talk to elder' },
  ]);
  await bumpTalkObjectives('usr_obj_a', 'npc_elder');
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 1, `expected counter=1, got ${obj.counter}`);
  assert(obj.doneAt !== null, 'expected doneAt set');
});

await test('bumpTalkObjectives is a no-op for non-matching npcId', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'TalkOther', [
    { kind: 'talk', npcId: 'npc_smith', text: 'talk to smith' },
  ]);
  await bumpTalkObjectives('usr_obj_a', 'npc_baker');
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 0, `expected counter=0, got ${obj.counter}`);
  assert(obj.doneAt === null, 'expected doneAt still null');
});

await test('bumpCollectObjectives accumulates by qty', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'CollectAccum', [
    { kind: 'collect', itemId: 'itm_gem', qty: 10, text: 'collect gems' },
  ]);
  await bumpCollectObjectives('usr_obj_a', 'itm_gem', 3);
  await bumpCollectObjectives('usr_obj_a', 'itm_gem', 4);
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 7, `expected counter=7, got ${obj.counter}`);
});

await test('bumpCollectObjectives is a no-op when qty <= 0', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'CollectZero', [
    { kind: 'collect', itemId: 'itm_coin', qty: 5, text: 'collect coins' },
  ]);
  await bumpCollectObjectives('usr_obj_a', 'itm_coin', 0);
  await bumpCollectObjectives('usr_obj_a', 'itm_coin', -3);
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 0, `expected counter=0, got ${obj.counter}`);
});

await test('bumpCollectObjectives caps at target qty', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'CollectCap', [
    { kind: 'collect', itemId: 'itm_herb', qty: 5, text: 'collect herbs' },
  ]);
  await bumpCollectObjectives('usr_obj_a', 'itm_herb', 100);
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 5, `expected counter capped at 5, got ${obj.counter}`);
  assert(obj.doneAt !== null, 'expected doneAt set when reaching cap');
});

await test('bumpCaptureObjectives without catalogId matches any catalog', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'CaptureAnyCatalog', [
    { kind: 'capture', count: 2, text: 'capture any' },
  ]);
  await bumpCaptureObjectives('usr_obj_a', 'skb-100', 'Rookie');
  await bumpCaptureObjectives('usr_obj_a', 'skb-200', 'Rookie');
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 2, `expected counter=2, got ${obj.counter}`);
});

await test('bumpCaptureObjectives with stage filter rejects wrong stage', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'CaptureRookieOnly', [
    { kind: 'capture', stage: 'Rookie', count: 2, text: 'rookie only' },
  ]);
  await bumpCaptureObjectives('usr_obj_a', 'skb-300', 'Ultimate');
  const obj = await readObjective('usr_obj_a', quest.id, 0);
  assert(obj.counter === 0, `expected counter=0 after wrong-stage bump, got ${obj.counter}`);
});

await test('bumpCaptureObjectives with both filters requires both to match', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'CaptureBothFilters', [
    { kind: 'capture', catalogId: 'skb-400', stage: 'Champion', count: 1, text: 'exact match' },
  ]);
  await bumpCaptureObjectives('usr_obj_a', 'skb-400', 'Rookie');
  const afterWrongStage = await readObjective('usr_obj_a', quest.id, 0);
  assert(afterWrongStage.counter === 0, 'right catalog wrong stage should not bump');
  await bumpCaptureObjectives('usr_obj_a', 'skb-999', 'Champion');
  const afterWrongCatalog = await readObjective('usr_obj_a', quest.id, 0);
  assert(afterWrongCatalog.counter === 0, 'wrong catalog right stage should not bump');
  await bumpCaptureObjectives('usr_obj_a', 'skb-400', 'Champion');
  const afterExactMatch = await readObjective('usr_obj_a', quest.id, 0);
  assert(afterExactMatch.counter === 1, 'exact match should bump');
  assert(afterExactMatch.doneAt !== null, 'expected doneAt set');
});

await test('bumps never re-touch an already-completed objective', async () => {
  const quest = await seedAndAccept('usr_obj_a', 'AlreadyDone', [
    { kind: 'talk', npcId: 'npc_locked', text: 'talk once' },
  ]);
  await bumpTalkObjectives('usr_obj_a', 'npc_locked');
  const firstDoneAt = (await readObjective('usr_obj_a', quest.id, 0)).doneAt;
  assert(firstDoneAt !== null, 'precondition: done on first bump');
  await new Promise((resolve) => setTimeout(resolve, 5));
  await bumpTalkObjectives('usr_obj_a', 'npc_locked');
  const secondDoneAt = (await readObjective('usr_obj_a', quest.id, 0)).doneAt;
  assert(secondDoneAt === firstDoneAt, 'doneAt must be preserved on subsequent bumps');
});

await closeDb();
await closeDbAdapter();

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
