---
tags:
  - digiworld/runbook
  - digiworld/ops
aliases:
  - SQLite backup
  - SQLite restore
  - Single-node backup
  - DB backup dev
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/db/sqlite.ts
  - docker-compose.yml
verified-at-commit: 13dc16b
---

# SQLite backup and restore

> [!info] When to use this
> Single-node deploys (`DATABASE=sqlite`, the default for `pnpm dev`
> and local demos). For Postgres deploys — the recommended production
> shape — use [[Postgres backup and restore]] instead.

## The SQLite storage layout

DigiWorld boots with WAL mode
([`sqlite.ts:83-95`](backend/src/db/sqlite.ts:83)):

```typescript
handle.pragma('journal_mode = WAL');
handle.pragma('synchronous = NORMAL');
```

Three files back a live SQLite database:

- **`digiworld.db`** — main data file
- **`digiworld.db-wal`** — write-ahead log (uncommitted + recently
  committed transactions)
- **`digiworld.db-shm`** — shared memory index (regenerated on open)

**All three must be backed up together.** Copying only `.db` while
the server is running gives a stale snapshot — recent transactions
sitting in `-wal` won't be there. Copying `.db` + `.db-wal` catches
them; `-shm` is not strictly required but harmless.

## Path A — offline backup (stop the server)

Simplest and safest. 10-second maintenance window.

```bash
# 1. Stop the backend (single-node)
docker compose stop backend

# 2. Copy the trio to a backup location
mkdir -p ./backups/$(date +%Y%m%d-%H%M%S)
cp -v backend/data/digiworld.db* ./backups/$(date +%Y%m%d-%H%M%S)/

# 3. Restart
docker compose start backend
```

The `*` glob picks `.db`, `.db-wal`, and `.db-shm` in one line.

## Path B — online backup via `sqlite3 .backup`

Zero downtime. Preferred for automated cron. `.backup` uses the SQLite
online backup API — it takes a consistent snapshot even while writers
are active.

```bash
# Ad-hoc from the docker host
docker exec digiworld-backend-1 sqlite3 /app/backend/data/digiworld.db \
  ".backup '/tmp/digiworld-$(date +%Y%m%d-%H%M%S).db'"

# Copy the snapshot off the container
docker cp digiworld-backend-1:/tmp/digiworld-*.db ./backups/
```

The `.backup` command produces a SINGLE file — no `-wal`/`-shm`
sidecars needed. The output IS the whole database, WAL contents
already merged in.

## Path C — `VACUUM INTO` (compact + snapshot in one)

Even cleaner than `.backup` for archival — the output is defragmented:

```bash
docker exec digiworld-backend-1 sqlite3 /app/backend/data/digiworld.db \
  "VACUUM INTO '/tmp/digiworld-vacuum-$(date +%Y%m%d).db';"
docker cp digiworld-backend-1:/tmp/digiworld-vacuum-*.db ./backups/
```

`VACUUM INTO` rebuilds the file from scratch, dropping deleted-row
holes and compacting indexes. Larger CPU cost, smaller output file.
Good for weekly compact-and-archive; ordinary daily backups can use
Path B.

## Verify the backup is valid

Round-trip against a scratch SQLite:

```bash
# Copy the backup into a scratch location
mkdir /tmp/dw-restore-check
cp ./backups/digiworld-*.db /tmp/dw-restore-check/digiworld.db

# Open + integrity check
sqlite3 /tmp/dw-restore-check/digiworld.db "PRAGMA integrity_check;"
# → "ok"

# Sanity — count key tables
sqlite3 /tmp/dw-restore-check/digiworld.db \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
sqlite3 /tmp/dw-restore-check/digiworld.db \
  "SELECT COUNT(*) AS users FROM users;
   SELECT COUNT(*) AS mons FROM player_roster;
   SELECT COUNT(*) AS matches FROM battles;"

# Tear down
rm -rf /tmp/dw-restore-check
```

`PRAGMA integrity_check` returns `ok` on a clean file. Any other
output means corruption.

## Restore the live DB

### Full replace

Stops the game briefly. Users get 503 / connection-refused during the
restore.

