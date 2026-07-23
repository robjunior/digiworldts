/**
 * Matchmaking queue on top of the Cluster abstraction.
 *
 * Storage layout (works identically on memory or Redis):
 *   mm:queue                 → ZSET member=userId, score=queuedAt (FIFO by time)
 *   mm:meta:{userId}         → JSON { userId, displayName, averageLevel, trainedness, queuedAt }
 *   mm:pair-lock             → short-lived lock during atomic pair selection
 *
 * Multi-node: on Redis this state is shared. Any node's `tryPair` uses the
 * cluster lock to make sure only one node walks the queue at a time (avoids
 * two nodes ZREMing the same pair). Memory backend gets the same code path
 * for free.
 *
 * Pairing brackets: two independent bounds that both must be satisfied,
 * each widening over queue wait time so nobody sits forever:
 *   level bracket       → |avgLevel_a − avgLevel_b|   ≤ 5   + 5×⌊wait/3s⌋
 *   trainedness bracket → |trainedness_a − trainedness_b| ≤ 100 + 100×⌊wait/3s⌋
 *
 * Interface is async. Old sync `Matchmaker` callers must migrate — the
 * pairing loop in lobby/ws.ts already runs in an async context.
 */
import { config } from '../config.js';
import { log } from '../util/log.js';
import { getCluster, type Cluster } from '../cluster/index.js';

const QUEUE_TTL_MS = 5 * 60 * 1000;
const BRACKET_START = 5;
const BRACKET_WIDEN_MS = 3_000;
const TRAINEDNESS_BRACKET_START = 100;
const TRAINEDNESS_BRACKET_WIDEN_MS = 3_000;
const PAIR_LOCK_KEY = 'mm:pair-lock';
const PAIR_LOCK_TTL_SEC = 2;
const QUEUE_KEY = 'mm:queue';
const META_KEY = (userId: string): string => `mm:meta:${userId}`;

export type QueueEntry = {
  userId: string;
  displayName: string;
  averageLevel: number;
  /** Party's average total stat bonus (hp+en+atk+def+int+spd). 0 for
   *  untrained; ~800 for a fully-trained party per the current stage pools.
   *  See `partyTrainedness()` in roster/routes.ts. */
  trainedness: number;
  queuedAt: number;
};

export type MatchPair = { a: QueueEntry; b: QueueEntry };

export interface Matchmaker {
  enqueue(entry: QueueEntry): Promise<'queued' | 'already-queued' | 'full'>;
  dequeue(userId: string): Promise<boolean>;
  tryPair(): Promise<MatchPair | null>;
  size(): Promise<number>;
  snapshot(): Promise<QueueEntry[]>;
  purgeStale(now?: number): Promise<number>;
  isQueued(userId: string): Promise<boolean>;
}

