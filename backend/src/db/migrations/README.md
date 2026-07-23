# Schema migrations

Numbered SQL files, applied once each in order by prefix, tracked in the
`schema_versions` ledger table (see [`../migrator.ts`](../migrator.ts)).

## Naming

- `NNN_description.sql` — portable across BOTH SQLite and Postgres
- `NNN_description.sqlite.sql` — SQLite-only (Postgres skips)
- `NNN_description.pg.sql` — Postgres-only (SQLite skips)

The three-digit `NNN` prefix is the version key stored in `schema_versions`
(dialect suffixes are stripped, so a `.sqlite.sql` file and its `.pg.sql`
counterpart share the same version key). Files are sorted lexically, so
`001` < `002` < ... < `099` < `100`.

Use a dialect suffix when the migration is inherently one-sided:
- SQLite-only CHECK-constraint drift fixes (SQLite can't `ALTER CHECK`).
- Postgres-only extensions (`CREATE EXTENSION`, index types SQLite doesn't have).
- Column-type differences the baseline schemas resolve differently.

For everything else, use the portable `.sql` suffix and write SQL that runs
on both — `CREATE TABLE IF NOT EXISTS`, `DROP TABLE IF EXISTS`, `?`
placeholders for INSERT/UPDATE, `ON CONFLICT ... DO ...`. See
[`001_drop_legacy_tables.sql`](001_drop_legacy_tables.sql) and
[`002_chat_rooms.sql`](002_chat_rooms.sql) for the portable pattern.

## Rules

1. **Idempotent within a fresh install.** A new DB starts empty, applies
   the baseline schema (`schema.sql` / `schema-pg.sql`), then runs every
   migration here in order. If your migration would break on the baseline
   schema (e.g. `DROP TABLE foo` when `foo` was removed from the baseline
   in the same release), use `IF EXISTS` guards.
2. **Transactional.** Each file is wrapped in a `BEGIN`/`COMMIT` by the
   migrator. Both dialects support transactional DDL for the ops we use
   here (CREATE / ALTER / DROP / CREATE INDEX). Don't split a logical
   change across two files.
3. **Never edit or delete an applied migration.** Once it's been run in
   any deployment, the ledger has recorded it; future runs will skip it.
   Fix mistakes with a new migration.
4. **Race-safe.** `schema_versions.version` is a PRIMARY KEY. Two nodes
   booting simultaneously will pick a winner; the loser's transaction
   rolls back cleanly. No advisory lock needed.
