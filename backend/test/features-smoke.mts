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

import { one, q, run, closeDb } from '../src/db/index.ts';
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
import { matchmaker, resetMatchmaking, type QueueEntry } from '../src/matchmaking/queue.ts';
import { seedStarterRoster } from '../src/roster/routes.ts';
import { createBattleForPair, dispatchAction } from '../src/battle/routes.ts';
import { addPendingBuff } from '../src/social/buffs.ts';

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

    const b1 = await initBattle({ loadoutA, loadoutB, damageRate: 1.0 });
    const b2 = await initBattle({ loadoutA, loadoutB, damageRate: 2.0 });
    const b3 = await initBattle({ loadoutA, loadoutB });
    check('initBattle stores damageRate=1.0 when passed', b1.damageRate === 1.0);
    check('initBattle stores damageRate=2.0 when passed', b2.damageRate === 2.0);
    check('initBattle defaults damageRate to 1.0 when omitted', b3.damageRate === 1.0);
  }

  console.log('\n=== matchmaking training-tier gate ===');
  {
    await resetMatchmaking();
    const now = Date.now();
    const untrained: QueueEntry = { userId: 'usr_mm_untr', displayName: 'Untr', averageLevel: 40, trainedness: 0,   queuedAt: now };
    const trained:   QueueEntry = { userId: 'usr_mm_trnd', displayName: 'Trnd', averageLevel: 40, trainedness: 8000, queuedAt: now };

    check('enqueue untrained', (await matchmaker.enqueue(untrained)) === 'queued');
    check('enqueue trained', (await matchmaker.enqueue(trained)) === 'queued');

    const noPair = await matchmaker.tryPair();
    check('mismatched trainedness (0 vs 8000) blocks fresh pair (bracket=1000)', noPair === null);
    check('both entries still queued after failed pair', (await matchmaker.size()) === 2);

    await matchmaker.dequeue(untrained.userId);
    await matchmaker.dequeue(trained.userId);

    const past = now - 60_000;
    const oldUntr: QueueEntry = { ...untrained, queuedAt: past };
    const oldTrnd: QueueEntry = { ...trained,   queuedAt: past };
    await matchmaker.enqueue(oldUntr);
    await matchmaker.enqueue(oldTrnd);

    const paired = await matchmaker.tryPair();
    check('after 60s wait, bracket saturates at 10000 and allows the mismatched pair', paired !== null);
    if (paired !== null) {
      check('pair returns both users', paired.a.userId !== paired.b.userId);
    }
    check('queue is empty after successful pair', (await matchmaker.size()) === 0);

    await resetMatchmaking();
    const closeA: QueueEntry = { userId: 'usr_mm_ca', displayName: 'A', averageLevel: 40, trainedness: 400, queuedAt: now };
    const closeB: QueueEntry = { userId: 'usr_mm_cb', displayName: 'B', averageLevel: 40, trainedness: 450, queuedAt: now };
    await matchmaker.enqueue(closeA);
    await matchmaker.enqueue(closeB);
    const closePair = await matchmaker.tryPair();
    check('similar trainedness (50 gap ≤ 1000 bracket) pairs immediately', closePair !== null);

    await resetMatchmaking();
  }

  console.log('\n=== PvP pair → createBattleForPair (parallel tx race) ===');
  {
    // Regression lock for commit 3b37a23: applyPreBattleBuffs was converted
    // to Promise.all(consumePreBattleBuffs) at match start. Each leg opens
    // its own tx(); the SQLite adapter has ONE synchronous connection so
    // three concurrent BEGIN IMMEDIATEs threw SQLITE_ERROR and killed the
    // process on the first live PvP pair. Fixed by the txTail serializer in
    // sqlite.ts. This test seeds two real parties, adds pending buffs so the
    // tx does real work, then calls createBattleForPair — the same path
    // runPairing hits — and asserts a battle materializes.
    const seedA = await seedStarterRoster(aliceId);
    check('alice starter seeded', seedA.seeded === 3);
    const seedB = await seedStarterRoster(bobId);
    check('bob starter seeded', seedB.seeded === 3);

    const partyA = await q<{ id: string }>(
      "SELECT id FROM player_roster WHERE user_id = ? AND status = 'party' ORDER BY slot_index", aliceId);
    const partyB = await q<{ id: string }>(
      "SELECT id FROM player_roster WHERE user_id = ? AND status = 'party' ORDER BY slot_index", bobId);
    check('alice party has 3 rows', partyA.length === 3);
    check('bob party has 3 rows', partyB.length === 3);

    for (const row of partyA) {
      await addPendingBuff({ userId: aliceId, monId: row.id, effectKind: 'hp_pct', magnitude: 0.10 });
    }
    for (const row of partyB) {
      await addPendingBuff({ userId: bobId, monId: row.id, effectKind: 'en_pct', magnitude: 0.15 });
    }

    const result = await createBattleForPair(aliceId, bobId);
    check('createBattleForPair returned ok=true (no SQLITE_ERROR crash)', result.ok === true);
    if (result.ok) {
      check('viewA has 3 friendly units', result.viewA.friendly.length === 3);
      check('viewB has 3 friendly units', result.viewB.friendly.length === 3);
      check('viewA and viewB share the same matchId', result.viewA.id === result.viewB.id);
      check('viewA yourSide=a', result.viewA.yourSide === 'a');
      check('viewB yourSide=b', result.viewB.yourSide === 'b');
      check('battle status is active', result.viewA.status === 'active');
    }

    const consumedA = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM pending_buffs WHERE user_id = ? AND consumed_at IS NOT NULL", aliceId);
    const consumedB = await one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM pending_buffs WHERE user_id = ? AND consumed_at IS NOT NULL", bobId);
    check('all 3 alice pending_buffs consumed', consumedA?.n === 3);
    check('all 3 bob pending_buffs consumed', consumedB?.n === 3);
  }

  console.log('\n=== PvP full battle to KO — MMR + credits + Bits + matches row + snap cleanup ===');
  {
    // Fresh users so previous section's active battle state doesn't collide.
    // The battle runs with Math.random frozen at 0.5, which is above the miss
    // threshold (0.08) and crit threshold (0.15), so every hit lands as a
    // non-crit at 1.0× variance — one variable in the flow, deterministic
    // termination, and every persistence + reward + cluster-cleanup path fires.
    const charlieId = 'usr_charlie_smoke';
    const daveId = 'usr_dave_smoke';
    await insertUser(charlieId, 'charlie_smoke', 'password-charlie-1');
    await insertUser(daveId, 'dave_smoke', 'password-dave-1');
    await seedStarterRoster(charlieId);
    await seedStarterRoster(daveId);

    const create = await createBattleForPair(charlieId, daveId);
    if (!create.ok) throw new Error('createBattleForPair failed: ' + create.error);
    const matchId = create.matchId;

    const originalRandom = Math.random;
    Math.random = () => 0.5;

    let viewA = create.viewA;
    let viewB = create.viewB;
    let ended = false;
    let totalActions = 0;
    const MAX_ACTIONS = 300;
    try {
      while (!ended && totalActions < MAX_ACTIONS) {
        const activeView = viewA.activeSide === 'a' ? viewA : viewB;
        const actingUserId = viewA.activeSide === 'a' ? charlieId : daveId;
        const unitId = activeView.currentTurnUnitId;
        if (!unitId) break;
        const target = activeView.enemy.find((u) => !u.down);
        if (!target) break;
        const result = await dispatchAction(actingUserId, matchId, { type: 'fight', unitId, targetId: target.id });
        if (!result.ok) throw new Error(`dispatchAction failed at action ${totalActions}: ${result.error}`);
        viewA = result.viewA;
        viewB = result.viewB;
        ended = result.ended;
        totalActions++;
      }
    } finally {
      Math.random = originalRandom;
    }

    check('battle ended within action cap', ended, `actions=${totalActions}`);
    check('viewA.status === ended', viewA.status === 'ended');
    check('viewB.status === ended', viewB.status === 'ended');
    check('outcome present', viewA.outcome !== null);
    check('viewA and viewB agree on outcome', viewA.outcome === viewB.outcome);
    check('viewA and viewB agree on winner', viewA.winner === viewB.winner);
    const outcomeOk = viewA.outcome === 'win_a' || viewA.outcome === 'win_b' || viewA.outcome === 'draw';
    check('outcome is win_a | win_b | draw', outcomeOk, `outcome=${viewA.outcome}`);

    type EndEvt = { type: 'end'; pvpMmr?: { before: number; after: number; delta: number } };
    const endEvtA = viewA.log.find((e) => e.type === 'end') as EndEvt | undefined;
    const endEvtB = viewB.log.find((e) => e.type === 'end') as EndEvt | undefined;
    check('viewA end event carries pvpMmr', endEvtA?.pvpMmr !== undefined);
    check('viewB end event carries pvpMmr', endEvtB?.pvpMmr !== undefined);
    const deltaA = endEvtA!.pvpMmr!.delta;
    const deltaB = endEvtB!.pvpMmr!.delta;
    // computeMmrDelta is quality-weighted (winner HP × speed), not vanilla ELO.
    // The winner's delta and loser's delta are RECIPROCAL through the quality
    // factor, so |deltaA| + |deltaB| is only symmetric when winQuality×speed=1.
    // The invariant that ALWAYS holds: each delta is bounded by K_FACTOR × 2.5
    // (max quality bound) × 0.5 (score gap) = 40, and the sign of each side
    // matches its outcome.
    check('|deltaA| bounded (≤ 40)', Math.abs(deltaA) <= 40, `dA=${deltaA}`);
    check('|deltaB| bounded (≤ 40)', Math.abs(deltaB) <= 40, `dB=${deltaB}`);
    const signOk =
      viewA.outcome === 'win_a' ? deltaA > 0 && deltaB < 0 :
      viewA.outcome === 'win_b' ? deltaA < 0 && deltaB > 0 :
      deltaA === 0 && deltaB === 0;
    check('MMR delta sign matches outcome', signOk, `outcome=${viewA.outcome} dA=${deltaA} dB=${deltaB}`);

    const matchRow = await one<{ id: string; player_a: string; player_b: string; winner: string | null; outcome: string; rounds: number }>(
      'SELECT id, player_a, player_b, winner, outcome, rounds FROM matches WHERE id = ?', matchId);
    check('matches row inserted', matchRow !== null);
    check('matches.player_a === charlie', matchRow?.player_a === charlieId);
    check('matches.player_b === dave', matchRow?.player_b === daveId);
    check('matches.outcome === viewA.outcome', matchRow?.outcome === viewA.outcome);
    check('matches.rounds > 0', (matchRow?.rounds ?? 0) > 0);
    const expectedWinnerId = viewA.outcome === 'win_a' ? charlieId : viewA.outcome === 'win_b' ? daveId : null;
    check('matches.winner correct', matchRow?.winner === expectedWinnerId);

    const mmrC = await one<{ mmr: number }>('SELECT mmr FROM users WHERE id = ?', charlieId);
    const mmrD = await one<{ mmr: number }>('SELECT mmr FROM users WHERE id = ?', daveId);
    check('users.mmr(charlie) matches endEvtA.after', mmrC?.mmr === endEvtA!.pvpMmr!.after);
    check('users.mmr(dave) matches endEvtB.after', mmrD?.mmr === endEvtB!.pvpMmr!.after);

    const winnerId = viewA.outcome === 'win_a' ? 'a' : viewA.outcome === 'win_b' ? 'b' : null;
    const expectedCredsC = winnerId === null ? 25 : winnerId === 'a' ? 60 : 15;
    const expectedCredsD = winnerId === null ? 25 : winnerId === 'b' ? 60 : 15;
    const wallC = await one<{ netcore: number }>('SELECT netcore FROM player_wallet WHERE user_id = ?', charlieId);
    const wallD = await one<{ netcore: number }>('SELECT netcore FROM player_wallet WHERE user_id = ?', daveId);
    check(`charlie netcore=${expectedCredsC}`, wallC?.netcore === expectedCredsC, `got=${wallC?.netcore}`);
    check(`dave netcore=${expectedCredsD}`, wallD?.netcore === expectedCredsD, `got=${wallD?.netcore}`);

    const expectedBitsC = winnerId === null ? 15 : winnerId === 'a' ? 30 : 5;
    const expectedBitsD = winnerId === null ? 15 : winnerId === 'b' ? 30 : 5;
    const bitsC = await one<{ amount: number }>("SELECT amount FROM resources WHERE user_id = ? AND resource = 'Bits'", charlieId);
    const bitsD = await one<{ amount: number }>("SELECT amount FROM resources WHERE user_id = ? AND resource = 'Bits'", daveId);
    check(`charlie Bits=${expectedBitsC}`, bitsC?.amount === expectedBitsC, `got=${bitsC?.amount}`);
    check(`dave Bits=${expectedBitsD}`, bitsD?.amount === expectedBitsD, `got=${bitsD?.amount}`);

    const cluster = await getCluster();
    check('battle:snap:{matchId} deleted', (await cluster.get(`battle:snap:${matchId}`)) === null);
    check('battle:user:{charlie} deleted', (await cluster.get(`battle:user:${charlieId}`)) === null);
    check('battle:user:{dave} deleted', (await cluster.get(`battle:user:${daveId}`)) === null);

    console.log(`  info: fought ${totalActions} actions across ${viewA.round} round(s), outcome=${viewA.outcome}, deltaA=${deltaA} deltaB=${deltaB}`);
  }

  console.log('\n=== PvP flee end path — outcome=fled_*, fler=0 credits, non-fler wins credits+MMR ===');
  {
    const eveId = 'usr_eve_smoke';
    const frankId = 'usr_frank_smoke';
    await insertUser(eveId, 'eve_smoke', 'password-eve-1');
    await insertUser(frankId, 'frank_smoke', 'password-frank-1');
    await seedStarterRoster(eveId);
    await seedStarterRoster(frankId);

    const create = await createBattleForPair(eveId, frankId);
    if (!create.ok) throw new Error('createBattleForPair failed: ' + create.error);
    const matchId = create.matchId;

    // Whichever side is active on turn 1 flees. Not deterministic which side.
    const flerSide = create.viewA.activeSide;
    const flerId = flerSide === 'a' ? eveId : frankId;
    const nonFlerId = flerSide === 'a' ? frankId : eveId;

    const result = await dispatchAction(flerId, matchId, { type: 'flee' });
    check('flee accepted', result.ok);
    if (!result.ok) throw new Error('flee failed: ' + result.error);
    check('battle ended in one action', result.ended === true);
    const expectedOutcome = flerSide === 'a' ? 'fled_a' : 'fled_b';
    check(`outcome === ${expectedOutcome}`, result.viewA.outcome === expectedOutcome);
    check('viewA and viewB agree on outcome', result.viewA.outcome === result.viewB.outcome);

    const matchRow = await one<{ outcome: string; winner: string | null }>(
      'SELECT outcome, winner FROM matches WHERE id = ?', matchId);
    check('matches.outcome persisted', matchRow?.outcome === expectedOutcome);
    check('matches.winner is the non-fler', matchRow?.winner === nonFlerId);

    // Fler's wallet row was never created (0 netcore award skips the upsert).
    const flerWall = await one<{ netcore: number }>('SELECT netcore FROM player_wallet WHERE user_id = ?', flerId);
    const nonFlerWall = await one<{ netcore: number }>('SELECT netcore FROM player_wallet WHERE user_id = ?', nonFlerId);
    check('fler wallet not credited (row absent or netcore=0)', flerWall === null || flerWall.netcore === 0, `netcore=${flerWall?.netcore}`);
    check('non-fler netcore = 60 (win)', nonFlerWall?.netcore === 60, `got=${nonFlerWall?.netcore}`);

    const flerBits = await one<{ amount: number }>("SELECT amount FROM resources WHERE user_id = ? AND resource = 'Bits'", flerId);
    const nonFlerBits = await one<{ amount: number }>("SELECT amount FROM resources WHERE user_id = ? AND resource = 'Bits'", nonFlerId);
    check('fler Bits not credited', flerBits === null || flerBits.amount === 0, `got=${flerBits?.amount}`);
    check('non-fler Bits = 30 (win)', nonFlerBits?.amount === 30, `got=${nonFlerBits?.amount}`);

    const flerMmr = await one<{ mmr: number }>('SELECT mmr FROM users WHERE id = ?', flerId);
    const nonFlerMmr = await one<{ mmr: number }>('SELECT mmr FROM users WHERE id = ?', nonFlerId);
    check('fler MMR decreased from 1000', (flerMmr?.mmr ?? 1000) < 1000, `mmr=${flerMmr?.mmr}`);
    check('non-fler MMR increased from 1000', (nonFlerMmr?.mmr ?? 1000) > 1000, `mmr=${nonFlerMmr?.mmr}`);

    const cluster = await getCluster();
    check('battle:snap deleted after flee', (await cluster.get(`battle:snap:${matchId}`)) === null);
    check('battle:user:{fler} deleted', (await cluster.get(`battle:user:${flerId}`)) === null);
    check('battle:user:{non-fler} deleted', (await cluster.get(`battle:user:${nonFlerId}`)) === null);

    console.log(`  info: side-${flerSide} fled, non-fler MMR = ${nonFlerMmr?.mmr}`);
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
