/**
 * Player teams: saved 3-slot lineups on the roster screen.
 *
 *   GET    /api/teams            → { teams, limit, premium, extraSlots }
 *   POST   /api/teams            → create { name?, seedFromParty? }
 *   POST   /api/teams/:id/rename → { name }
 *   PUT    /api/teams/:id/members→ { monIds: (string|null)[3] }
 *   POST   /api/teams/:id/activate → mirror the team into the party slots
 *   DELETE /api/teams/:id
 *
 * Model rules:
 *   - A team is a reference to 3 OWNED digimon (player_roster ids, nullable
 *     while drafting). The same mon may sit in several teams.
 *   - The ACTIVE team is the party: its members are mirrored into
 *     player_roster.status='party' + slot_index 0..2, which is exactly what
 *     `loadPartyLoadout` / matchmaking / the lobby scene consume. Activating a
 *     team clears the previous party, so battle never has to change.
 *   - Limit: 3 base (+2 while Premium) + purchased extra slots
 *     (`itm-team-slot`, 200cr each, applied via `grantTeamSlots`).
 *   - Draft edits to a non-active team never touch the party. Editing or
 *     activating the active team re-validates every member (owned, not
 *     downed, not market-listed, status resting|party) and re-syncs slots.
 */
import { one, q, run, tx } from '../db/index.js';
import { PARTY_SIZE } from '../digimon/types.js';
import { isUserPremium } from '../premium/index.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

// ============================================================================
// Constants
// ============================================================================

export const BASE_TEAM_LIMIT = 3;
/** Flat bonus while premium: 3 → 5 total. */
export const PREMIUM_TEAM_BONUS = 2;
/** Sanity cap so a single account cannot buy unbounded slots. */
export const MAX_TEAM_LIMIT = 12;
export const TEAM_NAME_MAX = 24;
export const TEAM_SLOT_ITEM_ID = 'itm-team-slot';

// ============================================================================
// SQL
// ============================================================================

const SQL_SELECT_TEAMS = `SELECT * FROM player_teams WHERE user_id = ? ORDER BY created_at, id`;
const SQL_SELECT_TEAM = `SELECT * FROM player_teams WHERE id = ? AND user_id = ?`;
const SQL_INSERT_TEAM = `INSERT INTO player_teams (id, user_id, name, mon_1_id, mon_2_id, mon_3_id, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`;
const SQL_UPDATE_NAME = `UPDATE player_teams SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_UPDATE_MEMBERS = `UPDATE player_teams SET mon_1_id = ?, mon_2_id = ?, mon_3_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_DELETE_TEAM = `DELETE FROM player_teams WHERE id = ? AND user_id = ?`;
const SQL_CLEAR_ACTIVE = `UPDATE player_teams SET active = 0 WHERE user_id = ?`;
const SQL_SET_ACTIVE = `UPDATE player_teams SET active = 1, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_SELECT_WALLET = `SELECT extra_team_slots, premium_until FROM player_wallet WHERE user_id = ?`;
const SQL_ADD_EXTRA_SLOTS = `UPDATE player_wallet SET extra_team_slots = extra_team_slots + ?, updated_at = ? WHERE user_id = ?`;
const SQL_INSERT_WALLET_ROW = `INSERT INTO player_wallet (user_id, credits, premium_until, extra_team_slots, updated_at)
     VALUES (?, 0, NULL, 0, ?) ON CONFLICT(user_id) DO NOTHING`;

const SQL_PARTY_MEMBERS = `SELECT * FROM player_roster WHERE user_id = ? AND slot_index IS NOT NULL ORDER BY slot_index`;
const SQL_CLEAR_PARTY = `UPDATE player_roster SET status = 'resting', slot_index = NULL, updated_at = ? WHERE user_id = ? AND slot_index IS NOT NULL`;
const SQL_PUT_IN_SLOT = `UPDATE player_roster SET status = 'party', slot_index = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_MON_OWNED = `SELECT id FROM player_roster WHERE id = ? AND user_id = ?`;

// ============================================================================
// Types
// ============================================================================

