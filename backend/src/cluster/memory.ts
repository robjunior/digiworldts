/**
 * In-process Cluster implementation. Used when CLUSTER=memory (single-node).
 *
 * KV entries have optional expiry (setTimeout-driven).
 * Sorted sets use Map<key, Map<member, score>> and sort on read.
 * Pub/sub uses an EventEmitter (channel + pattern).
 * Locks use a Map with fencing tokens.
 *
 * No external dependencies; behavior is identical to Redis for the subset
 * we use so callers write one code path.
 */
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { Cluster, MessageHandler, Unsubscribe, ZMember } from './index.js';

type Expiry = { value: string; timer: NodeJS.Timeout | null };

export class MemoryCluster implements Cluster {
  readonly kind = 'memory' as const;

  private readonly kv = new Map<string, Expiry>();
  private readonly zsets = new Map<string, Map<string, number>>();
  private readonly bus = new EventEmitter();
  private readonly locks = new Map<string, { token: string; timer: NodeJS.Timeout }>();

  constructor() {
    this.bus.setMaxListeners(0);
  }

  // ----- KV -----

  async get(key: string): Promise<string | null> {
    return this.kv.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    const prior = this.kv.get(key);
    if (prior?.timer) clearTimeout(prior.timer);
    const timer = ttlSec && ttlSec > 0
      ? setTimeout(() => { this.kv.delete(key); }, ttlSec * 1000)
      : null;
    if (timer) timer.unref?.();
    this.kv.set(key, { value, timer });
  }

  async del(key: string): Promise<number> {
    let removed = 0;
    const prior = this.kv.get(key);
    if (prior) {
      if (prior.timer) clearTimeout(prior.timer);
      this.kv.delete(key);
      removed = 1;
    }
    // Redis `DEL` is polymorphic: it removes any key regardless of type.
    // MemoryCluster stores KV and ZSET in separate Maps, so drop from both.
    if (this.zsets.delete(key)) removed = 1;
    return removed;
  }

  async keys(pattern: string): Promise<string[]> {
    const re = globToRe(pattern);
    const out = new Set<string>();
    for (const k of this.kv.keys()) if (re.test(k)) out.add(k);
    for (const k of this.zsets.keys()) if (re.test(k)) out.add(k);
    return Array.from(out);
  }

  async expire(key: string, ttlSec: number): Promise<boolean> {
    const prior = this.kv.get(key);
    if (!prior) return false;
    if (prior.timer) clearTimeout(prior.timer);
    const timer = setTimeout(() => { this.kv.delete(key); }, ttlSec * 1000);
    timer.unref?.();
    prior.timer = timer;
    return true;
  }

  // ----- Sorted set -----

  async zadd(key: string, score: number, member: string): Promise<void> {
    let z = this.zsets.get(key);
    if (!z) { z = new Map(); this.zsets.set(key, z); }
    z.set(member, score);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    let removed = 0;
    for (const m of members) if (z.delete(m)) removed += 1;
    if (z.size === 0) this.zsets.delete(key);
    return removed;
  }

  async zrange(key: string, start: number, stop: number): Promise<ZMember[]> {
    const z = this.zsets.get(key);
    if (!z) return [];
    const sorted = Array.from(z.entries())
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      .map(([member, score]) => ({ member, score }));
    const end = stop < 0 ? sorted.length + stop + 1 : stop + 1;
    return sorted.slice(start < 0 ? Math.max(0, sorted.length + start) : start, end);
  }

  async zcard(key: string): Promise<number> {
    return this.zsets.get(key)?.size ?? 0;
  }

  // ----- Pub/sub -----

  async publish(channel: string, message: string): Promise<number> {
    let count = 0;
    for (const listener of this.bus.listeners(channelEvent(channel))) {
      count += 1;
      (listener as (m: string, c: string) => void)(message, channel);
    }
    for (const [pattern, handlers] of this.patterns) {
      const re = globToRe(pattern);
      if (re.test(channel)) {
        for (const h of handlers) { h(message, channel); count += 1; }
      }
    }
    return count;
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe> {
    const wrapped = (m: string, c: string) => handler(m, c);
    this.bus.on(channelEvent(channel), wrapped);
    return async () => { this.bus.off(channelEvent(channel), wrapped); };
  }

  private readonly patterns = new Map<string, Set<MessageHandler>>();

  async psubscribe(pattern: string, handler: MessageHandler): Promise<Unsubscribe> {
    let set = this.patterns.get(pattern);
    if (!set) { set = new Set(); this.patterns.set(pattern, set); }
    set.add(handler);
    return async () => {
      const s = this.patterns.get(pattern);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.patterns.delete(pattern);
    };
  }

  // ----- Locks -----

  async lock(key: string, ttlSec: number): Promise<string | null> {
    if (this.locks.has(key)) return null;
    const token = randomBytes(12).toString('hex');
    const timer = setTimeout(() => { this.locks.delete(key); }, ttlSec * 1000);
    timer.unref?.();
    this.locks.set(key, { token, timer });
    return token;
  }

  async unlock(key: string, token: string): Promise<boolean> {
    const held = this.locks.get(key);
    if (!held || held.token !== token) return false;
    clearTimeout(held.timer);
    this.locks.delete(key);
    return true;
  }

  async close(): Promise<void> {
    for (const e of this.kv.values()) if (e.timer) clearTimeout(e.timer);
    for (const l of this.locks.values()) clearTimeout(l.timer);
    this.kv.clear();
    this.zsets.clear();
    this.locks.clear();
    this.bus.removeAllListeners();
    this.patterns.clear();
  }
}

function channelEvent(channel: string): string {
  return `ch:${channel}`;
}

// Redis-style glob → JS RegExp. Supports * (any run) and ? (single char).
function globToRe(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}
