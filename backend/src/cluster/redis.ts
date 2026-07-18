/**
 * Redis-backed Cluster implementation using ioredis.
 *
 * Two connections are used:
 *   - `main` for commands (get/set/zadd/publish/etc.)
 *   - `sub`  for SUBSCRIBE/PSUBSCRIBE (Redis blocks the connection while
 *            in subscriber mode, so we keep this one dedicated)
 *
 * Lock: SET key token NX EX ttl (Redis atomic). Unlock: a Lua CAS that only
 * deletes if the stored token matches — prevents A releasing B's lock.
 *
 * Every ioredis call is already promise-based so the shape matches the
 * MemoryCluster line-for-line.
 */
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import type { Cluster, MessageHandler, Unsubscribe, ZMember } from './index.js';

const UNLOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

export class RedisCluster implements Cluster {
  readonly kind = 'redis' as const;

  private constructor(private readonly main: Redis, private readonly sub: Redis) {}

  static async create(url: string): Promise<RedisCluster> {
    const main = new Redis(url, { maxRetriesPerRequest: 3, enableAutoPipelining: true });
    const sub = new Redis(url, { maxRetriesPerRequest: 3 });
    await Promise.all([main.ping(), sub.ping()]);
    return new RedisCluster(main, sub);
  }

  // ----- KV -----

  async get(key: string): Promise<string | null> {
    return this.main.get(key);
  }

  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    if (ttlSec && ttlSec > 0) await this.main.set(key, value, 'EX', ttlSec);
    else await this.main.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.main.del(key);
  }

  async keys(pattern: string): Promise<string[]> {
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.main.scan(cursor, 'MATCH', pattern, 'COUNT', '200');
      for (const k of batch) out.push(k);
      cursor = next;
    } while (cursor !== '0');
    return out;
  }

  async expire(key: string, ttlSec: number): Promise<boolean> {
    return (await this.main.expire(key, ttlSec)) === 1;
  }

  // ----- Sorted set -----

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.main.zadd(key, score, member);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.main.zrem(key, ...members);
  }

  async zrange(key: string, start: number, stop: number): Promise<ZMember[]> {
    const flat = await this.main.zrange(key, start, stop, 'WITHSCORES');
    const out: ZMember[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      const member = flat[i];
      const scoreStr = flat[i + 1];
      if (member === undefined || scoreStr === undefined) continue;
      out.push({ member, score: Number(scoreStr) });
    }
    return out;
  }

  async zcard(key: string): Promise<number> {
    return this.main.zcard(key);
  }

  // ----- Pub/sub -----

  async publish(channel: string, message: string): Promise<number> {
    return this.main.publish(channel, message);
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe> {
    await this.sub.subscribe(channel);
    const listener = (ch: string, msg: string): void => {
      if (ch === channel) handler(msg, ch);
    };
    this.sub.on('message', listener);
    return async () => {
      this.sub.off('message', listener);
      const remaining = this.sub.listenerCount('message');
      if (remaining === 0) await this.sub.unsubscribe(channel);
    };
  }

  async psubscribe(pattern: string, handler: MessageHandler): Promise<Unsubscribe> {
    await this.sub.psubscribe(pattern);
    const listener = (pat: string, ch: string, msg: string): void => {
      if (pat === pattern) handler(msg, ch);
    };
    this.sub.on('pmessage', listener);
    return async () => {
      this.sub.off('pmessage', listener);
      const remaining = this.sub.listenerCount('pmessage');
      if (remaining === 0) await this.sub.punsubscribe(pattern);
    };
  }

  // ----- Locks -----

  async lock(key: string, ttlSec: number): Promise<string | null> {
    const token = randomBytes(12).toString('hex');
    const ok = await this.main.set(key, token, 'EX', ttlSec, 'NX');
    return ok === 'OK' ? token : null;
  }

  async unlock(key: string, token: string): Promise<boolean> {
    const res = await this.main.eval(UNLOCK_SCRIPT, 1, key, token);
    return res === 1;
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.main.quit(), this.sub.quit()]);
  }
}
