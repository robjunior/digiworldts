---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Recover matchmaking queue
  - Stuck queue
  - Reset matchmaking
  - Matchmaking hung
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/matchmaking/queue.ts
  - backend/src/cluster/index.ts
verified-at-commit: 13dc16b
---

# Recover a stuck matchmaking queue

> [!info] When to use this
> Players report "I've been in the queue for 10 minutes and nothing
> happens." OR players who logged out are stuck in the queue and can't
> re-queue after logging back in. OR the queue count in admin dashboards
> is clearly wrong (higher than the number of online players).

## Diagnosis first

Three failure modes present the same symptom. Distinguish them before
acting — the fix differs.

### Symptom check

**Is the ticker actually running?** Every 500 ms tick logs pair
attempts at INFO on a successful pair. Silence for minutes = ticker
dead:

```bash
docker logs digiworld-backend-1 --since 5m 2>&1 | grep -E "(mm\.pair|mm\.enqueue|mm\.dequeue|mm\.hydrate)" | tail -20
```

If you see `mm.enqueue` lines but no `mm.pair` → ticker is running, no
matches are being made (bracket check failing? party sizes off?). If
you see NOTHING → the pairing loop crashed. Check for exceptions:

```bash
docker logs digiworld-backend-1 --since 15m 2>&1 | grep -iE "error|throw|uncaught" | tail
```

### Queue introspection

Direct Redis inspection ([[Cluster Coordination Layer#What lives in
the cluster]] for the full key map):

```bash
# Every queued userId (with wait time as score)
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  ZRANGE mm:queue 0 -1 WITHSCORES

# Total count
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  ZCARD mm:queue

# Per-user meta (party stats)
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  KEYS 'mm:meta:*'
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  GET mm:meta:usr_ABC123
```

Also inspect the pair lock — if a node crashed while holding it, the
TTL should have cleared it (2 s TTL per
[`queue.ts:32`](backend/src/matchmaking/queue.ts:32)) but drift
happens:

```bash
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  GET mm:pair-lock

docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  TTL mm:pair-lock
```

TTL > 2 → someone held it too long (should never happen in memory
mode; possible on a wedged Redis).

## Failure mode A — one user stuck (wrong meta / stale entry)

Most common: one specific player is stuck. Their meta may be corrupt
(bad JSON), OR their `queuedAt` in the ZSET may be from an old
session that never got dequeued.

### Fix

Dequeue them via the runtime API:

```bash
# From inside the backend container — hits the same code path the
# ticker's cleanup uses (dequeue via matchmaker singleton).
docker exec -it digiworld-backend-1 node --input-type=module -e '
import { matchmaker } from "/app/backend/dist/matchmaking/queue.js";
const removed = await matchmaker.dequeue("usr_ABC123");
console.log({ removed });
process.exit(0);
'
```

Or directly via Redis (equivalent, more surgical):

```bash
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  ZREM mm:queue usr_ABC123

docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  DEL mm:meta:usr_ABC123
```

Player can now re-queue.

## Failure mode B — the pair lock is stuck

Rare but possible on a Redis with clock drift or a killed node mid-hold.

### Fix

Manually release the lock. The Lua CAS unlock rejects a wrong token
— but a straight `DEL` bypasses that:

```bash
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  DEL mm:pair-lock
```

> [!warning] Don't `DEL` while a real node is pairing
> If a legitimate `tryPair()` is mid-walk and you `DEL` the lock, a
> second node could start a competing walk. The `ZREM` guard in
> [`queue.ts:167-170`](backend/src/matchmaking/queue.ts:167) prevents
> double-pair, but you may see a spike of `changes < 2` warnings.
> Prefer a 5-second wait for TTL expiry over the manual `DEL`.

## Failure mode C — the pairing loop crashed (or never started)

The 500 ms pairing tick lives in
[`backend/src/lobby/ws.ts`](backend/src/lobby/ws.ts). If it threw an
uncaught exception in `tryPair()` OR the interval was never scheduled,
matches simply don't happen.