export type TeamRow = {
  id: string;
  user_id: string;
  name: string;
  mon_1_id: string | null;
  mon_2_id: string | null;
  mon_3_id: string | null;
  active: 0 | 1;
  created_at: number;
  updated_at: number;
};

export type TeamView = {
  id: string;
  name: string;
  active: boolean;
  /** Ordered slot 0..2; null = empty slot. */
  monIds: readonly (string | null)[];
};

export type TeamsResponse = {
  teams: readonly TeamView[];
  limit: number;
  premium: boolean;
  extraSlots: number;
};

export type TeamResult<T> = { ok: true; value: T } | { ok: false; error: string; message?: string };

// ============================================================================
// Helpers
// ============================================================================

function rowToView(row: TeamRow): TeamView {
  return {
    id: row.id,
    name: row.name,
    active: row.active === 1,
    monIds: [row.mon_1_id, row.mon_2_id, row.mon_3_id],
  };
}

/** Team slot budget: 3 base (+2 while premium) + purchased extras, capped. */
export async function teamLimitFor(userId: string, now: number = Date.now()): Promise<number> {
  const wallet = await one<{ extra_team_slots: number; premium_until: number | null }>(SQL_SELECT_WALLET, userId);
  const premium = (wallet?.premium_until ?? 0) > now;
  const extra = wallet?.extra_team_slots ?? 0;
  return Math.min(MAX_TEAM_LIMIT, BASE_TEAM_LIMIT + (premium ? PREMIUM_TEAM_BONUS : 0) + extra);
}

/** Called by the shop buy handler for `itm-team-slot` (200cr each). */
export async function grantTeamSlots(userId: string, qty: number): Promise<void> {
  await tx(async (t) => {
    await t.run(SQL_INSERT_WALLET_ROW, [userId, Date.now()]);
    await t.run(SQL_ADD_EXTRA_SLOTS, [qty, Date.now(), userId]);
  });
}

export async function listTeams(userId: string): Promise<TeamsResponse> {
  const wallet = await one<{ extra_team_slots: number; premium_until: number | null }>(SQL_SELECT_WALLET, userId);
  const rows = await q<TeamRow>(SQL_SELECT_TEAMS, userId);
  return {
    teams: rows.map(rowToView),
    limit: await teamLimitFor(userId),
    premium: (wallet?.premium_until ?? 0) > Date.now(),
    extraSlots: wallet?.extra_team_slots ?? 0,
  };
}

// ============================================================================
// Create
// ============================================================================

/**
 * Create a named team. `seedFromParty` copies the current party (slot 0..2)
 * into the new team — this is the migration path for players whose 3 starters
 * live directly in `player_roster.slot_index` from onboarding.
 */
export async function createTeam(
  userId: string,
  input: { name?: string; seedFromParty?: boolean },
): Promise<TeamResult<TeamView>> {
  const limit = await teamLimitFor(userId);
  const count = (await q<{ n: number }>(`SELECT COUNT(*) AS n FROM player_teams WHERE user_id = ?`, userId))[0];
  const current = count?.n ?? 0;
  if (current >= limit) {
    return { ok: false, error: 'team-limit', message: `Team limit reached (${limit}). Buy an extra slot in the shop.` };
  }

  let monIds: (string | null)[] = [null, null, null];
  if (input.seedFromParty === true) {
    const party = await q<{ id: string; slot_index: number | null }>(SQL_PARTY_MEMBERS, userId);
    for (const row of party) {
      if (row.slot_index !== null && row.slot_index >= 0 && row.slot_index < PARTY_SIZE) {
        monIds[row.slot_index] = row.id;
      }
    }
  }

  const name = (input.name ?? '').trim().slice(0, TEAM_NAME_MAX) || `Time ${current + 1}`;
  const now = Date.now();
  const id = newId('team');
  await tx(async (t) => {
    await t.run(SQL_INSERT_TEAM, [id, userId, name, monIds[0], monIds[1], monIds[2], now, now]);
  });
  log.info('teams.create', { userId, teamId: id, seeded: input.seedFromParty === true });
  return { ok: true, value: { id, name, active: false, monIds } };
}

