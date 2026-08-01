---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Recover admin password
  - Lost admin password
  - Emergency admin recovery
  - No admin left
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/auth/password.ts
  - backend/src/auth/session.ts
  - README.md
verified-at-commit: 13dc16b
---

# Recover a lost admin password

> [!warning] Last-resort path
> There is **no anonymous "I forgot my admin password" flow** by design.
> An attacker who could self-serve an admin reset would own the deploy
> instantly. Recovery requires either **another admin** (use
> [[Reset a player password]] instead) or **DB shell access**.

## When to use this

Every one of the following is true:

- The admin password is genuinely lost / forgotten.
- There is NO other admin account, OR every admin is locked out.
- You have DB shell access (docker exec, psql, sqlite CLI, whatever
  the deployment shape gives you).

If ANY of those is false, use [[Reset a player password]] — an existing
admin issues a reset token for the locked-out one.

## Path A — direct DB UPDATE (when you have DB shell)

Steps:

1. **Identify the admin.**
   ```sql
   SELECT id, username, display_name, is_admin FROM users WHERE is_admin = 1;
   ```
   Pick the row you're recovering.

2. **Generate a new argon2id hash locally.** Use the exact same
   parameters the running app uses; the safe way is to shell into the
   backend container and use the app's own `hashPassword`.

   **Option 2a — inside the backend container**:
   ```bash
   docker exec -it digiworld-backend-1 node --input-type=module -e '
   import { hashPassword } from "/app/backend/dist/auth/password.js";
   console.log(await hashPassword("<pick a new password>"));
   '
   ```
   Copies argon2 params from the code path. **Preferred.**

   **Option 2b — standalone Node with `argon2`**:
   ```bash
   node --input-type=module -e '
   import argon2 from "argon2";
   console.log(await argon2.hash("<pick a new password>", { type: argon2.argon2id }));
   '
   ```
   Works but may drift from the app's chosen memory/time cost params.
   Verify in [`backend/src/auth/password.ts`](backend/src/auth/password.ts)
   before relying on it.

   Output looks like: `$argon2id$v=19$m=65536,t=3,p=4$…`

3. **Update the row.**
   ```sql
   UPDATE users
      SET password_hash = '$argon2id$v=19$m=65536,t=3,p=4$...',
          updated_at    = 1785545000000
    WHERE id = '<userId>';
   ```
   Verify `updated_at` matches your DB's timestamp format (BIGINT ms
   since epoch for DigiWorld tables).

4. **Kill every live session for this user** — critical if you think the
   password was leaked (rather than just forgotten).

   **Redis mode**:
   ```bash
   # Read every session token this user owns
   redis-cli ZRANGE usessions:<userId> 0 -1
   # → session_token_a  session_token_b  ...

   # Delete each session key + the user's session ZSET
   redis-cli ZRANGE usessions:<userId> 0 -1 | while read t; do
     redis-cli DEL "session:$t"
   done
   redis-cli DEL usessions:<userId>
   ```
   Or, easier — shell into the backend container and call
   `destroyAllSessionsForUser`:
   ```bash
   docker exec -it digiworld-backend-1 node --input-type=module -e '
   import { destroyAllSessionsForUser } from "/app/backend/dist/auth/session.js";
   await destroyAllSessionsForUser("<userId>");
   process.exit(0);
   '
   ```

   **Memory mode**: sessions live in-process; a backend restart already
   flushed them. If not restarting, `docker restart digiworld-backend-1`.

5. **Log in with the new password.**
   ```bash
   curl -sS -c /tmp/admin-cookies.txt -X POST \
     -H 'content-type: application/json' \
     -d '{"username":"<admin>","password":"<new password>"}' \
     https://<host>/api/auth/login
   curl -sS -b /tmp/admin-cookies.txt https://<host>/api/auth/me | jq
   ```
   `is_admin: 1` in the response confirms the recovery.

## Path B — no DB shell either

If you can't reach the DB shell, you're outside the operator boundary
this system was designed to handle. Options:

- **Cloud provider console** — most managed Postgres deployments expose
  a web-based `psql`. Use it, then Path A.
- **Docker exec through the compose stack** — if you can `ssh` into the
  host but don't have a psql client, `docker exec digiworld-db-1 psql -U
  digiworld -d digiworld` gets you in.
- **Full restore from backup** — [[Postgres backup and restore]]. Only
  helps if a backup exists with a working admin password.
- **Fresh deploy with a new DB, migrate catalogs manually** — nuclear.
  Preserves the XML catalog + assets but blows away every user, roster,
  match, wallet. Use only for a compromised deploy where nothing else
  works.

## Verify no other admin is silently active

Once you've recovered, do a full inventory:

```sql
SELECT id, username, is_admin, last_login_at, created_at FROM users WHERE is_admin = 1;
```

If any UNEXPECTED admin shows up — someone breached at some point. Kill
their `is_admin` flag:

```sql
UPDATE users SET is_admin = 0, updated_at = <ms> WHERE id = '<unexpected>';
```

…and dig through logs for how they got there.

## What can go wrong

> [!warning] Wrong argon2 params
> A hash generated with the wrong memory/time cost still verifies with
> `argon2.verify` — the encoded string carries its own params. But if
> the app's target cost is much higher than what you generated, every
> login for this user will be measurably slower.

> [!warning] `updated_at` wrong format
> DigiWorld uses BIGINT milliseconds since epoch on both dialects. A
> nullable insert of `NOW()` (Postgres seconds-ish) or `'2026-08-01'`
> won't match the expected shape and may break downstream reads.

> [!warning] You typo'd the new password when running the hash script
> The hash is committed to the DB with the typo. Just re-run steps 2–3
> with the intended password.

## Prevention

- **Every deploy should have at least TWO admins.** Peer-recovery via
  [[Reset a player password]] takes seconds; direct DB recovery takes
  minutes and risk.
- **Password manager on both.** Both admins keep their password in
  1Password / Bitwarden / etc. The password is the whole thing; a
  30-char random string is trivial to store, painful to type from
  memory.

## Related

- [[Reset a player password]] — the normal (admin-to-admin) reset flow
- [[Session cookies]] — the argon2 + session model
- [[Postgres backup and restore]] — for the last-resort restore case
- [[Multi-node Deployment]] — the DB is shared, so this runbook works
  identically on any node
