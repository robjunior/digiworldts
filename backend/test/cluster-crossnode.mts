/**
 * Cross-node persistence smoke test.
 *
 * Boots TWO independent RedisCluster instances (simulating two game nodes)
 * against the same Redis URL and exercises the four primitives on which
 * matchmaking, battle state, and WS delivery depend:
 *
 *   1. KV        — battle snapshot + battle user→match reverse lookup
 *   2. ZSET      — matchmaking FIFO queue (member=userId, score=queuedAt)
 *   3. Lock      — pair-lock + per-match battle mutation lock (with fencing)
 *   4. Pub/sub   — wsdeliver:{userId} pattern subscription for cross-node
 *                  WebSocket delivery
 *
 * If any of these fail cross-instance, multi-node deployment breaks. Passing
 * this test empirically proves the substrate is sound; the higher-level
 * modules in src/matchmaking, src/battle, src/lobby are thin async wrappers
 * over exactly these calls.
 *
 * Prereq: a Redis-compatible server on REDIS_URL (default redis://127.0.0.1:6400).
 * Ephemeral — creates keys under `xtest:*` and cleans them up.
 *
 * Run: pnpm --filter @digiworld/backend test:cluster
 */
import { RedisCluster } from '../src/cluster/redis.ts';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6400';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const KEYS = {
  snap: 'xtest:battle:snap:m1',
  userA: 'xtest:battle:user:usr_a',
  userB: 'xtest:battle:user:usr_b',
  lock: 'xtest:battle:lock:m1',
  queue: 'xtest:mm:queue',
  metaA: 'xtest:mm:meta:usr_a',
  metaB: 'xtest:mm:meta:usr_b',
  pairLock: 'xtest:mm:pair-lock',
};

async function cleanKeys(cluster: RedisCluster): Promise<void> {
  for (const k of Object.values(KEYS)) await cluster.del(k);
  await cluster.zrem(KEYS.queue, 'usr_a', 'usr_b');
}

