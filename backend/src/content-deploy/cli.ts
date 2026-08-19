/**
 * Content-deploy CLI.
 *
 * Promotes a seed artifact (produced by `pnpm seed:export`) into a target
 * environment. `--validate` and `--diff` are read-only; `--apply` deploys the
 * artifact (upsert content rows + record immutable content_versions snapshots
 * + swap active_versions pointers) and `--rollback` restores the previous
 * snapshot — both inside a single transaction (see versions.ts). A hard guard
 * refuses to touch player-state tables, and `--apply` validates cross-domain
 * references inside the artifact before any write.
 *
 * Usage:
 *   pnpm content:deploy --validate <seed.json>
 *   pnpm content:deploy --diff [--tables <csv>] <seed.json>
 *   pnpm content:deploy --apply <seed.json>
 *   pnpm content:deploy --rollback
 *   pnpm content:deploy --help
 *
 * Safety: `--validate` and `--diff` are read-only. No code path here may read
 * or write player-state tables (`player_*`, `user_*`, `pending_*`, `wallet_*`,
 * `friendships`, `coin_offers`, `sessions`, `resources`, `login_attempts`).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { CONTENT_TABLES } from '../seed-export/content-tables.js';
import { applySeed, rollback, canon, pkColumnsOf, rowKey } from './versions.js';

type Row = Record<string, unknown>;

/** Seed artifact envelope — mirrors the `seed-export` CLI output. */
type SeedEnvelope = {
  schemaVersion: number;
  exportedAt: number;
  source: unknown;
  skippedMissingTables: string[];
  tables: Record<string, Row[]>;
  assetManifest: Array<{ rel: string; bytes: number; sha256: string }>;
};

/** Player-state tables content-deploy must NEVER read or write. */
const FORBIDDEN_TABLE_NAMES: ReadonlySet<string> = new Set([
  'friendships',
  'coin_offers',
  'sessions',
  'resources',
  'login_attempts',
]);
const FORBIDDEN_TABLE_PREFIXES: readonly string[] = ['player_', 'user_', 'pending_', 'wallet_'];

function isForbiddenTable(name: string): boolean {
  return FORBIDDEN_TABLE_NAMES.has(name) || FORBIDDEN_TABLE_PREFIXES.some((p) => name.startsWith(p));
}

type CliOptions = {
  mode: 'help' | 'validate' | 'diff' | 'apply' | 'rollback';
  seedPath: string;
  tables: readonly string[];
};

function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      validate: { type: 'boolean', default: false },
      diff: { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      rollback: { type: 'boolean', default: false },
      tables: { type: 'string', short: 't' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) return { mode: 'help', seedPath: '', tables: [] };

  const modes = (['validate', 'diff', 'apply', 'rollback'] as const).filter((m) => values[m] === true);
  if (modes.length === 0) {
    throw new Error('Missing subcommand: --validate, --diff, --apply or --rollback (see --help)');
  }
  if (modes.length > 1) {
    throw new Error(`Conflicting subcommands: ${modes.join(', ')} (pick exactly one)`);
  }
  const mode = modes[0] ?? 'help';

  if (positionals.length > 1) {
    throw new Error(`Unexpected positional arguments: ${positionals.slice(1).join(' ')}`);
  }
  const seedPath = positionals[0] ?? '';
  if (mode === 'validate' || mode === 'diff' || mode === 'apply') {
    if (!seedPath) throw new Error(`--${mode} requires a seed.json path`);
  }

  return {
    mode,
    seedPath,
    tables: values.tables ? values.tables.split(',').map((t) => t.trim()).filter(Boolean) : [],
  };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Content-deploy CLI — promote a seed artifact into a target environment.

Usage:
  pnpm content:deploy --validate <seed.json>                 read-only artifact check
  pnpm content:deploy --diff [--tables <csv>] <seed.json>    read-only diff vs target DB
  pnpm content:deploy --apply <seed.json>                    deploy artifact (transactional)
  pnpm content:deploy --rollback                             restore previous version (transactional)
  pnpm content:deploy --help

Subcommands:
  --validate            Load the seed.json envelope, verify its shape and reject
                        artifacts that carry player-state tables. Read-only.
  --diff                Compare artifact rows against the target database and
                        print changed rows only. Read-only.
  --apply               Validate cross-domain refs, then in ONE transaction:
                        upsert content rows, record immutable content_versions
                        snapshots, and swap active_versions pointers.
  --rollback            In ONE transaction: restore every active content row
                        from its previous snapshot and re-point active_versions.

Options:
  -t, --tables <csv>    Restrict --diff to a subset of content tables.
      --help            Show this help.

Safety: content-deploy never touches player-state tables
  (player_*, user_*, pending_*, wallet_*, friendships, coin_offers,
   sessions, resources, login_attempts).`);
}

/** Resolve a CLI argument to a seed.json path (accepts file or out-directory). */
async function resolveSeedPath(path: string): Promise<string> {
  const { stat } = await import('node:fs/promises');
  const abs = resolve(process.cwd(), path);
  try {
    const info = await stat(abs);
    return info.isDirectory() ? resolve(abs, 'seed.json') : abs;
  } catch {
    return abs;
  }
}

/** Load and shape-check a seed.json envelope. Throws with a readable message. */
async function loadSeed(seedPath: string): Promise<SeedEnvelope> {
  let raw: string;
  try {
    raw = await readFile(seedPath, 'utf8');
  } catch {
    throw new Error(`seed.json not found at ${seedPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON in ${seedPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`seed.json at ${seedPath} must be a JSON object envelope`);
  }
  const env = parsed as Partial<SeedEnvelope>;
  if (env.schemaVersion !== 1) {
    throw new Error(`seed.json at ${seedPath}: unsupported schemaVersion ${String(env.schemaVersion)} (expected 1)`);
  }
  if (typeof env.tables !== 'object' || env.tables === null || Array.isArray(env.tables)) {
    throw new Error(`seed.json at ${seedPath}: missing "tables" object`);
  }
  for (const [name, rows] of Object.entries(env.tables)) {
    if (!Array.isArray(rows)) {
      throw new Error(`seed.json at ${seedPath}: tables.${name} must be an array of rows`);
    }
  }
  return env as SeedEnvelope;
}

