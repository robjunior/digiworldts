---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Admin subdomain
  - Admin panel deploy
  - CORS admin
  - Cross-origin admin
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - admin/vite.config.ts
  - admin/Dockerfile
  - backend/src/auth/session.ts
  - deploy/admin-nginx.conf
  - docker-compose.yml
  - docs/environments.md
verified-at-commit: 13dc16b
---

# Deploy the admin panel to a subdomain

> [!info] When to use this
> You want the admin panel on its own hostname (`admin.example.com`)
> instead of `example.com/admin`. Recommended for production so the
> player frontend never ships admin JS and admins can be gated behind
> stricter network / IP rules independent of the player origin. See
> [[2026-07-31 — Standalone Admin SPA]] for the rationale.

## Prerequisites

- DNS control for a subdomain (`admin.example.com`, or whatever you pick).
- TLS termination for that subdomain. Cloudflare, Let's Encrypt on
  nginx, whatever your setup uses.
- The player frontend already runs at `example.com` (or wherever the
  game backend + player nginx are).

**HTTPS is MANDATORY** for cross-origin cookies with `SameSite=None`.
There's no plain-HTTP fallback in a real browser session — dev has a
Vite proxy workaround, prod does not.

## The one config knob that matters

`CORS_ORIGINS` on the backend is the single switch. When non-empty:

- [`backend/src/auth/session.ts::cookieOpts()`](backend/src/auth/session.ts:141)
  flips `SameSite=None` + forces `Secure=true`.
- Cross-site fetches from the admin origin start carrying the session
  cookie.

Value: comma-separated list of ORIGINS (not paths, not wildcards):

```
CORS_ORIGINS=https://admin.example.com,https://example.com
```

Include the PLAYER origin too so any admin action from a browser that
also has the player app open doesn't break.

## Steps

### 1. Provision the subdomain

DNS: add an A / CNAME record for `admin.example.com` pointing at your
edge (nginx, Cloudflare, whatever).

TLS: issue a cert covering `admin.example.com`. Either add it to the
SAN of your existing wildcard or issue a new one.

### 2. Set `CORS_ORIGINS` on the backend

**Staging / production**: `Settings > Environments > … > Variables`, set
`CORS_ORIGINS=https://admin.example.com,https://example.com`.

