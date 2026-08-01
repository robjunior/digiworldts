---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - Postgres backup
  - Postgres restore
  - DB backup
  - Disaster recovery
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - docker-compose.multinode.yml
  - backend/src/db/schema-pg.sql
  - backend/src/db/migrator.ts
verified-at-commit: 13dc16b
---

# Postgres backup and restore

> [!info] When to use this
> - Scheduled backup ahead of a migration or schema change.
> - Disaster recovery — Postgres corruption, accidental `DROP TABLE`,
>   volume loss.
> - Cloning production data to staging for a repro session.
> - Point-in-time recovery when the code path is broken but the DB is
>   still readable.

Single-node dev with `DATABASE=sqlite` doesn't apply here — the SQLite
runbook is a follow-up (not yet written). For a quick manual backup of a
SQLite deploy: stop the backend, copy `data/digiworld.db*` (all three WAL
files), restart. That's it.

## Backup

### Ad-hoc `pg_dump` (custom format — preferred)

```bash
docker exec digiworld-postgres-1 pg_dump \
  --username digiworld \
  --format=custom \
  --compress=9 \
  --file=/tmp/digiworld-$(date +%Y%m%d-%H%M%S).dump \
  digiworld

# Copy off the container
docker cp digiworld-postgres-1:/tmp/digiworld-*.dump ./backups/
```

Custom format (`-F c`) is the shape `pg_restore` expects. Compression
`--compress=9` keeps the file small for a ~10 K user DB (fits in low MBs).

### Plain-SQL dump (portable, human-readable)

Use when you need a text file you can `grep` or apply piecemeal:

```bash
docker exec digiworld-postgres-1 pg_dump \
  --username digiworld \
  --format=plain \
  --no-owner \
  --no-privileges \
  digiworld > digiworld-$(date +%Y%m%d).sql
```

`--no-owner --no-privileges` strips role-specific grants so it applies
cleanly on a Postgres with a different role name.

### Scheduled backups (cron-driven)

```bash
# /etc/cron.d/digiworld-backup
0 3 * * * root /usr/local/bin/digiworld-backup.sh
```

Where the script does the `pg_dump` above, uploads to S3 / Backblaze / a
remote host, and prunes local copies older than N days.

> [!warning] Test your restores
> A backup you've never restored is a wish list, not a backup. Cycle a
> staging environment against last night's backup once a month.

## Verify the backup is valid

Round-trip against a scratch Postgres:

```bash
# Spin a scratch Postgres
docker run -d --rm --name digiworld-restore-check \
  -e POSTGRES_USER=digiworld \
  -e POSTGRES_PASSWORD=<any> \
  -e POSTGRES_DB=digiworld \
  postgres:16-alpine

# Wait a beat
sleep 5

# Restore
docker cp digiworld-YYYYMMDD.dump digiworld-restore-check:/tmp/
docker exec digiworld-restore-check pg_restore \
  --username digiworld \
  --dbname digiworld \
  --no-owner \
  /tmp/digiworld-YYYYMMDD.dump

# Sanity check — did the tables land?
docker exec digiworld-restore-check psql -U digiworld -d digiworld \
  -c "SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' ORDER BY table_name;"

# Tear down
docker rm -f digiworld-restore-check
```

Expect ~15+ tables including `users`, `player_wallet`, `farm_buildings`,
`schema_versions`, `oauth_tokens`, etc.

## Restore into the live DB

### Full replace

Stops the game briefly. Users get 503 / connection-refused during the
restore.

```bash
# 1. Take the game offline (multi-node: stop every game-node)
docker compose stop backend        # single-node
# OR
docker compose stop game-node1 game-node2   # multi-node

# 2. Drop and recreate the DB
docker exec -it digiworld-postgres-1 psql -U digiworld -c "DROP DATABASE digiworld;"
docker exec -it digiworld-postgres-1 psql -U digiworld -c "CREATE DATABASE digiworld;"

# 3. Restore
docker cp backups/digiworld-YYYYMMDD.dump digiworld-postgres-1:/tmp/
docker exec digiworld-postgres-1 pg_restore \
  --username digiworld \
  --dbname digiworld \
  --clean --if-exists \
  --no-owner \
  /tmp/digiworld-YYYYMMDD.dump

# 4. Bring the game back
docker compose start backend
```