/** List of tables in the envelope that content-deploy must never touch. */
function forbiddenTablesIn(env: SeedEnvelope): string[] {
  return Object.keys(env.tables).filter(isForbiddenTable).sort();
}

async function runValidate(seedPath: string): Promise<void> {
  const env = await loadSeed(seedPath);
  const forbidden = forbiddenTablesIn(env);
  if (forbidden.length > 0) {
    throw new Error(`seed artifact contains player-state tables: ${forbidden.join(', ')}`);
  }
  const counts = Object.entries(env.tables)
    .map(([name, rows]) => `${name}=${rows.length}`)
    .join(' ');
  // eslint-disable-next-line no-console
  console.log(`content-deploy: artifact OK schemaVersion=${env.schemaVersion} assets=${env.assetManifest?.length ?? 0} tables(${Object.keys(env.tables).length}) ${counts}`);
}

async function runDiff(seedPath: string, requested: readonly string[]): Promise<void> {
  const env = await loadSeed(seedPath);
  const forbidden = forbiddenTablesIn(env);
  if (forbidden.length > 0) {
    throw new Error(`seed artifact contains player-state tables: ${forbidden.join(', ')}`);
  }

  const names = requested.length > 0 ? requested : Object.keys(env.tables);
  const unknown = names.filter((n) => !(n in env.tables));
  if (unknown.length > 0) {
    throw new Error(`--tables references tables absent from artifact: ${unknown.join(', ')}`);
  }
  const requestedForbidden = names.filter(isForbiddenTable);
  if (requestedForbidden.length > 0) {
    throw new Error(`refusing to diff player-state tables: ${requestedForbidden.join(', ')}`);
  }

  const [{ q, closeDbAdapter }] = await Promise.all([
    import('../db/index.js'),
  ]);

  try {
    let anyChanges = false;
    for (const name of names) {
      const pk = pkColumnsOf(name);
      const artifact = env.tables[name] ?? [];
      const dbRows = await q<Row>(`SELECT * FROM ${name}`);
      const db = new Map(dbRows.map((r) => [rowKey(r, pk), r]));
      const art = new Map(artifact.map((r) => [rowKey(r, pk), r]));

      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];
      for (const [key, artRow] of art) {
        const dbRow = db.get(key);
        if (!dbRow) added.push(key);
        else if (canon(artRow) !== canon(dbRow)) changed.push(key);
      }
      for (const key of db.keys()) {
        if (!art.has(key)) removed.push(key);
      }
      if (added.length === 0 && removed.length === 0 && changed.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`content-deploy: ${name}: no changes (${dbRows.length} rows)`);
        continue;
      }
      anyChanges = true;
      // eslint-disable-next-line no-console
      console.log(`content-deploy: ${name}: +${added.length} added, ~${changed.length} changed, -${removed.length} removed`);
      for (const key of added) console.log(`  + ${name}[${key}] (in artifact, not in DB)`);
      for (const key of changed) console.log(`  ~ ${name}[${key}] (content differs)`);
      for (const key of removed) console.log(`  - ${name}[${key}] (in DB, not in artifact)`);
    }
    if (!anyChanges) {
      // eslint-disable-next-line no-console
      console.log('content-deploy: diff: no changed rows');
    }
  } finally {
    await closeDbAdapter();
  }
}

async function runApply(seedPath: string): Promise<void> {
  const env = await loadSeed(seedPath);
  const forbidden = forbiddenTablesIn(env);
  if (forbidden.length > 0) {
    throw new Error(`seed artifact contains player-state tables: ${forbidden.join(', ')}`);
  }

  const [{ closeDbAdapter }] = await Promise.all([
    import('../db/index.js'),
  ]);

  try {
    const summary = await applySeed(env);
    // eslint-disable-next-line no-console
    console.log(`content-deploy: applied ${Object.keys(summary.tables).length} table(s), ${summary.totalVersions} version(s) in one transaction`);
    for (const [name, t] of Object.entries(summary.tables)) {
      // eslint-disable-next-line no-console
      console.log(`  ${name}: ${t.rows} row(s) -> ${t.versions} version(s)`);
    }
  } finally {
    await closeDbAdapter();
  }
}

async function runRollback(): Promise<void> {
  const [{ closeDbAdapter }] = await Promise.all([
    import('../db/index.js'),
  ]);

  try {
    const summary = await rollback();
    // eslint-disable-next-line no-console
    console.log(`content-deploy: rollback: restored ${summary.restored} row(s), skipped ${summary.skipped} (no previous version)`);
    for (const line of summary.details) {
      // eslint-disable-next-line no-console
      console.log(`  ${line}`);
    }
  } finally {
    await closeDbAdapter();
  }
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  switch (opts.mode) {
    case 'help': printHelp(); return;
    case 'validate': {
      const seedPath = await resolveSeedPath(opts.seedPath);
      await runValidate(seedPath);
      return;
    }
    case 'diff': {
      const seedPath = await resolveSeedPath(opts.seedPath);
      await runDiff(seedPath, opts.tables);
      return;
    }
    case 'apply': {
      const seedPath = await resolveSeedPath(opts.seedPath);
      await runApply(seedPath);
      return;
    }
    case 'rollback': await runRollback(); return;
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`content-deploy: failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
