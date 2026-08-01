# DigiWorld — Roadmap

Grounded in code reality (see [README.md](README.md) for context). Each row is a verifiable claim: a file, a test, or a git ref. This is a snapshot at `feat/combat3d @ 2554aa5` — future roadmap edits should keep the same "every claim traceable" discipline.

---

## Legend

- **✅ Shipped** — landed on `main` or on `feat/combat3d`, verified in code
- **🚧 In flight** — under active work on a branch
- **⏭ Next** — scoped, next in line
- **🔭 Stretch** — real intent, not yet scoped
- **⛔ Non-goal** — explicitly out of scope for this codebase

---

## ✅ Shipped

### Ops / infra

| Item | Evidence |
|---|---|
| Cluster abstraction with memory + Redis backends | [`cluster/index.ts`](backend/src/cluster/index.ts), [`memory.ts`](backend/src/cluster/memory.ts), [`redis.ts`](backend/src/cluster/redis.ts) |
| Cross-node matchmaking queue (ZSET + distributed pair-lock) | [`matchmaking/queue.ts`](backend/src/matchmaking/queue.ts) |
| Cross-node battle state (per-match SET NX EX lock + Lua CAS release) | [`battle/routes.ts`](backend/src/battle/routes.ts) |
| Cross-node WS delivery via `wsdeliver:{userId}` psubscribe | [`lobby/ws.ts:167-170,358-365`](backend/src/lobby/ws.ts:167) |
| Cross-node presence + chat (KV TTL, `chat:global` pub/sub) | [`lobby/ws.ts:135-159,246-249`](backend/src/lobby/ws.ts:135) |
| Reconnect grace period (15s) so browser nav doesn't forfeit | [`lobby/ws.ts:182-211`](backend/src/lobby/ws.ts:182) |
| Postgres adapter fully wired end-to-end (15 route files) | [`db/adapter.ts`](backend/src/db/adapter.ts), [`db/index.ts`](backend/src/db/index.ts) |
| Cross-DB portability regression (63/63 prepared SQL, 13/13 e2e) | [`test/postgres-portability.mts`](backend/test/postgres-portability.mts) |
| Cross-node persistence empirical proof (18/18 checks) | [`test/cluster-crossnode.mts`](backend/test/cluster-crossnode.mts) |
| Multi-node docker-compose (nginx `ip_hash` + Redis + Postgres) | [`docker-compose.multinode.yml`](docker-compose.multinode.yml) |
| Cloudflared tunnel + nginx GLB revalidation | commit `23f65ab` |
| Bind-mounted catalog dir (host XML edits picked up on restart) | commit `1a6ef11` |
| Session secret persistence + argon2id auth | [`auth/password.ts`](backend/src/auth/password.ts), [`auth/session.ts`](backend/src/auth/session.ts) |
| First-user-is-admin bootstrap | [`auth/routes.ts`](backend/src/auth/routes.ts) |
| Numbered schema migrations + dialect suffixes + `schema_versions` ledger | [`db/migrator.ts`](backend/src/db/migrator.ts), 46 migrations under [`db/migrations/`](backend/src/db/migrations/) |
| Telemetry infra (jsonl + PostHog HTTP sinks, fire-and-forget emit, shutdown flush) | [`shared/src/telemetry.ts`](shared/src/telemetry.ts), [`backend/src/telemetry/emit.ts`](backend/src/telemetry/emit.ts), commit `bc55731` |

### Combat

| Item | Evidence |
|---|---|
| Server-authoritative 3v3 battle engine | [`battle/engine.ts`](backend/src/battle/engine.ts) |
| MMR with delta calculator per outcome | [`battle/mmr.ts`](backend/src/battle/mmr.ts) |
| 11-element resistance system + attribute triangle | commit `1b4b99f` |
| PVE battle path (idle expeditions + encounters) | [`world/pve-battle.ts`](backend/src/world/pve-battle.ts) |
| Chain multiplier + shifting initiative | [`test/battle-combo.mts`](backend/test/battle-combo.mts) |
| Full 3D battle view (Octopath layout, 11 effect runners) | commit `c42f3a1` |
| Scene / biome admin editor with height fog + wind + light | commits `e855098`, `2554aa5` |
| Battle feed with auto-scroll cap | commits `a9b01f2`, `6f36d9b` |
| Auto-battle toggle | commit `6f36d9b` |
| Per-enemy HP bars, DOM-attached GIF, sprite-rig polish | commits `0f8ed86`, `a226e41` |
| Spectator mode (cross-node fanout, max 20/match, ZSET-backed) | [`battle/spectate.ts`](backend/src/battle/spectate.ts), [`battle/http.ts`](backend/src/battle/http.ts) |

