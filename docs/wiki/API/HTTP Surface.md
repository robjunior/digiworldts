---
tags:
  - digiworld/api
  - digiworld/architecture
aliases:
  - HTTP API
  - REST API
  - Endpoints
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - README.md
  - backend/src/server.ts
  - backend/src/auth/routes.ts
  - backend/src/roster/routes.ts
  - backend/src/farm/routes.ts
  - backend/src/shop/routes.ts
  - backend/src/admin/routes.ts
  - backend/src/scenes/routes.ts
  - backend/src/particle-presets/routes.ts
verified-at-commit: 97f72ba
---

# HTTP Surface

> [!info] Contract
> Every route is JSON in / JSON out unless marked otherwise. Authenticated
> routes rely on the signed `digiworld_sid` cookie (see [[Session cookies]]).
> Admin routes additionally require `is_admin=1`. Service routes gate on
> a shared bearer (`SERVICE_TOKEN_DISCORD`).

Grouped by concern. `Auth` column: `—` = public, `user` = signed-in,
`admin` = signed-in AND `is_admin=1`, `cookie` = trusted signed cookie only
(no user lookup), `bearer` = M2M shared token.

---

## Health

| Method | Path             | Auth | Purpose                    |
| ------ | ---------------- | ---- | -------------------------- |
| GET    | `/api/health`    | —    | liveness (`{ok:true,at}`)  |

## Auth — password path

Backend: [`backend/src/auth/routes.ts`](backend/src/auth/routes.ts)

