---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Cluster failover
  - Redis failover
  - Redis replacement
  - Cluster migration Redis to Redis
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/cluster/redis.ts
  - backend/src/cluster/index.ts
  - docker-compose.multinode.yml
verified-at-commit: 13dc16b
---

# Cluster failover (Redis → Redis)

> [!info] When to use this
> - Current Redis instance is misbehaving (OOM, high latency, connection
>   drops, corruption on AOF replay).
> - Planned maintenance — moving to a bigger instance, upgrading Redis
>   version, migrating between hosts / providers.
> - Fresh production deploy after a `pnpm dev` phase where you don't
>   want to inherit dev state.
> - Scaling up (managed provider migration: local → Upstash / Redis
>   Cloud / self-hosted).

For **memory → redis** (initial Cluster switch), use
[[Migrate cluster memory to redis]] instead. This runbook is
**redis → redis**.

## Impact

Two failover shapes with very different impact:

- **Warm failover** (dump + restore) — sessions, matchmaking, live
  battles come across. Users don't notice unless the window is long.
- **Cold cutover** (drop old, start fresh new) — every cluster key
  dies. Sessions invalidated, queued players kicked, in-flight
  battles lost.

Cold is simpler; warm is user-friendlier.

### What's at stake (from [[Cluster Coordination Layer#What lives in
the cluster]])

- `session:{token}` + `usessions:{userId}` — sessions
- `mm:queue` + `mm:meta:*` — matchmaking
- `battle:snap:*` + `battle:lock:*` + `battle:spectators:*` — live matches
- `chat:*`, `wsdeliver:*` — chat + WS delivery (pub/sub — no persistent
  state)
- `presence:*` — 30-second TTL, re-populates in seconds
- `oauth:state:*`, `oauth:pending:*`, `reset:*` — short-lived (10-15 min)
- `scene:defaults:updated`, `weather:triggered` — pub/sub
- `seasons:close` — lock, TTL 30 s

Persistent state that MATTERS: sessions, matchmaking queue, battle
snapshots. Everything else regenerates on its own.

## Prerequisites

- New Redis instance provisioned + reachable from every game node.
- Same or new `REDIS_PASSWORD` (new is safer if this is triggered by a
  leak).
- Access to update `REDIS_URL` env on all game nodes.
- For warm failover: `redis-cli` on a host that can reach BOTH
  instances.

## Path A — cold cutover (simple, users get kicked)

Fastest. Everyone re-authenticates + re-queues + loses in-flight
battles.

### Steps

1. **Bring up the new Redis.** Managed provider: provision + get
   connection string. Docker: adjust the compose file to swap the
   `redis` service to a new image / config.

2. **Update `REDIS_URL` + `REDIS_PASSWORD` on every game node.**
   Env-file edit (dev) or GH Secrets update (staging/prod).

3. **Rolling restart the game nodes.**

   Single-node:
   ```bash
   docker compose restart backend
   ```

   Multi-node — restart one at a time to keep the site up:
   ```bash
   docker compose -f docker-compose.multinode.yml restart game-node1
   sleep 10
   docker compose -f docker-compose.multinode.yml restart game-node2
   ```

   Each restart's boot log shows the new connection:
   ```
   {"msg":"cluster.init","kind":"redis","nodeId":"..."}
   ```

4. **Verify** cluster is receiving writes:
   ```bash
   docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD KEYS 'session:*' | head
   ```
   After a fresh login + queue join, you should see `session:*`,
   `presence:*`, `mm:queue` populate.

5. **Retire the old Redis.** Once you've confirmed the new one is
   handling all traffic (no game nodes still connected to the old),
   stop the old service.

## Path B — warm failover (dump + restore)

Users don't get kicked. Takes longer.

### Steps

1. **Bring up the new Redis** — same as Path A step 1.

2. **Snapshot the OLD Redis** with `BGSAVE`:
   ```bash
   docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD BGSAVE
   docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD LASTSAVE
   # Wait for LASTSAVE to advance — means the RDB file is written
   ```

   Copy the RDB out:
   ```bash
   docker cp digiworld-redis-1:/data/dump.rdb /tmp/dump.rdb
   ```

3. **Load the RDB into the new Redis.**

   **If new is a docker service you control:**
   ```bash
   docker cp /tmp/dump.rdb <new-redis-container>:/data/dump.rdb
   docker restart <new-redis-container>
   # New Redis reads the RDB on boot
   ```

   **If new is a managed Redis** (no filesystem access):
   Use `redis-cli --pipe` to stream every key via `DUMP` / `RESTORE`:

   ```bash
   docker exec digiworld-redis-1 sh -c '
     redis-cli -a $REDIS_PASSWORD --scan --pattern "*" | while read key; do
       ttl=$(redis-cli -a $REDIS_PASSWORD PTTL "$key")
       # PTTL: -2 = expired, -1 = no ttl, else ms
       [ "$ttl" = "-2" ] && continue
       [ "$ttl" = "-1" ] && ttl=0
       payload=$(redis-cli -a $REDIS_PASSWORD --no-raw DUMP "$key" | head -c-1)
       echo "RESTORE $key $ttl $payload REPLACE"
     done
   ' | redis-cli -h <new-host> -p <new-port> -a <new-password>
   ```

   The pipe works between any two Redis instances of compatible
   versions — the RDB format is stable within a major.