### Content & progression

| Item | Evidence |
|---|---|
| Catalog scraper (skullbot list + wikimon enrich + asset verifier) | [`scraper/cli.ts`](backend/src/scraper/cli.ts), [`scraper/wikimon.ts`](backend/src/scraper/wikimon.ts), [`scraper/verifier.ts`](backend/src/scraper/verifier.ts) |
| XML catalog format with Zod-validated round-trip | [`digimon/xml.ts`](backend/src/digimon/xml.ts) |
| XP curve + level growth + admin XP multiplier | [`progression/xp.ts`](backend/src/progression/xp.ts), commit `c623004` |
| Farm (4-building production, computed-on-read) | [`farm/engine.ts`](backend/src/farm/engine.ts) |
| Factory / crafting / provisions (multi-factory, queue, upgrades) | commits `03fe6dd`, `957d459`, `fd1b397`, `3e1dfea` |
| Adventure (idle 3-mon expedition with seeded encounters) | [`adventure/engine.ts`](backend/src/adventure/engine.ts) |
| Training | [`training/engine.ts`](backend/src/training/engine.ts) |
| Nursery | [`nursery/routes.ts`](backend/src/nursery/routes.ts) |
| Market | [`market/routes.ts`](backend/src/market/routes.ts) |
| Digdex | [`dex/routes.ts`](backend/src/dex/routes.ts) |
| Quests + world objects | [`quests/routes.ts`](backend/src/quests/routes.ts), [`world/routes.ts`](backend/src/world/routes.ts) |
| Quest objectives (travel, defeat, talk, collect, capture) | [`shared/src/quest.ts`](shared/src/quest.ts), [`backend/src/quests/repo.ts`](backend/src/quests/repo.ts), commit `4e70621` |
| Narrative persistence via flags (quest gate + auto-set on claim + world-object hiding) | [`backend/src/flags/repo.ts`](backend/src/flags/repo.ts), migration [`046_world_objects_hidden_flag.sql`](backend/src/db/migrations/046_world_objects_hidden_flag.sql), commits `ad0ab62` + `f7247dd` |
| Onboarding flow (post-starter guided tour) | [`onboarding/engine.ts`](backend/src/onboarding/engine.ts), commit `c995a09` |

### Meta / social

| Item | Evidence |
|---|---|
| Friends + presence + block | [`social/friends.ts`](backend/src/social/friends.ts) |
| Shop with `apply` → `pending_buffs` combat integration | [`social/shop.ts`](backend/src/social/shop.ts), [`social/buffs.ts`](backend/src/social/buffs.ts) |
| Daily rewards (7-day cycle) | [`social/daily.ts`](backend/src/social/daily.ts) |
| Global chat (rate-limited, cluster pub/sub) | [`lobby/ws.ts:237-250`](backend/src/lobby/ws.ts:237) |
| Chat rooms + DMs (per-room fanout via wsdeliver, `chat_rooms` + `chat_room_members` via migration 002) | [`chat/rooms.ts`](backend/src/chat/rooms.ts), [`chat/routes.ts`](backend/src/chat/routes.ts), [`components/lobby/RoomsPanel.tsx`](frontend/src/components/lobby/RoomsPanel.tsx) |
| Password reset — admin-issued cluster tokens + hard reset | [`auth/reset.ts`](backend/src/auth/reset.ts), [`admin/users.ts:170-182`](backend/src/admin/users.ts:170) |

### Admin

| Item | Evidence |
|---|---|
| Scraped-list browser + XML catalog CRUD | [`admin/routes.ts`](backend/src/admin/routes.ts) |
| Blueprint editor (buildings + evolution requirements) | [`admin/blueprints.ts`](backend/src/admin/blueprints.ts), commit `6907d3b` |
| Full-template edit round-trip preserving type/resistances/skill descs | commit `a4bac4e` |
| Roster edit + per-user snapshot | [`admin/rosters.ts`](backend/src/admin/rosters.ts) |
| Import/export tooling (scoped: all, items, blueprints, catalog, scraped) | [`admin/impex.ts`](backend/src/admin/impex.ts) |
| Scene + biome save-to-server | commit `e855098` |
| Local override auto-invalidation + reset button | commit `2554aa5` |
| Quest editor: typed objectives + narrative flag chips + giver/rewardText/lockHint | [`admin/src/components/admin/QuestsAdmin.tsx`](admin/src/components/admin/QuestsAdmin.tsx), commit `fd77cc5` |

