/**
 * Player teams smoke test — the roster screen's saved lineups.
 *
 * Locks in the server-authoritative rules:
 *   - team limit 3 base, +2 while premium, +1 per purchased `itm-team-slot`
 *   - the ACTIVE team mirrors `player_roster.slot_index` 0..2 (the party)
 *     inside one transaction, so battle/matchmaking consumers never change
 *   - activation gates every member: owned, not downed, not market-listed,
 *     status resting|party; drafts (inactive team edits) allow pre-staging
 *   - duplicate mons in one team are rejected; deleting the active team
 *     releases the party slots
 *
 * Runs against the real SqliteAdapter (schema.sql + migrations, including
 * 108_player_teams) exactly as production boot wires it.
 *
 * Run: pnpm --filter @digiworld/backend test:teams
 */
import { existsSync, unlinkSync } from 'node:fs';

import { one, q, run, closeDb } from '../src/db/index.ts';
import { getDb, closeDbAdapter } from '../src/db/adapter.ts';
import { hashPassword } from '../src/auth/password.ts';
import { seedStarterRoster } from '../src/roster/routes.ts';
import { seedShopItems } from '../src/social/shop.ts';
import {
  activateTeam,
  createTeam,
  deleteTeam,
  grantTeamSlots,
  listTeams,
  renameTeam,
  setTeamMembers,
  teamLimitFor,
  BASE_TEAM_LIMIT,
  PREMIUM_TEAM_BONUS,
  MAX_TEAM_LIMIT,
  TEAM_SLOT_ITEM_ID,
} from '../src/teams/engine.ts';

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

async function insertUser(id: string, username: string): Promise<void> {
  const now = Date.now();
  const hash = await hashPassword('password-1234');
  await run(
    'INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [id, username, username, hash, 0, now, now],
  );
  await run(
    'INSERT INTO player_wallet (user_id, credits, netcore, updated_at) VALUES (?, 0, 0, ?)',
    [id, now],
  );
}

async function partyMonIds(userId: string): Promise<(string | null)[]> {
  const rows = await q<{ id: string; slot_index: number | null }>(
    'SELECT id, slot_index FROM player_roster WHERE user_id = ? AND slot_index IS NOT NULL ORDER BY slot_index',
    userId,
  );
  const out: (string | null)[] = [null, null, null];
  for (const r of rows) {
    if (r.slot_index !== null && r.slot_index >= 0 && r.slot_index < 3) out[r.slot_index] = r.id;
  }
  return out;
}

