---
tags:
  - digiworld/moc
aliases:
  - DigiWorld Home
  - Home
created: 2026-08-01
updated: 2026-08-03
grounded-in:
  - README.md
  - ROADMAP.md
verified-at-commit: 97f72ba
---

# DigiWorld MOC

> [!info] What is DigiWorld?
> A Digimon-style 3v3 real-time MMO — Node.js + TypeScript, Fastify + native
> WebSocket, better-sqlite3/Postgres, argon2id auth. Server-authoritative
> combat, scraped catalog from `api.skullbot.fr` + `wikimon.net`.

Everything in this vault is grounded in the codebase at
`/mnt/sdc/digiworld`. Follow the FAITHFUL rule from the `obsidian-docs`
skill — if a claim isn't citable to a file + line, it doesn't belong here.

## Architecture

- [[Architecture Overview]] — the stack, the layers, the boot sequence
- [[Cluster Coordination Layer]] — memory vs redis, KV/ZSET/pub-sub/locks
- [[Database Adapter]] — SQLite vs Postgres, the `DbAdapter` interface,
  migrator ledger, `?` → `$N` translation

## API

- [[HTTP Surface]] — every REST endpoint, grouped by concern
- [[WebSocket Protocol]] — client ↔ server messages, error codes, rate limits

## Systems

- [[Combat]] — turn-based 3v3, server-authoritative, damage math, actions
- [[Matchmaking and MMR]] — dual bracket queue (level + trainedness),
  Elo K=32 with quality shaping
- [[Farm]] — 4 buildings, computed-on-read production, upgrade curve,
  factories + crafting jobs
- [[Currency]] — NetCore + Credits split, coin market with lot-based
  order book, PIX mint path
- [[Chat]] — global broadcast + rooms + DMs, per-member fanout via
  `wsdeliver:{userId}`
- [[Quests]] — 4 step types + 5 objective kinds (travel/defeat/talk/
  collect/capture), flag-gated unlocks, world objects
- [[Dungeons]] — tile grid, random encounters, doors + warps + traps,
  Tiled TMJ import
- [[Adventure]] — idle 3-mon expeditions, provisions in / rewards out,
  deterministic seeded reports
- [[Scenes]] — per-arena `SceneSettings` + weather + time-of-day, picker
- [[Weather System]] — 11 presets, particle emitter, thunder controller,
  WS-triggered runtime overrides
- [[OAuth]] — Discord/Google/Facebook, hybrid decide flow, `oauth_tokens`
  table, legacy discord_id mirroring
- [[Dialogues]] — Twee-authored trees, ledger-guarded actions, predicate
  + action registries, cross-ref validation, dialogue simulator
- [[NPC Registry]] — speaker registry with per-NPC expression keys +
  PNG portraits, cross-referenced by dialogue import
- [[Nursery and Pen]] — species data collection, direct + mix hatch,
  Baby → In-Training → Rookie growth arc
- [[Roster and Party]] — one row per mon, 3-slot party, evolution with
  stage-pool freezing
- [[Skills catalog]] — admin-editable skills, learned-pool
  carry-forward, XML → DB resolver
- [[Skill Archetypes]] — the skill rework: archetype design system
  (design-only, never persisted), the four classes of defect it surfaced,
  balance history and open decisions
- [[Skill Catalog Reference]] — generated tables: 396 pool skills and 868
  signatures across all 434 Digimon
- [[Skill VFX and Status Badges]] — how a skill's effect is chosen and drawn,
  the ailment/buff badge layers, and the open items on both
- [[Seasons]] — cluster-locked auto-close ticker + admin CRUD, snapshot
  on close
- [[Onboarding and Tutorial]] — 3-team starter picker + per-user
  tutorial seen state

## Ops

- [[Environments]] — dev / staging / prod, GH Environments, materialize-env.sh
- [[Multi-node Deployment]] — docker-compose.multinode.yml topology,
  nginx `ip_hash`, cross-node primitives

## Cross-cutting

- [[Session cookies]] — argon2id, signed cookies, cluster storage,
  login/register/reset throttle, weak-password blocklist, absolute
  30-day session cap, global security headers, cross-origin policy

## ADRs (Architecture Decisions)

- [[2026-08-05 — Login security hardening]] — register throttle,
  OAuth-decide throttle, weak-password blocklist, absolute session cap,
  security headers
- [[2026-07-31 — Standalone Admin SPA]] — split admin out of the player
  frontend, cross-origin cookie contract