| Method | Path                          | Auth | Purpose                                                                                     |
| ------ | ----------------------------- | ---- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/status`            | —    | `{ userCount, registrationOpen }`                                                           |
| POST   | `/api/auth/register`          | —    | 403 unless `ADMIN_BOOTSTRAP=open`. First registrant becomes admin; every next is a player.  |
| POST   | `/api/auth/login`             | —    | argon2id verify + set signed cookie                                                         |
| POST   | `/api/auth/logout`            | user | destroys the session server-side + clears cookie                                            |
| POST   | `/api/auth/reset-consume`     | —    | `{token, newPassword}` — consumes admin-issued reset token, revokes all sessions for user   |
| GET    | `/api/auth/me`                | user | current user                                                                                |

Throttle: **10 attempts / IP / 15 min** on `reset-consume`.

## Auth — OAuth (Discord / Google / Facebook)

Backend: [`backend/src/auth/oauth/routes.ts`](backend/src/auth/oauth/routes.ts)

| Method | Path                                       | Auth   | Purpose                                                                       |
| ------ | ------------------------------------------ | ------ | ----------------------------------------------------------------------------- |
| GET    | `/api/auth/oauth/providers`                | —      | list of enabled provider ids for the login-page buttons                       |
| GET    | `/api/auth/oauth/:provider/login`          | —      | 302 to provider's authorize URL. `?returnTo=/path` optional                   |
| GET    | `/api/auth/oauth/:provider/link`           | user   | same as `/login` but binds identity to the authenticated user                 |
| GET    | `/api/auth/oauth/:provider/callback`       | —      | provider redirects here with `code`+`state`; sets session or hybrid-decide 302 |
| GET    | `/api/auth/oauth/pending/:token`           | —      | preview `{provider, providerUsername, canCreate, returnTo, expiresAt}`         |
| POST   | `/api/auth/oauth/decide`                   | —      | `{pendingToken, choice: 'create' \| 'link', username?, password?}`             |
| DELETE | `/api/auth/oauth/:provider`                | user   | unlink identity from current user                                             |
| GET    | `/api/auth/oauth/mine`                     | user   | `{ identities }` — every linked provider for this user                        |

See [[OAuth]] for the pending-token / hybrid decide flow.

## Catalog + Roster

Backend: [`backend/src/roster/routes.ts`](backend/src/roster/routes.ts)

| Method | Path                                | Auth | Purpose                                    |
| ------ | ----------------------------------- | ---- | ------------------------------------------ |
| GET    | `/api/catalog`                      | user | full XML catalog (Zod-validated on read)   |
| GET    | `/api/roster`                       | user | owned digimon + templates                  |
| POST   | `/api/roster/seed`                  | user | retry starter seed when catalog was empty at register |
| POST   | `/api/roster/party`                 | user | `{ slot: 0-2, monId }`                     |
| POST   | `/api/roster/party/remove`          | user | `{ slot }`                                 |
| POST   | `/api/roster/rename/:id`            | user | `{ nickname }`                             |

## Farm

Backend: [`backend/src/farm/routes.ts`](backend/src/farm/routes.ts)

| Method | Path                              | Auth | Purpose                                   |
| ------ | --------------------------------- | ---- | ----------------------------------------- |
| GET    | `/api/farm`                       | user | balances + credits + buildings            |
| POST   | `/api/farm/collect`               | user | bank every building at once               |
| POST   | `/api/farm/collect/:id`           | user | bank one building                         |
| POST   | `/api/farm/upgrade/:id`           | user | +25 % rate, +20 % cap, +60 % next cost    |

See [[Farm]] for the production math.

## Shop, Daily, Friends

Backend: `backend/src/social/{shop,daily,friends}.ts`

| Method | Path                            | Auth | Purpose                                                                       |
| ------ | ------------------------------- | ---- | ----------------------------------------------------------------------------- |
| GET    | `/api/shop`                     | user | items + inventory + credits                                                   |
| POST   | `/api/shop/buy`                 | user | `{ itemId, qty }`                                                             |
| POST   | `/api/shop/apply`               | user | `{ itemId, monId? }` — consumes into `pending_buff`; applied at next battle   |
| POST   | `/api/shop/use`                 | user | `{ itemId, qty }` (deprecated no-op)                                          |
| GET    | `/api/daily`                    | user | 7-day cycle state                                                             |
| POST   | `/api/daily/claim`              | user | grant today's reward                                                          |
| GET    | `/api/friends`                  | user | `{ friends, incoming, outgoing }`                                             |
| POST   | `/api/friends/request`          | user | `{ username }`                                                                |
| POST   | `/api/friends/accept`           | user | `{ userId }`                                                                  |
| POST   | `/api/friends/remove`           | user | `{ userId }`                                                                  |
| POST   | `/api/friends/block`            | user | `{ userId }`                                                                  |

## Chat

Backend: [`backend/src/chat/routes.ts`](backend/src/chat/routes.ts)

| Method | Path                              | Auth | Purpose                                                    |
| ------ | --------------------------------- | ---- | ---------------------------------------------------------- |
| GET    | `/api/chat/rooms/mine`            | user | rooms the caller is a member of                            |
| POST   | `/api/chat/room/create`           | user | `{ name }` — creates a room + adds creator as owner+member |
| POST   | `/api/chat/room/join`             | user | `{ roomId }` (rooms only, not DMs)                         |
| POST   | `/api/chat/room/leave`            | user | remove caller from a room                                  |
| POST   | `/api/chat/dm/open`               | user | `{ username }` — find-or-create 2-member DM room           |

Global chat is `/ws` only — see [[WebSocket Protocol#Client to server messages]].

## Scenes + Particle presets + Weather

Backend: [`backend/src/scenes/routes.ts`](backend/src/scenes/routes.ts) + [`backend/src/particle-presets/routes.ts`](backend/src/particle-presets/routes.ts)

| Method | Path                                          | Auth  | Purpose                                                                     |
| ------ | --------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| GET    | `/api/scene/defaults`                         | user  | per-arena `SceneSettings` (lighting / fog / camera / arena offsets)         |
| POST   | `/api/admin/scene-defaults`                   | admin | write full `PerArenaSceneDefaults`; publishes `scene:defaults:updated`      |
| GET    | `/api/particle-presets`                       | user  | list named particle presets                                                 |
| POST   | `/api/admin/particle-presets`                 | admin | create preset                                                               |
| PUT    | `/api/admin/particle-presets/:id`             | admin | update preset                                                               |
| DELETE | `/api/admin/particle-presets/:id`             | admin | delete preset                                                               |
| POST   | `/api/admin/weather/trigger`                  | admin | broadcast a weather override; fans out `weather-triggered` WS message       |

See [[Weather System]] and [[Scenes]] for the full picture.

## Battle

Backend: [`backend/src/battle/routes.ts`](backend/src/battle/routes.ts)

| Method | Path                                  | Auth | Purpose                                                              |
| ------ | ------------------------------------- | ---- | -------------------------------------------------------------------- |
| GET    | `/api/battle/spectate/:matchId`       | user | initial `BattleView` + `spectatorCount`; enemy stats redacted        |

Live combat mutations happen over `/ws` — see [[WebSocket Protocol#act]].

## Game settings + Admin ops

Backend: [`backend/src/settings/routes.ts`](backend/src/settings/routes.ts) + [`backend/src/admin/routes.ts`](backend/src/admin/routes.ts)

| Method | Path                                                      | Auth  | Purpose                                                                           |
| ------ | --------------------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| GET    | `/api/admin/game-settings`                                | admin | `{ xpRate, damageRate, updatedAt }` — global multipliers                          |
| PUT    | `/api/admin/game-settings`                                | admin | partial update; `xpRate ∈ [0.1, 10.0]`, `damageRate ∈ [0.25, 5.0]`                |
| GET    | `/api/admin/scraped-list`                                 | admin | paginated + filterable scraped digimon list                                       |
| POST   | `/api/admin/scrape/refresh`                               | admin | pull the skullbot list again                                                      |
| POST   | `/api/admin/catalog/from-scraped`                         | admin | `{ skullbotId, enrich }` — promote scraped entry into catalog                     |
| POST   | `/api/admin/catalog/custom`                               | admin | full `TemplateDigimon` body                                                       |
| PUT    | `/api/admin/catalog/:id`                                  | admin | replace (id must match)                                                           |
| DELETE | `/api/admin/catalog/:id`                                  | admin | remove template                                                                   |
| POST   | `/api/admin/assets/:id/download`                          | admin | force re-download portrait + dot                                                  |
| POST   | `/api/admin/users/:id/reset-token`                        | admin | 15-min one-time reset token stored at `reset:{token}` in cluster                  |
| POST   | `/api/admin/users/:id/reset-password`                     | admin | hard reset — admin picks the password directly                                    |

Damage rate is **frozen per-match at `initBattle`** so an admin bump
mid-tournament doesn't disturb in-flight battles.
[`backend/src/battle/engine.ts::applyAction`](backend/src/battle/engine.ts) —
verify the exact spot where the frozen value is read.

## Service (M2M for the Discord bot)

Backend: [`backend/src/service/routes.ts`](backend/src/service/routes.ts)

| Method | Path                                     | Auth   | Purpose                                                                     |
| ------ | ---------------------------------------- | ------ | --------------------------------------------------------------------------- |
| POST   | `/api/service/wallet-credit`             | bearer | Discord bot posts here after MercadoPago PIX settles; idempotent-ledgered   |

Gated by `SERVICE_TOKEN_DISCORD`. Missing / mismatched token → 401.

---

## Consistent conventions

- **Errors** are JSON `{ error: 'human-readable' | 'stable-slug', ... }` with
  the correct HTTP status. `4xx` for the client; `5xx` for us.
- **Zod validation lives in the route**, not the client. `safeParse().error.issues`
  is returned on 400.
- **Pagination**, when present: `?limit=&offset=`. Nothing more elaborate.
- **Idempotency** on money-adjacent endpoints uses ledger tables (`service_grant_log`,
  `coin_offer_fills`) not client-supplied keys.

## Related

- [[Architecture Overview]]
- [[WebSocket Protocol]]
- [[Session cookies]] — the exact cookie contract
- [[OAuth]] — the OAuth flow end-to-end