async function readMeta(cluster: Cluster, userId: string): Promise<QueueEntry | null> {
  const raw = await cluster.get(META_KEY(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QueueEntry>;
    if (typeof parsed.userId !== 'string' || typeof parsed.displayName !== 'string') return null;
    return {
      userId: parsed.userId,
      displayName: parsed.displayName,
      averageLevel: typeof parsed.averageLevel === 'number' ? parsed.averageLevel : 1,
      trainedness: typeof parsed.trainedness === 'number' ? parsed.trainedness : 0,
      queuedAt: typeof parsed.queuedAt === 'number' ? parsed.queuedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

class ClusterMatchmaker implements Matchmaker {
  async enqueue(entry: QueueEntry): Promise<'queued' | 'already-queued' | 'full'> {
    const cluster = await getCluster();
    if (await this.isQueued(entry.userId)) return 'already-queued';
    const size = await cluster.zcard(QUEUE_KEY);
    if (size >= config.MAX_CONCURRENT_MATCHES * 4) return 'full';
    await cluster.set(META_KEY(entry.userId), JSON.stringify(entry), Math.ceil(QUEUE_TTL_MS / 1000));
    await cluster.zadd(QUEUE_KEY, entry.queuedAt, entry.userId);
    log.info('mm.enqueue', { userId: entry.userId, size: size + 1, nodeId: config.NODE_ID });
    return 'queued';
  }

  async dequeue(userId: string): Promise<boolean> {
    const cluster = await getCluster();
    const removed = await cluster.zrem(QUEUE_KEY, userId);
    await cluster.del(META_KEY(userId));
    if (removed > 0) log.info('mm.dequeue', { userId, nodeId: config.NODE_ID });
    return removed > 0;
  }

  async isQueued(userId: string): Promise<boolean> {
    const cluster = await getCluster();
    return (await cluster.get(META_KEY(userId))) !== null;
  }

  async size(): Promise<number> {
    const cluster = await getCluster();
    return cluster.zcard(QUEUE_KEY);
  }

  async snapshot(): Promise<QueueEntry[]> {
    const cluster = await getCluster();
    const members = await cluster.zrange(QUEUE_KEY, 0, -1);
    const metas = await Promise.all(members.map((m) => readMeta(cluster, m.member)));
    return metas.filter((m): m is QueueEntry => m !== null);
  }

  async purgeStale(now: number = Date.now()): Promise<number> {
    const cluster = await getCluster();
    const cutoff = now - QUEUE_TTL_MS;
    const members = await cluster.zrange(QUEUE_KEY, 0, -1);
    const stale = members.filter((m) => m.score < cutoff);
    if (stale.length === 0) return 0;
    await Promise.all(stale.flatMap((m) => [cluster.zrem(QUEUE_KEY, m.member), cluster.del(META_KEY(m.member))]));
    return stale.length;
  }

  /**
   * Atomic across the cluster via a short-lived lock. Under contention only
   * one node walks the queue at a time; the others get null and try again on
   * the next tick.
   */
  async tryPair(): Promise<MatchPair | null> {
    const cluster = await getCluster();
    const token = await cluster.lock(PAIR_LOCK_KEY, PAIR_LOCK_TTL_SEC);
    if (!token) return null;
    try {
      const members = await cluster.zrange(QUEUE_KEY, 0, 24);
      if (members.length < 2) return null;
      const metas = await Promise.all(members.map((m) => readMeta(cluster, m.member)));
      const entries = metas.filter((m): m is QueueEntry => m !== null);
      const now = Date.now();
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i]!;
        const wait = now - a.queuedAt;
        const widenedLevel = BRACKET_START + Math.floor(wait / BRACKET_WIDEN_MS) * BRACKET_START;
        const widenedTrained =
          TRAINEDNESS_BRACKET_START + Math.floor(wait / TRAINEDNESS_BRACKET_WIDEN_MS) * TRAINEDNESS_BRACKET_START;
        for (let j = i + 1; j < entries.length; j++) {
          const b = entries[j]!;
          if (b.userId === a.userId) continue;
          if (Math.abs(a.averageLevel - b.averageLevel) > widenedLevel) continue;
          if (Math.abs(a.trainedness - b.trainedness) > widenedTrained) continue;
          const removed = await cluster.zrem(QUEUE_KEY, a.userId, b.userId);
          await cluster.del(META_KEY(a.userId));
          await cluster.del(META_KEY(b.userId));
          if (removed < 2) continue;
          log.info('mm.pair', {
            a: a.userId,
            b: b.userId,
            levelGap: Math.abs(a.averageLevel - b.averageLevel),
            trainednessGap: Math.abs(a.trainedness - b.trainedness),
            nodeId: config.NODE_ID,
          });
          return { a, b };
        }
      }
      return null;
    } finally {
      await cluster.unlock(PAIR_LOCK_KEY, token);
    }
  }
}

export const matchmaker: Matchmaker = new ClusterMatchmaker();

/**
 * Boot-time hydration. With cluster-backed storage this is essentially a
 * status ping — Redis already holds the queue across restarts and the memory
 * backend starts empty. We just report the size for logs.
 */
export async function hydrateMatchmaking(): Promise<number> {
  const n = await matchmaker.size();
  if (n > 0) log.info('mm.hydrate.ok', { count: n });
  return n;
}

/** Test / admin: nuke the queue via `snapshot() → dequeue(each)`. */
export async function resetMatchmaking(): Promise<void> {
  const snap = await matchmaker.snapshot();
  await Promise.all(snap.map((e) => matchmaker.dequeue(e.userId)));
}
