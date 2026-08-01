---
tags:
  - digiworld/architecture
aliases:
  - DB
  - DbAdapter
  - Database Layer
created: 2026-08-01
updated: 2026-08-01
grounded-in:
  - backend/src/db/adapter.ts
  - backend/src/db/sqlite.ts
  - backend/src/db/postgres.ts
  - backend/src/db/migrator.ts
  - backend/src/db/index.ts
verified-at-commit: 97f72ba
---

# Database Adapter

> [!info] TL;DR
> One [`DbAdapter`](backend/src/db/adapter.ts:27) interface, two backends
> — `SqliteAdapter` (better-sqlite3 with WAL) and `PgAdapter` (`pg.Pool`
> with prepared-statement cache). Every SQL string uses `?` placeholders;
> Postgres rewrites them to `$1, $2, …` on the fly. Same string, both
> dialects. Picked at boot by `config.DATABASE`.

## The interface

Verbatim from [`backend/src/db/adapter.ts:22-49`](backend/src/db/adapter.ts):

```typescript
export type RunResult = {
  changes: number;
  lastInsertId: number | null;
};

export interface DbAdapter {
  readonly kind: 'sqlite' | 'postgres';
  init(): Promise<void>;
  close(): Promise<void>;

  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}
```

The `getDb()` singleton constructs the concrete adapter on first call
([`adapter.ts:54-66`](backend/src/db/adapter.ts:54)):

```typescript
if (config.DATABASE === 'postgres') {
  instance = await PgAdapter.create(config.DATABASE_URL!);
} else {
  instance = await SqliteAdapter.create();
}
```

Route files pull top-level helpers from
[`backend/src/db/index.ts`](backend/src/db/index.ts) — `q()`, `one()`,
`run()`, `tx()` — which delegate to the singleton. Sync `prep()` is retained
for legacy callers but **throws when `DATABASE !== 'sqlite'`**, so misuse
fails loud instead of silently corrupting on Postgres.

## SqliteAdapter — [`sqlite.ts`](backend/src/db/sqlite.ts)

better-sqlite3 wrapped in the async interface. Under the hood it's
synchronous; every method wraps in `Promise.resolve` (no CPU work moved off
the loop, but the caller writes the same code either way).

### Boot pragmas

Set once at `create()` ([`sqlite.ts:83-95`](backend/src/db/sqlite.ts:83)):

```typescript
handle.pragma('journal_mode = WAL');
handle.pragma('synchronous = NORMAL');
handle.pragma('foreign_keys = ON');
handle.pragma('busy_timeout = 5000');
handle.pragma('temp_store = MEMORY');
handle.pragma('cache_size = -20000');
```

- **WAL** — concurrent readers alongside one writer.
- **`synchronous = NORMAL`** — durability drops from `FULL` (fsync every
  commit) but crash-consistency stays intact. Fine for a game DB; not for
  a bank.
- **`busy_timeout = 5000`** — 5 s waiting for a lock instead of instant
  `SQLITE_BUSY`. Bought us free retries on the SQL side.
- **`cache_size = -20000`** — 20 MB page cache (negative = KB).

### Prepared statement cache

Every SQL string goes through `prep()` which caches the compiled `Statement`
([`sqlite.ts:110-116`](backend/src/db/sqlite.ts:110)). Repeat calls to the
same string skip the parse+compile.

### Transaction serialization

better-sqlite3 has ONE synchronous connection. Two concurrent
`transaction()` calls MUST be serialized — a `BEGIN IMMEDIATE` on a handle
already inside a tx throws `SQLITE_ERROR` and can crash the process.
[`sqlite.ts:79`](backend/src/db/sqlite.ts:79) uses a promise-chain tail:

```typescript
private txTail: Promise<unknown> = Promise.resolve();

async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => { /* BEGIN → fn → COMMIT/ROLLBACK */ };
  const next = this.txTail.then(run, run);
  this.txTail = next.catch(() => undefined);  // don't poison the chain
  return next;
}
```

Failed txs are caught on the chain itself so one rejection does not poison
subsequent callers — critical, otherwise a single failed migration would
freeze every future transaction.

### Column migrations (drift-catcher)

[`applyColumnMigrations()`](backend/src/db/sqlite.ts:25) hand-declares
optional columns that older `schema.sql` versions didn't have. Runs BEFORE
`runMigrations()`; keeps `pnpm dev` on a stale DB going without the user
having to blow it away. Postgres never needs this — its schema always ships
current via `schema-pg.sql`.

## PgAdapter — [`postgres.ts`](backend/src/db/postgres.ts)

`pg.Pool` under the hood. Two subtleties.

### `BIGINT` OID coercion

Postgres returns BIGINT / INT8 as **strings** by default because they can
exceed `Number.MAX_SAFE_INTEGER`. Our BIGINT columns hold ms timestamps
and small counts; both fit inside safe integer. Without coercion,
`SELECT COUNT(*)` returns `"0"` and every `count === 0` check silently
misbehaves. [`postgres.ts:33-34`](backend/src/db/postgres.ts):

