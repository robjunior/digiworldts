---
tags:
  - digiworld/adr
aliases:
  - Standalone Admin SPA
  - Admin Split
  - ADR-001
created: 2026-07-31
updated: 2026-08-01
status: Accepted
grounded-in:
  - admin/vite.config.ts
  - admin/Dockerfile
  - admin/src/components/admin/AdminGuard.tsx
  - backend/src/auth/session.ts
  - docker-compose.yml
  - deploy/admin-nginx.conf
  - frontend/src/App.tsx
verified-at-commit: 97f72ba
---

# 2026-07-31 — Standalone Admin SPA

> [!info] Status
> **Accepted** and shipped. Two commits carry the migration:
> - `1bbb090 feat(admin): standalone Vite/React admin SPA` — new workspace
> - `97f72ba refactor(admin): finish standalone SPA cutover — remove old
>   files + wire cross-origin auth`

## Context

Before this ADR, admin lived under `frontend/src/routes/Admin*.tsx` +
`frontend/src/components/admin/*` + `frontend/src/lib/api-{admin,
dungeon-admin, quest-admin}.ts` — every player fetched the code, even
though 99.9% of players never see the admin panel.

That in-bundle admin had three concrete problems:

1. **Bundle bloat for regular players.** `Admin-*.js` weighed ~106 KB
   after route-splitting, but the router table + AdminGuard component still
   shipped in the player entrypoint. A React-Router `RouteGuard` seeing an
   admin route it can never render is 1–2 KB of dead code in the critical
   path.
2. **No environment portability.** Admins log in through the same origin
   as players. There was no way to run a local `pnpm dev` admin against
   staging or production — the admin UI was hardcoded to whatever host
   served it.
3. **Blast radius on visual regressions.** Any player-frontend refactor
   could break admin components that shared design-system primitives
   (buttons, dialogs, dropdowns). CI passed, prod broke.

## Decision

Split admin into its own **standalone Vite + React SPA** at `admin/`
inside the monorepo. Independently built, deployed, and scoped.

- **Own workspace.** `admin/package.json` declares
  `@digiworld/admin@0.1.0`; registered in
  [`pnpm-workspace.yaml`](pnpm-workspace.yaml) as `admin` (first entry).
- **Own Dockerfile.** [`admin/Dockerfile`](admin/Dockerfile) — pnpm
  install shared + admin only, tsc + vite build, nginx runtime serving
  `admin/dist`.
- **Own compose service.** Behind the `admin` profile in
  [`docker-compose.yml`](docker-compose.yml) — off by default, opt-in with
  `docker compose --profile admin up`.
- **Own nginx target.** [`deploy/admin-nginx.conf`](deploy/admin-nginx.conf)
  serves the built SPA on `${ADMIN_HOST_PORT:-8090}`.

## Cross-origin auth contract

The hardest technical piece — the admin SPA runs on a **different origin**
(e.g. `admin.example.com`) from the game backend (`example.com`). Browsers
gate cross-site cookies behind `SameSite=None + Secure`, so the game
backend's session cookie policy needed a conditional switch.

**Solution** ([`backend/src/auth/session.ts:141-159`](backend/src/auth/session.ts:141)):

```typescript
const HAS_CORS_ORIGINS = config.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0).length > 0;

function cookieOpts() {
  const sameSite = HAS_CORS_ORIGINS ? 'none' : 'lax';
  const secure   = HAS_CORS_ORIGINS ? true   : !IS_DEV;
  return { path: '/', httpOnly: true, sameSite, secure, maxAge: TTL_SEC, signed: true };
}
```

- **Monolith mode** (`CORS_ORIGINS` empty) — historical `SameSite=Lax`,
  Secure only in prod. Zero behaviour change for single-origin deploys.
- **Cross-origin mode** (`CORS_ORIGINS` non-empty) — auto-flips to
  `SameSite=None; Secure`. `Secure` is always forced when
  `SameSite=None` because the spec rejects that combo otherwise.

