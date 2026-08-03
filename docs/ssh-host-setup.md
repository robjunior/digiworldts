# Deploy host setup

This guide covers bootstrapping a fresh Linux VPS (Debian/Ubuntu) so it can
receive automated deploys from the GitHub Actions workflows in
[`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml)
and [`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml)
via SSH (Pattern A from [`environments.md`](environments.md)).

The end state:

- One host, one `deploy` user, two working trees: `~/digiworld` (prod) and
  `~/digiworld-staging` (staging).
- Docker Compose brings up every runtime service — Postgres, Redis, backend,
  frontend, admin, discord-bot, cloudflared — inside containers. **The host
  itself does not need Postgres, Redis, or Node installed.**
- Cloudflared inside the compose stack terminates public HTTPS at
  `soul.xenon.dev.br` (prod) / `staging.xenon.dev.br` (staging). The only
  inbound port the host ever needs open on the internet is **`22/tcp` for SSH**
  — everything else rides the Cloudflare tunnel.

Assumes a fresh Debian 12 or Ubuntu 22.04+ VPS. Adjust package names for other
distros.

---

## 1. Pick a VPS + point DNS

- Any provider works — Hetzner CX22 (~€4/month, 2 vCPU / 4 GB) is plenty for
  DigiWorld's compose stack; Contabo / DigitalOcean / Vultr / Oracle Free Tier
  all fit too. RAM is the constraint (Postgres + Redis + backend ≈ 1.5 GB
  steady-state).
- Point A/AAAA records for `soul.xenon.dev.br` and `staging.xenon.dev.br`
  at the VPS's public IP **before** you configure the Cloudflare tunnels.
  Even though the tunnels don't actually use those A records for traffic
  routing (they use the tunnel connector), Cloudflare's cert automation
  wants them to exist. Or, delete the A records and let CF Tunnel own the
  hostname entirely — either works.

---

## 2. Bootstrap the host as root

SSH in as `root` for the last time. Everything after this section runs as the
unprivileged `deploy` user.

```bash
ssh root@<vps-ip>

# System up-to-date
apt update && apt -y upgrade

# Baseline tooling
apt -y install curl ca-certificates git ufw fail2ban unattended-upgrades \
               vim htop iotop tmux

# Auto-apply security patches (Debian/Ubuntu default is unattended-upgrades)
dpkg-reconfigure -plow unattended-upgrades
```

### 2.1 Install Docker + Compose plugin

Straight from Docker's official convenience script:

```bash
curl -fsSL https://get.docker.com | sh
# Verify — needs Compose v2.24+ for the `!reset` tag used in the staging override
docker --version
docker compose version
```

If the shipped Compose is older than 2.24, add Docker's official apt repo
(the get.docker.com script already sets it up on Debian/Ubuntu — a plain
`apt install docker-compose-plugin` picks up the current version).

### 2.2 Create the `deploy` user

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

The `docker` group grants `docker` CLI access without `sudo` — which is
exactly what the CI's `docker compose up -d` step needs. The `deploy` user
gets **no sudo**; if you ever need to run apt / systemctl / edit
`/etc/nginx`, SSH back in as `root` (or add sudo separately).

### 2.3 Firewall — only SSH from the internet

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw --force enable
ufw status verbose
```

Because Cloudflared makes outbound-only connections to Cloudflare's edge, no
inbound HTTP/HTTPS port ever needs to be open on the host. This is the whole
security win of using a tunnel.

### 2.4 SSH hardening

Edit `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Then `systemctl restart ssh` (Debian/Ubuntu) or `systemctl restart sshd`
(RHEL-derived). **Do not close your current root session** until step 3
confirms you can log in as `deploy` — otherwise a misconfigured sshd locks
you out for real.

### 2.5 fail2ban (optional but recommended)

Default fail2ban config already jails ssh on Debian/Ubuntu; just make sure
the service is running:

```bash
systemctl enable --now fail2ban
fail2ban-client status sshd
```

---

## 3. Generate the deploy SSH keypair

Do this on **your workstation**, NOT on the VPS. The private half goes into
GitHub Secrets; the public half goes into the VPS's `authorized_keys`.

```bash
# Create a dedicated key just for GH deploys — do not reuse your personal key
ssh-keygen -t ed25519 -f ~/.ssh/digiworld-deploy -C "digiworld-gh-deploy" -N ""

# Print both halves
cat ~/.ssh/digiworld-deploy      # PRIVATE — goes to GH Secret DEPLOY_SSH_KEY
cat ~/.ssh/digiworld-deploy.pub  # PUBLIC — goes into the VPS
```

Push the public key to the VPS's deploy user:

