/**
 * User admin: read/edit/delete player accounts.
 *
 *   Backing tables: `users` + `player_wallet` + `player_roster` (for counts).
 *   Deletion cascades: schema declares ON DELETE CASCADE for roster / wallet /
 *   sessions / matches — deleting a user tears down all their state.
 *
 *   Password reset uses argon2id via `hashPassword` and invalidates every
 *   existing session for that user via `destroyAllSessionsForUser` so a
 *   password change forces a re-login on every device.
 *
 *   Callers (routes) are responsible for the "cannot demote / delete SELF"
 *   safeguard — the engine does not know who is calling.
 */
import { hashPassword, validatePasswordPolicy } from '../auth/password.js';
import { destroyAllSessionsForUser } from '../auth/session.js';
import { one, q, run, type UserRow, type WalletRow } from '../db/index.js';
import { log } from '../util/log.js';

const SQL_SEARCH = `
  SELECT u.*, COALESCE(w.credits, 0) AS credits,
         (SELECT COUNT(*) FROM player_roster r WHERE r.user_id = u.id) AS mon_count
    FROM users u
    LEFT JOIN player_wallet w ON w.user_id = u.id
   WHERE (CAST(? AS TEXT) IS NULL OR LOWER(u.username) LIKE LOWER(?))
   ORDER BY u.created_at DESC
   LIMIT ? OFFSET ?
`;
const SQL_COUNT_SEARCH = `
  SELECT COUNT(*) AS n FROM users u
   WHERE (CAST(? AS TEXT) IS NULL OR LOWER(u.username) LIKE LOWER(?))
`;
const SQL_SELECT_BY_ID = `SELECT * FROM users WHERE id = ?`;
const SQL_SELECT_WALLET = `SELECT * FROM player_wallet WHERE user_id = ?`;
const SQL_COUNT_ROSTER_FOR_USER = `SELECT COUNT(*) AS n FROM player_roster WHERE user_id = ?`;
const SQL_UPDATE_FLAGS = `UPDATE users SET is_admin = ?, disabled = ?, updated_at = ? WHERE id = ?`;
const SQL_UPDATE_PASSWORD = `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`;
const SQL_UPSERT_WALLET = `
  INSERT INTO player_wallet (user_id, credits, streak_day, updated_at)
       VALUES (?, ?, 0, ?)
    ON CONFLICT (user_id) DO UPDATE SET credits = excluded.credits, updated_at = excluded.updated_at
`;
const SQL_DELETE_USER = `DELETE FROM users WHERE id = ?`;

export type UserListEntry = {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  credits: number;
  monCount: number;
};

export type UserDetail = UserListEntry & {
  updatedAt: number;
  wallet: {
    credits: number;
    streakDay: number;
    lastClaimAt: number | null;
    premiumUntil: number | null;
    updatedAt: number;
  } | null;
};

type SearchRow = UserRow & { credits: number; mon_count: number };

function rowToListEntry(row: SearchRow): UserListEntry {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    credits: row.credits,
    monCount: row.mon_count,
  };
}

export async function listUsers(
  query: string | undefined,
  limit: number,
  offset: number,
): Promise<{ users: UserListEntry[]; total: number; hasMore: boolean }> {
  const q0 = query?.trim();
  const like = q0 && q0.length > 0 ? `%${q0}%` : null;
  const rows = await q<SearchRow>(SQL_SEARCH, like, like, Math.max(1, Math.min(200, limit)), Math.max(0, offset));
  const totalRow = await one<{ n: number }>(SQL_COUNT_SEARCH, like, like);
  const total = totalRow?.n ?? 0;
  return {
    users: rows.map(rowToListEntry),
    total,
    hasMore: offset + rows.length < total,
  };
}

export async function getUser(id: string): Promise<UserDetail | null> {
  const user = await one<UserRow>(SQL_SELECT_BY_ID, id);
  if (!user) return null;
  const wallet = await one<WalletRow>(SQL_SELECT_WALLET, id);
  const monCountRow = await one<{ n: number }>(SQL_COUNT_ROSTER_FOR_USER, id);
  const monCount = monCountRow?.n ?? 0;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    isAdmin: user.is_admin === 1,
    disabled: user.disabled === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    lastLoginAt: user.last_login_at,
    credits: wallet?.credits ?? 0,
    monCount,
    wallet: wallet
      ? {
          credits: wallet.credits,
          streakDay: wallet.streak_day,
          lastClaimAt: wallet.last_claim_at,
          premiumUntil: wallet.premium_until,
          updatedAt: wallet.updated_at,
        }
      : null,
  };
}

export type UserError =
  | 'not-found'
  | 'invalid-password'
  | 'invalid-credits'
  | 'invalid-input';

export type UserOutcome<T> = { ok: true; user: T } | { ok: false; error: UserError; message?: string };

export async function updateUserFlags(
  id: string,
  input: { isAdmin?: boolean; disabled?: boolean },
): Promise<UserOutcome<UserDetail>> {
  const existing = await one<UserRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const nextAdmin = input.isAdmin === true ? 1 : input.isAdmin === false ? 0 : existing.is_admin;
  const nextDisabled = input.disabled === true ? 1 : input.disabled === false ? 0 : existing.disabled;
  await run(SQL_UPDATE_FLAGS, [nextAdmin, nextDisabled, Date.now(), id]);
  // If we just disabled the user, kill their sessions so they cannot keep acting.
  if (nextDisabled === 1 && existing.disabled === 0) {
    await destroyAllSessionsForUser(id);
  }
  log.info('admin.user.updateFlags', { id, isAdmin: nextAdmin === 1, disabled: nextDisabled === 1 });
  const detail = await getUser(id);
  if (!detail) return { ok: false, error: 'not-found' };
  return { ok: true, user: detail };
}

export async function updateUserCredits(id: string, credits: number): Promise<UserOutcome<UserDetail>> {
  if (typeof credits !== 'number' || credits < 0 || !Number.isFinite(credits)) {
    return { ok: false, error: 'invalid-credits' };
  }
  const existing = await one<UserRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await run(SQL_UPSERT_WALLET, [id, Math.floor(credits), Date.now()]);
  log.info('admin.user.updateCredits', { id, credits: Math.floor(credits) });
  const detail = await getUser(id);
  if (!detail) return { ok: false, error: 'not-found' };
  return { ok: true, user: detail };
}

export async function resetUserPassword(id: string, newPassword: string): Promise<UserOutcome<UserDetail>> {
  const policy = validatePasswordPolicy(newPassword);
  if (!policy.ok) return { ok: false, error: 'invalid-password', message: policy.reason };
  const existing = await one<UserRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  const hash = await hashPassword(newPassword);
  await run(SQL_UPDATE_PASSWORD, [hash, Date.now(), id]);
  await destroyAllSessionsForUser(id);
  log.info('admin.user.resetPassword', { id });
  const detail = await getUser(id);
  if (!detail) return { ok: false, error: 'not-found' };
  return { ok: true, user: detail };
}

export async function deleteUser(id: string): Promise<UserOutcome<{ id: string }>> {
  const existing = await one<UserRow>(SQL_SELECT_BY_ID, id);
  if (!existing) return { ok: false, error: 'not-found' };
  await destroyAllSessionsForUser(id);
  await run(SQL_DELETE_USER, id);
  log.info('admin.user.delete', { id, username: existing.username });
  return { ok: true, user: { id } };
}