- [[2026-07-31 — OAuth hybrid decide]] — pending token + decide page
  instead of auto-create-on-unknown
- [[2026-07-25 — Dual currency split]] — NetCore (earned) vs Credits
  (paid), coin market
- [[2026-07-01 — Cluster abstraction]] — memory ⇔ redis interface,
  zero-dep local dev
- [[2026-06-15 — Compute-on-read farm]] — no ticker, checkpoint math,
  guarded UPDATE
- [[2026-06-01 — Server-authoritative combat]] — clients send intent,
  server owns state

## Runbooks

- [[First admin bootstrap]] — set `ADMIN_BOOTSTRAP=open`, register, close
- [[Reset a player password]] — admin-issued token vs hard reset,
  session invalidation guarantees
- [[Rotate SESSION_SECRET]] — scheduled or emergency cookie-key rotation
- [[Recover a lost admin password]] — DB-shell fallback when no other
  admin can help
- [[Postgres backup and restore]] — `pg_dump` / `pg_restore`, migration
  ledger considerations
- [[SQLite backup and restore]] — WAL-aware backup for single-node
  deploys, `.backup` + `VACUUM INTO`
- [[Migrate cluster memory to redis]] — going from `pnpm dev` to a real
  multi-node deploy
- [[Cluster failover Redis to Redis]] — warm dump+restore vs cold
  cutover, rolling multi-node
- [[Deploy the admin panel to a subdomain]] — CORS + cookie contract,
  Vite proxy for dev
- [[Run dev against production Postgres]] — HMR-driven Vite dev pointed
  at the shared Docker Postgres backend, cookie-rewrite proxy
- [[Bootstrap a fresh scraped catalog]] — CLI-first vs register-first
  catalog seeding
- [[Recover a stuck matchmaking queue]] — dequeue single user vs full
  reset, pair-lock recovery
- [[Rotate SERVICE_TOKEN_DISCORD]] — bi-lateral bot ↔ backend token
  rotation, order matters

---

## The 12 grounded notes at a glance

| Note                                           | Focus                          | Primary source                                             |
| ---------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| [[Architecture Overview]]                       | Stack overview + boot          | `backend/src/server.ts`                                    |
| [[Cluster Coordination Layer]]                  | Redis/memory abstraction       | `backend/src/cluster/`                                     |
| [[Database Adapter]]                            | SQLite/Postgres abstraction    | `backend/src/db/`                                          |
| [[HTTP Surface]]                                | Every REST endpoint            | `backend/src/*/routes.ts`                                  |
| [[WebSocket Protocol]]                          | `/ws` message shapes           | `shared/src/ws.ts` + `backend/src/lobby/ws.ts`             |
| [[Combat]]                                      | Battle types + engine          | `shared/src/battle.ts` + `backend/src/battle/`             |
| [[Farm]]                                        | Passive prod + crafting        | `backend/src/farm/`                                        |
| [[Currency]]                                    | NTC + CR + coin market         | `backend/src/market/coins.ts`                              |
| [[Session cookies]]                             | Auth cookie contract           | `backend/src/auth/session.ts`                              |
| [[Weather System]]                              | Particles + weather + ToD      | `shared/src/weather.ts` + `scene3d/src/particles/`          |
| [[Skill VFX and Status Badges]]                 | Skill effects + status badges  | `scene3d/src/` + `frontend/src/components/combat3d/`       |
| [[OAuth]]                                       | Social login + hybrid decide   | `backend/src/auth/oauth/`                                  |
| [[Scenes]]                                      | Per-arena scene entities       | `backend/src/scenes/`                                      |
| [[Environments]]                                | dev/staging/prod matrix        | `docs/environments.md` + `.env.example`                    |
| [[Multi-node Deployment]]                       | 2-node compose stack           | `docker-compose.multinode.yml`                             |
| [[2026-07-31 — Standalone Admin SPA]]           | ADR — admin split              | `admin/` workspace commits `1bbb090` + `97f72ba`           |

---

> [!info] Working with these notes
> The [`obsidian-docs`](../../mnt/sdc/digiworld/.opencode/skills/obsidian-docs/SKILL.md)
> skill (project-scope in the DigiWorld repo) defines the conventions —
> every claim grounded in a `file:line` citation, every type copied
> verbatim from source, every wikilink resolved, every note carrying a
> `verified-at-commit` frontmatter marker.
>
> When the code drifts, update the note AND bump `verified-at-commit`.
> When a claim can't be verified, mark it `> [!warning] Unverified` with a
> follow-up TODO. Never smooth over uncertainty.