```bash
# Easiest — ssh-copy-id (still connected as root or via another admin account)
ssh-copy-id -i ~/.ssh/digiworld-deploy.pub deploy@<vps-ip>

# Or manually — paste the .pub content into /home/deploy/.ssh/authorized_keys
```

Verify the key works:

```bash
ssh -i ~/.ssh/digiworld-deploy deploy@<vps-ip> "docker ps && whoami && groups"
# Expect:
#   CONTAINER ID   IMAGE   ...     (empty at this point)
#   deploy
#   deploy docker
```

If you see `groups: deploy docker` you're wired up correctly. Now you can
close the root SSH session — future ops go through `deploy`.

---

## 4. Register the SSH creds in GitHub Actions

For **each** of the `staging` and `production` GitHub Environments (`Settings
→ Environments → <env> → Secrets`):

| Secret name        | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| `DEPLOY_HOST`      | The VPS's public IP or hostname                             |
| `DEPLOY_USER`      | `deploy`                                                    |
| `DEPLOY_SSH_KEY`   | **Full contents** of `~/.ssh/digiworld-deploy` (private key, including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`) |

The two envs can (and probably will) share `DEPLOY_HOST` / `DEPLOY_USER` /
`DEPLOY_SSH_KEY` since both deploys land on the same host in separate
directories. GH Environments still keep the secrets scoped so a staging job
can't accidentally read prod-only secrets like `MP_ACCESS_TOKEN` (live).

### 4.1 Pattern A — paste into the workflow

Both workflows currently stop at a `TODO` step after `.env` is materialized.
Replace that step (in `deploy-staging.yml`) with:

```yaml
- name: Copy files to staging host
  uses: appleboy/scp-action@v0.1.7
  with:
    host:     ${{ secrets.DEPLOY_HOST }}
    username: ${{ secrets.DEPLOY_USER }}
    key:      ${{ secrets.DEPLOY_SSH_KEY }}
    source:   ".env,docker-compose.yml,docker-compose.staging.override.yml,backend,frontend,admin,discord,shared,scripts,deploy,package.json,pnpm-lock.yaml,pnpm-workspace.yaml,tsconfig.base.json"
    target:   "/home/deploy/digiworld-staging"

- name: Roll containers on staging
  uses: appleboy/ssh-action@v1.0.3
  with:
    host:     ${{ secrets.DEPLOY_HOST }}
    username: ${{ secrets.DEPLOY_USER }}
    key:      ${{ secrets.DEPLOY_SSH_KEY }}
    script: |
      cd /home/deploy/digiworld-staging
      docker compose --profile discord up -d --build --remove-orphans
      docker compose ps
```

For `deploy-production.yml`, use the same block but drop the
`docker-compose.staging.override.yml` from the scp `source:` list and change
`target:` / `cd` to `/home/deploy/digiworld` (or wherever you host prod).

---

## 5. First deploy — prime the working trees

Before firing the CI, seed the two directories on the host with an initial
clone. Subsequent CI runs `scp` files on top of them — the checkout only
needs to exist so `docker compose up -d --build` finds a `Dockerfile` context
on the first run.

SSH in as `deploy`:

```bash
ssh -i ~/.ssh/digiworld-deploy deploy@<vps-ip>

# Production tree — tracks tags
git clone https://github.com/<owner>/<repo>.git ~/digiworld
cd ~/digiworld
git checkout <latest tag>            # or leave on main until you tag

# Staging tree — tracks main
git clone https://github.com/<owner>/<repo>.git ~/digiworld-staging
cd ~/digiworld-staging
git checkout main
```

The CI's `scp` step will now overwrite these on every deploy — the initial
clone is just a "starter kit" of file paths so docker can `--build` the
Dockerfiles the very first time.

### 5.1 Bootstrap the first admin (once per env)

On the target env, temporarily set `ADMIN_BOOTSTRAP=open` in that
Environment's Variables tab, dispatch the deploy workflow, register the
admin through the UI (`https://staging.xenon.dev.br/`), then set
`ADMIN_BOOTSTRAP=closed` and re-dispatch. See
[`environments.md` § 4](environments.md) for the full flow.

---

## 6. Manual dispatch to smoke-test

You don't have to wait for a push to trigger the workflow. From the GitHub
UI:

`Actions → Deploy — Staging → Run workflow → main → Run`

Watch the job log. If the deploy step goes green, SSH in and confirm
containers are healthy:

```bash
ssh -i ~/.ssh/digiworld-deploy deploy@<vps-ip> "cd digiworld-staging && docker compose ps"
```

Every service should read `running (healthy)` — cloudflared may take up
to 30 seconds to reach healthy after boot while it opens the tunnel
connectors.

From your laptop:

```bash
curl -sSf https://staging.xenon.dev.br/api/health && echo OK
```

Green? Ship it.

---

## 7. Day-to-day operations (all as the `deploy` user)

### View live logs

```bash
cd ~/digiworld-staging       # or ~/digiworld
docker compose logs -f backend       # one service
docker compose logs -f              # everything, interleaved
docker compose logs --since 10m     # last 10 minutes only
```

### Restart a single service

```bash
docker compose restart backend       # doesn't rebuild
docker compose up -d --build backend # rebuilds from source in the tree
```

### Roll back to the previous image without changing code

Docker keeps prior image builds around by tag. You can inspect
`docker images` and re-tag, but the simpler workflow is: `git checkout <prior
tag>` in the working tree, then `docker compose up -d --build`. The prior
tag's Dockerfile + source produces the same binary and containers roll
gracefully.

### Dump the Postgres DB

```bash
docker compose exec db pg_dump -U digiworld digiworld \
  | gzip > ~/backups/digiworld-$(date +%F).sql.gz
```

Schedule via cron on the host:

```
0 3 * * * cd /home/deploy/digiworld && docker compose exec -T db pg_dump -U digiworld digiworld | gzip > /home/deploy/backups/prod-$(date +\%F).sql.gz
```

The `-T` disables pseudo-TTY allocation which cron needs.

### Restore

```bash
gunzip -c ~/backups/digiworld-2026-06-01.sql.gz \
  | docker compose exec -T db psql -U digiworld digiworld
```

Destroys current data — take a fresh dump first if you're mid-triage.

### Inspect what's on disk in the container

```bash
docker compose exec backend sh
# now inside the container's shell
ls -la /app/backend/data/catalog
cat /app/backend/data/catalog/digimons.xml | head
```

### Nuke and re-seed staging

Staging is disposable by design:

```bash
cd ~/digiworld-staging
docker compose down -v          # -v deletes named volumes (db, redis, assets)
docker compose --profile discord up -d --build
# Then flip ADMIN_BOOTSTRAP=open in the GH Environment for one deploy so
# you can register the first admin again.
```

**Never** run `docker compose down -v` in `~/digiworld` — it drops prod data.

---

## 8. Security posture at a glance

| Vector | Mitigation |
| --- | --- |
| Random internet scanners hitting HTTP ports | Ports 80/443 are never open on the host — Cloudflared tunnels outbound. UFW blocks everything except 22. |
| SSH brute-force | Root login disabled, password auth disabled, fail2ban jails repeat offenders on port 22. |
| Compromised GH runner leaks a secret | GH Environment `production` gates on required reviewers; `SESSION_SECRET` / DB creds are unique per env; MP `MP_ACCESS_TOKEN` on staging is a `TEST-*` sandbox token so a leak can't move real money. |
| Compromised deploy key | Rotate: `ssh-keygen -R <vps-ip>` on your laptop, generate a new key pair, replace `authorized_keys` on the host, replace `DEPLOY_SSH_KEY` in both GH Environments. The old key is dead the moment you overwrite `authorized_keys`. |
| Malicious PR from a contributor | GH Environments only expose secrets to workflows running on protected branches / tags (`deploy-production.yml` triggers on `v*.*.*` tags only — a PR can't dispatch it). |

---

## 9. Cheat sheet — the whole setup in ~30 commands

```bash
# --- On the VPS as root ---
apt update && apt -y upgrade
apt -y install curl ca-certificates git ufw fail2ban unattended-upgrades vim tmux
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
touch /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw --force enable
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
systemctl enable --now fail2ban

# --- On your workstation ---
ssh-keygen -t ed25519 -f ~/.ssh/digiworld-deploy -C "digiworld-gh-deploy" -N ""
ssh-copy-id -i ~/.ssh/digiworld-deploy.pub deploy@<vps-ip>
ssh -i ~/.ssh/digiworld-deploy deploy@<vps-ip> "docker ps"   # sanity check

# --- Back on the VPS as deploy ---
git clone https://github.com/<owner>/<repo>.git ~/digiworld
git clone https://github.com/<owner>/<repo>.git ~/digiworld-staging
cd ~/digiworld-staging && git checkout main

# --- On GitHub ---
# Settings > Environments > staging  (and production) — add:
#   DEPLOY_HOST      = <vps-ip>
#   DEPLOY_USER      = deploy
#   DEPLOY_SSH_KEY   = <cat ~/.ssh/digiworld-deploy>   (private half, all of it)
#
# Edit .github/workflows/deploy-staging.yml — replace the TODO block with the
# scp-action + ssh-action snippet from section 4.1 above. Same for prod.
#
# Trigger: Actions > Deploy — Staging > Run workflow > main
```

Done. `staging.xenon.dev.br` should come up green, and every push to `main`
rolls staging automatically thereafter.