```typescript
const PG_INT8_OID = 20;
pg.types.setTypeParser(PG_INT8_OID, (v) => (v === null ? null : Number(v)));
```

### Prepared statement cache

Every SQL text gets a stable prepared name derived from its SHA-1
([`postgres.ts:36-52`](backend/src/db/postgres.ts:36)). LRU-evicted at
256 entries. Postgres caches the plan against that name so repeat calls
skip re-planning.

### Transactions with a pinned client

`transaction()` pulls ONE client from the pool and pins it for the whole
callback ([`postgres.ts:117-138`](backend/src/db/postgres.ts:117)) —
BEGIN/COMMIT would otherwise land on different physical connections and
the tx would be silently useless. Inner adapter shares the pool but
carries `pinned`; nested `transaction()` calls reuse it.

## `?` → `$1, $2, …` translation

Every SQL constant is written SQLite-style (`WHERE id = ?`). Postgres
runs [`toPgPlaceholders()`](backend/src/db/adapter.ts:83) at query time
which scans the SQL and rewrites `?` to `$N`, correctly skipping `?`
found inside:

- single-quoted strings (`'foo?bar'`), including `''`-escaped quotes
- double-quoted identifiers (`"col?"`)
- dollar-quoted strings (`$$foo?$$` / `$tag$…$tag$`) — PG-specific
- line comments (`-- ?`)
- block comments (`/* ? */`) — nesting supported

Cached in a 512-entry LRU. First translation of a SQL is O(n); every
repeat is O(1) map lookup.

## Migrator — [`migrator.ts`](backend/src/db/migrator.ts)

Numbered SQL files in [`backend/src/db/migrations/`](backend/src/db/migrations/)
named `NNN_description.sql`, applied once each in order.

### Dialect-aware suffixes

- `NNN_desc.sql` — portable, applied on BOTH dialects
- `NNN_desc.sqlite.sql` — SQLite only
- `NNN_desc.pg.sql` — Postgres only

The version key stored in `schema_versions` strips the dialect suffix, so
counterparts share the same version. A migration that only exists on one
dialect (e.g. `003_skills_element_check.sqlite.sql` — SQLite was born with
a stale CHECK constraint that Postgres never had) simply has no partner —
the other dialect's ledger just won't have that entry.

### Ledger + race safety

```sql
CREATE TABLE IF NOT EXISTS schema_versions (
  version    TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
)
```

`version` is a PRIMARY KEY. Two nodes booting simultaneously both try
migration X; the loser's INSERT fails, its transaction ROLLBACKs, and the
DDL rolls with it (both dialects support transactional DDL for our ops).
We recheck the ledger after a failed apply
([`migrator.ts:119`](backend/src/db/migrator.ts:119)); if the row is there
the loser continues, otherwise the error rethrows.

### Duplicate-column tolerance

An `ADD COLUMN` migration whose column the baseline schema already
declares is a no-op, not a failure —
[`canMarkDuplicateColumnMigration()`](backend/src/db/migrator.ts:189)
inspects the migration's SQL for pure `ALTER TABLE X ADD COLUMN Y`
statements, verifies every column already exists via `PRAGMA table_info`
(SQLite) / `information_schema.columns` (Postgres), and marks it applied
without re-running. Mixed migrations (ADD COLUMN + backfill INSERT) stay
strict; auto-applying them would silently skip the backfill.

### Self-managed transactions

A migration containing `-- migrator:self-managed-transaction` runs OUTSIDE
the wrapper transaction ([`migrator.ts:143`](backend/src/db/migrator.ts:143)).
Use it for `CREATE INDEX CONCURRENTLY` and similar Postgres operations
that reject implicit transactions.

## Portability verification

[`test/postgres-portability.mts`](backend/test/postgres-portability.mts)
loads `schema-pg.sql` into a real Postgres 18 via `@electric-sql/pglite`
(compiled to WASM, no daemon, ~15 s per run — safe for CI). Then:

- **63 / 63 SQL constants `PREPARE`d cleanly** — validates syntax, column
  names, types, and placeholder counts in one pass.
- **13 / 13 end-to-end roundtrips pass** — register, case-insensitive login
  via CITEXT, starter roster, farm building, shop upsert, wallet credit,
  admin catalog search, tx commit + rollback.

```bash
pnpm --filter @digiworld/backend test:pg-portability
```

## Design notes

> [!info] Why one interface for two SQL flavours?
> Deploy-shape freedom. Single-node local demo → SQLite, one file, zero
> external service. Multi-node prod → Postgres, real pool, real concurrency.
> Every route uses the same helper functions; the switch happens once at
> boot.

> [!warning] SQL that would work on ONE dialect only
> Some SQL is naturally non-portable (`RETURNING *`, dollar-quoted
> functions, arrays). We avoid them; when unavoidable, put the migration
> under `.pg.sql` / `.sqlite.sql`. Every portable `SQL_*` constant should
> pass through `test:pg-portability`.

## Related

- [[Architecture Overview]]
- [[Cluster Coordination Layer]] — sits alongside; DB is durable, cluster
  is coordination
- [[Environments]] — how `DATABASE=` is wired per env
- [[Multi-node Deployment]] — Postgres is mandatory here
