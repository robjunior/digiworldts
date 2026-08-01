---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Rotate SERVICE_TOKEN_DISCORD
  - Rotate service token
  - Discord bot token rotation
  - M2M token rotation
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/service/routes.ts
  - discord/src/index.ts
  - .env.example
verified-at-commit: 13dc16b
---

# Rotate SERVICE_TOKEN_DISCORD

> [!info] When to use this
> - Suspected leak (accidentally committed .env, log line captured the
>   token, contractor with access left the team).
> - Scheduled rotation (quarterly, per your security policy).
> - Bringing up a fresh staging or prod deploy.

## Impact

**The token is bi-lateral.** Both sides — backend
(`SERVICE_TOKEN_DISCORD` in the game backend env) and Discord bot
(`SERVICE_TOKEN_DISCORD` in the discord-bot env) — must agree on the
value. During the rotation window, ONE will always be out of sync
briefly; the other side's requests will return 401 until both agree.

Affected endpoints:

- `POST /api/service/wallet-credit` — the [[Currency|Credits mint path]].
  Discord bot posts here after MercadoPago PIX settles. A failed post
  during rotation leaves paid orders un-credited until the retry
  succeeds — the Discord bot's retry ledger backfills once the tokens
  agree again.

## Prerequisites

- Ability to update env in both the game backend AND the discord-bot
  service.
- ~30 s of tolerance for `/api/service/*` failures during the swap.

## Steps

### 1. Generate a new token

32+ random chars, base64 or hex:

```bash
openssl rand -base64 32
# or
openssl rand -hex 32
```

Do NOT re-use a previous value. Keep the OLD value handy for step 4
in case you need to roll back.

### 2. Update the DISCORD BOT first

**Why bot first**: the bot is the CALLER. Updating the CALLER first
means it'll start sending the new token; the backend still accepts the
old token (nothing rejected yet). Then when the backend flips, the bot
is already sending the correct value.

**Dev**: edit `.env`, save. Restart:

```bash
docker compose --profile discord restart discord-bot
```

**Staging / production**: `Settings > Environments > … > Secrets >
SERVICE_TOKEN_DISCORD`, paste the new value, save. Manually dispatch
the discord-bot deploy workflow (or trigger a redeploy however your
Discord bot deploy is wired).

Verify the bot is running with the new token:

```bash
docker exec digiworld-discord-bot-1 env | grep SERVICE_TOKEN_DISCORD
# → SERVICE_TOKEN_DISCORD=<new value>
```

At this point:

- **Bot** sends the NEW token.
- **Backend** still has the OLD token → **rejects new-token requests as 401**.
- **Any incoming PIX settlement calls will fail** until step 3.

The window is intentional but SHORT — 30 s max between steps 2 and 3.

### 3. Update the game BACKEND

Same env update, same secret name, same value as step 2:

**Dev**: edit `.env`, restart:

```bash
docker compose restart backend        # single-node
docker compose restart game-node1 game-node2   # multi-node
```

**Staging / production**: `SERVICE_TOKEN_DISCORD` secret update +
manually dispatch the game backend deploy.

Verify:

```bash
docker exec digiworld-backend-1 env | grep SERVICE_TOKEN_DISCORD
```

Now BOTH sides agree on the new token. `/api/service/*` calls resume.

### 4. Verify with a smoke test

The bot has an internal ping / heartbeat that hits the backend
periodically (verify — check
[`discord/src/index.ts`](discord/src/index.ts) for a service-token
health check). Alternatively, force a call:

```bash
# Try any /api/service/* endpoint from outside the bot's environment
# (using the NEW token) to prove the backend accepts it
curl -sS -X POST \
  -H "Authorization: Bearer <new token>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"usr_test","credits":0,"orderId":"probe-'$(date +%s)'","amountBrl":0}' \
  http://localhost:3001/api/service/wallet-credit
```

Expected: some 4xx if the probe payload doesn't validate cleanly
(e.g., `invalid-input`, `duplicate-order-id`), but NOT 401. 401 =
token mismatch → the backend still has the old value → step 3 didn't
land.

### 5. Confirm no leaked PIX orders

The bot ledgers PIX settlements at
[`discord/src/payments/mercadopago.ts`](discord/src/payments/mercadopago.ts).
During the rotation window, any settlement that hit the OLD backend
before it rejected will have been retried by the bot. Check the
retry-queue depth is at zero:

```bash
docker logs digiworld-discord-bot-1 --since 10m 2>&1 | \
  grep -iE "(retry|401|service.*fail)"
```

If the retry queue drained cleanly, no user was left un-credited.

## Rollback

Put the OLD token back in BOTH sides:

1. Backend env → old value, restart.
2. Bot env → old value, restart.

The window is symmetric — the bot will fail while the backend has the
old token but the bot still has the new token. Do backend first this
time (unswap the order from the forward rotation).

Better yet: don't roll back. The forward rotation is the intended
end state; a rollback re-exposes the (allegedly leaked) token.

## Automating

Full rotation with zero-manual-touch requires:

1. Secrets manager (AWS Secrets Manager, HashiCorp Vault, GH
   Environment secrets with API access).
2. Both the game backend and Discord bot fetch the secret at startup
   OR watch the source for changes.
3. Deploy workflow rotates via API, then triggers rolling restarts
   in the right order.

Currently the deploy uses `scripts/materialize-env.sh`
([[Environments#Staging + production]]) — the ROTATION itself is a
manual GH Secret edit + workflow re-dispatch. Automating this end-to-
end is a follow-up.

## What can go wrong

> [!warning] Token in a log line
> `SERVICE_TOKEN_DISCORD` accidentally logged (dev's added a
> `console.log(env)` while debugging). Rotate immediately. Also grep
> the recent logs for token substrings and estimate the exposure
> window.

> [!warning] Token accidentally committed to git
> Even if reverted, the value stays in git history. Force-push +
> rewrite is a nightmare; safer to rotate the token, THEN scrub the
> repo history separately. GitHub's secret-scanning may already have
> notified you.

> [!warning] Bot restart mid-settlement
> If MercadoPago settles a PIX during the ~5 s bot restart window,
> the webhook delivery may fail. MercadoPago retries per their
> policy (5 min → 1 h → 12 h). No orders are lost, but confirmation
> can be delayed. Consider timing the rotation to a low-traffic
> window.

> [!warning] `.env` cached in the running image
> Docker's `env_file:` reads the file at CONTAINER CREATE, not
> restart. If you `docker compose restart`, the env DOESN'T reread.
> Use `docker compose up -d --force-recreate SERVICE_NAME` to
> guarantee the new env lands.

## What DOESN'T change

- **User passwords** — unrelated argon2 hashes.
- **User sessions** — `digiworld_sid` cookies keep working.
- **Player wallets** — the historical CR balances don't move.
- **The service_grant_log** — retains every past settle for audit.

## Related

- [[Environments#Required secrets]] — the secrets table
- [[Currency#Discord bot mint path]] — what this token enables
- [[HTTP Surface#Service (M2M for the Discord bot)]] — the endpoint
- [[Rotate SESSION_SECRET]] — sibling rotation runbook for a DIFFERENT
  secret with different failure modes
