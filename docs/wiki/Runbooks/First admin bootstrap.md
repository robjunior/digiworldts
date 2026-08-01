---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - First admin bootstrap
  - Bootstrap admin
  - Fresh deploy admin
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - README.md
  - .env.example
  - backend/src/auth/routes.ts
  - backend/src/config.ts
verified-at-commit: 13dc16b
---

# First admin bootstrap

> [!info] When to use this
> Fresh deploy (dev, staging, production) has zero users. You need the
> **first** account to be an admin — every subsequent one will be a
> regular player.

## The problem

`ADMIN_BOOTSTRAP=closed` (the production default in
[`.env.example`](.env.example) and the code default in
[`backend/src/config.ts`](backend/src/config.ts)) makes
`POST /api/auth/register` return `403 registration is closed`. This
prevents an attacker from racing the intended admin on a public URL.

When `ADMIN_BOOTSTRAP=open`, the **first** registrant (verified via
`SELECT COUNT(*) FROM users`) gets `is_admin=1`; every subsequent
registration is a regular player. See
[[Session cookies#First-user-is-admin bootstrap]] for the full contract.

## Steps

1. **Confirm the DB is empty.** Fresh deploy → skip. Existing deploy:
   ```sql
   SELECT COUNT(*) AS n, MAX(is_admin) AS has_admin FROM users;
   ```
   If `n > 0 AND has_admin = 1`, you already have an admin. Use
   [[Recover a lost admin password]] instead.

2. **Set `ADMIN_BOOTSTRAP=open`.**
   - **Dev**: edit `.env`, save.
   - **Staging / production**: `Settings > Environments > staging (or
     production) > Variables > ADMIN_BOOTSTRAP = open`.

3. **Restart the backend.** Config is loaded once at boot.
   - **Dev**: `docker compose restart backend` (or ctrl-C `pnpm dev` and
     restart).
   - **Staging / production**: manually dispatch the deploy workflow
     (`Actions > Deploy — Staging > Run workflow`).

4. **Verify the flag flipped.**
   ```bash
   curl -sS https://<host>/api/auth/status | jq
   # → { "userCount": 0, "registrationOpen": true }
   ```

5. **Register the admin through the UI.** Open the game URL, click
   Register, pick username + password.
   - Backend inserts with `is_admin=1` on the FIRST row.
   - Response sets the `digiworld_sid` cookie — you're already logged in.

6. **Set `ADMIN_BOOTSTRAP=closed`.** Reverse of step 2. Every subsequent
   registration will now be a regular player. Some deploys prefer to
   **delete** the variable rather than set it to `closed` — the code
   defaults to `closed` when missing, same effect.

7. **Restart the backend again.** Same as step 3.

8. **Confirm.**
   ```bash
   curl -sS https://<host>/api/auth/status | jq
   # → { "userCount": 1, "registrationOpen": false }
   ```

## Verify the admin flag from the DB

```sql
SELECT id, username, is_admin, created_at FROM users;
```

The first row should have `is_admin = 1`.

## What can go wrong

> [!warning] Someone raced you during the open window
> If the first `POST /api/auth/register` came from an attacker, THEIR
> account is admin. Fix:
> 1. Flip `ADMIN_BOOTSTRAP=closed`.
> 2. Direct DB: `DELETE FROM users WHERE id = '<attacker_id>';` — cascades
>    remove sessions, roster, wallet.
> 3. Reset back to step 2 of this runbook.

> [!warning] `ADMIN_BOOTSTRAP=open` on a live prod deploy
> Any window where this is `open` on production is a foothold. Minimize
> the window: set → restart → register → set back → restart. Sub-minute
> is achievable.

> [!warning] I registered but I'm not admin
> Verify `SELECT COUNT(*) FROM users` **before** registering. If a row
> already exists (previous test, orphan from a prior bootstrap attempt,
> etc.) the first-user-is-admin check has already fired. Delete the stale
> row (see above) OR use [[Recover a lost admin password]] to promote
> your existing account.

## Rollback

Rolling back an admin creation:

```sql
DELETE FROM users WHERE id = '<admin_id>';    -- cascades sessions, roster
```

Then re-run this runbook from step 1.

## Related

- [[Session cookies#First-user-is-admin bootstrap]] — the contract
- [[Environments#Bootstrap the first admin on a fresh staging/prod deploy]]
- [[Recover a lost admin password]] — no-user-visible-path fallback
