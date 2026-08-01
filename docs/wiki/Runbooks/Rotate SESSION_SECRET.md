---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Rotate session secret
  - Rotate cookie key
  - SESSION_SECRET rotation
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/auth/session.ts
  - .env.example
  - docs/environments.md
verified-at-commit: 13dc16b
---

# Rotate SESSION_SECRET

> [!info] When to use this
> - Suspected leak of `.env` or GH Actions secret.
> - Scheduled rotation (quarterly, per your security policy).
> - Contractor / operator who had the secret left the team.

## Impact

**Every live cookie is invalidated instantly.** Users are logged out on
their next request; they log back in with password or OAuth. No
zero-downtime option — this is a hard cutover by design.

Why: `@fastify/cookie` signs cookies with the current `SESSION_SECRET`.
On rotation, `req.unsignCookie(rawString)` returns `valid: false` for
every old cookie ([`session.ts:169-175`](backend/src/auth/session.ts:169)),
which `readSessionCookie` maps to `null` → 401 on any authed request.

## Steps

1. **Generate a new secret.** 32+ chars, random, base64 or hex — either
   works with `@fastify/cookie`.
   ```bash
   openssl rand -base64 32
   # or
   openssl rand -hex 32
   ```
   Do NOT re-use a previous secret.

2. **Update the secret.**
   - **Dev**: edit `.env`, save.
   - **Staging / production**: `Settings > Environments > staging (or
     production) > Secrets > SESSION_SECRET`. Paste the new value, save.

3. **Restart / redeploy the backend.**
   - **Dev**: `docker compose restart backend` or ctrl-C `pnpm dev`,
     restart.
   - **Staging / production**: manually dispatch the deploy workflow
     (`Actions > Deploy — Staging > Run workflow`).
   - **Multi-node**: rolling restart. Nodes booted with the old secret
     keep signing/validating the old cookies until they restart. Users
     hitting an old node during the rollover will bounce between "logged
     in" and 401 — expect a small window of chatter. For a clean cut,
     restart all nodes simultaneously.

4. **Verify** that new cookies are minted correctly.
   ```bash
   curl -sS -c /tmp/new-cookies.txt -X POST \
     -H 'content-type: application/json' \
     -d '{"username":"<user>","password":"<pw>"}' \
     https://<host>/api/auth/login
   curl -sS -b /tmp/new-cookies.txt \
     https://<host>/api/auth/me | jq
   ```
   Should return the user JSON. If it returns 401, the new secret didn't
   land — check the deploy log for the effective env value.

5. **Optional — proactive session flush.** Session records still live in
   the cluster at `session:{token}` even though their cookies are dead.
   They'll expire naturally at TTL (default 7 days). To reclaim the
   memory immediately:
   ```bash
   redis-cli KEYS 'session:*' | xargs -r redis-cli DEL
   redis-cli KEYS 'usessions:*' | xargs -r redis-cli DEL
   ```
   > [!warning] `KEYS` is O(N) — for large deployments prefer `SCAN`.
   > See [`cluster/redis.ts::keys`](backend/src/cluster/redis.ts:53) for
   > the pattern.

## What DOESN'T change on rotation

- **Passwords.** `SESSION_SECRET` only signs the cookie envelope. Argon2
  hashes in `users.password_hash` are unaffected. Users log in with the
  same password they always used.
- **OAuth links.** `oauth_tokens` rows are unaffected. Provider access
  tokens don't ride the session cookie.
- **DB.** Zero DB writes on rotation. The session token in the cookie is
  cryptographically opaque; the cluster is the only place it maps to a
  user id.

## What can go wrong

> [!warning] `SESSION_SECRET` shorter than 32 chars
> Every attempt to sign a new cookie fails silently — the process may
> boot but every login returns a 401. Check
> [`config.ts`](backend/src/config.ts) for the exact minimum length
> constraint; the `.env.example` guidance is 32+ chars.

> [!warning] Multi-node rolling restart, users hop between nodes
> During the rollover window, `ip_hash` pins each user to one node, so a
> single user's experience is consistent. But if a user's ONE node is
> being restarted mid-request, they get a 502. Configure nginx
> `proxy_next_upstream` if a smoother window matters.

> [!warning] Forgot to flush old sessions
> Not a security issue — the OLD cookies fail `unsignCookie` under the
> NEW secret. The cluster rows just occupy space until TTL.

## Rollback

Put the OLD secret back before users log in with the new one. Anyone who
already logged in with the new secret will now be logged out again
(their new cookies fail unsign under the old secret).

If everyone already logged back in, rollback means logging them all
out AGAIN. Better to just accept the rotation and move forward.

## Related

- [[Session cookies#The cookie]] — the exact cookie contract
- [[Environments#Rotate a secret]]
- [[Reset a player password]] — for individual account resets
- [[Multi-node Deployment#Redis with AOF]] — how the session persists
  across Redis restarts (which is orthogonal to secret rotation)
