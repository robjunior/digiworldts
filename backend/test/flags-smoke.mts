/**
 * Flags smoke test — the durable per-player flag store the dialogue DSL writes
 * through (set_flag) and reads back (flag_enabled). Boots the real
 * SqliteAdapter the way production does, so schema.sql plus every migration --
 * including 037_user_flags -- has applied before the first assertion.
 *
 * Run: pnpm --filter @digiworld/backend test:flags
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { setFlag, clearFlag, hasFlag, listFlags, clearFlagPrefix } from '../src/flags/repo.ts';

const DB = process.env.DB_PATH ?? '/tmp/dw-flags-smoke.db';
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(DB + suffix)) unlinkSync(DB + suffix);
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failed += 1;
    process.stderr.write(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

async function mkUser(id: string): Promise<void> {
  const now = Date.now();
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, id, id, 'x', 0, now, now],
  );
}

await getDb();
await mkUser('usr_flag_a');
await mkUser('usr_flag_b');

await test('an unset flag reads false', async () => {
  assert((await hasFlag('usr_flag_a', 'dialogue.elder.met')) === false, 'expected false before set');
});

await test('setFlag makes the flag readable', async () => {
  await setFlag('usr_flag_a', 'dialogue.elder.met');
  assert((await hasFlag('usr_flag_a', 'dialogue.elder.met')) === true, 'expected true after set');
});

await test('setFlag is idempotent and preserves the first set_at', async () => {
  await setFlag('usr_flag_a', 'quest.embers.briefed', 1000);
  await setFlag('usr_flag_a', 'quest.embers.briefed', 9999);
  const row = await one<{ readonly set_at: number; readonly n: number }>(
    'SELECT MIN(set_at) AS set_at, COUNT(*) AS n FROM user_flags WHERE user_id = ? AND flag = ?',
    ['usr_flag_a', 'quest.embers.briefed'],
  );
  assert(row?.n === 1, `expected exactly one row, got ${row?.n}`);
  assert(row?.set_at === 1000, `expected the original set_at, got ${row?.set_at}`);
});

await test('flags are scoped per user', async () => {
  assert((await hasFlag('usr_flag_b', 'dialogue.elder.met')) === false, 'flag leaked across users');
});

await test('clearFlag removes only the named flag', async () => {
  await setFlag('usr_flag_a', 'dialogue.elder.gift');
  await clearFlag('usr_flag_a', 'dialogue.elder.gift');
  assert((await hasFlag('usr_flag_a', 'dialogue.elder.gift')) === false, 'flag survived clear');
  assert((await hasFlag('usr_flag_a', 'dialogue.elder.met')) === true, 'clear hit the wrong flag');
});

await test('listFlags returns this user only, sorted', async () => {
  await setFlag('usr_flag_b', 'zeta');
  await setFlag('usr_flag_b', 'alpha');
  const flags = await listFlags('usr_flag_b');
  assert(flags.join(',') === 'alpha,zeta', `unexpected list: ${flags.join(',')}`);
});

await test('clearFlagPrefix sweeps one namespace', async () => {
  await setFlag('usr_flag_a', 'dialogue.elder.seen_shrine');
  await clearFlagPrefix('usr_flag_a', 'dialogue.elder.');
  assert((await hasFlag('usr_flag_a', 'dialogue.elder.met')) === false, 'namespace not swept');
  assert((await hasFlag('usr_flag_a', 'quest.embers.briefed')) === true, 'sweep crossed namespaces');
});

await test('an underscore in the prefix is not treated as a LIKE wildcard', async () => {
  await setFlag('usr_flag_a', 'dialogue.elder_met.x');
  await setFlag('usr_flag_a', 'dialogue.elderXmet.x');
  await clearFlagPrefix('usr_flag_a', 'dialogue.elder_met.');
  assert((await hasFlag('usr_flag_a', 'dialogue.elder_met.x')) === false, 'literal prefix did not sweep');
  assert((await hasFlag('usr_flag_a', 'dialogue.elderXmet.x')) === true, '_ matched a wildcard and over-swept');
});

await test('a percent in the prefix is not treated as a LIKE wildcard', async () => {
  await setFlag('usr_flag_b', 'weird%ns.one');
  await setFlag('usr_flag_b', 'weirdZZns.two');
  await clearFlagPrefix('usr_flag_b', 'weird%ns.');
  assert((await hasFlag('usr_flag_b', 'weird%ns.one')) === false, 'literal percent did not sweep');
  assert((await hasFlag('usr_flag_b', 'weirdZZns.two')) === true, '% matched a wildcard and over-swept');
});

await test('deleting the user cascades their flags away', async () => {
  await run('DELETE FROM users WHERE id = ?', ['usr_flag_b']);
  const row = await one<{ readonly n: number }>(
    'SELECT COUNT(*) AS n FROM user_flags WHERE user_id = ?', ['usr_flag_b'],
  );
  assert(row?.n === 0, `expected the cascade to clear flags, ${row?.n} left`);
});

process.stdout.write(`flags tests: ${passed} passed, ${failed} failed\n`);
closeDb();
await closeDbAdapter();
process.exit(failed === 0 ? 0 : 1);
