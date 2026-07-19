# Running DigiWorld with Docker Compose

Three containers, one command. Backend (Fastify + WS), frontend (Nginx serving Vite build), Postgres.

```
┌────────────────┐    :8080     ┌────────────┐   :3000     ┌───────────┐
│  your browser  │─────────────▶│  frontend  │────────────▶│  backend  │
└────────────────┘              │  (nginx)   │  (proxy     │ (Fastify) │
                                └────────────┘   /api /ws  └─────┬─────┘
                                                  /assets)       │
                                                                 ▼
                                                          ┌───────────┐
                                                          │    db     │
                                                          │ (postgres)│
                                                          └───────────┘
```

## Prerequisites

- Docker Engine 24+ (`docker --version`)
- Docker Compose v2 (`docker compose version`)
- ~2 GB free disk for images + volumes
- Ports **8080** (host) free — change with `HOST_PORT=9000` in `.env` if not

## First run

```bash
cp .env.example .env
# edit .env — set POSTGRES_PASSWORD and SESSION_SECRET (min 32 chars)
docker compose build
docker compose up -d
```

Wait ~20 seconds for the backend healthcheck to go green, then:

```bash
open http://localhost:8080/       # macOS
xdg-open http://localhost:8080/   # Linux
```

Register the first account — it becomes the game admin.

## What's in `.env`

| Var | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | DB password (compose refuses to start if unset) |
| `SESSION_SECRET` | yes, min 32 chars | Cookie signing key (compose refuses to start if unset) |
| `ADMIN_BOOTSTRAP` | no, default `open` | Set to `closed` after go-live to freeze registration |
| `HOST_PORT` | no, default `8080` | Host port to publish the frontend on |
| `SESSION_TTL_HOURS` | no, default `168` | Sliding session lifetime (7 days) |
| `MAX_LOBBY_CONNECTIONS` | no, default `1200` | WS socket cap |
| `MAX_CONCURRENT_MATCHES` | no, default `200` | Live 3v3 battle cap |

Generate a strong secret quickly:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Verify

```bash
docker compose ps                          # all three services 'healthy' or 'running'
curl -f http://localhost:8080/healthz      # nginx  → 'ok'
curl -f http://localhost:8080/api/health   # backend via nginx proxy → { ok: true, at: ... }
curl -sS http://localhost:8080/api/auth/status
# → {"userCount":0,"registrationOpen":true}
```

## First-time catalog seed

The Digimon catalog XML ships baked into the image (`backend/data/catalog/digimons.xml`, ~195 entries). Portraits and dot sprites live on the `assetdata` volume — the startup verifier will re-download any that are missing from Skullbot on first boot. Give it 30–60 seconds after `docker compose up`.

If you want to (re-)scrape from scratch:

```bash
docker compose exec backend pnpm scrape --list             # ~434 Digimon into scraped_catalog
docker compose exec backend pnpm scrape --enrich --limit 40   # pulls attacks from wikimon
docker compose exec backend pnpm scrape --assets --limit 40   # portrait.webp + dot.gif
```

## Common ops

```bash
docker compose logs -f backend             # tail backend logs
docker compose logs -f frontend            # tail nginx access log
docker compose logs -f db                  # postgres logs
docker compose exec backend sh             # shell inside backend container
docker compose exec db psql -U digiworld   # psql prompt on the db
docker compose restart backend             # after config change
docker compose down                        # stop everything (volumes preserved)
docker compose down -v                     # NUKE all data + volumes (irreversible)
docker compose build --no-cache backend    # force rebuild
docker compose pull                        # refresh postgres/nginx base images
```

## Ports

| Host port | Container | Purpose |
|---|---|---|
| `8080` (configurable) | `frontend:80` | HTTP + WebSocket (proxied to backend internally) |
| — | `backend:3000` | Not published; frontend reaches it over the compose network |
| — | `db:5432` | Not published; only backend talks to it |

To publish Postgres for a local DB client, add under `db:` in `docker-compose.yml`:

```yaml
    ports:
      - '5432:5432'
```

Then `psql postgres://digiworld:<password>@127.0.0.1:5432/digiworld`.

## Data & persistence

Three named volumes survive `docker compose down`:

- `digiworld_pgdata` — Postgres data directory
- `digiworld_assetdata` — scraped portraits/dots (`backend/public/assets/digimon/`)
- `digiworld_scrapecache` — HTML/JSON cache from Skullbot/Wikimon scrape runs

The XML catalog and TypeScript source are baked into the backend image — no bind mount, so edits require `docker compose build backend`.

## Rebuild after code changes

```bash
docker compose build backend && docker compose up -d backend    # backend only
docker compose build frontend && docker compose up -d frontend  # frontend only
docker compose build && docker compose up -d                    # full rebuild
```

Frontend rebuild is fast (Vite + nginx layer). Backend rebuild reinstalls the pnpm workspace and recompiles TS — cache-friendly on unchanged `package.json` files.

## Troubleshooting

**`SESSION_SECRET is required min 32 chars`** — compose refuses to start. Copy `.env.example → .env` and set both `POSTGRES_PASSWORD` and `SESSION_SECRET`.

**Backend restarts in a loop** — `docker compose logs backend` and look for `boot.` messages. Common causes: DB not up yet (should self-resolve via healthcheck), bad `DATABASE_URL` (compose builds it from `POSTGRES_PASSWORD` — match `.env`), `SESSION_SECRET` shorter than 32 chars.

**Frontend shows blank page** — hard-refresh (`Ctrl-Shift-R`). If still blank, `docker compose logs frontend` for nginx errors and `docker compose exec frontend ls /usr/share/nginx/html` to confirm the build shipped.

**Portraits are 404** — the asset verifier is fetching them from Skullbot. `docker compose logs backend | grep verify` to watch progress. On a fresh volume it can take ~30 seconds for the first pass. If Skullbot is unreachable, entries stay missing but the game still runs — the admin can retry via **Refresh from skullbot** in `/admin`.

**Postgres schema not applied** — the backend applies `schema-pg.sql` on first boot via `PgAdapter.init()`. Check `docker compose logs backend | grep -i schema`. If schema is corrupted, `docker compose down -v` to wipe and start over.

## Production notes

- Set `ADMIN_BOOTSTRAP=closed` in `.env` after the admin account is created, then `docker compose up -d backend`.
- Put a real TLS terminator (Caddy, Traefik, Cloudflare, nginx with certs) in front of `:8080`. WebSocket over TLS is transparent — nginx already sets `Upgrade` + `Connection` headers.
- For horizontal scale (multi-node game servers), see [`docker-compose.multinode.yml`](docker-compose.multinode.yml) which adds Redis for cluster state and runs 2 backend replicas behind an internal nginx with `ip_hash` WS stickiness.
- Backups: `docker compose exec db pg_dump -U digiworld digiworld > backup.sql`. Restore: `docker compose exec -T db psql -U digiworld digiworld < backup.sql`.
