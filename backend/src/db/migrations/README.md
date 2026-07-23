# Schema migrations

Numbered SQL files, applied once each in order by prefix, tracked in the
`schema_versions` ledger table (see [`../migrator.ts`](../migrator.ts)).

## Naming

- `NNN_description.sql` — three-digit prefix, snake_case description
- The prefix is the version key stored in `schema_versions`
- Files are sorted lexically, so `001` < `002` < ... < `099` < `100`

## Rules

1. **Portable SQL only.** SQL must run on both SQLite (via `better-sqlite3`)
   and Postgres (via `pg`). Use `DROP TABLE IF EXISTS`, `CREATE INDEX IF NOT
   EXISTS`, `?` placeholders where relevant. When a change is genuinely
   dialect-specific, keep it out of this pipeline — see the SQLite-only
   column backfill in [`../sqlite.ts`](../sqlite.ts) for the pattern.
2. **Idempotent within a fresh install.** A new DB starts empty, applies
   the baseline schema (`schema.sql` / `schema-pg.sql`), then runs every
   migration here in order. If your migration would break on the baseline
   schema (e.g. `DROP TABLE foo` when `foo` was removed from the baseline
   in the same release), use `IF EXISTS` guards.
3. **Transactional.** Each file is wrapped in a `BEGIN`/`COMMIT` by the
   migrator. Both dialects support transactional DDL for the ops we use
   here (CREATE / ALTER / DROP / CREATE INDEX). Don't split a logical
   change across two files.
4. **Never edit or delete an applied migration.** Once it's been run in
   any deployment, the ledger has recorded it; future runs will skip it.
   Fix mistakes with a new migration.
5. **Race-safe.** `schema_versions.version` is a PRIMARY KEY. Two nodes
   booting simultaneously will pick a winner; the loser's transaction
   rolls back cleanly. No advisory lock needed.