```bash
# 1. Stop the backend
docker compose stop backend

# 2. Move the current DB aside (safety copy)
docker exec digiworld-backend-1 sh -c '
  cd /app/backend/data
  mkdir -p .broken
  mv digiworld.db* .broken/ 2>/dev/null || true
'

# 3. Copy the backup in
docker cp ./backups/digiworld-YYYYMMDD.db digiworld-backend-1:/app/backend/data/digiworld.db

# 4. Fix ownership (bind-mount volumes may drop this)
docker exec digiworld-backend-1 chown node:node /app/backend/data/digiworld.db

# 5. Bring the game back
docker compose start backend
```

The `.broken/` sidecar keeps the failed state around in case the
restore turns out to be worse than the original. Delete after a
few days if the new DB is stable.

### Migration ledger behavior

The `schema_versions` table travels with the backup. Restoring an
older backup:

- Migrator opens the ledger, sees version N.
- Applies migrations N+1 → HEAD in order.
- Same behavior as [[Postgres backup and restore#Schema drift after
  restore]] — safe as long as every migration between N and HEAD
  is transactional (they are — see [[Database Adapter#Migrator]]).

## Scheduled backups (cron)

```bash
# /etc/cron.d/digiworld-sqlite-backup
0 3 * * * root /usr/local/bin/digiworld-sqlite-backup.sh
```

Where the script does the `.backup` + upload + rotate:

```bash
#!/bin/bash
set -euo pipefail
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/var/backups/digiworld
mkdir -p "$BACKUP_DIR"

docker exec digiworld-backend-1 sqlite3 /app/backend/data/digiworld.db \
  ".backup '/tmp/digiworld-$STAMP.db'"
docker cp "digiworld-backend-1:/tmp/digiworld-$STAMP.db" "$BACKUP_DIR/"
docker exec digiworld-backend-1 rm "/tmp/digiworld-$STAMP.db"

# Optional: upload to S3
# aws s3 cp "$BACKUP_DIR/digiworld-$STAMP.db" s3://your-bucket/backups/

# Prune backups older than 14 days
find "$BACKUP_DIR" -name 'digiworld-*.db' -mtime +14 -delete
```

## What can be lost

**With Path A (offline)**: nothing — the file at rest is consistent.
**With Path B / C (online)**: last-second in-flight transactions
(committed AFTER `.backup`/`VACUUM INTO` started). SQLite's online
backup captures a snapshot at the moment it begins.

**Assets are NOT in the DB.** `backend/public/assets/digimon/`
(portrait.webp + dot.gif per mon) live on the filesystem. The DB
references them by relative path. A restore of the DB with fresh
assets uses the boot verifier
([`backend/src/scraper/verifier.ts`](backend/src/scraper/verifier.ts))
to re-download any missing ones — see
[[Bootstrap a fresh scraped catalog#Live asset verifier]].

## Filesystem vs volume gotchas

The bundled docker-compose uses a named volume `data:` mount for the
SQLite files (verify — depends on your compose). This means:

- `backend/data/` on the HOST may be empty; the actual DB lives in
  a docker-managed volume.
- Backup path is `docker exec` INTO the container, not host `cp`.

If you're running `pnpm dev` outside docker, `backend/data/digiworld.db`
is a real file on disk — host `cp` works fine.

## What can go wrong

> [!warning] Copying `.db` alone while the server runs
> Recent writes sitting in `.db-wal` won't be in the copy. Result: a
> "backup" missing the last N minutes of transactions. Always use
> Path B (`.backup`) for live backups.

> [!warning] Restoring atop a mounted `.db`
> `mv` before `cp` — dropping a new file over an OPEN one doesn't
> disconnect the existing SQLite handle. Stop the backend first.

> [!warning] `PRAGMA integrity_check` slow on large DBs
> On >5 GB SQLite files, the check can take minutes. Run it against
> a scratch copy, not the live one.

> [!warning] File permissions after `docker cp`
> `docker cp` preserves USER but not necessarily GROUP inside the
> container. Chown `node:node` after every restore.

## Related

- [[Postgres backup and restore]] — production-shape sibling
- [[Database Adapter#Boot pragmas]] — the WAL / synchronous config
- [[Bootstrap a fresh scraped catalog#Path C — restore a curated XML directly]] —
  the asset-and-catalog parallel to DB restore
- [[Environments#Development]] — where the SQLite deploy shape is
  the default