---

## 🚧 In flight — `feat/combat3d` (26 commits ahead of `main`)

The whole 3D combat rewrite + scene/biome tooling lives here. Not yet merged. Untracked WIP asset: [`monument_prairie_wip.blend`](base/signal/monument_prairie_wip.blend).

**Open questions before merge:**
1. Merge cadence — big-bang merge risk vs. cherry-pick order
2. `main` is 1 commit ahead of divergence base (`9f99e70` element corrections) — clean rebase should be trivial
3. Any player data migrations needed (schema is unchanged on this branch — checked in [`schema.sql`](backend/src/db/schema.sql))

---

## ⏭ Next passes

Ordered by size × user impact, smallest × highest first.

### N1 — ~~Password-reset flow~~ ✅ shipped

See Shipped ▸ Meta / social. Admin-issued token flow at [`auth/reset.ts`](backend/src/auth/reset.ts) (routes `POST /api/admin/users/:id/reset-token` + `POST /api/auth/reset-consume`), hard-reset at [`admin/users.ts:170`](backend/src/admin/users.ts:170). Frontend consume page at [`frontend/src/routes/Reset.tsx`](frontend/src/routes/Reset.tsx).

### N2 — ~~Drop legacy SQLite tables~~ ✅ shipped

Migration [`001_drop_legacy_tables.sql`](backend/src/db/migrations/001_drop_legacy_tables.sql) drops both `active_matches` and `matchmaking_queue` with `IF EXISTS` guards — portable across SQLite and Postgres, no-op on fresh installs where the baseline schemas never mention them. Regression guard in [`test/migrator-smoke.mts`](backend/test/migrator-smoke.mts) seeds a pre-cluster SQLite DB with the legacy tables + a stale row, applies migrations, and asserts both tables are gone. Blocker (schema migration story) resolved by S6 shipping first.

### N3 — ~~Chat rooms + DMs~~ ✅ shipped

See Shipped ▸ Meta / social. Migration `002_chat_rooms.sql` adds `chat_rooms` + `chat_room_members`. Backend at [`backend/src/chat/rooms.ts`](backend/src/chat/rooms.ts) + [`backend/src/chat/routes.ts`](backend/src/chat/routes.ts). WS `chat` message extended with optional `room` in [`shared/src/ws.ts`](shared/src/ws.ts); server-side membership check + per-member wsdeliver fanout in [`backend/src/lobby/ws.ts`](backend/src/lobby/ws.ts). Frontend [`RoomsPanel`](frontend/src/components/lobby/RoomsPanel.tsx) lists rooms, opens DMs by username, sends per-room chat. Global chat unchanged.

### N4 — ~~Spectator mode~~ ✅ shipped

See Shipped ▸ Combat. Backend: [`backend/src/battle/spectate.ts`](backend/src/battle/spectate.ts) (ZSET registry, max 20/match), [`backend/src/battle/http.ts`](backend/src/battle/http.ts) (GET `/api/battle/spectate/:matchId`), fanout hooks in [`battle/routes.ts`](backend/src/battle/routes.ts) call `deliverToSpectators` alongside player deliveries; WS `spectate` join/leave handler in [`lobby/ws.ts`](backend/src/lobby/ws.ts). Frontend viewer at [`frontend/src/routes/Spectate.tsx`](frontend/src/routes/Spectate.tsx). Minimal text-based render for MVP — 3D viewer is a follow-up.

### N5 — Merge `feat/combat3d` → `main`
- Rebase check, one review pass, merge. Followed by a tag.

### N6 — ~~Migrate multi-node compose to `DATABASE=postgres`~~ ✅ shipped

[`docker-compose.multinode.yml`](docker-compose.multinode.yml) already ships `DATABASE: postgres` + `DATABASE_URL: postgres://...` as the active values under both `game-node1` (lines 82-83) and `game-node2` (lines 105-106), with a commented `# DATABASE: sqlite` line kept beside each as the zero-external-dep fallback for local demos. Cross-DB portability is regression-guarded by [`test/postgres-portability.mts`](backend/test/postgres-portability.mts): every migration applies against real Postgres 18 via pglite + every `SQL_*` constant PREPAREs cleanly against the resulting schema. Soak-testing the hot paths (`q()` / `one()` / queue tick / battle mutation / presence broadcast) under real network latency remains a follow-up.