async function main(): Promise<void> {
  console.log(`Cross-node persistence smoke test — REDIS_URL=${REDIS_URL}\n`);

  const nodeA = await RedisCluster.create(REDIS_URL);
  const nodeB = await RedisCluster.create(REDIS_URL);

  try {
    await cleanKeys(nodeA);

    // ------------------------------------------------------------------ KV
    console.log('=== 1) KV — battle snapshot pattern ===');
    await nodeA.set(KEYS.snap, JSON.stringify({ id: 'm1', round: 3, status: 'active' }), 60);
    await nodeA.set(KEYS.userA, 'm1', 60);
    await nodeA.set(KEYS.userB, 'm1', 60);

    const snapFromB = await nodeB.get(KEYS.snap);
    check(
      'nodeB reads battle snapshot written by nodeA',
      snapFromB !== null && JSON.parse(snapFromB).round === 3,
      `got=${snapFromB}`,
    );
    const uaLookup = await nodeB.get(KEYS.userA);
    check('nodeB resolves user→match reverse index written by nodeA', uaLookup === 'm1', `got=${uaLookup}`);

    // ---------------------------------------------------------------- ZSET
    console.log('\n=== 2) ZSET — matchmaking queue pattern ===');
    await nodeA.zadd(KEYS.queue, 1_000, 'usr_a');
    await nodeA.zadd(KEYS.queue, 2_000, 'usr_b');
    await nodeA.set(KEYS.metaA, JSON.stringify({ userId: 'usr_a', averageLevel: 10 }), 300);
    await nodeA.set(KEYS.metaB, JSON.stringify({ userId: 'usr_b', averageLevel: 12 }), 300);

    const q = await nodeB.zrange(KEYS.queue, 0, -1);
    check(
      'nodeB sees FIFO queue written by nodeA (order preserved by score)',
      q.length === 2 && q[0]?.member === 'usr_a' && q[1]?.member === 'usr_b',
      `got=${JSON.stringify(q)}`,
    );
    const size = await nodeB.zcard(KEYS.queue);
    check('nodeB zcard matches', size === 2, `got=${size}`);

    // Simulate atomic pair: nodeB grabs pair-lock, ZREMs, verifies zcard drops.
    const pairToken = await nodeB.lock(KEYS.pairLock, 2);
    check('nodeB acquires pair-lock', pairToken !== null);
    const zremmed = await nodeB.zrem(KEYS.queue, 'usr_a', 'usr_b');
    check('nodeB atomic zrem returns removed count 2', zremmed === 2, `got=${zremmed}`);
    if (pairToken) await nodeB.unlock(KEYS.pairLock, pairToken);
    const remaining = await nodeA.zcard(KEYS.queue);
    check('nodeA sees queue empty after nodeB paired', remaining === 0, `got=${remaining}`);

    // ---------------------------------------------------------------- Lock
    console.log('\n=== 3) Lock — mutual exclusion + token fencing ===');
    const tokA = await nodeA.lock(KEYS.lock, 5);
    check('nodeA acquires battle lock', tokA !== null);
    const tokBBlocked = await nodeB.lock(KEYS.lock, 5);
    check('nodeB blocked while nodeA holds lock', tokBBlocked === null);

    // Token fencing: nodeB (with fake token) cannot release nodeA's lock.
    const wrongRelease = await nodeB.unlock(KEYS.lock, 'not-the-real-token');
    check('wrong token cannot release lock (fencing works)', !wrongRelease);
    const stillBlocked = await nodeB.lock(KEYS.lock, 5);
    check('lock still held after failed release', stillBlocked === null);

    const releasedA = await nodeA.unlock(KEYS.lock, tokA!);
    check('nodeA releases with correct token', releasedA);
    const tokBOk = await nodeB.lock(KEYS.lock, 5);
    check('nodeB acquires after nodeA releases', tokBOk !== null);
    if (tokBOk) await nodeB.unlock(KEYS.lock, tokBOk);

    // ------------------------------------------------------------- Pub/sub
    console.log('\n=== 4) Pub/sub — wsdeliver:{userId} psubscribe pattern ===');
    const received: Array<{ msg: string; channel: string }> = [];
    const unsub = await nodeB.psubscribe('xtest:wsdeliver:*', (msg, channel) => {
      received.push({ msg, channel });
    });
    // ioredis needs a tick for SUBSCRIBE to register server-side.
    await sleep(80);

    const subCount1 = await nodeA.publish('xtest:wsdeliver:usr_alpha', JSON.stringify({ type: 'battle', matchId: 'm1' }));
    check('nodeA publish reports >=1 subscriber via Redis', subCount1 >= 1, `got=${subCount1}`);
    const subCount2 = await nodeA.publish('xtest:wsdeliver:usr_beta', JSON.stringify({ type: 'match', matchId: 'm2' }));
    check('nodeA second publish also routed', subCount2 >= 1, `got=${subCount2}`);

    // Give ioredis time to fanout to the subscriber connection.
    await sleep(120);

    check('nodeB received both messages published by nodeA', received.length === 2, `got=${received.length}`);
    check(
      'nodeB decoded first message correctly',
      received[0]?.channel === 'xtest:wsdeliver:usr_alpha' && JSON.parse(received[0].msg).matchId === 'm1',
      `got=${JSON.stringify(received[0] ?? null)}`,
    );
    check(
      'nodeB decoded second message correctly',
      received[1]?.channel === 'xtest:wsdeliver:usr_beta' && JSON.parse(received[1].msg).matchId === 'm2',
      `got=${JSON.stringify(received[1] ?? null)}`,
    );

    await unsub();

    // Cleanup
    await cleanKeys(nodeA);
    console.log('\n=== teardown ok ===');
  } finally {
    await Promise.allSettled([nodeA.close(), nodeB.close()]);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('FATAL:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
