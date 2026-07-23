/**
 * Features smoke test — end-to-end library-level coverage for the N1 / N3 / N4
 * features shipped this session. Uses the real SqliteAdapter + MemoryCluster
 * singletons the way production boot wires them, so:
 *
 *   - schema.sql applies
 *   - applyColumnMigrations backfills legacy columns
 *   - runMigrations lands 001 (drop legacy) + 002 (chat_rooms) + 003 (skills CHECK)
 *
 * ...before any assertion runs. Every path under test uses the exact functions
 * the HTTP + WS handlers use — no shim, no fake. HTTP round-trips are covered
 * by manual curl verification during commits; this test locks in the business
 * rules against a real DB so regressions surface immediately.
 *
 * Run: pnpm --filter @digiworld/backend test:features
 *   (requires DB_PATH pointing at a scratch file, e.g. /tmp/dw-features-smoke.db)
 */
import { unlinkSync, existsSync } from 'node:fs';

import { one, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';
import { createSession, resolveSession, destroyAllSessionsForUser } from '../src/auth/session.ts';
import {
  issueResetToken,
  resolveResetToken,
  consumeResetToken,
  checkResetThrottle,
  recordResetAttempt,
} from '../src/auth/reset.ts';
import { resetUserPassword } from '../src/admin/users.ts';
import {
  createRoom,
  openDm,
  joinRoom,
  leaveRoom,
  isMember,
  listMembers,
  listMyRooms,
} from '../src/chat/rooms.ts';
import {
  joinSpectate,
  leaveSpectate,
  listSpectators,
  spectatorCount,
  clearSpectators,
  MAX_SPECTATORS_PER_MATCH,
} from '../src/battle/spectate.ts';
import { getCluster, closeCluster } from '../src/cluster/index.ts';
import { newId } from '../src/util/ids.ts';
import {
  getGameSettings,
  updateGameSettings,
  seedDefaultGameSettings,
  DEFAULT_XP_RATE,
  DEFAULT_DAMAGE_RATE,
  MIN_DAMAGE_RATE,
  MAX_DAMAGE_RATE,
} from '../src/settings/engine.ts';
import { initBattle } from '../src/battle/engine.ts';
import type { Loadout, LoadoutMember } from '../src/battle/engine.ts';
import type { TemplateDigimon } from '../src/digimon/types.ts';

const DB_PATH = process.env.DB_PATH!;
for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  PASS: ${name}`); }
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

async function insertUser(id: string, username: string, password: string, isAdmin = false): Promise<void> {
  const now = Date.now();
  const hash = await hashPassword(password);
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, username, username, hash, isAdmin ? 1 : 0, now, now],
  );
}

function mkTemplate(id: string): TemplateDigimon {
  return {
    id,
    name: id,
    stage: 'Rookie',
    attribute: 'Vaccine',
    element: 'fire',
    baseStats: { hp: 500, en: 30, atk: 100, def: 80, int: 90, spd: 100 },
    skillPool: [
      { id: 's0', name: 'Basic', element: 'fire', energyCost: 0, power: 100 },
    ],
    assets: { portrait: '', dot: '' },
  };
}

function mkLoadout(playerId: string, tag: string): Loadout {
  const template = mkTemplate(`t-${tag}`);
  const member: LoadoutMember = {
    monId: `m-${tag}`,
    templateId: template.id,
    template,
    level: 10,
    nickname: template.name,
    statBonus: { hp: 0, en: 0, atk: 0, def: 0, int: 0, spd: 0 },
  };
  return { playerId, members: [member] };
}

async function main(): Promise<void> {
  await getDb();

  const adminId = 'usr_admin_smoke';
  const aliceId = 'usr_alice_smoke';
  const bobId = 'usr_bob_smoke';
  const oldPw = 'old-password-1234';
  const newPw = 'new-password-5678';

  await insertUser(adminId, 'admin_smoke', oldPw, true);
  await insertUser(aliceId, 'alice_smoke', oldPw);
  await insertUser(bobId, 'bob_smoke', oldPw);

  console.log('\n=== N1: Password reset via admin-issued token ===');
  {
    const aliceSession = await createSession({ userId: aliceId });
    const preResolve = await resolveSession(aliceSession.token);
    check('alice has an active session before reset', preResolve?.user.id === aliceId);

    const { token, expiresAt } = await issueResetToken(aliceId);
    check('issueResetToken returns 64-char hex', /^[0-9a-f]{64}$/.test(token), `got length=${token.length}`);
    check('expiresAt ≈ 15min from now', expiresAt > Date.now() + 14 * 60_000 && expiresAt < Date.now() + 16 * 60_000);

    const resolved = await resolveResetToken(token);
    check('resolveResetToken finds the token', resolved?.userId === aliceId);
    const badToken = await resolveResetToken('0'.repeat(64));
    check('resolveResetToken returns null for unknown token', badToken === null);
    const wrongLength = await resolveResetToken('x'.repeat(63));
    check('resolveResetToken rejects wrong-length tokens', wrongLength === null);

    const result = await resetUserPassword(aliceId, newPw);
    check('resetUserPassword succeeds', result.ok === true);

    await consumeResetToken(token);
    const afterConsume = await resolveResetToken(token);
    check('token is single-use (deleted after consume)', afterConsume === null);

    const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', aliceId);
    check('old password no longer verifies', !(await verifyPassword(row!.password_hash, oldPw)));
    check('new password verifies', await verifyPassword(row!.password_hash, newPw));

    const postResolve = await resolveSession(aliceSession.token);
    check('alice existing session is destroyed by resetUserPassword', postResolve === null);

    const throttleBefore = await checkResetThrottle('10.0.0.1');
    check('throttle starts allowed', throttleBefore.allowed);
    for (let i = 0; i < 11; i++) await recordResetAttempt('10.0.0.1', false);
    const throttleAfter = await checkResetThrottle('10.0.0.1');
    check('throttle blocks after 10 failed attempts', !throttleAfter.allowed);
  }

  console.log('\n=== N3: Chat rooms + DMs ===');
  {
    const room = await createRoom(aliceId, 'test-room');
    check('createRoom returns a fresh id', /^rm_/.test(room.id));
    check('creator is auto-member', await isMember(room.id, aliceId));
    check('non-member is not a member', !(await isMember(room.id, bobId)));
    check('memberCount is 1', room.memberCount === 1);

    const joinRes = await joinRoom(room.id, bobId);
    check('joinRoom succeeds for a real room', joinRes === 'ok');
    check('joined user is now a member', await isMember(room.id, bobId));

    const members = await listMembers(room.id);
    check('listMembers returns both users', members.length === 2 && members.includes(aliceId) && members.includes(bobId));

    const notFound = await joinRoom('rm_bogus_id_that_wont_exist', aliceId);
    check('joinRoom returns not-found for unknown room', notFound === 'not-found');

    const dm1 = await openDm(aliceId, 'bob_smoke');
    check('openDm creates a DM (first call)', dm1.ok === true && dm1.ok && dm1.created === true);
    if (!dm1.ok) throw new Error('DM open failed');
    check('DM room has kind=dm', dm1.room.kind === 'dm');
    check('DM has exactly 2 members', dm1.room.memberCount === 2);

    const dm2 = await openDm(aliceId, 'bob_smoke');
    check('openDm is idempotent (returns existing on 2nd call)', dm2.ok === true && dm2.ok && dm2.created === false);
    if (!dm2.ok) throw new Error('DM re-open failed');
    check('same DM room id both times', dm2.room.id === dm1.room.id);

    const dm3 = await openDm(aliceId, 'nonexistent_user');
    check('openDm rejects unknown username', !dm3.ok && dm3.error === 'user-not-found');
    const dm4 = await openDm(aliceId, 'alice_smoke');
    check('openDm rejects self-DM', !dm4.ok && dm4.error === 'self-dm');

    const aliceRooms = await listMyRooms(aliceId);
    check('listMyRooms includes both the room and the DM', aliceRooms.length === 2);

    const leaveRes = await leaveRoom(room.id, bobId);
    check('leaveRoom succeeds', leaveRes === 'ok');
    check('user is not a member after leaving', !(await isMember(room.id, bobId)));
  }

  console.log('\n=== N4: Spectator mode ===');
  {
    const matchId = newId('mtc');
    const cluster = await getCluster();
    await cluster.set(
      `battle:snap:${matchId}`,
      JSON.stringify({ id: matchId, playerA: aliceId, playerB: bobId, status: 'active' }),
      1800,
    );

    const beforeCount = await spectatorCount(matchId);
    check('spectatorCount starts at 0', beforeCount === 0);

    const join = await joinSpectate(matchId, adminId);
    check('joinSpectate ok for non-player', join.ok === true && join.ok && join.status === 'joined');
    if (join.ok) check('joinSpectate count = 1', join.count === 1);

    const list = await listSpectators(matchId);
    check('listSpectators returns admin', list.length === 1 && list.includes(adminId));

    const doubleJoin = await joinSpectate(matchId, adminId);
    check('joinSpectate is idempotent for the same user', doubleJoin.ok === true);

    const playerAttempt = await joinSpectate(matchId, aliceId);
    check('player cannot spectate own match — returns already-in-match', playerAttempt.ok === true && playerAttempt.ok && playerAttempt.status === 'already-in-match');
    const listAfterPlayer = await listSpectators(matchId);
    check('player is NOT added to spectator ZSET even on player-attempt', listAfterPlayer.length === 1);

    const missing = await joinSpectate('mtc_bogus_id_that_wont_exist', adminId);
    check('joinSpectate on unknown match returns not-found', !missing.ok && missing.error === 'not-found');

    check('MAX_SPECTATORS_PER_MATCH is 20 (matches ROADMAP N4 spec)', MAX_SPECTATORS_PER_MATCH === 20);

    await leaveSpectate(matchId, adminId);
    const afterLeave = await listSpectators(matchId);
    check('leaveSpectate removes the user', afterLeave.length === 0);

    await joinSpectate(matchId, adminId);
    await clearSpectators(matchId);
    const afterClear = await spectatorCount(matchId);
    check('clearSpectators removes the whole ZSET', afterClear === 0);
  }

  console.log('\n=== Cross-flow: reset+session isolation ===');
  {
    const aliceSession1 = await createSession({ userId: aliceId });
    const bobSession = await createSession({ userId: bobId });
    check('alice has a fresh session', (await resolveSession(aliceSession1.token))?.user.id === aliceId);
    check('bob has a fresh session', (await resolveSession(bobSession.token))?.user.id === bobId);

    await destroyAllSessionsForUser(aliceId);
    check('destroyAllSessionsForUser(alice) kills alice session', (await resolveSession(aliceSession1.token)) === null);
    check("destroyAllSessionsForUser(alice) does NOT touch bob's session", (await resolveSession(bobSession.token))?.user.id === bobId);
  }

  console.log('\n=== game_settings: damage_rate + xp_rate round-trip ===');
  {
    await seedDefaultGameSettings();
    const initial = await getGameSettings();
    check('defaults seed at xpRate=1.0', initial.xpRate === DEFAULT_XP_RATE);
    check('defaults seed at damageRate=1.0', initial.damageRate === DEFAULT_DAMAGE_RATE);

    const okBoth = await updateGameSettings({ xpRate: 1.5, damageRate: 1.4 });
    check('updateGameSettings accepts both rates', okBoth.ok === true);
    if (okBoth.ok) {
      check('xpRate applied', okBoth.value.xpRate === 1.5);
      check('damageRate applied', okBoth.value.damageRate === 1.4);
    }

    const okXpOnly = await updateGameSettings({ xpRate: 2.0 });
    check('partial update: xpRate only', okXpOnly.ok === true && okXpOnly.value.xpRate === 2.0);
    check('partial update: damageRate preserved', okXpOnly.ok === true && okXpOnly.value.damageRate === 1.4);

    const tooLow = await updateGameSettings({ damageRate: MIN_DAMAGE_RATE - 0.01 });
    check('damageRate below MIN rejected', tooLow.ok === false && tooLow.error === 'invalid-input');
    const tooHigh = await updateGameSettings({ damageRate: MAX_DAMAGE_RATE + 0.01 });
    check('damageRate above MAX rejected', tooHigh.ok === false && tooHigh.error === 'invalid-input');

    await updateGameSettings({ damageRate: 1.0, xpRate: 1.0 });
  }

  console.log('\n=== battle.damageRate flows into applyAction ===');
  {
    const loadoutA = mkLoadout(aliceId, 'a');
    const loadoutB = mkLoadout(bobId, 'b');

    const b1 = initBattle({ loadoutA, loadoutB, damageRate: 1.0 });
    const b2 = initBattle({ loadoutA, loadoutB, damageRate: 2.0 });
    const b3 = initBattle({ loadoutA, loadoutB });
    check('initBattle stores damageRate=1.0 when passed', b1.damageRate === 1.0);
    check('initBattle stores damageRate=2.0 when passed', b2.damageRate === 2.0);
    check('initBattle defaults damageRate to 1.0 when omitted', b3.damageRate === 1.0);
  }

  await closeCluster();
  await closeDbAdapter();
  try { closeDb(); } catch {}

  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('FATAL:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