---

## 🔭 Stretch

These have real intent but no scoped design yet.

### S1 — More biomes
- One WIP `.blend` present in tree. Assumption: at least Prairie / Cave / City biome variants planned.
- Design surface: [`admin/scene`](backend/src/admin/routes.ts) already supports per-biome params (fog, wind, light).

### S2 — PvE beyond Adventure
- Story / dungeon system with narrative encounters, boss battles, rewards beyond farm resources.
- Reuses [`world/pve-battle.ts`](backend/src/world/pve-battle.ts) but needs a progression graph.

### S3 — Guilds / parties
- Friends exist; groups don't. Guild chat = a chat room owned by a guild id.
- Parties = pre-made 2v2 or 3v3 vs. matched opponents (asymmetric matchmaking).

### S4 — Mobile / touch UX
- Combat3d is desktop-first. Touch controls for the action panel, virtual joystick or tap-to-target for the 3D view.
- Server changes: mostly none; likely all client-side.

### S5 — Match replay
- Match log is already persisted (last 120 events per match — see [`SQL_INSERT_MATCH`](backend/src/battle/routes.ts:55)).
- Add a viewer that plays the log back through the same 3D pipeline.

### S6 — ~~Schema migration framework~~ ✅ shipped

Numbered `NNN_description.sql` files under [`backend/src/db/migrations/`](backend/src/db/migrations/) applied once each in order, tracked in a `schema_versions (version TEXT PK, applied_at BIGINT)` ledger. Runner in [`backend/src/db/migrator.ts`](backend/src/db/migrator.ts) is dialect-aware (`.sqlite.sql`, `.pg.sql`, plain `.sql`) and executes each migration in a transaction; PK-conflict-on-ledger-insert is the race-safe multi-node-boot guard. Wired into both `SqliteAdapter.init` and `PgAdapter.init` after the baseline schema. 46 migrations shipped through `046_world_objects_hidden_flag.sql`. Regression coverage: [`test/migrator-smoke.mts`](backend/test/migrator-smoke.mts) (SQLite legacy-table drop) + [`test/postgres-portability.mts`](backend/test/postgres-portability.mts) (every migration applied against real Postgres 18 via pglite, 420/420 SQL_* constants PREPARE cleanly against the resulting schema).

### S7 — Observability
- **Telemetry infra shipped** — fire-and-forget emitter with 5 s flush window + 100-event batch cap + jsonl sink + PostHog HTTP sink + shutdown flush. Instrumented sites: `auth.signup/login`, `battle.start/end`, `capture.success`, `world.move`, `quest.accept/claim`, `daily.claim`, `market.list/sold`, `flag.set/cleared`. See [`shared/src/telemetry.ts`](shared/src/telemetry.ts) + [`backend/src/telemetry/emit.ts`](backend/src/telemetry/emit.ts) + [`backend/src/telemetry/sink.ts`](backend/src/telemetry/sink.ts). Covers the retention/funnel side.
- **Still missing** — SRE metrics/traces for the multi-node ops layer. Prometheus exporter + Grafana dashboards on cluster ops (queue depth, pair latency, match count, cross-node WS delivery rate) is the natural next step.

---

## ⛔ Non-goals

- **No pay-to-win power sales.** Credits are a premium currency bought with real money (PIX via the Discord bot), but they buy cosmetics, eggs and convenience boosts — never raw combat power. Gameplay itself grants only NetCore, and Credits are player-tradable for NetCore on the coin market, so a non-paying player can still reach premium goods by grinding. See [`README.md` §Currency rules](README.md).
- **No client-side damage math.** All combat is server-authoritative — see [`README.md` §Combat rules](README.md).
- **No gRPC / message queue between nodes.** Redis pub/sub + KV covers every current cross-node need; adding Kafka etc. is premature.
- **No native mobile app.** Web frontend serves both surfaces.

---

## Doc anchor

If you're adding a new feature that changes the multi-node shape (new cross-node state, new locks, new pub/sub channels), update [`README.md` §What crosses nodes](README.md) AND add a check to [`test/cluster-crossnode.mts`](backend/test/cluster-crossnode.mts). The former is the design contract; the latter is its regression guard.
