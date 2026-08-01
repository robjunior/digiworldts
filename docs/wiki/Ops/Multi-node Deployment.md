---
tags:
  - digiworld/ops
aliases:
  - Multi-node
  - Horizontal Scaling
  - Cluster Deployment
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - docker-compose.multinode.yml
  - backend/src/cluster/redis.ts
  - backend/src/cluster/index.ts
  - README.md
verified-at-commit: 97f72ba
---

# Multi-node Deployment

> [!info] TL;DR
> Two game nodes behind nginx `ip_hash`, sharing ONE Redis (cluster state)
> + ONE Postgres (durable data). Every multi-node feature — sessions,
> presence, chat, matchmaking, live battle state, cross-node WS delivery —
> rides the [[Cluster Coordination Layer|Cluster]] abstraction. Bundled
> compose file at [`docker-compose.multinode.yml`](docker-compose.multinode.yml).

## Topology

```mermaid
flowchart LR
  Cli[Clients]
  subgraph Edge
    N[nginx :8080<br/>ip_hash upstream]
  end
  subgraph Nodes
    G1[game-node1<br/>Fastify + WS]
    G2[game-node2<br/>Fastify + WS]
  end
  subgraph State
    R[(Redis :6379<br/>AUTH + AOF)]
    P[(Postgres :5432)]
  end

  Cli --> N
  N -->|ip_hash sticky| G1
  N -->|ip_hash sticky| G2
  G1 <--> R
  G2 <--> R
  G1 --> P
  G2 --> P
```

Both game nodes share Redis for cluster state (sessions, presence, chat,
matchmaking queue, live battle state, cross-node WS delivery) and Postgres
for durable data (users, roster, wallet, matches, farm, catalog metadata).

`ip_hash` sticky routing keeps a client's WebSocket pinned to a single
node for the connection's lifetime. Sessions in Redis mean HTTP fallback
still works even if the client hits the other node. Battle events and
match starts route to the correct node via `wsdeliver:{userId}` pub/sub
so a wrong-node HTTP request finds its way home.

## Bring-up

```bash
docker compose -f docker-compose.multinode.yml up --build
# Open http://localhost:8080/
```

Boots five containers:

- `digiworld-postgres-1` — Postgres 16-alpine, healthcheck via `pg_isready`
- `digiworld-redis-1` — Redis 7-alpine, `--appendonly yes`, AUTH via
  `REDIS_PASSWORD`, healthcheck via `redis-cli ping`
- `digiworld-game-node1-1` — Fastify backend + WS handler, `NODE_ID=game-node1`
- `digiworld-game-node2-1` — mirror of node1 with `NODE_ID=game-node2`
- `digiworld-nginx-1` — nginx 1.27-alpine at `:8080` → 80 internally, config
  from [`deploy/nginx.conf`](../deploy/nginx.conf)

The compose file uses YAML anchors ([`docker-compose.multinode.yml:71-83`](../docker-compose.multinode.yml:71))
so node2 inherits node1's build + volumes + healthcheck definition:

```yaml
game-node1: &game
  build: .
  container_name: digiworld-game-node1-1
  depends_on:
    redis: { condition: service_healthy }
    postgres: { condition: service_healthy }
  environment:
    NODE_ENV: production
    NODE_ID: game-node1
    HOST: 0.0.0.0
    PORT: 3000
    CLUSTER: redis
    REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
    DATABASE: postgres
    DATABASE_URL: postgres://digiworld:${POSTGRES_PASSWORD}@postgres:5432/digiworld
    SESSION_SECRET: ${SESSION_SECRET:?SESSION_SECRET is required min 32 chars ...}
    ADMIN_BOOTSTRAP: open
  volumes:
    - gamedata:/data
    - ./backend/public/assets/digimon:/app/backend/public/assets/digimon
    - ./backend/data/catalog:/app/backend/data/catalog
    - ./backend/data/dialogues:/app/backend/data/dialogues:ro

game-node2:
  <<: *game
  container_name: digiworld-game-node2-1
  environment:
    NODE_ID: game-node2
    # ...same env, only NODE_ID differs
```

## What crosses nodes