### Fix

Restart the backend. Boot re-hydrates the queue from the cluster
(`hydrateMatchmaking()` logs count) and restarts the tick:

```bash
docker compose restart backend                 # single-node
docker compose restart game-node1 game-node2   # multi-node
```

Verify with the log:

```bash
docker logs digiworld-backend-1 --since 30s 2>&1 | grep -E "(mm\.hydrate|server\.listening)"
# → mm.hydrate.ok { count: N }
# → server.listening
```

## Full nuclear — reset the whole queue

Only when nothing else works OR a schema change in `QueueEntry`
invalidated every meta blob. Uses `resetMatchmaking()` from
[`queue.ts:196`](backend/src/matchmaking/queue.ts:196):

```typescript
export async function resetMatchmaking(): Promise<void> {
  const snap = await matchmaker.snapshot();
  await Promise.all(snap.map((e) => matchmaker.dequeue(e.userId)));
}
```

Invocation:

```bash
docker exec -it digiworld-backend-1 node --input-type=module -e '
import { resetMatchmaking } from "/app/backend/dist/matchmaking/queue.js";
await resetMatchmaking();
console.log("queue reset");
process.exit(0);
'
```

Or the equivalent Redis wipe:

```bash
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD DEL mm:queue

# Wipe every mm:meta:* key (SCAN + DEL — never use KEYS in production)
docker exec digiworld-redis-1 sh -c '
  redis-cli -a "$REDIS_PASSWORD" --scan --pattern "mm:meta:*" | \
    xargs -r redis-cli -a "$REDIS_PASSWORD" DEL
'

# Also drop the lock in case it was stuck
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD DEL mm:pair-lock
```

Impact: every queued user loses their spot. They get a fresh WS
`queue` event on next tick showing them as `'idle'`. They re-queue
manually.

## Post-fix verification

Watch a queue → pair cycle in real time:

```bash
docker logs digiworld-backend-1 --since 5s -f 2>&1 | grep -E "mm\."
```

In a browser: two test accounts each `/queue` join → expect a `match`
event within 500 ms + one queue-widen bracket.

Confirm zero orphans:

```bash
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD ZCARD mm:queue
# → matches the count of players currently expecting a match
```

## Preventive: stale purge

The ticker calls `purgeStale()` periodically (verify — cadence lives
in `lobby/ws.ts`), sweeping entries older than
`QUEUE_TTL_MS = 5 min`
([`queue.ts:22`](backend/src/matchmaking/queue.ts:22)). If purge
never runs, stale entries accumulate over hours. Check with:

```bash
# Any queued members with score older than 5 min?
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD \
  eval 'return redis.call("ZRANGEBYSCORE", KEYS[1], 0, ARGV[1])' \
  1 mm:queue "$(($(date +%s%3N) - 300000))"
```

Non-empty result = stale purge isn't firing → escalate to
[[#Failure mode C]].

## What can go wrong

> [!warning] Redis-cli command wrong version
> `docker exec` uses the container's redis-cli (7.x). If you're
> using host redis-cli against a networked Redis, verify version
> parity — some scan syntaxes differ.

> [!warning] `KEYS mm:meta:*` on production
> `KEYS` is O(N) and blocks the whole Redis instance. Use `SCAN`
> (or `--scan` on redis-cli). See [[Cluster Coordination Layer#KEYS
> via SCAN]].

> [!warning] Manual DEL races with legitimate ops
> The runtime `matchmaker.dequeue()` is safer than raw `ZREM` +
> `DEL` because it goes through the same singleton the ticker uses.
> Prefer the Node-inside-container variant unless you're
> troubleshooting Redis itself.

## Related

- [[Matchmaking and MMR]] — the system reference
- [[Cluster Coordination Layer#What lives in the cluster]] — key map
- [[Migrate cluster memory to redis]] — related recovery scenario
- [[WebSocket Protocol#queue]] — the client-side queue message
