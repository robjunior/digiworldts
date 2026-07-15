/**
 * Matchmaking queue on top of the Cluster abstraction.
 *
 * Storage layout (works identically on memory or Redis):
 *   mm:queue                 → ZSET member=userId, score=queuedAt (FIFO by time)
 *   mm:meta:{userId}         → JSON { userId, displayName, averageLevel, queuedAt }
 *   mm:pair-lock             → short-lived lock during atomic pair selection
 *
 * Multi-node: on Redis this state is shared. Any node's `tryPair` uses the
 * cluster lock to make sure only one node walks the queue at a time (avoids
 * two nodes ZREMing the same pair). Memory backend gets the same code path
 * for free.
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
const PAIR_LOCK_KEY = 'mm:pair-lock';
const PAIR_LOCK_TTL_SEC = 2;
const QUEUE_KEY = 'mm:queue';
const META_KEY = (userId: string): string => `mm:meta:${userId}`;

export type QueueEntry = {
  userId: string;
  displayName: string;
  averageLevel: number;
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
    return JSON.parse(raw) as QueueEntry;
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
    const out: QueueEntry[] = [];
    for (const m of members) {
      const meta = await readMeta(cluster, m.member);
      if (meta) out.push(meta);
    }
    return out;
  }

  async purgeStale(now: number = Date.now()): Promise<number> {
    const cluster = await getCluster();
    const cutoff = now - QUEUE_TTL_MS;
    const members = await cluster.zrange(QUEUE_KEY, 0, -1);
    let dropped = 0;
    for (const m of members) {
      if (m.score < cutoff) {
        await cluster.zrem(QUEUE_KEY, m.member);
        await cluster.del(META_KEY(m.member));
        dropped += 1;
      }
    }
    return dropped;
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
      const entries: QueueEntry[] = [];
      for (const m of members) {
        const meta = await readMeta(cluster, m.member);
        if (meta) entries.push(meta);
      }
      const now = Date.now();
      for (let i = 0; i < entries.length; i++) {
        const a = entries[i]!;
        const wait = now - a.queuedAt;
        const widened = BRACKET_START + Math.floor(wait / BRACKET_WIDEN_MS) * BRACKET_START;
        for (let j = i + 1; j < entries.length; j++) {
          const b = entries[j]!;
          if (b.userId === a.userId) continue;
          if (Math.abs(a.averageLevel - b.averageLevel) > widened) continue;
          const removed = await cluster.zrem(QUEUE_KEY, a.userId, b.userId);
          await cluster.del(META_KEY(a.userId));
          await cluster.del(META_KEY(b.userId));
          if (removed < 2) continue;
          log.info('mm.pair', {
            a: a.userId,
            b: b.userId,
            gap: Math.abs(a.averageLevel - b.averageLevel),
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
  for (const e of snap) await matchmaker.dequeue(e.userId);
}
