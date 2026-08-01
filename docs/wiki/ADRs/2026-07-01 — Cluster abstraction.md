---
tags:
  - digiworld/adr
aliases:
  - Cluster Abstraction
  - Cluster Interface ADR
  - ADR-004
created: 2026-07-01
updated: 2026-08-01
status: Accepted
grounded-in:
  - backend/src/cluster/index.ts
  - backend/src/cluster/memory.ts
  - backend/src/cluster/redis.ts
verified-at-commit: 4e70621
---

# 2026-07-01 — Cluster interface abstraction (memory ⇔ redis)

> [!info] Status
> **Accepted** and shipped. Landed with the multi-node retrofit — the
> [`Cluster`](backend/src/cluster/index.ts:26) interface predates
> `1bbb090`/`ee635a7` and is the substrate every cross-node feature
> rides on. See [[Cluster Coordination Layer]] for the reference.

## Context

DigiWorld shipped as a single-node game: sessions in-process,
matchmaking in-process, presence in-process. Two problems became
inevitable:

1. **Deploy shape locked in.** Scaling required a rewrite, not a
   configuration flip. Every module that touched shared state
   (sessions, matchmaking, chat, presence, battle snapshots) knew
   about Maps and EventEmitters directly.
2. **Local dev needed Redis to test multi-node.** For a game where 90%
   of engineering happens on `pnpm dev`, forcing a Redis service on
   every developer's laptop is a friction tax that pays for itself
   only during production incidents.

The naive approach — "just import ioredis everywhere" — locks in
option 2. The other naive approach — "leave single-node code, rewrite
before scaling" — locks in option 1 with interest.

## Decision

**One `Cluster` interface, two backends** —
[`MemoryCluster`](backend/src/cluster/memory.ts) and
[`RedisCluster`](backend/src/cluster/redis.ts). Every module that
needs cross-node state consumes the interface via
[`getCluster()`](backend/src/cluster/index.ts:58), never the concrete
backends. Picked at boot by `config.CLUSTER = 'memory' | 'redis'`.

The interface exposes the smallest useful subset of Redis primitives
that our domain needs — verbatim from
[`cluster/index.ts:26-53`](backend/src/cluster/index.ts:26):

```typescript
export interface Cluster {
  readonly kind: 'memory' | 'redis';

  // KV
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  expire(key: string, ttlSec: number): Promise<boolean>;

  // Sorted set (matchmaking queue, user session index)
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, ...members: string[]): Promise<number>;
  zrange(key: string, start: number, stop: number): Promise<ZMember[]>;
  zcard(key: string): Promise<number>;

  // Pub/sub (chat, cross-node WS, admin broadcasts)
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe>;
  psubscribe(pattern: string, handler: MessageHandler): Promise<Unsubscribe>;

  // Distributed lock (matchmaking pair, battle mutation)
  lock(key: string, ttlSec: number): Promise<string | null>;
  unlock(key: string, token: string): Promise<boolean>;

  close(): Promise<void>;
}
```

Everything is async so callers write ONE code path against both
backends.

## Consequences

### Positive

- **Zero-dep local dev.** `pnpm dev` with `CLUSTER=memory` (default)
  runs the full game with no external services. Developers debug
  code paths that will run in production against Redis by exercising
  the SAME abstraction on `MemoryCluster`.
- **Sync test suite for cross-node behavior.**
  [`test/cluster-crossnode.mts`](backend/test/cluster-crossnode.mts) spins
  up TWO `RedisCluster` instances against ONE Redis and verifies KV,
  ZSET, distributed lock, and pub/sub cross instances. 18 / 18 pass
  in ~5s. Same test suite works against `MemoryCluster` (single-instance
  variant, cross-tab isn't relevant).
- **Deploy shape is a one-line flip.** `CLUSTER=redis
  REDIS_URL=redis://…` in the env, restart, done. See [[Migrate cluster
  memory to redis]] for the runbook.
- **Contract-first migrations.** New multi-node features design against
  the interface (`lock` / `zrange` / `publish`). If it fits the shape,
  it works on both backends. If it doesn't, we know before shipping.
- **Refactor safety.** Redis-specific tricks — `enableAutoPipelining`,
  SCAN vs KEYS, Lua CAS unlock — hide behind the interface. Improving
  performance on the RedisCluster doesn't leak assumptions to callers.

### Negative

- **We deliberately don't expose full Redis.** No hashes (`HSET`), no
  streams, no transactions (`MULTI/EXEC`), no scripts beyond the fixed
  unlock. Adding a new primitive means updating both backends AND every
  caller — friction is by design (keeps the surface small) but occasionally
  frustrating.
- **`MemoryCluster` behavior isn't a byte-for-byte Redis emulation.** For
  the subset we use, it matches. Edge cases like exact TTL rounding or
  `KEYS` pattern globbing edge cases differ — see
  [`cluster/memory.ts::globToRe`](backend/src/cluster/memory.ts:181).
  Any caller reaching into implementation details of one backend risks
  drift.
- **In-process pub/sub via EventEmitter has different failure modes.**
  A slow subscriber blocks the publisher; Redis pub/sub doesn't. For
  our use (chat + wsdeliver, both non-blocking), this is fine —
  something to remember when adding new subscribers.

### Neutral

- **`kind: 'memory' | 'redis'`** is exposed on the interface. Callers
  that legitimately want to branch on backend (rare) can — but
  generally you shouldn't; the point is to write one code path.
- **Lock TTL semantics differ slightly.** Redis: hard TTL at second
  granularity; Memory: `setTimeout` at millisecond precision but
  process-lifetime bounded. Both are 2 s in the matchmaking case,
  and the guarded ZREM is the last-line correctness check.

## Rejected alternatives

### Just use ioredis directly

Simpler at first — no interface, no adapter. Rejected because it
locks in the deploy shape and forces Redis on every dev machine. The
local-dev friction cost was expected to be many hours per developer per
year.

### Pretend the memory backend doesn't exist, ship Redis-only

An improvement over ioredis-directly: use the interface, but only ship
one implementation. Rejected because a fresh clone should be `pnpm
dev` runnable in <30s. The DX loss of "start Redis first" is bigger
than the runtime cost of a Map-based implementation.

### Full Redis emulation (like ioredis-mock)

We could shell out `MemoryCluster` to an in-process library that emulates
the whole Redis command set. Rejected because it drags in a dependency
just to support commands we don't use, and library emulation drifts from
real Redis over time.

### Redis Cluster mode from day one

Skip standalone Redis, start with Redis Cluster. Rejected because
Redis Cluster has real complexity (hash slots, cross-slot operations
banned) that we don't need until we're hitting standalone Redis limits.
Ioredis supports Redis Cluster transparently — the day we outgrow one
Redis, we swap the connection string. See
[[Multi-node Deployment#Scaling past two nodes]].

## Related

- [[Cluster Coordination Layer]] — the system reference
- [[Multi-node Deployment]] — how the abstraction lands in prod
- [[Migrate cluster memory to redis]] — the runbook
- [[Database Adapter]] — the SIBLING abstraction (SQLite ⇔ Postgres)
  built on the same principle
