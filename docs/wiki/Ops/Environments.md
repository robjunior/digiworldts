---
tags:
  - digiworld/ops
aliases:
  - Environments
  - Dev Staging Prod
  - Env Matrix
created: 2026-08-01
updated: 2026-08-03
grounded-in:
  - docs/environments.md
  - .env.example
  - .github/workflows/deploy-staging.yml
  - .github/workflows/deploy-production.yml
  - scripts/materialize-env.sh
  - backend/src/config.ts
  - admin/vite.config.ts
  - frontend/vite.config.ts
  - admin/.env.dev
  - frontend/.env.development
  - docker-compose.yml
verified-at-commit: 97f72ba
---

# Environments

> [!info] TL;DR
> Three environments — **development**, **staging**, **production** — share
> ONE canonical variable schema in [`.env.example`](../.env.example) but
> consume their values from different sources. Dev is a hand-edited local
> `.env`; staging + production live in **GitHub Actions Environments** as
> `secrets.*` + `vars.*`, then get written to a `.env` file at deploy time
> by [`scripts/materialize-env.sh`](../scripts/materialize-env.sh). No
> secret ever hits the shell command line or the workflow log.

## The matrix

|            | Value source                                        | Trigger                        | Compose profile           |
| ---------- | --------------------------------------------------- | ------------------------------ | ------------------------- |
| **dev**    | Local `.env`, edited by hand                        | `docker compose up` / `pnpm dev` | opt-in `--profile discord` |
| **staging**| GH Actions Environment `staging` secrets + vars     | Push to `main`, or manual dispatch | always (deploy step)     |
| **production** | GH Actions Environment `production` secrets + vars | Tag `vX.Y.Z`, or manual dispatch | always (deploy step)   |

Shared runtime: `POSTGRES` + `Redis` + `backend` + `frontend` +
`discord-bot` + optional `admin` (the last two live behind the `discord`
and `admin` compose profiles respectively).

## Development

Copy the template and edit by hand:

```bash
cp .env.example .env
$EDITOR .env
```

For local Discord + MP work, keep the sandbox defaults for the
`MP_PAYER_*` block — they're MercadoPago-safe fakes. `MP_ACCESS_TOKEN`
must be a `TEST-…` token.

Bring the stack up:

```bash
# Game only
docker compose up -d --build

# With the Discord commerce bot (Wave-1 required)
docker compose --profile discord up -d --build
```

`.env` is git-ignored — never commit it.

### Local dev-time port matrix (the ONE-backend layout)

When both the Docker `backend` container AND the Vite dev servers are
running against it, the local host exposes six ports. Every one has a
distinct purpose — the redundancy is deliberate, but you should know which
is which so no orphan process piles up.

| Host port | Service                                           | DB / target                     | HMR? |
| --------- | ------------------------------------------------- | ------------------------------- | ---- |
| **`:3001`** | Docker `backend` (Fastify)                      | **Postgres** (`digiworld-db-1`) | no   |
| `:5173`   | Vite dev of [`frontend/`](../frontend)             | proxies `/api` + `/ws` → `:3001`| **yes** |
| `:5174`   | Vite dev of [`admin/`](../admin)                   | proxies `/api` + `/ws` → `:3001`| **yes** |
| `:8080`   | Docker `frontend` (nginx serving `dist/`)          | talks → `:3001`. **Cloudflared points here** for `soul.xenon.dev.br`. | no |
| `:8090`   | Docker `admin` (nginx serving `dist/`)             | talks → `:3001`.                | no |
| `:3100`   | Docker `discord-bot`                               | talks → `:3001` on internal net.| no |

> [!warning] `:3000` is intentionally free
> The old habit of spawning `pnpm dev` at the repo root would bind a
> SECOND backend (SQLite, throwaway data) on `:3000`. That instance is
> redundant once `:3001` is up — kill it. If you need SQLite-isolated
> dev data, spin it up but bind a non-conflicting port and update
> `.env.development` accordingly.

The public URL `https://soul.xenon.dev.br` is served by cloudflared
routing `soul.xenon.dev.br → http://frontend:8080` (verified via
`docker logs cloudflared` — see ingress config). Do NOT stop the Docker
`frontend` container without a rebuild pipeline ready, or the public URL
breaks until you `docker compose up -d --build frontend`.

### Sharing the Docker Postgres backend from local dev

The Vite proxy in both [`frontend/vite.config.ts`](../frontend/vite.config.ts)
and [`admin/vite.config.ts`](../admin/vite.config.ts) can point at ANY
backend origin via `VITE_BACKEND_URL`. The default in dev now points at
the **Docker Postgres backend on `:3001`** so HMR-driven UI iteration hits
the same data as `soul.xenon.dev.br`.

