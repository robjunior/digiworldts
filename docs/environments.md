# Environments

DigiWorld runs across three environments — **development**, **staging**, and
**production** — that share ONE canonical variable schema ([`.env.example`](../.env.example))
but consume their values from different sources.

|            | Value source                                | Trigger                        | Compose profile |
| ---------- | ------------------------------------------- | ------------------------------ | --------------- |
| dev        | Local `.env`, edited by hand                | `docker compose up` / `pnpm dev` | opt-in `--profile discord` |
| staging    | GitHub Actions Environment `staging` secrets + vars | Push to `main`, or manual dispatch | always (deploy step) |
| production | GitHub Actions Environment `production` secrets + vars | Tag `vX.Y.Z`, or manual dispatch | always (deploy step) |

The shared runtime is: `POSTGRES` + `Redis` + `backend` + `frontend` + `discord-bot`
+ optional `admin` (the last two are behind the `discord` and `admin` compose profiles).

---

## 1. Development

1. Copy the template and edit values by hand:
   ```bash
   cp .env.example .env
   $EDITOR .env
   ```
2. For local Discord+MP work, keep the sandbox defaults for the
   `MP_PAYER_*` block — they're MercadoPago-safe fakes. Make sure
   `MP_ACCESS_TOKEN` is a `TEST-…` token.
3. Bring the stack up:
   ```bash
   # game only
   docker compose up -d --build
   # with the Discord commerce bot
   docker compose --profile discord up -d --build
   ```
4. First-user-is-admin bootstrap: temporarily flip `ADMIN_BOOTSTRAP=open`,
   restart, register the first user through the UI, flip back to `closed`,
   restart. See the [main README](../README.md) for the full flow.

`.env` is git-ignored — never commit it.

---

## 2. Staging + production

