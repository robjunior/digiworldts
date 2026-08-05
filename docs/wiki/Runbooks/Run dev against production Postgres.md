---
tags:
  - digiworld/ops
  - digiworld/runbook
aliases:
  - Dev against Postgres
  - Local dev shared Postgres
  - Point dev at :3001
created: 2026-08-03
updated: 2026-08-03
grounded-in:
  - frontend/vite.config.ts
  - frontend/.env.development
  - admin/vite.config.ts
  - admin/.env.dev
  - docker-compose.yml
  - backend/src/auth/session.ts
verified-at-commit: 97f72ba
---

# Run dev against production Postgres

> [!info] Goal
> Bring up HMR-driven Vite dev servers for `frontend/` and `admin/` that
> talk to the **same Docker Postgres backend** the public
> `soul.xenon.dev.br` uses. Every UI edit hot-reloads; every data write
> lands in the real DB.

## When to use this

- You need to iterate on player-facing UI or admin panel JSX with HMR
  and see the fix against real data (real users, real rosters, real
  world objects) instead of a throwaway seed.
- You want to verify a fix against the SAME state that a player is
  currently seeing on `soul.xenon.dev.br`.

## When NOT to use this

- **Any experiment that writes data.** There's no isolation. If you
  create a user, mint a currency row, mutate the catalog, or edit a
  scene, it lands in production Postgres. Use SQLite-isolated dev
  instead — see [[Environments#Local dev-time port matrix]].
- **Any experiment that mutates admin-editable content** (scenes,
  dungeons, catalog, NPCs, quests) unless you deliberately want the
  change live.

## Prerequisites

- Docker stack up: `docker compose up -d backend db redis`. Verify with:
  ```bash
  curl -s http://localhost:3001/api/auth/status
  # → {"userCount":26,"registrationOpen":true}
  ```
- No process bound on `:5173`, `:5174`, or (ideally) `:3000`. If `:3000`
  is bound by a leftover `pnpm dev:backend`, kill it — see
  [[Environments#Local dev-time port matrix]] for why.
- A valid admin account in the shared Postgres. If you don't remember
  the password, follow [[Reset a player password]] first (works on any
  user, admin or not).

## Steps

### 1. Confirm the env files

Both files are committed and default to the Docker backend on `:3001`:

```bash
cat frontend/.env.development
# VITE_BACKEND_URL=http://localhost:3001

cat admin/.env.dev
# VITE_BACKEND_URL=http://localhost:3001
```

If either is missing or points at `:3000`, that's the throwaway SQLite
dev backend. Fix by rewriting to `http://localhost:3001`.

### 2. Build the shared workspace

Vite dev doesn't rebuild the workspace-linked `@digiworld/shared`
package on its own. Do this once per shared change:

```bash
pnpm --filter @digiworld/shared build
```

### 3. Launch dev servers

Two terminals (or two backgrounded processes):

```bash
# Player app on :5173 (HMR)
pnpm --filter @digiworld/frontend dev

# Admin panel on :5174 (HMR)
pnpm --filter @digiworld/admin dev
```

Vite is silent about the proxy target — inspect
[`frontend/vite.config.ts`](../frontend/vite.config.ts) and
[`admin/vite.config.ts`](../admin/vite.config.ts) to confirm they read
`VITE_BACKEND_URL` (they do via `loadEnv(mode, process.cwd(), 'VITE_')`).

### 4. Verify the same DB is reached from all four surfaces

Every one should return the same `userCount`:

```bash
curl -s http://localhost:3001/api/auth/status              # direct
curl -s http://localhost:5173/api/auth/status              # frontend dev proxy
curl -s http://localhost:5174/api/auth/status              # admin dev proxy
curl -s https://soul.xenon.dev.br/api/auth/status          # public URL
# All four → {"userCount":26,"registrationOpen":true} (or whatever the current count is)
```

If any of the four disagrees, one of the proxies is pointing at the
wrong backend — check its `VITE_BACKEND_URL`.

### 5. Log in

Use the browser at `http://localhost:5173` (player) or
`http://localhost:5174` (admin). Credentials MUST be a user that exists
in the shared Postgres — the `admin_smoke` / `xenon_test` throwaway
users from the SQLite dev DB will NOT authenticate against Postgres.

### 6. When you're done

Kill the dev servers (Ctrl-C in each terminal, or `kill $(cat …pid)` if
backgrounded). The Docker `backend`, `db`, `redis`, `frontend`, `admin`,
`discord-bot` containers can stay up — they're the always-on
production-parity stack.

## Under the hood — why the cookie rewrite matters

The Docker `backend` runs `NODE_ENV=production` (see
[`docker-compose.yml`](../docker-compose.yml)), so every session cookie
minted by [`backend/src/auth/session.ts`](../backend/src/auth/session.ts)
carries `Secure`. A plain-HTTP browser at `localhost:5173/5174` rejects
`Secure` cookies over HTTP — you'd log in, get a 200, then the follow-up
`GET /api/auth/me` would 401 because no cookie made it back.

Both Vite proxies fix this with a `Set-Cookie` rewriter (see
[[Environments#The Vite proxy Set-Cookie rewrite]]). It strips
`Domain=`, strips `Secure`, and coerces `SameSite=None` → `SameSite=Lax`.
`changeOrigin: true` is also required so the backend's CORS policy sees
the request as coming from itself, not from `localhost:517x`.

Without either patch, login rounds fail silently — the same failure the
[[2026-07-31 — Standalone Admin SPA]] ADR documented for the admin, now
applied identically to the player frontend.

## Troubleshooting

### Login says 200 but next request is 401

Cookie rewrite isn't in effect. Reload `vite.config.ts` (restart the
dev server — env-level changes don't HMR). Confirm the proxy config
matches the pattern in [[Environments#The Vite proxy Set-Cookie rewrite]].

### Login itself returns 401 with correct credentials

You're hitting the wrong DB. Run the four `curl` checks in step 4. If
the dev-proxy `userCount` doesn't match the direct `:3001` count, the
proxy is pointing at a different origin (probably the throwaway `:3000`
SQLite backend — see [[Environments#Local dev-time port matrix]]).

### The public URL breaks after I stop a container

Cloudflared routes `soul.xenon.dev.br` → `http://frontend:8080`. If you
`docker stop digiworld-frontend-1`, the tunnel returns 502 until you
restart. The dev servers on `:5173/:5174` do NOT serve the public URL —
they're purely local.

## Related

- [[Environments]] — the full env matrix + port table this runbook lives inside
- [[Session cookies]] — the cookie contract the proxy rewrite is compensating for
- [[2026-07-31 — Standalone Admin SPA]] — the ADR that originally landed
  the admin's cookie-rewrite pattern; the frontend adopted the same
  pattern in a follow-up
- [[Reset a player password]] — for the "I don't remember the shared
  Postgres admin password" case