See [[Session cookies#Cookie options]] for the full contract.

## Dev-mode HTTPS bypass

`SameSite=None; Secure` requires HTTPS end-to-end in a browser — which is
unpleasant for `pnpm dev`. The admin Vite proxy in
[`admin/vite.config.ts`](admin/vite.config.ts) rewrites `Set-Cookie`
headers received from the remote backend:

- Strip `Secure` attribute
- Coerce `SameSite=None` → `SameSite=Lax`
- Strip `Domain=` so the cookie stays on `localhost`

So a production `HttpOnly; Secure; SameSite=None` cookie is accepted by
the local browser on `http://localhost:5174` without touching the backend
config.

## `AdminGuard` hardening

The old `AdminGuard` silently redirected any non-admin to `/`. That was
noise for two failure modes it should have distinguished:

| Situation           | Old behaviour              | New behaviour                                           |
| ------------------- | -------------------------- | ------------------------------------------------------- |
| `status: 'loading'` | Redirect to `/`            | Render nothing (avoids login-flash on auth check)       |
| `status: 'anon'`    | Redirect to `/`            | 302 `/login?next=<current>` — comes back after auth     |
| Authed non-admin    | Redirect to `/`            | Hard **403** page naming the account                    |
| Authed admin        | Render children            | Render children (unchanged)                             |

New shape ([`admin/src/components/admin/AdminGuard.tsx`](admin/src/components/admin/AdminGuard.tsx)):

```tsx
if (status === 'loading') return <div className="admin-guard-loading" aria-hidden="true" />;

if (status === 'anon' || user === null) {
  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}

if (user.isAdmin !== true) {
  return (
    <div role="alert" style={{ /* 403 layout */ }}>
      <h1>403 — Not an admin</h1>
      <p>You're logged in as <b>{user.displayName ?? user.username}</b>,
         but this account isn't flagged as admin.</p>
    </div>
  );
}

return <>{children}</>;
```

> [!info] Defense in depth
> The backend still enforces `is_admin=1` on every `/api/admin/*` route.
> A compromised UI cannot grant privilege it didn't have. Guard is UX;
> backend is authority.

## Frontend cleanup

The follow-up commit `97f72ba` (`refactor(admin): finish standalone SPA
cutover`) landed **43 file deletions**:

- Every `frontend/src/components/admin/*.tsx`
- Every `frontend/src/routes/Admin*.tsx`
- `frontend/src/lib/api-{admin,dungeon-admin,quest-admin}.ts`

Plus 8 files modified, including:

- `frontend/src/App.tsx` — 4 lazy-imports + 4 routes removed
- `frontend/src/routes/Roster.tsx` — the ONE cross-boundary import
  (`getCatalog` from `api-admin`) rehomed to a new focused
  `frontend/src/lib/api-catalog.ts`

Net: `frontend/dist` loses ~106 KB (Admin-*.js) plus the ~2 KB of guard
scaffolding. The Vite bundle for the player app is now purely player.

## Consequences

### Positive

- **Zero admin JS in the player bundle.** Not one byte reaches a regular
  player.
- **Admin can point at ANY backend.** Set `VITE_BACKEND_URL` at admin
  dev time, Vite proxy tunnels `/api` + `/ws` to whatever origin.
  Cookies flow transparently through the proxy.
- **Independent CI cadence.** Admin can iterate without gating on player
  frontend visual regressions.
- **Independent deploy target.** `docker compose --profile admin up`
  or a static bucket + CDN. Doesn't share the player nginx.
- **`AdminGuard` distinguishes failure modes** — the 403 page is
  actionable ("your account isn't flagged as admin"), the redirect
  loop bug is gone.

### Negative

- **Two workspaces to keep type-consistent.** `@digiworld/shared` is
  the only intended sharing surface; anything shared beyond it should
  land there or via a new package.
- **Duplicated `scene3d/particles/` tree.** The admin panel needs the
  particle emitter runtime for the [[Weather System]] editor's live
  preview — currently duplicated in both `frontend/src/scene3d/particles/`
  and `admin/src/scene3d/particles/`. TODO: promote to
  `@digiworld/shared` or a new `@digiworld/scene3d` package.
- **CORS + cookie contract has a footgun.** Setting `CORS_ORIGINS` in
  dev (even for testing) silently flips the backend into
  `SameSite=None; Secure` mode; the browser then refuses to send the
  cookie on plain HTTP. Watch out on staging with mixed HTTP endpoints.

### Neutral

- **The player frontend no longer builds admin.** Anyone looking for
  admin components in `frontend/src/` will find a "not found" — they
  live in `admin/src/`.
- **Discord bot lookup unchanged.** `SELECT users WHERE discord_id = ?`
  in [`backend/src/service/routes.ts`](backend/src/service/routes.ts)
  works transparently — see [[OAuth#Legacy Discord code-link]].

## Compose service

Defined in [`docker-compose.yml`](docker-compose.yml) under the `admin`
profile:

```yaml
admin:
  profiles: ["admin"]
  build:
    context: .
    dockerfile: admin/Dockerfile
  container_name: digiworld-admin-1
  depends_on:
    backend:
      condition: service_healthy
  ports:
    - "${ADMIN_HOST_PORT:-8090}:8080"
  volumes:
    - ./frontend/public/assets/arenas:/usr/share/nginx/html/assets/arenas:ro
  restart: unless-stopped
```

Not built by `docker compose up`. Opt-in with `--profile admin`.

## Follow-ups

- **Promote `scene3d/particles/` to shared.** Currently duplicated;
  moving it to `@digiworld/shared/scene3d` (or a sibling package) removes
  the drift risk without changing runtime behaviour.
- **`api-catalog.ts` split**. `getCatalog` was the ONE function the
  player app still needed from admin — now lives in its own file. Watch
  for future cross-boundary imports; they should split similarly.
- **Admin nginx should serve `arenas/` from the shared bucket**, not the
  bind-mount into the container. Convenient for dev; adds coupling in
  prod.

## Rejected alternatives

### Keep in-bundle, route-split harder

Would have saved the 43 file moves but not fixed the cross-origin dev
story or the environment-pinning problem. Route-splitting is a code-size
optimisation, not an architecture split.

### Server-side admin (Fastify-rendered)

Would have avoided the CORS complexity but forced admin UI iteration into
the backend deploy cycle. Admin needs to iterate independently of the
game runtime — server-rendered pages fight that.

### Separate repo entirely

Would have added a submodule / package-registry step to every admin PR.
Too much friction for the current team size. If the admin ever grows
its own team, revisit.

## Related

- [[Session cookies#Cookie options]] — the CORS-aware cookie policy
- [[Environments#Admin panel — split into its own service]] — how to
  point the admin at staging / production
- [[HTTP Surface]] — the `/api/admin/*` surface the admin drives
- [[Standalone Admin SPA]] (this note, alt-alias)