// ============================================================================
// Member validation (activation + active-team edits)
// ============================================================================

export type MemberGateError = {
  monId: string;
  reason: 'not-owned' | 'downed' | 'listed' | 'busy';
  status?: string;
};

/** True when the mon can physically stand in the party right now. */
async function validatePartyCandidate(userId: string, monId: string, now: number): Promise<MemberGateError | null> {
  const row = await one<
    { id: string; status: string; revive_at: number | null; listed_at: number | null }
  >(`SELECT id, status, revive_at, listed_at FROM player_roster WHERE id = ? AND user_id = ?`, monId, userId);
  if (!row) return { monId, reason: 'not-owned' };
  if (row.revive_at !== null && row.revive_at > now) return { monId, reason: 'downed' };
  if (row.listed_at !== null) return { monId, reason: 'listed' };
  if (row.status !== 'resting' && row.status !== 'party') return { monId, reason: 'busy', status: row.status };
  return null;
}

function reasonsToMessage(errors: readonly MemberGateError[]): string {
  const names: string[] = [];
  for (const e of errors) {
    if (e.reason === 'not-owned') names.push('a Digimon that is not yours');
    else if (e.reason === 'downed') names.push('a downed Digimon');
    else if (e.reason === 'listed') names.push('a market-listed Digimon');
    else names.push(`a ${e.status ?? 'busy'} Digimon`);
  }
  return `Cannot use ${names.join(', ')} in the active team.`;
}

async function validateTeamMembers(
  userId: string,
  monIds: readonly (string | null)[],
  now: number,
): Promise<MemberGateError[]> {
  const errors: MemberGateError[] = [];
  for (const monId of monIds) {
    if (monId === null) continue;
    const err = await validatePartyCandidate(userId, monId, now);
    if (err) errors.push(err);
  }
  return errors;
}

/**
 * Mirror a team's members into the party slots. Caller must have validated
 * every non-null member (see validateTeamMembers) and ensured full lineup.
 */
async function mirrorToParty(userId: string, monIds: readonly (string | null)[], now: number): Promise<void> {
  await tx(async (t) => {
    await t.run(SQL_CLEAR_PARTY, [now, userId]);
    for (let slot = 0; slot < PARTY_SIZE; slot++) {
      const monId = monIds[slot];
      if (monId === null) continue;
      const info = await t.run(SQL_PUT_IN_SLOT, [slot, now, monId, userId]);
      if (info.changes === 0) throw new Error('mon not found');
    }
  });
}

// ============================================================================
// Mutations
// ============================================================================

export async function renameTeam(userId: string, teamId: string, name: string): Promise<TeamResult<TeamView>> {
  const clean = name.trim().slice(0, TEAM_NAME_MAX);
  if (clean.length === 0) return { ok: false, error: 'invalid-name' };
  const info = await run(SQL_UPDATE_NAME, clean, Date.now(), teamId, userId);
  if (info.changes === 0) return { ok: false, error: 'not-found' };
  const row = await one<TeamRow>(SQL_SELECT_TEAM, teamId, userId);
  return row ? { ok: true, value: rowToView(row) } : { ok: false, error: 'not-found' };
}

/**
 * Set a team's lineup. Editing a NON-active team is a draft: no party
 * interaction, mon availability is not checked (it can be training/adventure —
 * activation will gate it). Editing the ACTIVE team re-syncs the party, so
 * every member must currently be party-eligible or the whole edit is rejected.
 */