```bash
# One-time setup — env files are already committed at these paths:
#   frontend/.env.development → VITE_BACKEND_URL=http://localhost:3001
#   admin/.env.dev            → VITE_BACKEND_URL=http://localhost:3001

# Start the shared Postgres-backed backend (Docker):
docker compose up -d backend db redis

# Launch HMR dev servers (they proxy /api + /ws to :3001):
pnpm --filter @digiworld/frontend dev   # → http://localhost:5173
pnpm --filter @digiworld/admin dev      # → http://localhost:5174
```

> [!warning] Every write on `:5173/:5174` hits real Postgres
> There's no isolation — user creation, roster changes, currency spend,
> admin edits all commit to the same DB `soul.xenon.dev.br` reads.
> Use a throwaway admin account (or spin up isolated SQLite dev if you
> need a sandbox — see the `:3000` warning above).

### The Vite proxy Set-Cookie rewrite

The Docker backend runs `NODE_ENV=production` (per
[`docker-compose.yml`](../docker-compose.yml)) so its session cookie is
served with `Secure` and (when `CORS_ORIGINS` is set) `SameSite=None` —
a plain-HTTP `localhost:5173/5174` browser rejects that. Both Vite dev
proxies solve this the same way — see the `configure: (proxy) => {...}`
block in each vite.config.ts:

```typescript
// admin/vite.config.ts + frontend/vite.config.ts
configure: (proxy) => {
  proxy.on('proxyRes', (proxyRes) => {
    const setCookie = proxyRes.headers['set-cookie'];
    if (!setCookie) return;
    proxyRes.headers['set-cookie'] = setCookie.map((cookie) =>
      cookie
        .replace(/;\s*Domain=[^;]+/i, '')
        .replace(/;\s*Secure/i, '')
        .replace(/SameSite=None/i, 'SameSite=Lax'),
    );
  });
},
```

`changeOrigin: true` is also required so the backend sees the proxy's
origin, not the browser's — otherwise CORS 403s the login.

See [[Run dev against production Postgres]] for the full walkthrough.

## Staging + production

Both envs live in [GitHub Actions Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments).
The deploy workflows
([`deploy-staging.yml`](../.github/workflows/deploy-staging.yml),
[`deploy-production.yml`](../.github/workflows/deploy-production.yml))
map each `secrets.X` and `vars.X` into a job step's `env:` block, then
invoke [`scripts/materialize-env.sh`](../scripts/materialize-env.sh) to
write a `.env` file on the runner.

### One-time setup per environment

For **each** of `staging` and `production`:

1. **Create the Environment** — `Settings > Environments > New environment`.
   Name exactly `staging` or `production` (the workflow references
   `environment: staging`/`production`).
2. **Add secrets** — `Environment secrets` tab. Every secret name matches
   the `.env` variable name 1:1.
3. **Add variables** — `Environment variables` tab. Same 1:1 naming.
4. **Production only, recommended** — enable `Required reviewers` and
   restrict deployments to protected branches + tags. Gates every prod
   deploy behind a human approval.

### Required secrets (Environment > Secrets)

| Secret name              | What it is                                         | dev vs staging vs prod |
| ------------------------ | -------------------------------------------------- | ---------------------- |
| `POSTGRES_PASSWORD`      | Postgres role password                             | fresh random per env |
| `REDIS_PASSWORD`         | Redis AUTH password                                | fresh random per env |
| `SESSION_SECRET`         | Cookie signing key (32+ chars)                     | fresh random per env |
| `CLOUDFLARE_TUNNEL_TOKEN`| Cloudflared tunnel token                           | fresh per env, or empty to disable |
| `SERVICE_TOKEN_DISCORD`  | Backend ↔ Discord service M2M bearer               | fresh random per env |
| `DISCORD_TOKEN`          | Discord bot token                                  | **separate Discord app per env** |
| `DISCORD_CLIENT_SECRET`  | Discord OAuth client secret                        | **separate Discord app per env** |
| `MP_ACCESS_TOKEN`        | MercadoPago API access token                       | dev+staging: `TEST-…` sandbox / prod: real |
| `MP_WEBHOOK_SECRET`      | MP webhook `x-signature` verification key          | fresh per env |
| `MP_PAYER_EMAIL`         | PIX payer email                                    | dev+staging: fake / prod: real business |
| `MP_PAYER_NAME`          | PIX payer first name                               | dev+staging: fake / prod: real business |
| `MP_PAYER_LAST_NAME`     | PIX payer last name                                | dev+staging: fake / prod: real business |
| `MP_PAYER_ID_NUMBER`     | PIX payer CPF (14 digits without mask)             | dev+staging: fake / prod: real business |