**Dev** (rarely needed — dev usually goes through the Vite proxy): edit
`.env`. Once you set this, cookies flip to `SameSite=None; Secure`,
which browsers refuse on plain HTTP → the player app breaks locally.
See the dev-mode Vite proxy in [[2026-07-31 — Standalone Admin SPA#Dev-mode HTTPS bypass]].

### 3. Restart / redeploy the backend

Same as any env change:

```bash
docker compose restart backend        # single-node
docker compose -f docker-compose.multinode.yml restart game-node1 game-node2   # multi-node
```

Verify by inspecting the cookie on a fresh player login:

```bash
curl -sS -c /tmp/cookies.txt -X POST \
  -H 'content-type: application/json' \
  -d '{"username":"<user>","password":"<pw>"}' \
  https://example.com/api/auth/login
cat /tmp/cookies.txt
```

You should see:

```
example.com  TRUE  /  TRUE  <expires>  digiworld_sid  <token>
                          ^^^^ Secure=true
```

And the `Set-Cookie` header from the login response should include
`SameSite=None`.

### 4. Build the admin SPA for the target backend

The admin needs to know the backend URL at BUILD time (embedded in the
built JS as `VITE_BACKEND_URL`).

Edit `admin/.env.production` (or the equivalent your deploy uses):

```
VITE_BACKEND_URL=https://example.com
```

Build:

```bash
pnpm --filter @digiworld/admin build
# → admin/dist/ ready
```

### 5. Deploy the built SPA

**Option A — bundled compose service.**

```bash
docker compose --profile admin up -d --build admin
# → digiworld-admin-1 running on ${ADMIN_HOST_PORT:-8090}
```

Point your edge (nginx, Cloudflare) at `<host>:8090` for the
`admin.example.com` vhost. The bundled admin nginx is at
[`deploy/admin-nginx.conf`](deploy/admin-nginx.conf) — SPA fallback to
`index.html` is already wired.

**Option B — static bucket + CDN.**

`admin/dist` is a plain static site. Sync to S3 / Cloudflare R2 / Vercel:

```bash
aws s3 sync admin/dist/ s3://admin-example-com-bucket/ --delete
```

Configure the bucket for SPA routing (fallback to `index.html` on 404).

### 6. Test the round-trip

Open a fresh browser session (or Incognito) to `admin.example.com`:

1. You get redirected to `example.com/login?next=...` (admin guard fired
   because no session cookie).
2. Log in with an admin account.
3. Post-login, you land back on `admin.example.com` — the session cookie
   set by `example.com` is now sent on cross-site fetches because of
   `SameSite=None`.
4. The admin dashboard loads. Every `/api/admin/*` call succeeds.

If step 3 fails and every `/api/admin/*` returns 401, the cookie isn't
crossing. Debug checklist:

- **Cookie inspector** — verify the cookie set by `/api/auth/login` has
  `SameSite=None; Secure`. If it says `Lax`, the backend didn't pick up
  `CORS_ORIGINS`.
- **`fetch()` credentials** — the admin app must send
  `credentials: 'include'` (verify in
  [`admin/src/lib/api.ts`](admin/src/lib/api.ts) — the shared api client
  does this).
- **HTTPS** — every party must be HTTPS. A single plain-HTTP redirect in
  the chain kills the cookie.
- **Third-party cookies** — some browsers (Safari ITP, Firefox strict
  mode) block third-party cookies by default. The admin origin and the
  game origin must share a REGISTRABLE domain (both `*.example.com`) for
  them to be first-party. If your admin is on a completely different
  domain (`digiworld-admin.io` vs `example.com`), you're in third-party
  territory.

## Local admin dev against a REMOTE backend

The Vite proxy in [`admin/vite.config.ts`](admin/vite.config.ts) tunnels
`/api` + `/ws` to the remote and rewrites `Set-Cookie` (strip `Secure`,
coerce `SameSite=None` → `Lax`) so the local browser accepts them.

```bash
# .env.staging in admin/
VITE_BACKEND_URL=https://staging.example.com

# Dev
pnpm --filter @digiworld/admin dev:staging
# → http://localhost:5174/  proxying to staging
```

Log in normally; the cookie is auto-rewritten to be accepted on
`localhost`. No backend config change needed.

## Rollback

To retire the admin subdomain:

1. Clear `CORS_ORIGINS` (or set to just the player origin).
2. Restart backend — cookies flip back to `SameSite=Lax`; existing
   admin-panel cookies stop being sent on cross-site fetches.
3. Stop the admin compose service:
   ```bash
   docker compose --profile admin stop admin
   ```

Player app is unaffected.

## What can go wrong

> [!warning] `CORS_ORIGINS` set but the actual browser Origin isn't in the list
> The cookie policy flipped correctly, but the CORS response header
> `Access-Control-Allow-Origin` won't include the requesting origin, so
> the browser rejects the response. **Both** the cookie policy AND the
> CORS response come from `CORS_ORIGINS` — same source of truth,
> different mechanisms.

> [!warning] `SameSite=None` cookie NOT sent on top-level navigation
> Top-level navs (typing the URL, clicking a link) sometimes drop
> `SameSite=None` cookies in Chrome unless the request has appropriate
> user-activation. XHR / fetch is fine; direct navigation from an admin
> bookmark may not be. Use a login flow that redirects THROUGH the
> player origin.

> [!warning] Third-party cookie blocking
> Firefox in strict mode blocks third-party cookies by default. Safari
> ITP has been aggressive here for years. Choose a subdomain of the SAME
> registrable domain as the player app to stay first-party.

## Related

- [[2026-07-31 — Standalone Admin SPA]] — the ADR that authorized this
- [[Session cookies#Cookie options]] — the CORS-aware policy
- [[Environments#Admin panel — split into its own service]]
- [[Multi-node Deployment#nginx config sketch]] — for extending the same
  nginx to serve two vhosts
