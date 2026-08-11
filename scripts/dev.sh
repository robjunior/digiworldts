#!/usr/bin/env bash
#
# scripts/dev.sh — bring up the whole local dev environment in one command.
#
# Starts the database, the backend API, the player frontend and the admin panel,
# which together are everything needed to build maps, author quests, edit NPCs
# and dialogue, tune skills and test onboarding.
#
#   ./scripts/dev.sh              postgres + redis in docker (matches .env)
#   ./scripts/dev.sh --sqlite     zero dependencies, no docker at all
#   ./scripts/dev.sh --stop       stop the docker services and exit
#   ./scripts/dev.sh --help
#
# There is deliberately NO cloudflared and NO DNS here. `docker-compose.yml`
# ships a `cloudflared` service for staging/production ingress; dev talks to
# 127.0.0.1 over plain HTTP and never needs a tunnel, a hostname or a cert.
# This script never starts that container.
#
# ── Why two database modes ──────────────────────────────────────────────────
#
# `.env` sets DATABASE=postgres + CLUSTER=redis, so the default mode brings up
# exactly those two containers via `docker-compose.dev.override.yml`, which
# publishes them on host loopback so a NATIVELY-run backend shares the same
# store as the containerized stack. That override exists precisely because a
# native backend falling back to SQLite reads a different database, and a user
# registered in one simply does not exist in the other.
#
# `--sqlite` is the escape hatch: no docker, no services, everything in
# `backend/data/digiworld.db`. dotenv is additive and first-load-wins, so the
# exports below win over `.env` without editing it.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Options ─────────────────────────────────────────────────────────────────
USE_SQLITE=0
RUN_FRONTEND=1
RUN_ADMIN=1
RUN_DISCORD=0
STOP_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sqlite)       USE_SQLITE=1 ;;
    --no-frontend)  RUN_FRONTEND=0 ;;
    --no-admin)     RUN_ADMIN=0 ;;
    --with-discord) RUN_DISCORD=1 ;;
    --stop)         STOP_ONLY=1 ;;
    -h|--help)
      sed -n '3,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "unknown option: $1 (try --help)" >&2
      exit 2 ;;
  esac
  shift
done

# ── Output helpers ──────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'; C_INFO=$'\033[36m'
else
  C_RESET=; C_DIM=; C_BOLD=; C_OK=; C_WARN=; C_ERR=; C_INFO=
fi
step()  { printf '%s==>%s %s\n' "$C_INFO$C_BOLD" "$C_RESET$C_BOLD" "$*$C_RESET"; }
ok()    { printf '    %sok%s %s\n' "$C_OK" "$C_RESET" "$*"; }
warn()  { printf '    %s!%s  %s\n' "$C_WARN" "$C_RESET" "$*"; }
die()   { printf '%serror:%s %s\n' "$C_ERR$C_BOLD" "$C_RESET" "$*" >&2; exit 1; }

COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.dev.override.yml)

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "${COMPOSE_ARGS[@]}" "$@"
  else
    docker-compose "${COMPOSE_ARGS[@]}" "$@"
  fi
}

# ── --stop ──────────────────────────────────────────────────────────────────
if [[ "$STOP_ONLY" == 1 ]]; then
  step "Stopping dev database services"
  compose stop db redis
  ok "db + redis stopped (data volumes kept)"
  exit 0
fi

# ── 1. Preflight ────────────────────────────────────────────────────────────
step "Preflight"
command -v pnpm >/dev/null || die "pnpm not found. Run: corepack enable && corepack use pnpm@latest"
command -v node >/dev/null || die "node not found (Node 22+ required)"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node $NODE_MAJOR found; 22+ required"
ok "node $(node -v), pnpm $(pnpm -v)"

[[ -f .env ]] || die ".env is missing. Copy .env.example to .env and fill SESSION_SECRET (32+ chars)."

if [[ ! -d node_modules ]]; then
  warn "node_modules missing — installing (first run takes a while)"
  pnpm install
fi
ok "dependencies present"

# Ports must be free or the services fail with an opaque EADDRINUSE deep in a
# child process, long after this script has reported success.
port_busy() {
  if command -v ss >/dev/null 2>&1; then ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN
  elif command -v lsof >/dev/null 2>&1; then lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else return 1; fi
}
if port_busy 3000; then die "port 3000 (backend) is already in use — stop the other process first"; fi
if [[ "$RUN_FRONTEND" == 1 ]] && port_busy 5173; then die "port 5173 (frontend) is already in use"; fi
if [[ "$RUN_ADMIN" == 1 ]] && port_busy 5174; then die "port 5174 (admin) is already in use"; fi
ok "ports free"

# ── 2. Shared package ───────────────────────────────────────────────────────
# backend/, frontend/ and admin/ all import @digiworld/shared from its BUILT
# dist/, not its source. A stale dist is invisible: typecheck passes against
# source while the running server uses last build's types.
step "Building @digiworld/shared"
pnpm shared:build >/dev/null
ok "dist up to date"