`--clean --if-exists` drops each object before creating it; harmless on a
freshly-created empty DB, essential if you skipped step 2.

### Selective restore (single table)

Handy for `DELETE FROM users WHERE …` you regret 5 minutes later.

```bash
# List every table pg_restore would create from the dump
docker exec digiworld-postgres-1 pg_restore --list \
  /tmp/digiworld-YYYYMMDD.dump | grep TABLE

# Restore just the users table (data + schema)
docker exec digiworld-postgres-1 pg_restore \
  --username digiworld \
  --dbname digiworld \
  --table users \
  --data-only \                       # skip DDL — keeps existing schema
  --clean --if-exists \
  /tmp/digiworld-YYYYMMDD.dump
```

> [!warning] Foreign key ordering
> Restoring `users` alone leaves rows in `player_wallet`, `roster`,
> `sessions` (Redis, not DB — but still worth thinking about) that
> reference USER IDs not in the restored dump. `ON DELETE CASCADE` on
> most FKs means the truncated child rows may already be gone. Verify
> the dump you're restoring covers the users AND all their dependent
> rows.

## Schema drift after restore

The migrator runs on every backend boot ([[Database Adapter#Migrator]]).
Restoring an older dump can leave the DB with a `schema_versions` ledger
row for migration 037, while the code expects 045. Boot behaviour:

- Backend starts.
- Migrator opens the ledger, sees 037.
- Applies 038, 039, 040, ..., 045 in order.
- Logs `db.migration.applied` for each.
- Race safety kicks in on multi-node — see
  [[Database Adapter#Ledger + race safety]].

So restoring an older backup is safe as long as:

1. The backup is from a schema the migrator can advance from (not
   ancient — verify each migration between the dump's version and
   HEAD is transactional and applies cleanly).
2. Every migration in that range is idempotent-on-race (they are —
   `INSERT INTO schema_versions` is PRIMARY KEY-gated).

## Point-in-time recovery (advanced)

Postgres 16 supports PITR via `pg_basebackup` + WAL archiving. The
bundled compose does NOT wire this up — for a real production shop, add:

- `archive_mode = on` + `archive_command = 'cp %p /path/to/archive/%f'`
  to `postgresql.conf`
- Regular `pg_basebackup` snapshots

Restore: replay from the base backup + apply WAL segments up to a
target timestamp. Docs at
<https://www.postgresql.org/docs/16/continuous-archiving.html>.

## What can go wrong

> [!warning] Redis session state didn't come with the backup
> Sessions live in the cluster, not the DB. A restore rolls back USER
> data (passwords, wallets) but the cluster still has session tokens
> that point to the pre-restore state. Fix: flush user sessions after
> restore.
> ```bash
> redis-cli KEYS 'session:*'   | xargs -r redis-cli DEL
> redis-cli KEYS 'usessions:*' | xargs -r redis-cli DEL
> ```
> Users log back in with whatever passwords are in the restored DB.

> [!warning] Migration ledger has a version the migrator doesn't know
> Your BACKUP is NEWER than the running code. Migrator sees version 048
> in the ledger but has no migration file for 047 (the code branch it's
> running is older). Boot succeeds — the migrator only APPLIES; it
> doesn't roll back. But the SCHEMA is ahead of the code, so route
> handlers may fail on columns they don't expect.
> Fix: upgrade the code before restoring a newer backup.

> [!warning] Restored the wrong DB (mixed users)
> Cross-env restore (prod dump into staging) leaks prod user data into
> staging. Anonymize by hand:
> ```sql
> UPDATE users SET username = 'staging_' || id,
>                  password_hash = '<placeholder>',
>                  display_name = NULL;
> ```

## Related

- [[Multi-node Deployment#Postgres — mandatory here]] — why Postgres is
  the default here
- [[Database Adapter#Migrator]] — the ledger + race safety
- [[Environments#Rotate a secret]] — for co-rotating `POSTGRES_PASSWORD`
- [[Recover a lost admin password#Path B]] — where backup restore is
  the last-resort recovery
