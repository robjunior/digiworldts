/**
 * Cluster coordination layer.
 *
 * Abstracts the primitives that a multi-node deployment needs to share:
 *   - key/value with TTL         (sessions, presence, per-user routing)
 *   - sorted sets                 (matchmaking queue, ordered by queuedAt)
 *   - pub/sub                     (chat, presence broadcast, battle events,
 *                                  cross-node action forwarding)
 *
 * Two implementations, picked by `config.CLUSTER`:
 *   - `memory` (default) — single process, no external service, zero setup.
 *     Everything lives in Maps and an EventEmitter.
 *   - `redis`             — ioredis-backed. Any number of nodes can share
 *     state. Requires REDIS_URL.
 *
 * Every method is async so callers write the same code for both backends.
 * The factory `getCluster()` returns the singleton for this process.
 */
import { config } from '../config.js';
import { log } from '../util/log.js';

export type ZMember = { member: string; score: number };
export type Unsubscribe = () => void | Promise<void>;
export type MessageHandler = (message: string, channel: string) => void;

export interface Cluster {
  readonly kind: 'memory' | 'redis';

  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  expire(key: string, ttlSec: number): Promise<boolean>;

  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<ZMember[]>;
  zcard(key: string): Promise<number>;

  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe>;
  psubscribe(pattern: string, handler: MessageHandler): Promise<Unsubscribe>;

  /**
   * Try to acquire a short-lived lock. Returns a token if acquired, null
   * otherwise. Callers MUST release via `unlock(key, token)` — passing the
   * wrong token is a no-op (fencing).
   */
  lock(key: string, ttlSec: number): Promise<string | null>;
  unlock(key: string, token: string): Promise<boolean>;

  close(): Promise<void>;
}

let instance: Cluster | null = null;

/** Get (and lazily construct) the process-wide Cluster instance. */
export async function getCluster(): Promise<Cluster> {
  if (instance) return instance;
  if (config.CLUSTER === 'redis') {
    const { RedisCluster } = await import('./redis.js');
    instance = await RedisCluster.create(config.REDIS_URL!);
    log.info('cluster.init', { kind: 'redis', nodeId: config.NODE_ID });
  } else {
    const { MemoryCluster } = await import('./memory.js');
    instance = new MemoryCluster();
    log.info('cluster.init', { kind: 'memory', nodeId: config.NODE_ID });
  }
  return instance;
}

/** Close and drop the singleton — used by tests / graceful shutdown. */
export async function closeCluster(): Promise<void> {
  if (!instance) return;
  await instance.close();
  instance = null;
}