# ── 3. Database ─────────────────────────────────────────────────────────────
if [[ "$USE_SQLITE" == 1 ]]; then
  step "Database: SQLite (no docker)"
  export DATABASE=sqlite
  export DATABASE_URL=
  export CLUSTER=memory
  export REDIS_URL=
  mkdir -p backend/data
  # DB_PATH resolves against backend/, not the repo root — see config.ts.
  ok "backend/data/digiworld.db (migrations run on boot)"
else
  step "Database: PostgreSQL + Redis (docker)"
  command -v docker >/dev/null || die "docker not found. Use --sqlite for a dependency-free run."
  docker info >/dev/null 2>&1 || die "docker daemon is not running. Start it, or use --sqlite."

  compose up -d db redis
  printf '    waiting for postgres'
  for i in $(seq 1 45); do
    if compose exec -T db pg_isready -U digiworld >/dev/null 2>&1; then
      printf '\r'; ok "postgres accepting connections"; break
    fi
    printf '.'; sleep 1
    if [[ "$i" == 45 ]]; then printf '\n'; die "postgres did not become ready in 45s. Check: docker compose logs db"; fi
  done
  ok "redis up"
  warn "cloudflared is NOT started — dev is plain HTTP on 127.0.0.1, by design"
fi

# ── 4. Content sanity ───────────────────────────────────────────────────────
# An empty catalog is the classic "why is everything broken" dev state: no
# Digimon means onboarding cannot spawn a starter team, so quests, dungeons and
# battles have nothing to act on.
step "Content check"
CATALOG="backend/data/catalog/digimons.xml"
if [[ -f "$CATALOG" ]]; then
  MON_COUNT="$(grep -c '<digimon ' "$CATALOG" || true)"
  if [[ "${MON_COUNT:-0}" -gt 0 ]]; then
    ok "catalog has $MON_COUNT Digimon"
  else
    warn "catalog is EMPTY — run: pnpm --filter @digiworld/backend scrape --list && ... --enrich"
  fi
else
  warn "no catalog at $CATALOG — onboarding will have no starter teams to offer"
fi

# ── 5. Services ─────────────────────────────────────────────────────────────
PGIDS=()
CLEANED=0
cleanup() {
  local code=$?
  if [[ "$CLEANED" == 1 ]]; then exit $code; fi
  CLEANED=1
  echo
  step "Shutting down"
  # Walk the tree instead of signalling one process: `pnpm` execs `vite`/`tsx`,
  # which fork again, and those grandchildren survive a signal aimed only at the
  # group leader — an earlier version left a tsx watcher holding port 3000.
  kill_tree() {
    local parent="$1" child
    for child in $(pgrep -P "$parent" 2>/dev/null); do kill_tree "$child"; done
    kill -TERM "$parent" 2>/dev/null || true
  }
  for pgid in "${PGIDS[@]:-}"; do
    if [[ -n "$pgid" ]]; then kill_tree "$pgid"; fi
  done
  sleep 1
  for pgid in "${PGIDS[@]:-}"; do
    if [[ -n "$pgid" ]]; then kill -KILL -- "-$pgid" 2>/dev/null || true; fi
  done
  ok "services stopped"
  if [[ "$USE_SQLITE" != 1 ]]; then
    printf '    %sdb + redis left running — stop them with: ./scripts/dev.sh --stop%s\n' "$C_DIM" "$C_RESET"
  fi
  exit $code
}
trap cleanup INT TERM EXIT

launch() {
  local label="$1" colour="$2"; shift 2
  setsid "$@" > >(sed -u "s/^/${colour}[${label}]${C_RESET} /") 2>&1 &
  PGIDS+=("$!")
}

step "Starting services"
launch backend "$C_INFO" pnpm dev:backend
if [[ "$RUN_FRONTEND" == 1 ]]; then launch frontend "$C_OK"   pnpm dev:frontend; fi
if [[ "$RUN_ADMIN"    == 1 ]]; then launch admin    "$C_WARN" pnpm dev:admin;    fi
if [[ "$RUN_DISCORD"  == 1 ]]; then launch discord  "$C_DIM"  pnpm --filter @digiworld/discord dev; fi

# ── 6. Readiness ────────────────────────────────────────────────────────────
printf '    waiting for the API'
API_UP=0
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then API_UP=1; break; fi
  printf '.'; sleep 1
done
printf '\r'
if [[ "$API_UP" == 1 ]]; then ok "API healthy"; else warn "API did not answer /api/health in 60s — see the [backend] log above"; fi

cat <<BANNER

  ${C_BOLD}DigiWorld dev environment${C_RESET}
  ${C_DIM}────────────────────────────────────────────────${C_RESET}
  ${C_OK}player${C_RESET}    http://localhost:5173
  ${C_WARN}admin${C_RESET}     http://localhost:5174   ${C_DIM}maps, quests, NPCs, dialogue, skills${C_RESET}
  ${C_INFO}api${C_RESET}       http://localhost:3000/api/health

  ${C_DIM}First run: register at the player URL — the first account created
  becomes admin (ADMIN_BOOTSTRAP=open in .env). Then open the admin panel.

  Maps      admin -> Dungeons (Tiled import, tilesets, biomes)
  Quests    admin -> Quests, Dialogues, NPCs
  Starters  admin -> Onboarding

  Ctrl+C stops everything.${C_RESET}

BANNER

wait