4. **Update `REDIS_URL` on the game nodes.** Same as Path A step 2.

5. **Rolling restart.** Same as Path A step 3.

6. **Verify hydration.** Boot log should still show the pre-failover
   counts:
   ```bash
   docker logs digiworld-backend-1 --since 30s 2>&1 | \
     grep -E "(mm\.hydrate|cluster\.init|server\.listening)"
   # Expected:
   # cluster.init { kind: 'redis' }
   # mm.hydrate.ok { count: N }   (matches pre-failover)
   # server.listening
   ```

7. **Retire old Redis.**

## Path C — provider failover (managed → managed)

Same as Path B, with the added twist that you may not have shell
access to either side. Do the dump + restore via a bastion / jump
host that can reach both.

Some managed Redis providers (AWS ElastiCache, Redis Enterprise Cloud)
offer built-in migration tools — check the provider docs for
`SLAVEOF` / `REPLICAOF` setup which lets the new instance replicate
from the old, then promote.

## Multi-node coordination

If you have `game-node1` + `game-node2` (per [[Multi-node
Deployment]]):

- **Rolling restart** — do them one at a time so the site stays
  reachable. `ip_hash` on nginx re-routes traffic to whichever is up.
- **Session pinning** — during the window a game node is down, users
  on IT lose their WS. On reconnect, they're routed to the healthy
  node (if only one is up) OR back to their pinned node (if it's back
  up). Both cases resume from cluster state.
- **Race window** — for ~10 s during the rolling restart, the two
  nodes might briefly point at DIFFERENT Redis instances if you
  misaligned the env update. Verify EVERY node has the new URL
  BEFORE restarting any of them.

## Verification checklist

Post-failover, in order:

- [ ] `cluster.init { kind: 'redis' }` on every game node's boot log
- [ ] `mm.hydrate.ok` count reasonable (matches pre-failover for
      warm failover; 0 for cold)
- [ ] `presence:user:*` keys start appearing within 15 s (existing
      WS clients push presence)
- [ ] New user can log in (fresh `session:*` written)
- [ ] Fresh queue join → pair test works end-to-end
- [ ] Battle snapshot: kick off a fight, look for
      `battle:snap:mtc_...` in cluster

If cold, expect users to complain about being logged out — that's
by design. Set expectations in advance if possible.

## Rollback

Point the game nodes back at the OLD Redis by reverting `REDIS_URL`
and rolling-restarting. Assuming the OLD instance is still up and
serving, the state from mid-failover comes back.

Not clean if any writes hit the new Redis first (those writes are
gone on rollback). Warm failover is safer for rollback because the
old still has the pre-cutover state; cold rollback loses everything
written during the failover window.

## What can go wrong

> [!warning] Password mismatch
> `REDIS_PASSWORD` differs from the new Redis's `--requirepass`.
> Boot fails with `NOAUTH Authentication required` — see
> [[Migrate cluster memory to redis#What can go wrong]].

> [!warning] Old node still holding a connection
> One game node still points at the OLD Redis after cutover. Writes
> split-brain between old and new — users on that node still have
> their old session, users on other nodes don't. Fix: `docker ps` +
> verify every game node's env has the new `REDIS_URL`.

> [!warning] AOF replay slow on new Redis
> If you `docker cp` a large RDB (5+ GB) into a fresh Redis, first
> boot takes minutes. Watch the log; don't restart during replay.

> [!warning] Managed Redis rejects DUMP/RESTORE
> Some managed providers disable `DUMP` for security. Fallback: use
> `redis-cli --scan | redis-cli SET ... EXPIRE ...` per key. Slower
> but works.

> [!warning] Version skew
> `DUMP` payload is stable within a Redis major but NOT across
> majors. Migrating Redis 6 → Redis 7: cold cutover only.

## Related

- [[Cluster Coordination Layer]] — what state actually lives in Redis
- [[Multi-node Deployment#Redis with AOF]] — the persistence config
  that decides how much survives a restart
- [[Migrate cluster memory to redis]] — the initial cluster switch
- [[Rotate SESSION_SECRET]] — sibling rotation runbook (also
  invalidates sessions)
- [[Postgres backup and restore]] — the DB-side equivalent runbook
