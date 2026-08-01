---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Cluster migration
  - Enable redis cluster
  - Memory to redis
  - Scale up cluster
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/cluster/index.ts
  - backend/src/cluster/memory.ts
  - backend/src/cluster/redis.ts
  - docker-compose.yml
  - docker-compose.multinode.yml
verified-at-commit: 13dc16b
---

# Migrate CLUSTER=memory → redis

> [!info] When to use this
> - Scaling from single-node to multi-node.
> - You want session / matchmaking / battle state to survive backend
>   restarts (memory mode doesn't persist).
> - Moving from `pnpm dev` to a real staging deploy.

## Impact

**All in-flight cluster state dies at cutover.** Sessions, presence,
matchmaking queue, live battle snapshots — everything that lived in
`MemoryCluster` is in-process; the moment you restart the backend with
`CLUSTER=redis`, it's talking to a fresh empty Redis.

- Users get logged out (their `session:{token}` isn't in Redis yet).
- Live battles are lost (`battle:snap:{matchId}` gone — a mid-match
  restart already loses these in memory mode, so no NEW pain).
- Chat backlog: N/A (chat is fire-and-forget pub/sub).
- Farm, roster, wallet, catalog: **unaffected** — durable DB state.

Not a live migration. Plan a maintenance window (~2 minutes is enough
if you're not migrating data).

## Prerequisites

- A Redis instance reachable from the backend, with AUTH configured.
  Bundled compose ships one; managed Redis (Upstash / Redis Cloud /
  self-hosted) works identically.
- `REDIS_PASSWORD` value ready.
- The backend already type-checks against `RedisCluster` — the code path
  is production tested (see [`test/cluster-crossnode.mts`](backend/test/cluster-crossnode.mts)).

## Steps

### 1. Bring Redis online

**Using the bundled compose:**

```bash
docker compose up -d redis
# → digiworld-redis-1 running, healthchecked
```

The service (from [`docker-compose.yml`](docker-compose.yml)) runs
Redis 7-alpine with `--appendonly yes --requirepass ${REDIS_PASSWORD}`.
AOF persistence means AofF replay on restart preserves sessions
+ matchmaking + battle snapshots.

**Using managed Redis:**

Provision a Redis 7+ instance. Note the connection string:

```
redis://:<password>@<host>:<port>
```

### 2. Update env

Both variables are required for `CLUSTER=redis`:

| Variable          | Value                                       |
| ----------------- | ------------------------------------------- |
| `CLUSTER`         | `redis`                                     |
| `REDIS_URL`       | `redis://:${REDIS_PASSWORD}@redis:6379` (or managed URL) |
| `REDIS_PASSWORD`  | matches the one Redis is booted with        |

**Dev**: edit `.env`.

**Staging / production**: `Settings > Environments > … > Variables` +
`Secrets`. See [[Environments#Required secrets]] for the full matrix.

### 3. Restart the backend

Single-node:
```bash
docker compose restart backend
```

Multi-node:
```bash
docker compose -f docker-compose.multinode.yml up -d --no-deps game-node1 game-node2
```

Boot log confirms the switch:

```json
{"msg":"cluster.init","kind":"redis","nodeId":"..."}
```

If you still see `kind:"memory"`, the env didn't land — check the
running container's environment:

```bash
docker exec digiworld-backend-1 env | grep -E '(CLUSTER|REDIS_URL)'
```

### 4. Sanity-check the cluster is doing work

```bash
# Session created on login
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD KEYS 'session:*'
# → session:abc...

# Presence key populated
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD KEYS 'presence:*'

# ZSETs for matchmaking + user sessions
docker exec digiworld-redis-1 redis-cli -a $REDIS_PASSWORD TYPE mm:queue
# → zset
```

Also see [[Cluster Coordination Layer#What lives in the cluster]] for the
full key/channel map.

### 5. Notify users

Post-restart, everyone gets `{code:'unauth'}` on their next request. The
frontend redirects to `/login`. Send a heads-up before the restart if
the user base is small and reachable.

## Multi-node bring-up (going from 1 → 2+ nodes)

Same runbook, plus:

1. Bring up node2 with a distinct `NODE_ID`:
   ```yaml
   NODE_ID: game-node2
   CLUSTER: redis
   REDIS_URL: same
   DATABASE_URL: same
   SESSION_SECRET: same
   ```

2. Add node2 to nginx `upstream`:
   ```nginx
   upstream game_backend {
     ip_hash;
     server game-node1:3000;
     server game-node2:3000;
   }
   ```

3. `docker compose reload nginx` (or reload the config out-of-band).

4. Verify cross-node behaviour with the test suite:
   ```bash
   REDIS_URL=redis://:$REDIS_PASSWORD@127.0.0.1:6379 \
     pnpm --filter @digiworld/backend test:cluster
   # → 18 / 18 pass
   ```
   The test spins up TWO `RedisCluster` instances against ONE Redis to
   prove KV + ZSET + lock + pub/sub cross instances. See
   [[Cluster Coordination Layer#Testing]].

## Rollback

If Redis is misbehaving mid-session, flip back to memory mode:

```bash
# Revert env
CLUSTER=memory   # comment out REDIS_URL / REDIS_PASSWORD

docker compose restart backend
```

Users lose sessions again (same as forward migration). Redis stays
around; you can leave the service up for the next attempt.

## What can go wrong

> [!warning] Wrong `REDIS_PASSWORD`
> Backend boots but every `cluster.set()` throws `NOAUTH Authentication
> required`. The healthcheck on Redis passes because it uses the same
> password from the compose env — but a hand-edited `REDIS_URL` can
> drift. Check both are the same value.

> [!warning] Redis network unreachable
> `RedisCluster.create` calls `main.ping()` + `sub.ping()` at boot; if
> Redis is unreachable, boot fails fast:
> ```
> Error: connect ECONNREFUSED redis:6379
> ```
> Don't retry-loop — fix the config, then bring the backend back up.

> [!warning] Two backends with the SAME `SESSION_SECRET` but DIFFERENT `REDIS_URL`
> Sessions can't cross-authenticate. Users bounce between "logged in" on
> node1 and 401 on node2. Ensure every game-node points at the SAME
> Redis instance.

> [!warning] AOF disabled on production Redis
> `--appendonly yes` is the default in the bundled compose. If you're
> pointing at a managed Redis WITHOUT AOF / persistence, every restart
> loses sessions + live battles. The game will still work but the UX
> gets rough (mid-match reboots break the match). Verify persistence is
> on for anything more than dev.

## Related

- [[Cluster Coordination Layer]] — the interface + backend contract
- [[Multi-node Deployment]] — the full multi-node topology
- [[Environments#Required secrets]] — `REDIS_PASSWORD` provenance
- [[Session cookies#Session storage in the cluster]] — what actually
  moves
