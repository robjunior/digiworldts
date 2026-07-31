import { config } from '../config.js';
import { CommandRateLimitError } from './wrapper.js';

const WINDOW_MS = 60_000;
const PRUNE_EVERY_N_CHECKS = 256;

type Bucket = number[];
const buckets = new Map<string, Bucket>();
let checkCount = 0;

export type RateLimitKind = 'default' | 'buy';

function enforceRateLimit(bucketKey: string, limit: number): void {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const hits = (buckets.get(bucketKey) ?? []).filter((t) => t > cutoff);
  hits.push(now);
  buckets.set(bucketKey, hits);
  if (++checkCount % PRUNE_EVERY_N_CHECKS === 0) prune(cutoff);
  if (hits.length > limit) throw new CommandRateLimitError();
}

function prune(cutoff: number): void {
  for (const [key, hits] of buckets.entries()) {
    if (hits.length === 0 || hits[hits.length - 1]! < cutoff) buckets.delete(key);
  }
}

export function enforceCommandRateLimit(userId: string, kind: RateLimitKind = 'default'): void {
  enforceRateLimit(`cmd:${userId}`, config.RATE_LIMIT_COMMANDS);
  if (kind === 'buy') enforceRateLimit(`buy:${userId}`, config.RATE_LIMIT_BUY);
}

export function __resetRateLimitCacheForTests(): void {
  buckets.clear();
  checkCount = 0;
}