export async function setTeamMembers(
  userId: string,
  teamId: string,
  monIds: readonly (string | null)[],
): Promise<TeamResult<TeamView & { membersOk: boolean }>> {
  if (monIds.length !== PARTY_SIZE) return { ok: false, error: 'invalid-input', message: 'A team has exactly 3 slots.' };
  const normalized = monIds.map((id) => (id === null ? null : id));
  const unique = new Set(normalized.filter((id): id is string => id !== null));
  if (unique.size !== normalized.filter((id): id is string => id !== null).length) {
    return { ok: false, error: 'duplicate-mon', message: 'A Digimon cannot fill two slots of the same team.' };
  }
  const row = await one<TeamRow>(SQL_SELECT_TEAM, teamId, userId);
  if (!row) return { ok: false, error: 'not-found' };

  // Ownership is validated for EVERY edit (draft or active) so teams can
  // never reference mons that are not the player's. Availability (downed/
  // listed/busy) only gates party sync — drafts may pre-stage a training mon.
  for (const monId of normalized) {
    if (monId === null) continue;
    const owned = await one<{ id: string }>(SQL_MON_OWNED, monId, userId);
    if (!owned) return { ok: false, error: 'not-owned', message: 'One of the chosen Digimon is not on your roster.' };
  }

  const now = Date.now();
  const wasActive = row.active === 1;
  if (wasActive) {
    const errors = await validateTeamMembers(userId, normalized, now);
    if (errors.length > 0) {
      return { ok: false, error: 'member-unavailable', message: reasonsToMessage(errors) };
    }
    await mirrorToParty(userId, normalized, now);
  }

  await run(SQL_UPDATE_MEMBERS, [normalized[0], normalized[1], normalized[2], now, teamId, userId]);
  const fresh = await one<TeamRow>(SQL_SELECT_TEAM, teamId, userId);
  if (!fresh) return { ok: false, error: 'not-found' };
  return { ok: true, value: { ...rowToView(fresh), membersOk: true } };
}

/**
 * Activate a team: its full lineup becomes the party. Validates every member
 * (owned, not downed, not market-listed, status resting|party), then clears
 * the previous party and mirrors the new one in one transaction.
 */
export async function activateTeam(userId: string, teamId: string): Promise<TeamResult<TeamView>> {
  const row = await one<TeamRow>(SQL_SELECT_TEAM, teamId, userId);
  if (!row) return { ok: false, error: 'not-found' };
  const monIds = [row.mon_1_id, row.mon_2_id, row.mon_3_id];
  if (monIds.some((id) => id === null)) {
    return { ok: false, error: 'incomplete-team', message: 'Fill all 3 slots before activating the team.' };
  }
  const now = Date.now();
  const errors = await validateTeamMembers(userId, monIds as string[], now);
  if (errors.length > 0) {
    return { ok: false, error: 'member-unavailable', message: reasonsToMessage(errors) };
  }
  try {
    await tx(async (t) => {
      await t.run(SQL_CLEAR_ACTIVE, [userId]);
      const setInfo = await t.run(SQL_SET_ACTIVE, [now, teamId, userId]);
      if (setInfo.changes === 0) throw new Error('team not found');
      await t.run(SQL_CLEAR_PARTY, [now, userId]);
      for (let slot = 0; slot < PARTY_SIZE; slot++) {
        const monId = monIds[slot] as string;
        const info = await t.run(SQL_PUT_IN_SLOT, [slot, now, monId, userId]);
        if (info.changes === 0) throw new Error('mon not found');
      }
    });
  } catch {
    // The tx rolled back: active flag + party are untouched.
    return { ok: false, error: 'activation-failed', message: 'Could not activate the team — a member may have changed. Refresh and try again.' };
  }
  const fresh = await one<TeamRow>(SQL_SELECT_TEAM, teamId, userId);
  if (!fresh) return { ok: false, error: 'not-found' };
  log.info('teams.activate', { userId, teamId });
  return { ok: true, value: rowToView(fresh) };
}

export async function deleteTeam(userId: string, teamId: string): Promise<TeamResult<{ ok: true }>> {
  const row = await one<TeamRow>(SQL_SELECT_TEAM, teamId, userId);
  if (!row) return { ok: false, error: 'not-found' };
  await tx(async (t) => {
    await t.run(SQL_DELETE_TEAM, [teamId, userId]);
    if (row.active === 1) {
      // The party mirror has no team anymore — release the slots.
      await t.run(SQL_CLEAR_PARTY, [Date.now(), userId]);
    }
  });
  log.info('teams.delete', { userId, teamId, wasActive: row.active === 1 });
  return { ok: true, value: { ok: true } };
}