### Required variables (Environment > Variables)

| Variable name           | What it is                                    | Example (staging)                  |
| ----------------------- | --------------------------------------------- | ---------------------------------- |
| `DISCORD_PUBLIC_URL`    | Public origin the bot's HTTP is reachable at  | `https://staging-discord.example.com` |
| `GAME_PUBLIC_URL`       | Public origin where players reach the game    | `https://staging.example.com`      |
| `DISCORD_CLIENT_ID`     | Discord application client ID (public)        | `1234567890123456789`              |
| `DISCORD_GUILD_ID`      | Guild the bot registers slash commands into   | `9876543210987654321`              |

### Optional variables (opt-in overrides)

Empty means "use the code default". Set only when you need to override:

| Variable name                | Code default | When to set |
| ---------------------------- | ------------ | ----------- |
| `ADMIN_BOOTSTRAP`            | `closed`     | Briefly set to `open` when bootstrapping the first admin, then flip back and re-deploy |
| `HOST_PORT`                  | `8080`       | Only if colocating multiple envs on one machine |
| `CORS_ORIGINS`               | empty (off)  | Comma-separated origins. **Non-empty flips the session cookie to `SameSite=None; Secure`** — mandatory for the standalone admin panel on a separate host. See [[Session cookies#Cookie options]] |
| `DISCORD_ADMIN_ROLE_IDS`     | empty        | Comma-separated Discord role IDs allowed to use `/admin` commerce commands |
| `MP_PAYER_ID_TYPE`           | `CPF`        | Change only if the payer identity type differs |
| `PIX_EXPIRATION_MINUTES`     | `30`         | Aligned with MP defaults |
| `PURCHASE_SWEEP_INTERVAL_MS` | `300000`     | Expired-order sweeper cadence |
| `TICKET_INACTIVITY_HOURS`    | `48`         | Support-ticket auto-close threshold |
| `RATE_LIMIT_COMMANDS`        | `20`         | Per-user command rate limit |
| `RATE_LIMIT_BUY`             | `3`          | Per-user `/buy` rate limit |
| `CREDITS_PER_BRL`            | `100`        | Snapshotted per purchase — changing never rewrites paid orders |
| `BUY_MIN_BRL`                | `5`          | Per-purchase floor |
| `BUY_MAX_BRL`                | `500`        | Per-purchase ceiling |

## Deploy step — wire your target

The deploy workflows stop at a `TODO` step after `.env` is materialised and
typecheck passes. Wire the actual rollout with ONE of the patterns below.

### Pattern A — SSH from a hosted GitHub runner to a VPS

Add three secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`. Then:

```yaml
- name: Copy .env and compose files to the host
  uses: appleboy/scp-action@v0.1.7
  with:
    host:     ${{ secrets.DEPLOY_HOST }}
    username: ${{ secrets.DEPLOY_USER }}
    key:      ${{ secrets.DEPLOY_SSH_KEY }}
    source:   ".env,docker-compose.yml,docker-compose.multinode.yml,nginx/,cloudflared/"
    target:   "~/digiworld"

- name: Pull latest code and roll containers
  uses: appleboy/ssh-action@v1.0.3
  with:
    host:     ${{ secrets.DEPLOY_HOST }}
    username: ${{ secrets.DEPLOY_USER }}
    key:      ${{ secrets.DEPLOY_SSH_KEY }}
    script: |
      cd ~/digiworld
      git pull --ff-only
      docker compose --profile discord pull
      docker compose --profile discord up -d --build --remove-orphans
      docker compose --profile discord ps
```

### Pattern B — self-hosted runner directly on the host

Register a self-hosted runner (`Settings > Actions > Runners`), change
`runs-on: ubuntu-latest` → `[self-hosted, digiworld-staging]`, then:

```yaml
- name: Roll containers in place
  run: |
    docker compose --profile discord pull
    docker compose --profile discord up -d --build --remove-orphans
    docker compose --profile discord ps
```

### Pattern C — GHCR image push + pull on host

Split into `build` (hosted runner, `docker buildx` → push to
`ghcr.io/OWNER/digiworld-backend:${{ github.sha }}`) + `deploy` (SSH →
host, `docker compose pull && docker compose up -d`). Sketch — see
[`docker/build-push-action`](https://github.com/docker/build-push-action).

## Common tasks

### Bootstrap the first admin on a fresh staging/prod deploy

1. Set the Environment variable `ADMIN_BOOTSTRAP=open`.
2. Re-run the deploy workflow (dispatch manually).
3. Open the game URL, register the admin account through the UI.
4. Set `ADMIN_BOOTSTRAP=closed` (or delete the variable — code defaults
   to `closed`).
5. Re-run the deploy workflow.

### Rotate a secret

1. Update the value in the target GH Environment.
2. Manually dispatch the deploy workflow for that env
   (`Actions > Deploy — Staging > Run workflow`).
3. `SESSION_SECRET` rotations invalidate every live cookie (users logged
   out); other rotations don't force re-login.

### Promote a change from staging to production

1. Merge into `main` → staging deploys automatically.
2. Smoke-test on staging.
3. Cut a tag: `git tag v1.4.0 && git push origin v1.4.0` → prod deploys.
   (Required reviewers, if enabled, still gate the deploy behind approval.)

### Sanity-check the materialisation locally

Dry-run `materialize-env.sh` outside CI:

```bash
POSTGRES_PASSWORD=x REDIS_PASSWORD=x SESSION_SECRET=x \
DISCORD_PUBLIC_URL=x GAME_PUBLIC_URL=x SERVICE_TOKEN_DISCORD=x \
DISCORD_TOKEN=x DISCORD_CLIENT_ID=x DISCORD_CLIENT_SECRET=x DISCORD_GUILD_ID=x \
MP_ACCESS_TOKEN=x MP_WEBHOOK_SECRET=x \
MP_PAYER_EMAIL=x MP_PAYER_NAME=x MP_PAYER_LAST_NAME=x \
MP_PAYER_ID_TYPE=CPF MP_PAYER_ID_NUMBER=x \
OUTPUT_ENV_FILE=/tmp/dw.env ./scripts/materialize-env.sh

cat /tmp/dw.env
```

Omitting any required variable prints a targeted error and exits
non-zero — same failure mode CI produces when a GH secret is missing.

## Config loader — [`backend/src/config.ts`](backend/src/config.ts)

Zod-validated at boot. Every env var goes through:

- Type coercion (`z.coerce.number()`, `z.enum([...])`)
- Sensible defaults for optional ones
- Hard fails at boot for missing required ones (before the port opens)

Read the file for the exact schema. Any config drift between docs and
runtime lives HERE — this is the source of truth for defaults.

## Admin panel across environments

The admin lives in a **standalone Vite/React workspace** (`admin/`) that
is independent of the player frontend. See [[Standalone Admin SPA]].
Consequences:

- **Player bundle no longer ships admin JS.** Every `/admin/*` route was
  removed from `frontend/src/App.tsx`; the workspace has no admin
  components. Regular players cannot reach a lazy-loaded admin chunk.
- **Admin can point at ANY environment.** Set `VITE_BACKEND_URL` at admin
  dev time and the Vite proxy tunnels `/api` + `/ws` to that origin.
  Cookies flow transparently because the browser sees same-origin
  (`http://localhost:5174`).

```bash
# Local backend
pnpm --filter @digiworld/admin dev

# Staging (edit admin/.env.staging first)
pnpm --filter @digiworld/admin dev:staging

# Production — prints a red banner + confirm dialog on boot
pnpm --filter @digiworld/admin dev:production
```

The Vite proxy in [`admin/vite.config.ts`](../admin/vite.config.ts)
rewrites `Set-Cookie` from remote backends (strips `Domain=` and
`Secure`, coerces `SameSite=None` → `Lax`) so a production
`HttpOnly; Secure; SameSite=None` cookie is accepted on plain HTTP dev.

### Deployed admin on a subdomain

For real production (`admin.example.com` in front of the standalone SPA):

- `CORS_ORIGINS=https://admin.example.com,https://example.com` — flips
  the game backend cookie to `SameSite=None; Secure`. See
  [[Session cookies#Cookie options]].
- HTTPS mandatory end-to-end once this is on.
- Point the subdomain at the admin nginx (docker-compose `admin` service
  or your own bucket + CDN serving `admin/dist`).

The admin does NOT require its own database, Redis, or environment
secrets — it's a stateless SPA that talks to the game backend via the
same authenticated `/api/*` surface.

## Related

- [[Multi-node Deployment]] — how the runtime stack shape works when
  multiple game nodes share Postgres + Redis
- [[Session cookies]] — the CORS-aware cookie policy that makes the
  standalone admin work
- [[Standalone Admin SPA]] — the ADR that landed the split
- [`docs/environments.md`](docs/environments.md) — the source of truth
  for this note; if these two drift, THAT file wins