Both envs live in [GitHub Actions Environments](https://docs.github.com/en/actions/deployment/targeting-different-environments).
The deploy workflows ([`deploy-staging.yml`](../.github/workflows/deploy-staging.yml),
[`deploy-production.yml`](../.github/workflows/deploy-production.yml)) map each
`secrets.X` and `vars.X` into a job step's `env:` block, then invoke
[`scripts/materialize-env.sh`](../scripts/materialize-env.sh) to write a `.env`
file on the runner. No secret ever hits the shell command line or the workflow log.

### One-time setup per environment

For **each** of `staging` and `production`:

1. **Create the Environment.** `Settings > Environments > New environment`.
   Name it `staging` (or `production`, exact spelling — the workflow references
   `environment: staging`/`production`).
2. **Add secrets** — `Environment secrets` tab. See the table below for the
   canonical list. Every secret name matches the `.env` variable name 1:1.
3. **Add variables** — `Environment variables` tab. Same 1:1 naming.
4. **(production only, recommended)** enable `Required reviewers` and restrict
   deployments to protected branches + tags. This gates every prod deploy
   behind a human approval.

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
| `MP_PAYER_ID_NUMBER`     | PIX payer CPF (14 digits w/out mask)               | dev+staging: fake / prod: real business |

### Required variables (Environment > Variables)

| Variable name           | What it is                                    | Example (staging)                  |
| ----------------------- | --------------------------------------------- | ---------------------------------- |
| `DISCORD_PUBLIC_URL`    | Public origin the bot's HTTP is reachable at  | `https://staging-discord.example.com` |
| `GAME_PUBLIC_URL`       | Public origin where players reach the game    | `https://staging.example.com`      |
| `DISCORD_CLIENT_ID`     | Discord application client ID (public)        | `1234567890123456789`              |
| `DISCORD_GUILD_ID`      | Guild the bot registers slash commands into   | `9876543210987654321`              |

### Optional variables (opt-in overrides — empty means "use code default")

| Variable name                | Code default | When to set |
| ---------------------------- | ------------ | ----------- |
| `ADMIN_BOOTSTRAP`            | `closed`     | Briefly set to `open` when bootstrapping the first admin, then flip back and re-deploy |
| `HOST_PORT`                  | `8080`       | Only if colocating multiple envs on one machine |
| `CORS_ORIGINS`               | empty (off)  | Set to the frontend origin(s), comma-separated. **Non-empty flips the session cookie to `SameSite=None; Secure`** so the standalone admin (`admin.example.com`) can authenticate against the game backend (`example.com`). Requires HTTPS end-to-end in production. |
| `DISCORD_ADMIN_ROLE_IDS`     | empty        | Comma-separated Discord role IDs allowed to use `/admin` commerce commands |
| `MP_PAYER_ID_TYPE`           | `CPF`        | Change only if the payer identity type differs |
| `PIX_EXPIRATION_MINUTES`     | `30`         | Aligned with MP defaults |
| `PURCHASE_SWEEP_INTERVAL_MS` | `300000`     | Expired-order sweeper cadence |
| `TICKET_INACTIVITY_HOURS`    | `48`         | Support-ticket auto-close threshold |
| `RATE_LIMIT_COMMANDS`        | `20`         | Per-user command rate limit |
| `RATE_LIMIT_BUY`             | `3`          | Per-user `/buy` rate limit |
| `CREDITS_PER_BRL`            | `100`        | Snapshotted per purchase — change never rewrites paid orders |
| `BUY_MIN_BRL`                | `5`          | Per-purchase floor |
| `BUY_MAX_BRL`                | `500`        | Per-purchase ceiling |

---

## 3. Deploy step — wire your target

Both deploy workflows are pre-wired for **Pattern B (self-hosted runner)** —
`runs-on: [self-hosted, staging]` / `[self-hosted, production]` with a
`docker compose --profile discord up -d --build --remove-orphans` deploy step.
Follow [`ssh-host-setup.md`](ssh-host-setup.md) to bootstrap the host, install
the runner as a systemd service, and register it against the repo. No workflow
edits required.

Pattern A (SSH from a hosted `ubuntu-latest` runner to a public VPS) is still
supported — the setup steps live in [`ssh-host-setup.md § 3–4`](ssh-host-setup.md).
To use it, revert `runs-on:` back to `ubuntu-latest` and replace the deploy
step with the scp-action + ssh-action snippet documented there.

### Pattern A — SSH from a hosted GitHub runner to a VPS

**For a fresh VPS**, follow [`ssh-host-setup.md`](ssh-host-setup.md) first — it
covers user creation, Docker install, SSH hardening, key exchange, and the
initial repo clone in ~30 commands. Then come back here.

Add three secrets to the target Environment: `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_SSH_KEY` (private key). Then replace the deploy step with:

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

**Already wired into both workflows.** See [`ssh-host-setup.md § 5`](ssh-host-setup.md)
for runner install/register/service commands. The `runs-on:` labels the
workflows target are `staging` and `production` respectively — match those when
registering the runners.

The runner has repo checkout + the freshly-materialized `.env` in
`$GITHUB_WORKSPACE`, so the compose invocation is a simple:

```yaml
- name: Roll containers in place
  run: |
    docker compose --profile discord up -d --build --remove-orphans
    docker compose ps
```

### Pattern C — GHCR image push + pull on host

Split into `build` (hosted runner, `docker buildx` → push to
`ghcr.io/OWNER/digiworld-backend:${{ github.sha }}`) + `deploy` (SSH-to-host,
`docker compose pull && docker compose up -d`). Skeleton left as an exercise —
GitHub's [`docker/build-push-action`](https://github.com/docker/build-push-action)
docs cover it.

---

## 4. Common tasks

### Bootstrap the first admin on a fresh staging/prod deploy

1. Set the Environment variable `ADMIN_BOOTSTRAP=open`.
2. Re-run the deploy workflow (dispatch manually).
3. Open the game URL, register the admin account through the UI.
4. Set `ADMIN_BOOTSTRAP=closed` (or delete the variable — the code defaults to `closed`).
5. Re-run the deploy workflow.

### Rotate a secret

1. Update the value in the target GH Environment.
2. Manually dispatch the deploy workflow for that env — `Actions > Deploy — Staging > Run workflow`.
3. Old sessions are invalidated when `SESSION_SECRET` rotates (users are logged out); other rotations don't force re-login.

### Promote a change from staging to production

1. Merge the change into `main` → staging deploy fires automatically.
2. Smoke-test on staging.
3. Cut a tag: `git tag v1.4.0 && git push origin v1.4.0` → prod deploy fires.
   (If required reviewers are enabled, someone still has to click Approve.)

### Sanity-check the materialization locally

You can dry-run `materialize-env.sh` outside CI:

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

Omitting any required variable prints a targeted error and exits non-zero — the
same failure mode CI produces when a GH secret is missing.

---

## 5. Admin panel — split into its own service

The admin UI lives in a **standalone Vite/React workspace** (`admin/`) that is
independent of the player frontend. Two consequences:

- **Player bundle no longer ships admin JS.** Every `/admin/*` route was
  removed from `frontend/src/App.tsx`; the workspace has no admin components,
  libs, or types. Regular players cannot even reach a lazy-loaded admin
  chunk.
- **Admin can point at ANY environment.** Set `VITE_BACKEND_URL` at admin dev
  time and the Vite proxy tunnels `/api` + `/ws` to that origin. Cookies flow
  transparently because the browser sees same-origin (`http://localhost:5174`).

### Local dev — connect the admin to any backend

```bash
# Connect to your local `pnpm --filter @digiworld/backend dev` on :3000
pnpm --filter @digiworld/admin dev

# Connect to staging (edit admin/.env.staging with the real host first)
pnpm --filter @digiworld/admin dev:staging

# Connect to production — prints a red banner + confirm dialog on boot
pnpm --filter @digiworld/admin dev:production
```

The Vite dev proxy in [`admin/vite.config.ts`](../admin/vite.config.ts) rewrites
`Set-Cookie` from remote backends (strips `Domain=` and `Secure`, coerces
`SameSite=None` → `Lax`) so a production `HttpOnly; Secure; SameSite=None`
cookie is still accepted by the local dev browser on plain HTTP.

### Deployed admin — separate origin (opt-in)

Bundled `admin` compose service builds `admin/dist` and serves it via nginx on
`${ADMIN_HOST_PORT:-8090}`. Behind the `admin` compose profile, so `docker
compose up` ignores it unless you opt in:

```bash
docker compose --profile admin up -d --build
# admin at http://localhost:8090
```

For a real production deploy on a subdomain (e.g. `admin.example.com`), set:

- `CORS_ORIGINS=https://admin.example.com,https://example.com` (or whatever
  the frontend origin is). Any non-empty value flips the backend session
  cookie to `SameSite=None; Secure` so cross-site fetches from the admin
  are authenticated. HTTPS end-to-end is mandatory once this is on.
- Point `admin.example.com` at the admin nginx (docker-compose `admin` service
  or your own bucket + CDN serving `admin/dist`).

The admin does **not** require its own database, Redis, or environment
secrets — it's a stateless SPA that talks to the game backend via the same
authenticated `/api/*` surface as before.
