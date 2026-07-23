# DigiWorld

A Digimon-style 3v3 real-time MMO — Node.js + TypeScript, Fastify + native WebSocket, better-sqlite3, argon2id auth. Ships with a scraper that pulls the full Digimon Story roster from [`api.skullbot.fr`](https://api.skullbot.fr/digimon) (portraits + evolution graph) and enriches each entry with attack techniques from [wikimon.net](https://wikimon.net).

**Status**: backend fully operational; full HTTP + WebSocket smoke test passes end-to-end. Frontend renders across 6 pages (`login`, `lobby`, `combat`, `roster`, `farm`, `admin`).

---

## Design at a glance

| Layer | Choice | Why |
|---|---|---|
| HTTP | Fastify 5 | fastest mainstream Node server; native TS types |
| Realtime | `ws` via `@fastify/websocket` | lowest-overhead WS; scales to 1000+ concurrent |
| DB | `better-sqlite3` | synchronous, single-file, no external service; WAL for concurrent readers |
| Auth | Argon2id + HttpOnly cookies | OWASP-recommended; server-side revoke, sliding renewal |
| Validation | Zod v4 | one schema, both runtime + inferred TS types |
| Catalog | XML via `fast-xml-parser` | edit-friendly, human-readable, admin-mutable |
| Scraper | `fetch` + regex | zero-dep, defensive against site drift |

**First-user-is-admin**: registration is **always open** by default. The *first* user to register (via `/api/auth/register`) is flagged `is_admin=1`; every subsequent registration is a regular player (`is_admin=0`). Set `ADMIN_BOOTSTRAP=closed` in the environment to lock registration entirely — useful once the game is live and you don't want new signups.

**Server-authoritative combat**: clients submit `{ type: 'act', matchId, action }` and receive full `BattleView` snapshots. No client-side damage math. Cheating is a lookup failure at worst.

**Live asset check on every startup**: `src/scraper/verifier.ts` walks the loaded XML catalog and re-downloads any portrait/dot that is missing or truncated on disk. Idempotent — noop on a clean install.

---

## Prerequisites

- Node.js 22+ (Node 24 tested)
- pnpm 10+ (`corepack enable && corepack use pnpm@latest`)
- A C toolchain for `better-sqlite3` and `argon2` native builds (build-essential on Debian, `xcode-select --install` on macOS)

---

## Install

```bash
git clone <this-repo> digiworld && cd digiworld
pnpm install
```

`pnpm-workspace.yaml` already whitelists native builds for `argon2`, `better-sqlite3`, and `esbuild`.

---

## First-time setup

You have TWO paths — pick the one you prefer.

### Path A — CLI first, then register (recommended)

Populate the scraped-source table + XML catalog + assets BEFORE the first user registers, so their starter roster seeds cleanly:

```bash
pnpm scrape --list                    # fetches ~434 Digimon into scraped_catalog
pnpm scrape --enrich --limit 20       # pulls attacks from wikimon.net, writes data/catalog/digimons.xml
pnpm scrape --assets --limit 20       # downloads portrait.webp + dot.gif per entry
pnpm dev                              # start the server on http://localhost:3000
```

Then open `http://localhost:3000/`, register the first user — they will be the game admin automatically. Their starter roster is populated with 3 random Rookies from the catalog.

### Path B — Register first, then seed from the Admin UI

```bash
pnpm dev
```

Register the first user via the browser. Because the catalog is empty at first register, the starter roster seeding is deferred (register succeeds with an empty roster). Then:

1. Go to `/admin.html`.
2. Click **Refresh from skullbot** — the scraped list populates.
3. Click **Add to catalog** on however many Digimon you want (each add pulls the attacks from wikimon).
4. Go to `/roster.html` and click **Try to seed starter roster** — you now have 3 starter Digimon.

Both paths converge on the same state.

---

## Run

```bash
# dev — tsx watch, auto-restart on source change
pnpm dev

# production — build first
pnpm build
pnpm start
```

### Environment variables (all optional)

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | bind address |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | drives cookie `Secure` flag |
| `NODE_ID` | random `node-{hex}` | identifies this node in cluster logs |
| `CLUSTER` | `memory` | `memory` (single-node) or `redis` (multi-node) |
| `REDIS_URL` | — | required when `CLUSTER=redis`, e.g. `redis://redis:6379` |
| `DATABASE` | `sqlite` | `sqlite` (default) or `postgres` (once the DB refactor lands) |
| `DATABASE_URL` | — | required when `DATABASE=postgres` |
| `DB_PATH` | `data/digiworld.db` | SQLite file (when `DATABASE=sqlite`) |
| `CATALOG_XML` | `data/catalog/digimons.xml` | catalog source of truth |
| `ASSETS_DIR` | `public/assets/digimon` | portrait + dot cache root |
| `SESSION_SECRET` | auto-generated & persisted in `data/.session-secret` | cookie sign key |
| `SESSION_TTL_HOURS` | `168` (7 days) | sliding renewal |
| `ADMIN_BOOTSTRAP` | `open` | set to `closed` to disable new registrations entirely (first-registered user is always the admin regardless) |
| `SCRAPER_MIN_DELAY_MS` | `150` | polite throttle between upstream requests |
| `SCRAPER_USER_AGENT` | see `src/config.ts` | identifies us to upstream hosts |
| `MAX_LOBBY_CONNECTIONS` | `1200` | hard cap on live WS sockets |
| `MAX_CONCURRENT_MATCHES` | `200` | hard cap on live 3v3 battles |

---

## Multi-node deployment

Single-node (default) needs zero setup — `pnpm dev` and go. For real
horizontal scaling, the server ships with a two-tier abstraction:

- **Cluster** (`src/cluster/`) — sessions, presence, chat, matchmaking
  queue, and live battle state route through a shared coordination layer.
  Two backends: `memory` (in-process; default) and `redis` (ioredis).
- **DbAdapter** (`src/db/adapter.ts`) — async interface for durable data.
  Two impls: `sqlite` (better-sqlite3, default) and `postgres` (pg pool).
  Every route file routes through this via the `q()` / `one()` / `run()` /
  `tx()` helpers in `src/db/index.ts`; sync `prep()` is retained for legacy
  callers but throws when `DATABASE !== 'sqlite'` so misuse fails loud.

### Single-node (dev)

```bash
pnpm dev                  # CLUSTER=memory, DATABASE=sqlite (defaults)
```

### Multi-node (production)

Bundled docker-compose spins up 1× Postgres + 1× Redis + 2× game nodes
behind nginx (`ip_hash` for WebSocket stickiness).

```bash
docker compose -f docker-compose.multinode.yml up --build
# open http://localhost:8080/
```

Key env vars per game node:

```
NODE_ID=game-node1               # unique per node, used in logs
CLUSTER=redis
REDIS_URL=redis://redis:6379
DATABASE=postgres                # or 'sqlite' (default)
DATABASE_URL=postgres://digiworld:digiworld@postgres:5432/digiworld
SESSION_SECRET=<32+ char secret>
```

### What crosses nodes

All of these work identically on the memory backend and on Redis:

| Feature | Cluster key(s) | Cross-node behavior |
|---|---|---|
| Sessions | `session:{token}` (KV, TTL) | Any node authenticates any cookie |
| Presence | `presence:user:{userId}` (KV, TTL 30s) | Global online list refreshed every 15s |
| Chat | `chat:global` (pub/sub) | Every node's WS clients see every message |
| Matchmaking | `mm:queue` (ZSET) + `mm:pair-lock` (lock) | Any node's queued player pairs with any other; atomic pairing via `cluster.lock` |
| Battle state | `battle:snap:{matchId}` (KV, TTL 30m) | Any node can serve any player's actions; mutations serialized via `battle:lock:{matchId}` |
| WS delivery | `wsdeliver:{userId}` (pub/sub via psubscribe pattern) | Battle events / match starts route to whichever node hosts that user's WebSocket |

### Postgres

`DATABASE=postgres` is fully wired end-to-end:

- 15 route/module files (`auth`, `session`, `roster`, `farm`, `battle`,
  `matchmaking`, `lobby`, `admin`, `shop`, `friends`, `daily`, `buffs`,
  `verifier`, `skullbot`, `cli`) all route through the async `DbAdapter`
  via `q()` / `one()` / `run()` / `tx()`.
- `?` placeholders in SQL constants are translated to `$1, $2, …` at query
  time by the pg adapter — same SQL string works on both backends.
- Cross-database portability is verified by [`test/postgres-portability.mts`](test/postgres-portability.mts),
  a `pnpm test:pg-portability` regression test that loads
  `schema-pg.sql` into a real PostgreSQL 18.3 instance (via
  `@electric-sql/pglite` — actual Postgres C source compiled to WASM, no
  daemon required, ~15s per run, safe for CI) and:
  (a) applies the schema cleanly (238 lines, 15 tables),
  (b) `PREPARE`-s every `SQL_*` constant in the codebase against the real
      schema — **63/63 pass**, validating syntax, column names, types, and
      placeholder counts in one pass, and
  (c) end-to-end roundtrips the critical ops — register, case-insensitive
      login (via CITEXT), starter roster, farm building, shop `ON CONFLICT`
      upsert (verifying additive `qty + excluded.qty`), wallet credit
      upsert, resource upsert, admin scraped-catalog search, transaction
      commit + rollback — **13/13 pass**.
- Schema is `src/db/schema-pg.sql` (Postgres translation of `schema.sql`):
  `BIGSERIAL` PKs, `BIGINT` for ms timestamps (no 2038), `CITEXT` for
  username columns, partial indexes on unconsumed buffs.
- SQL constants use portable syntax: `LOWER(x) LIKE LOWER(?)` for
  case-insensitive matching, `CAST(? AS TEXT) IS NULL` for optional
  filters, table-qualified `ON CONFLICT DO UPDATE SET col = TBL.col + excluded.col`
  to avoid Postgres ambiguity.

```bash
# Local Postgres via docker (adjust password to taste)
docker run -d --name digiworld-pg \
  -e POSTGRES_USER=digiworld -e POSTGRES_PASSWORD=digiworld -e POSTGRES_DB=digiworld \
  -p 5432:5432 postgres:16-alpine

DATABASE=postgres \
DATABASE_URL=postgres://digiworld:digiworld@127.0.0.1:5432/digiworld \
CLUSTER=redis REDIS_URL=redis://127.0.0.1:6379 \
pnpm dev
```

`DATABASE=sqlite` (the default) also works on any deploy shape including
multi-node — but two nodes writing to the same SQLite file need a shared
volume + WAL (on by default) or per-node user pinning at the LB. For a
real production deploy, run Postgres.

---

## Directory layout

```
digiworld/
├── base/                          reference HTML the design was extracted from
├── data/
│   ├── catalog/digimons.xml       ← authoritative Digimon catalog (edit-safe)
│   ├── digiworld.db               ← SQLite (WAL mode)
│   └── .session-secret            ← auto-generated cookie signing key
├── public/                        ← static assets served by Fastify at /
│   ├── index.html                 login / register
│   ├── lobby.html                 presence + chat + queue + party overview
│   ├── combat.html                WS-driven 3v3 battle
│   ├── roster.html                owned Digimon grid + party picker
│   ├── farm.html                  4-building production (live tick)
│   ├── admin.html                 scraped-list browser + catalog editor
│   └── assets/
│       ├── css/{tokens,components}.css
│       ├── js/{api,ws,auth-guard}.js
│       └── digimon/{catalogId}/{portrait.webp,dot.gif}
├── src/
│   ├── config.ts                  Zod-validated env loader
│   ├── util/{log,ids}.ts
│   ├── db/{schema.sql,index.ts,init.ts}
│   ├── auth/{password,session,routes}.ts        argon2id + cookie sessions
│   ├── digimon/{types,element,xml}.ts           canonical types + XML I/O
│   ├── scraper/                                 skullbot + wikimon + assets + startup verifier
│   ├── farm/{engine,routes}.ts                  4 buildings, computed-on-read production
│   ├── progression/xp.ts                        XP curve + level growth
│   ├── battle/{types,engine,routes}.ts          server-authoritative 3v3 state machine
│   ├── roster/routes.ts                         starter seed + party slots + loadout resolver
│   ├── matchmaking/queue.ts                     FIFO with widening level bracket
│   ├── lobby/ws.ts                              main WS router + presence + pairing loop
│   ├── admin/routes.ts                          scraped-list + catalog CRUD
│   ├── social/{friends,shop,daily}.ts
│   └── server.ts                                entrypoint: verifier → plugins → listen
└── pnpm-workspace.yaml            allowBuilds for native modules
```

---

## HTTP surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | liveness |
| GET | `/api/auth/status` | — | `{ userCount, registrationOpen }` |
| POST | `/api/auth/register` | — | open by default; first registrant becomes admin. Returns 403 only when `ADMIN_BOOTSTRAP=closed` |
| POST | `/api/auth/login` | — | argon2id verify + set cookie |
| POST | `/api/auth/logout` | cookie | destroy session |
| POST | `/api/auth/reset-consume` | — | `{ token, newPassword }` — consume an admin-issued reset token, hashes the new password, invalidates all sessions for that user (10 attempts/IP/15min throttle) |
| GET | `/api/auth/me` | cookie | current user |
| GET | `/api/catalog` | user | full XML catalog |
| GET | `/api/roster` | user | owned Digimon + templates |
| POST | `/api/roster/seed` | user | retry starter seed if catalog was empty at register |
| POST | `/api/roster/party` | user | `{ slot: 0-2, monId }` |
| POST | `/api/roster/party/remove` | user | `{ slot }` |
| POST | `/api/roster/rename/:id` | user | `{ nickname }` |
| GET | `/api/farm` | user | balances + credits + buildings |
| POST | `/api/farm/collect` | user | bank all buildings |
| POST | `/api/farm/collect/:id` | user | bank one |
| POST | `/api/farm/upgrade/:id` | user | +25% rate, +20% cap, +60% cost |
| GET | `/api/shop` | user | items + inventory + credits |
| POST | `/api/shop/buy` | user | `{ itemId, qty }` |
| POST | `/api/shop/apply` | user | `{ itemId, monId? }` — consumes 1 item into a `pending_buff` (applied at next battle start for hp/en buffs, next win for xp mult) |
| POST | `/api/shop/use` | user | `{ itemId, qty }` (deprecated no-op decrement — kept for compat) |
| GET | `/api/daily` | user | 7-day cycle state |
| POST | `/api/daily/claim` | user | grants today's reward |
| GET | `/api/friends` | user | `{ friends, incoming, outgoing }` |
| POST | `/api/friends/request` | user | `{ username }` |
| POST | `/api/friends/accept` | user | `{ userId }` |
| POST | `/api/friends/remove` | user | `{ userId }` |
| POST | `/api/friends/block` | user | `{ userId }` |
| GET | `/api/scene/defaults` | user | per-arena `SceneSettings` (lighting / fog / camera / arena offsets) for the client to apply on top of its `DEFAULT_SETTINGS` + local overrides |
| POST | `/api/admin/scene-defaults` | admin | body: full `PerArenaSceneDefaults`. Persists to `data/scene-defaults.json` and publishes `scene:defaults:updated` on the cluster so every connected WS client invalidates its module cache |
| GET | `/api/chat/rooms/mine` | user | rooms the caller is a member of |
| POST | `/api/chat/room/create` | user | `{ name }` — creates a room + adds creator as owner+member |
| POST | `/api/chat/room/join` | user | `{ roomId }` — join an existing room (`kind='room'` only) |
| POST | `/api/chat/room/leave` | user | `{ roomId }` — remove caller from a room |
| POST | `/api/chat/dm/open` | user | `{ username }` — find-or-create a 2-member DM room with the given user |
| GET | `/api/admin/scraped-list` | admin | paginated + filterable |
| POST | `/api/admin/scrape/refresh` | admin | pull the skullbot list again |
| POST | `/api/admin/catalog/from-scraped` | admin | `{ skullbotId, enrich }` |
| POST | `/api/admin/catalog/custom` | admin | full `TemplateDigimon` body |
| PUT | `/api/admin/catalog/:id` | admin | replace (id must match) |
| DELETE | `/api/admin/catalog/:id` | admin | remove |
| POST | `/api/admin/assets/:id/download` | admin | force re-download portrait+dot |
| GET | `/api/battle/spectate/:matchId` | user | initial `BattleView` + `spectatorCount` for a live match. Any authenticated user can call it; enemy stats are redacted (matches side-A view). WS live updates via `spectate` message |
| POST | `/api/admin/users/:id/reset-token` | admin | issue a one-time password-reset token (`reset:{token}` in the cluster, TTL 15 min). Returns `{ token, expiresAt, url }` — hand the URL to the user, they consume via `/reset?token=...` and pick their own password |
| POST | `/api/admin/users/:id/reset-password` | admin | hard reset — admin types the new password directly |

---

## WebSocket protocol

Single endpoint: `GET /ws` — expects the session cookie on the upgrade request. Rejected sockets get a JSON `{ type: 'error', code: 'unauth' }` + close code `4401`.

### Client → server

```json
{ "type": "hello" }
{ "type": "ping" }
{ "type": "chat",  "text": "...", "room?": "rm_..." }
{ "type": "queue", "join": true|false }
{ "type": "act",   "matchId": "mtc_...",
  "action": { "type": "fight"|"skill"|"guard"|"flee", ... } }
{ "type": "spectate", "matchId": "mtc_...", "join": true|false }
```

Chat messages without `room` route through the global `chat:global` channel (broadcast to every online socket). With `room`, membership is validated against `chat_room_members` and the message fans out to each member's `wsdeliver:{userId}` channel.

### Server → client

```json
{ "type": "welcome",  "user": {...}, "presence": [...], "matchId?": "mtc_..." }
{ "type": "pong" }
{ "type": "presence", "users": [...], "count": N }
{ "type": "chat",     "from": "usr_...", "displayName": "...", "text": "...", "at": ms, "room?": "rm_..." }
{ "type": "queue",    "status": "idle"|"waiting"|"matched", "size": N }
{ "type": "match",    "matchId": "mtc_...", "view": BattleView }
{ "type": "battle",   "matchId": "mtc_...", "view": BattleView }
{ "type": "event",    "matchId": "mtc_...", "events": [BattleEvent, ...] }
{ "type": "end",      "matchId": "mtc_...", "view": BattleView, "outcome": "win_a"|... }
{ "type": "spectate", "matchId": "mtc_...", "status": "joined"|"left"|"full"|"not-found"|"already-in-match", "view?": BattleView, "count?": N }
{ "type": "scene-defaults-updated", "at": ms }
{ "type": "error",    "code": "not-your-turn"|..., "message": "..." }
```

Rate limits: chat is capped at **4 messages per 8 seconds per user** (server-side sliding window). Presence is broadcast every **3 seconds**. Matchmaking pairs every **500 ms** with a level bracket that widens 5 levels every 3 seconds a user has been queued.

---

## Combat rules (server-authoritative)

- Alternating turns. Active player picks ONE alive unit + ONE action.
- Actions: `fight` (basic attack, 0 EN), `skill` (from a 4-skill pool, gated by EN), `guard` (next incoming halved), `flee` (forfeit).
- Element affinity mirrors `base/combat.html`: `fire > nature > water > fire`, `electric > water`. Weak = 1.5×, resist = 0.5×.
- Miss chance 8%, crit chance 15% (×1.6). Damage: `(atk*0.4 + skill.power) * crit * affinity * defMitigation * guard * (0.9-1.1)`.
- Ailments: `burn`/`poison` are DoT (6-5% of hpMax per turn), `weaken` reduces effective defense, `freeze`/`stun`/`sleep` skip the turn.
- Match end triggers wallet grant: **60 credits for a win, 25 for a draw, 15 for a loss**, plus XP scaled by opponent level differential.

---

## Farm rules

Every player starts with 4 buildings (Meat Farm, Bit Foundry, Data Spire, Bio Lab). Production is **computed on read** from `last_touch` + `ratePerHour`, capped at `capacity`. Collect banks the accrued value into `resources` and resets the checkpoint. Upgrade costs DigiCredits, raises rate by 25%, capacity by 20%, and the next upgrade cost by 60%.

---

## XML catalog format

```xml
<catalog version="1" updatedAt="1720000000000">
  <digimon id="skb-317" name="Agumon" stage="Rookie" attribute="Vaccine"
           element="nature" wikimonSlug="Agumon"
           sourceUrl="https://api.skullbot.fr/digimon/317">
    <assets portrait="/assets/digimon/skb-317/portrait.webp"
            dot="/assets/digimon/skb-317/dot.gif"/>
    <stats hp="500" en="30" atk="100" def="80" spd="100"/>
    <skills>
      <skill id="s0" name="Pepper Breath" element="fire" cost="12"
             power="210" description="A blast of superheated flame."/>
      <skill id="s1" name="Claw Attack"   element="neutral" cost="0"
             power="120"/>
      <skill id="s2" name="..."           element="..." cost="..." power="..."/>
      <skill id="s3" name="..."           element="..." cost="..." power="..."/>
    </skills>
  </digimon>
</catalog>
```

Hand-editing is safe — the loader Zod-validates on read and prints a targeted error at each bad path. The admin UI writes the same format atomically.

---

## Verified end-to-end (smoke tests)

Four self-contained test scripts, all runnable via `pnpm --filter @digiworld/backend test:<name>`. Every one boots real adapters — `SqliteAdapter` opens a real DB file, `PGlite` runs actual Postgres 18 in-process, `RedisCluster` talks to a real Redis (or Valkey) — so what passes here is what production runs.

```bash
REDIS_URL=redis://127.0.0.1:6400 pnpm --filter @digiworld/backend test:cluster
#   18/18 — two RedisCluster instances against one Redis, proving KV, ZSET,
#   distributed lock (SET NX EX + Lua CAS), and pub/sub (chat + wsdeliver
#   psubscribe) all work cross-instance. This is the substrate every
#   multi-node feature rides on. See test/cluster-crossnode.mts.

DB_PATH=/tmp/dw-migrator-smoke.db pnpm --filter @digiworld/backend test:migrator
#   Boots SqliteAdapter twice — once on a fresh DB, once on a DB pre-seeded
#   with legacy `active_matches` + `matchmaking_queue` tables + a stale row —
#   and verifies both paths land migrations 001 + 002 + 003 in schema_versions,
#   drop the legacy tables, create the chat tables, and widen the
#   `skills_catalog.element` CHECK. Includes a functional probe: INSERT with
#   element='plant' must succeed after migration 003. See test/migrator-smoke.mts.

DB_PATH=/tmp/dw-features-smoke.db pnpm --filter @digiworld/backend test:features
#   46/0 — library-level integration for the auth/reset flow (N1), chat rooms
#   + DMs (N3), and spectator mode (N4). Every path under test uses the exact
#   functions the HTTP + WS handlers use (no shim). Also cross-checks that
#   destroyAllSessionsForUser is per-user, not global. See test/features-smoke.mts.

pnpm --filter @digiworld/backend test:pg-portability
#   13/13 e2e roundtrip + 261/261 SQL_* constants PREPAREd cleanly against real
#   Postgres 18 via @electric-sql/pglite. Also applies every migration under
#   src/db/migrations/*.sql (dialect-filtered — SQLite-only migrations are
#   correctly skipped). ~15s per run, safe for CI. See test/postgres-portability.mts.
```

`test/battle-combo.mts` also exists and runs 47 checks on the combat engine but has 3 pre-existing failures from a balance rebalance (commit `3b37a23`) — the test expectations drifted and haven't been re-tuned. Not gating.

---

## Admin bootstrap notes

- The **first** account created via `/api/auth/register` (browser or curl) is the admin — irrevocably.
- Every subsequent registration is a regular player (`is_admin=0`). Registration stays open by default so the 1000-player MMO shape actually works. Set `ADMIN_BOOTSTRAP=closed` in the environment to lock the door once the game is live.
- **Regular user password recovery** goes through the admin: `POST /api/admin/users/:id/reset-token` issues a 15-minute cluster-stored token; the user consumes it at `/reset?token=...` and picks a new password. Alternatively the admin can hard-reset directly via `POST /api/admin/users/:id/reset-password` (admin types the new password). Either way, all live sessions for that user are revoked on success.
- **A totally-lost *admin* password** still requires a manual `UPDATE users SET password_hash = ...` on the DB — there's no anonymous "I forgot my admin password" path by design.
- The admin is the ONLY user who can add/edit/remove Digimon templates. Regular players can only pick from what the admin has curated in `data/catalog/digimons.xml`.

---

## Recently addressed (post-MVP rewrite)

- **Live scene-defaults cache invalidation.** The scene-defaults cache in [`frontend/src/lib/scene-defaults.ts`](frontend/src/lib/scene-defaults.ts) was a module-level Promise with no expiry — non-admin users never saw admin edits until a hard refresh, and the "auto-invalidate stale local overrides" logic in the admin panel could never fire in practice. Now: a 30-second TTL + `forceRefresh` param, plus a WS broadcast on admin save. `POST /api/admin/scene-defaults` publishes to the `scene:defaults:updated` cluster channel; every node's WS lobby subscribes and fans out `{type:'scene-defaults-updated', at}` to its local sockets; every tab's [`wsStore`](frontend/src/state/wsStore.ts) case nulls the cache so the next `getSceneDefaults()` call refetches. TTL is the safety net for freshly-loaded tabs.
- **Numbered schema migrations with a `schema_versions` ledger.** Files in [`backend/src/db/migrations/`](backend/src/db/migrations/) named `NNN_description.sql` are applied once each in order, tracked in a `schema_versions (version TEXT PK, applied_at BIGINT)` ledger. Runner in [`backend/src/db/migrator.ts`](backend/src/db/migrator.ts) is dialect-aware — files ending `.sqlite.sql` run only on SQLite, `.pg.sql` only on Postgres, plain `.sql` on both. Each migration executes in a transaction; PK conflict on ledger insert is how we survive two-node concurrent boots. Wired into both `SqliteAdapter.init` and `PgAdapter.init` after the baseline schema. Migrations shipped so far: `001_drop_legacy_tables.sql` (kills the pre-cluster `active_matches` + `matchmaking_queue`), `002_chat_rooms.sql` (chat rooms + DM tables), `003_skills_element_check.sqlite.sql` (widens SQLite's stale 5-element CHECK on `skills_catalog.element` to the correct 11-element taxonomy — Postgres was already handled by an inline `DO $$` block in `schema-pg.sql`).
- **Chat rooms + DMs.** Two new tables (`chat_rooms`, `chat_room_members`) landed via migration `002_chat_rooms.sql`. Endpoints: `POST /api/chat/room/create`, `/room/join`, `/room/leave`, `/dm/open` (find-or-create), `GET /api/chat/rooms/mine`. WS `chat` message gains optional `room` field — with `room`, membership is validated then delivered to each member's `wsdeliver:{userId}` channel (cross-node just works). Global chat unchanged. Frontend `RoomsPanel` in the lobby lists rooms + DMs, opens DM by username, sends per-room messages. See [`backend/src/chat/rooms.ts`](backend/src/chat/rooms.ts) and [`frontend/src/components/lobby/RoomsPanel.tsx`](frontend/src/components/lobby/RoomsPanel.tsx).
- **Spectator mode.** New `GET /api/battle/spectate/:matchId` returns the current `BattleView` (side-A perspective — enemy stats redacted); WS `{type:'spectate', matchId, join:true}` subscribes the socket to live `event`/`battle`/`end` fanout for that match. Up to 20 spectators per match, tracked in a `battle:spectators:{matchId}` ZSET in the cluster. Cleaned up automatically when the match ends. Frontend viewer at `/spectate?matchId=...` (minimal text HP bars + event log; a rich 3D viewer is a follow-up). See [`backend/src/battle/spectate.ts`](backend/src/battle/spectate.ts) and [`frontend/src/routes/Spectate.tsx`](frontend/src/routes/Spectate.tsx).
- **Password reset via admin-issued cluster tokens.** New admin route `POST /api/admin/users/:id/reset-token` issues a one-time reset token stored at `reset:{token}` in the Cluster (TTL 15 min). User consumes via `POST /api/auth/reset-consume { token, newPassword }` — argon2id hashes the new password, all sessions for that user are revoked, and the token is deleted (single-use). Complements the existing hard-reset (where admin picks the password directly). Frontend consume page at `/reset?token=...`. See [`backend/src/auth/reset.ts`](backend/src/auth/reset.ts).
- **Shop items now feed into combat.** `POST /api/shop/apply { itemId, monId? }` consumes one inventory item into a `pending_buffs` row. `hp_pct` / `en_pct` are consumed at the START of the target mon's next battle (mutates `statBonus`); `xp_mult` is player-wide and consumed at the END of the next won match (multiplies XP awarded). Deprecated `POST /api/shop/use` still exists for backwards compat but no longer has combat semantics.
- **Battle state now survives server restart AND crosses nodes.** Every mutation upserts the full `Battle` JSON blob into the cluster at `battle:snap:{matchId}`. On boot, `hydrateActiveMatches()` in [`src/battle/routes.ts`](backend/src/battle/routes.ts) reports the cluster count. On Redis, any node in the deployment can serve any player's actions — mutations serialize via `battle:lock:{matchId}` (SET NX EX + Lua CAS release). See [`test/cluster-crossnode.mts`](backend/test/cluster-crossnode.mts) for the empirical proof.
- **Matchmaking queue now crosses nodes.** `mm:queue` (ZSET, member=userId, score=queuedAt) + `mm:meta:{userId}` (KV, TTL 5 min) live in the cluster. `tryPair()` holds the `mm:pair-lock` for the walk so only one node ZREMs a given pair. `hydrateMatchmaking()` reports queue size at boot — no SQL rehydration needed.
- **WS delivery is cross-node.** Any node can `publish` on `wsdeliver:{userId}`; a psubscribe on `wsdeliver:*` in every node forwards to whichever node hosts that user's live socket. Chat rides `chat:global`; presence is a scan over `presence:user:*` (30s TTL, refreshed every 15s).

## Known limitations / next passes

- **Admin bootstrap recovery still needs shell access.** Any user can be reset by an admin via the token flow above (or the hard-reset variant). A totally-lost *admin* password still requires a manual `UPDATE users SET password_hash = ...` on the DB — there's no anonymous "I forgot my admin password" path by design.
- **Spectator view is minimal (text-based).** The `/spectate?matchId=...` page renders HP bars + event log rather than the full 3D combat viewer. Wiring the 3D pipeline into read-only mode is a follow-up (Combat3DBody currently assumes player-side state — it needs a `readOnly` prop pass).
- **The multi-node docker-compose ships with `DATABASE=postgres`.** Both game nodes share the bundled Postgres 16 by default. To run the zero-external-dep local demo instead, flip the two commented `DATABASE: sqlite` lines under each `game-node*` service in `docker-compose.multinode.yml`.

---

## License

MIT.
