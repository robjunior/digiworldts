# Discord Commerce — Credential Setup

Everything you need before Wave 3 (OAuth linking + slash commands) can run.

**Nothing here is required for Waves 1–2.** The `discord-bot` service sits behind
the `discord` compose profile, and the backend skips registering `/api/service/*`
when `SERVICE_TOKEN_DISCORD` is unset. You can build, boot, and health-check the
whole stack with zero credentials.

Do the steps in order — later values depend on earlier ones.

---

## Which variables are actually required

Verified against `discord/src/config.ts`. Only five are required to boot:

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | **yes** | `3100` in compose |
| `PUBLIC_URL` | **yes** | see naming trap below |
| `BACKEND_URL` | **yes** | `http://backend:3000` in compose |
| `DATABASE_URL` | **yes** | Postgres connection string |
| `SERVICE_TOKEN_DISCORD` | **yes** | min 32 chars, shared with the game backend |
| `DISCORD_TOKEN` | no | needed from Wave 3 on |
| `DISCORD_CLIENT_ID` | no | needed from Wave 3 on |
| `DISCORD_CLIENT_SECRET` | no | needed from Wave 3 on |
| `DISCORD_GUILD_ID` | no | needed from Wave 3 on |
| `DISCORD_ADMIN_ROLE_IDS` | no | empty disables admin commands (safe default) |
| `MP_ACCESS_TOKEN` | no | needed from Wave 5 on |
| `MP_WEBHOOK_SECRET` | no | needed from Wave 5 on |
| `PIX_EXPIRATION_MINUTES` | no | default `30` |
| `PURCHASE_SWEEP_INTERVAL_MS` | no | default `300000` (5 min) |
| `TICKET_INACTIVITY_HOURS` | no | default `48` |
| `RATE_LIMIT_COMMANDS` | no | default `20` per 60s |
| `RATE_LIMIT_BUY` | no | default `3` per 300s |
| `NODE_ENV` | no | default `development` |

### Naming trap: `DISCORD_PUBLIC_URL` vs `PUBLIC_URL`

In `.env` the variable is **`DISCORD_PUBLIC_URL`**. The service itself reads
**`PUBLIC_URL`**. `docker-compose.yml` bridges them:

```yaml
PUBLIC_URL: ${DISCORD_PUBLIC_URL:-}
```

So: setting `PUBLIC_URL` directly in `.env` does nothing under compose, and
running the service outside compose requires `PUBLIC_URL`, not the prefixed name.

---

## 1. Discord application

<https://discord.com/developers/applications> → **New Application**.

**OAuth2 → Client information:**

```
DISCORD_CLIENT_ID=      # "Client ID"
DISCORD_CLIENT_SECRET=  # "Client Secret" — press Reset Secret the first time
```

**OAuth2 → Redirects → Add Redirect:**

```
http://localhost:3100/oauth/discord/callback
```

This must match the token-exchange redirect **byte for byte** — scheme, port,
path, trailing slash. A mismatch surfaces as `invalid_grant`, which is the most
common failure when wiring Discord OAuth. Multiple redirects are allowed, so add
the Cloudflare tunnel hostname as a second entry when you go to production.

## 2. Bot token

**Bot → Reset Token**, then copy:

```
DISCORD_TOKEN=          # shown ONCE — reset again if lost
```

On the same page:

- **Public Bot** → off. This bot is single-guild; nobody else should install it.
- **Privileged Gateway Intents** → all off. Slash commands do not need
  `MESSAGE CONTENT`. Only enable it if you later read message bodies outside of
  an interaction.

## 3. Development guild

Create a server in the Discord client (`+` in the sidebar → *Create My Own*). A
personal server is fine.

Enable **User Settings → Advanced → Developer Mode**, then right-click the server
name → **Copy Server ID**:

```
DISCORD_GUILD_ID=
```