Same table as [[Architecture Overview#What crosses nodes (Redis mode)]],
expanded:

| Feature       | Cluster keys                                | Cross-node behaviour                                                        |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| Sessions      | `session:{token}` (KV, TTL)                 | Any node authenticates any cookie via cluster GET                           |
| Presence      | `presence:user:{userId}` (KV, TTL 30 s)     | Every node scans presence keys every 15 s for the global online list       |
| Chat (global) | `chat:global` (pub/sub)                     | Every node's WS clients see every message                                  |
| Chat (rooms/DMs) | `wsdeliver:{userId}` (pub/sub psubscribe) | Membership validated on the sending node; delivery fans out per userId    |
| Matchmaking   | `mm:queue` (ZSET, member=userId, score=queuedAt) + `mm:pair-lock` (lock) | Any node's queued player pairs with any other; `mm:pair-lock` serialises pairing |
| Battle state  | `battle:snap:{matchId}` (KV, TTL 30 min)    | Any node serves any player's actions; mutations serialised via `battle:lock:{matchId}` |
| WS delivery   | `wsdeliver:{userId}` (pub/sub psubscribe pattern) | Battle events / match starts route to whichever node hosts that user's socket |
| Scene defaults | `scene:defaults:updated` (pub/sub)         | Admin write → every node fans out `scene-defaults-updated` WS msg          |
| Weather trigger | `weather:triggered` (pub/sub)             | Admin trigger → every node fans out `weather-triggered` WS msg             |

## Postgres — mandatory here

Multi-node with SQLite is technically possible (both nodes bind-mount the
same `.db` file with WAL), but Postgres is the recommended and default
option. `docker-compose.multinode.yml` ships `DATABASE=postgres` by
default.

`DATABASE=postgres` is fully wired end-to-end:

- 15+ route/module files (`auth`, `session`, `roster`, `farm`, `battle`,
  `matchmaking`, `lobby`, `admin`, `shop`, `friends`, `daily`, `buffs`,
  `verifier`, `skullbot`, `cli`, `scenes`, `particle-presets`) route
  through the async [`DbAdapter`](backend/src/db/adapter.ts) via `q()` /
  `one()` / `run()` / `tx()`.
- `?` placeholders in SQL constants translated to `$1, $2, …` at query
  time by [`toPgPlaceholders()`](backend/src/db/adapter.ts:83). Same SQL
  string works on both backends. See [[Database Adapter]].
- Portability verified by
  [`test/postgres-portability.mts`](backend/test/postgres-portability.mts)
  — 63 / 63 `SQL_*` constants `PREPARE`d cleanly against real Postgres
  18 via `@electric-sql/pglite`, plus 13 / 13 end-to-end roundtrips.

## To pin to SQLite (local demo)

Swap the two commented `DATABASE` lines in each `game-node` service:

```yaml
# DATABASE: sqlite            # SQLite fallback
# DB_PATH: /data/digiworld.db # shared via the `gamedata` volume
```

Drop the `postgres` service, use the `gamedata` volume as the shared
SQLite storage. Two nodes writing to the same SQLite file need:

- **Shared volume** (already present as `gamedata` in the compose)
- **WAL mode** (enabled by default in
  [`SqliteAdapter.create()`](backend/src/db/sqlite.ts:83))

For real production, keep Postgres.

## Redis with AOF

Redis is booted with `--appendonly yes`, so battle snapshots + sessions
survive a Redis restart. Startup replays the AOF; live matches pick back
up from `battle:snap:{matchId}` via
[`hydrateActiveMatches()`](backend/src/battle/routes.ts).

The healthcheck uses `redis-cli -a $REDIS_PASSWORD ping` — the AUTH is
mandatory (`--requirepass ${REDIS_PASSWORD:?…}`) so a misconfigured
`.env` with an empty password fails at bring-up, not at first WS connect.

## Session pinning vs socket pinning

Two levels of stickiness:

- **Socket** — nginx `ip_hash` upstream keeps a WS pinned to the node
  that accepted the upgrade. WebSocket is a stateful protocol; a
  mid-connection node hop would drop.
- **Session** — cookies are stateless. Any node validates any cookie via
  cluster `GET session:{token}`. HTTP requests can round-robin across
  nodes without harm; the WS stays sticky for its lifetime.

`ip_hash` is chosen over `sticky cookie` because it's the least-effort
scheme that doesn't require nginx-plus. Downside: two clients behind the
same NAT go to the same node — fine for a game (small tenant sizes),
not fine for a public API with millions of unique IPs.

## Cross-node testing

[`test/cluster-crossnode.mts`](backend/test/cluster-crossnode.mts) spins
up TWO `RedisCluster` instances against one real Redis and verifies:

- KV cross-instance visibility
- ZSET reads seeing writes from either instance
- Distributed lock (SET NX EX + Lua CAS release) atomic across instances
- Pub/sub — chat and wsdeliver psubscribe messages cross instances

**18 / 18 pass**, proving the substrate every multi-node feature depends on:

```bash
REDIS_URL=redis://127.0.0.1:6400 pnpm --filter @digiworld/backend test:cluster
```

## Scaling past two nodes

The compose file happens to have two `game-node*` services because that's
what fits on a single VM comfortably. There's nothing two-specific in the
code:

- Add `game-node3`, `game-node4`, … to compose (`<<: *game` inherits).
- Set unique `NODE_ID` for each (used in logs, not routing).
- Add each to the nginx `upstream` block in
  [`deploy/nginx.conf`](../deploy/nginx.conf).

Every cluster operation is O(1) or O(log n) per instance, so nodes are
independent. The bottleneck at very large scale would be Redis
(single-instance) — for that you'd swap to Redis Cluster mode, which the
`ioredis` client supports transparently.

## Boot sequence per node

Same as single-node ([[Architecture Overview#Boot sequence]]):

1. Cluster init (`cluster.init` kind=redis)
2. Catalog load
3. Asset verifier
4. DB init + migrations
5. Idempotent seeds (shop, farm recipes, skills, quests)
6. Plugin registration
7. Hydrate active state from cluster —
   [`hydrateActiveMatches()`](backend/src/battle/routes.ts) reports
   the cluster count; matchmaking rehydrates from `mm:queue`.
8. `app.listen()`

Both nodes run the same sequence in parallel. Migration races are
handled by the `schema_versions` primary-key ledger in
[`migrator.ts`](backend/src/db/migrator.ts) — see [[Database Adapter#Ledger + race safety]].

## nginx config sketch

[`deploy/nginx.conf`](../deploy/nginx.conf) — verify the exact directives.
Key blocks:

```nginx
upstream game_backend {
  ip_hash;                       # sticky per client IP for WebSocket
  server game-node1:3000;
  server game-node2:3000;
}

server {
  listen 80;

  location / {
    proxy_pass http://game_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;   # WS upgrade
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;                 # long-lived WS
  }
}
```

## Related

- [[Architecture Overview]]
- [[Cluster Coordination Layer]] — the abstraction the whole stack rides on
- [[Database Adapter]] — the DbAdapter interface + portability tests
- [[Environments]] — how staging/production env values reach these nodes
- [[Session cookies]] — how cross-origin cookies flip on when
  `CORS_ORIGINS` is set