async function main(): Promise<void> {
  await getDb();
  await seedShopItems();

  const aliceId = 'usr_teams_alice';
  const bobId = 'usr_teams_bob';
  await insertUser(aliceId, 'alice_teams');
  await insertUser(bobId, 'bob_teams');

  const seeded = await seedStarterRoster(aliceId);
  check('alice got a 3-mon starter roster', seeded.seeded === 3, `seeded=${seeded.seeded}`);

  console.log('\n=== Shop item ===');
  const slotItem = await one<{ id: string; price_credits: number; kind: string; class: string }>(
    'SELECT id, price_credits, kind, class FROM shop_items WHERE id = ?',
    TEAM_SLOT_ITEM_ID,
  );
  check('itm-team-slot exists after seedShopItems', slotItem !== null);
  check('itm-team-slot costs 200 credits', slotItem?.price_credits === 200, `price=${slotItem?.price_credits}`);
  check('itm-team-slot is a purchasable product', slotItem?.class === 'product' && slotItem?.kind === 'team_slot');

  console.log('\n=== Limits ===');
  check('base limit is 3', (await teamLimitFor(aliceId)) === BASE_TEAM_LIMIT);
  check('bob base limit is 3', (await teamLimitFor(bobId)) === BASE_TEAM_LIMIT);

  console.log('\n=== Create / seed from party ===');
  const fresh = await listTeams(aliceId);
  check('fresh player has no teams', fresh.teams.length === 0);
  check('fresh response carries limit + premium + extraSlots', fresh.limit === 3 && fresh.premium === false && fresh.extraSlots === 0);

  const party = await partyMonIds(aliceId);
  check('alice has a full party from onboarding', party.every((id) => id !== null));

  const t1 = await createTeam(aliceId, { seedFromParty: true, name: 'Main' });
  check('create team seeded from party succeeds', t1.ok);
  if (t1.ok) {
    check('seeded team mirrors the party slots', JSON.stringify(t1.value.monIds) === JSON.stringify(party));
    check('new team starts inactive', t1.value.active === false);
    check('custom name kept', t1.value.name === 'Main');
  }
  const t2 = await createTeam(aliceId, {});
  check('create default-named team succeeds', t2.ok);
  if (t2.ok) {
    check('default name is "Time N"', t2.value.name.startsWith('Time ') && Number.isFinite(Number(t2.value.name.replace('Time ', ''))), t2.value.name);
  }
  await createTeam(aliceId, {});
  const atCap = await createTeam(aliceId, { name: '4th' });
  check('4th team rejected at base limit', atCap.ok === false && atCap.error === 'team-limit');

  console.log('\n=== Premium + purchased slots ===');
  await run('UPDATE player_wallet SET premium_until = ? WHERE user_id = ?', [Date.now() + 86_400_000, bobId]);
  check('premium limit is 3 + 2', (await teamLimitFor(bobId)) === BASE_TEAM_LIMIT + PREMIUM_TEAM_BONUS);
  await grantTeamSlots(bobId, 1);
  check('one purchased slot adds +1 (premium)', (await teamLimitFor(bobId)) === BASE_TEAM_LIMIT + PREMIUM_TEAM_BONUS + 1);
  await grantTeamSlots(bobId, 8);
  check('limit is capped at MAX_TEAM_LIMIT', (await teamLimitFor(bobId)) === MAX_TEAM_LIMIT);
  const bobView = await listTeams(bobId);
  check('response exposes premium + extraSlots', bobView.premium === true && bobView.extraSlots === 9 && bobView.limit === MAX_TEAM_LIMIT);

  console.log('\n=== Members (draft) ===');
  const draft = await createTeam(aliceId, {});
  const draftId = draft.ok ? draft.value.id : '';
  const swap = party[0]!;
  if (draftId) {
    const setDraft = await setTeamMembers(aliceId, draftId, [swap, null, null]);
    check('draft edit accepts a partial lineup', setDraft.ok);
    const dup = await setTeamMembers(aliceId, draftId, [swap, swap, null]);
    check('duplicate mon in one team rejected', dup.ok === false && dup.error === 'duplicate-mon');
    const alien = await setTeamMembers(aliceId, draftId, ['mon_not_yours', null, null]);
    check('non-owned mon rejected even in a draft', alien.ok === false && alien.error === 'not-owned');
    // Draft capacity: alice is now at 4 teams (3 + this draft). Creating a
    // 5th must fail — the draft team still counts toward the limit.
    const fifth = await createTeam(aliceId, {});
    check('team count includes drafts', fifth.ok === false && fifth.error === 'team-limit');
  }

  console.log('\n=== Activate ===');
  const act = await activateTeam(aliceId, t1.ok ? t1.value.id : '');
  check('activate full team succeeds', act.ok);
  const afterParty = await partyMonIds(aliceId);
  check('party mirrors the active team', JSON.stringify(afterParty) === JSON.stringify(party));
  const teamsAfter = await listTeams(aliceId);
  const activeCount = teamsAfter.teams.filter((t) => t.active).length;
  check('exactly one active team', activeCount === 1);
  check('t1 is the active team', teamsAfter.teams.find((t) => t.id === (t1.ok ? t1.value.id : ''))?.active === true);

  const busyId = party[1]!;
  // Training flow clears the mon from its party slot before the session starts.
  await run('UPDATE player_roster SET status = \'training\', slot_index = NULL WHERE id = ?', [busyId]);
  const t2Id = t2.ok ? t2.value.id : '';
  const staged = await setTeamMembers(aliceId, t2Id, [party[0]!, busyId, party[2]!]);
  check('draft edit accepts a training mon (no availability gate)', staged.ok);
  const busyAct = await activateTeam(aliceId, t2Id);
  check('activate rejected when a member is training', busyAct.ok === false && busyAct.error === 'member-unavailable');
  const partyStill = await partyMonIds(aliceId);
  check('failed activation leaves the party untouched', JSON.stringify(partyStill) === JSON.stringify([party[0], null, party[2]]));
  // Restore the original party for the next section.
  await run('UPDATE player_roster SET status = \'party\', slot_index = 1 WHERE id = ?', [busyId]);

  console.log('\n=== Active-team edit re-syncs the party ===');
  if (t1.ok && party[2]) {
    const swapped = await setTeamMembers(aliceId, t1.value.id, [party[2], party[1], party[0]]);
    check('active team member edit succeeds', swapped.ok);
    const mirrored = await partyMonIds(aliceId);
    check('party re-synced to the edited lineup', JSON.stringify(mirrored) === JSON.stringify([party[2], party[1], party[0]]));
  }

  console.log('\n=== Rename / delete ===');
  const renamed = await renameTeam(aliceId, t1.ok ? t1.value.id : '', '  First Team  ');
  check('rename trims and applies', renamed.ok && renamed.value.name === 'First Team');
  const emptyName = await renameTeam(aliceId, t1.ok ? t1.value.id : '', '   ');
  check('blank rename rejected', emptyName.ok === false && emptyName.error === 'invalid-name');

  const del = await deleteTeam(aliceId, t1.ok ? t1.value.id : '');
  check('delete active team succeeds', del.ok);
  const partyAfterDel = await partyMonIds(aliceId);
  check('deleting the active team releases the party slots', partyAfterDel.every((id) => id === null));
  const delMissing = await deleteTeam(aliceId, 'team_nope');
  check('deleting a missing team is 404', delMissing.ok === false && delMissing.error === 'not-found');

  console.log('\n=== Isolation (bob unaffected) ===');
  const bobTeams = await listTeams(bobId);
  check('bob has no teams', bobTeams.teams.length === 0);
  const bobAlien = await setTeamMembers(bobId, t1.ok ? t1.value.id : '', [party[0]!, null, null]);
  check('cannot edit another user\'s team', bobAlien.ok === false && bobAlien.error === 'not-found');

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