Guild-scoped commands register instantly; global commands take up to an hour to
propagate. That latency is why the plan locked this to a single guild.

## 4. Invite the bot

Replace `YOUR_CLIENT_ID`:

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=360777336848&scope=bot+applications.commands
```

`360777336848` is the sum of exactly the seven permissions this feature needs:

| Permission | Bit | Used for |
| --- | --- | --- |
| Manage Channels | `1 << 4` | open/close support channels |
| Send Messages | `1 << 11` | command replies |
| Embed Links | `1 << 14` | PIX QR code embed |
| Read Message History | `1 << 16` | ticket transcript on close |
| Manage Threads | `1 << 34` | archive on inactivity |
| Create Private Threads | `1 << 36` | private support ticket |
| Send Messages in Threads | `1 << 38` | conversation inside a ticket |

## 5. Admin role

**Server Settings → Roles → Create Role** (e.g. `Commerce Admin`), assign it to
yourself, then right-click the role → **Copy Role ID**:

```
DISCORD_ADMIN_ROLE_IDS=   # comma-separated for multiple roles
```

This gates `/admin refund|disable|stats|resend`. Leaving it empty disables every
admin command — the safe default.

## 6. MercadoPago (test credentials)

<https://www.mercadopago.com.br/developers/panel> → your application →
**Test credentials**, not production.

```
MP_ACCESS_TOKEN=
```

**Do not trust the token prefix.** Older MercadoPago accounts issued sandbox
tokens as `TEST-...`, but current accounts issue *both* test and production
tokens with an `APP_USR-` prefix. The prefix tells you nothing.

Verify which one you have with a read-only call that creates no charge:

```bash
curl -s -H "Authorization: Bearer $MP_ACCESS_TOKEN" \
  https://api.mercadopago.com/users/me | grep -o '"tags":\[[^]]*\]'
```

A test credential returns `test_user` among its tags and a
`test_user_...@testuser.com` email. A production credential does not. That
check is authoritative; the prefix is not.

**Webhooks → Configure notifications** gives the signing secret:

```
MP_WEBHOOK_SECRET=
```

A placeholder is fine during development. Wave 5 ships
`scripts/trigger-test-webhook.sh`, which forges correctly signed notifications
locally. The real secret is only needed once the webhook URL is publicly exposed.

## 7. M2M token (self-generated)

This one is not issued by any provider — it is a shared secret between the game
backend and the Discord service:

```bash
head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 40
```

```
SERVICE_TOKEN_DISCORD=    # min 32 chars, enforced by Zod on both sides
```

The same value must appear in the backend's environment, since
`backend/src/service/middleware.ts` compares against it with
`crypto.timingSafeEqual`.

## 8. Public URL

Development:

```
DISCORD_PUBLIC_URL=http://localhost:3100
```

Production: whichever hostname the Cloudflare tunnel routes to port 3100. That
hostname must also be registered as an OAuth redirect (step 1) and as the
MercadoPago webhook URL (step 6).

---

## Verify

```bash
# every required variable present and interpolable
docker compose --profile discord config --quiet && echo "env complete"

# the stack still works without any Discord credential
docker compose config --quiet && echo "core stack unaffected"
```

The second command is the regression guard: a plain `docker compose up` must
never depend on Discord configuration.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `invalid_grant` during OAuth | Redirect URI differs from the registered one |
| Slash commands never appear | Wrong `DISCORD_GUILD_ID`, or bot invited without the `applications.commands` scope |
| Bot online but ignores commands | Commands were never registered — run `pnpm --filter @digiworld/discord register-commands` |
| `401` from `/api/service/*` | `SERVICE_TOKEN_DISCORD` differs between backend and Discord service |
| Backend logs `service.plugin.skipped` | `SERVICE_TOKEN_DISCORD` unset, or `DATABASE` is not `postgres` — both are intentional guards |
| MercadoPago rejects the payment | Using `APP_USR-` production credentials where sandbox is expected |
