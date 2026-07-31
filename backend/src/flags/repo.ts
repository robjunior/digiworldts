import { one, q, run } from '../db/index.js';

const SQL_SET = `
  INSERT INTO user_flags (user_id, flag, set_at)
  VALUES (?, ?, ?)
  ON CONFLICT (user_id, flag) DO NOTHING
`;
const SQL_CLEAR = `DELETE FROM user_flags WHERE user_id = ? AND flag = ?`;
const SQL_HAS = `SELECT 1 AS hit FROM user_flags WHERE user_id = ? AND flag = ?`;
const SQL_LIST = `SELECT flag FROM user_flags WHERE user_id = ? ORDER BY flag`;
const SQL_CLEAR_PREFIX = `DELETE FROM user_flags WHERE user_id = ? AND flag LIKE ? ESCAPE '\\'`;

type FlagRow = { readonly flag: string };

/** Flag names may contain _ and %, which LIKE would otherwise read as wildcards. */
function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * DO NOTHING, not DO UPDATE: re-setting keeps the original set_at, so a
 * first-met timestamp survives the player triggering the same line again.
 */
export async function setFlag(userId: string, flag: string, now = Date.now()): Promise<void> {
  await run(SQL_SET, [userId, flag, now]);
}

export async function clearFlag(userId: string, flag: string): Promise<void> {
  await run(SQL_CLEAR, [userId, flag]);
}

export async function hasFlag(userId: string, flag: string): Promise<boolean> {
  return (await one<{ readonly hit: number }>(SQL_HAS, [userId, flag])) !== null;
}

export async function listFlags(userId: string): Promise<readonly string[]> {
  return (await q<FlagRow>(SQL_LIST, [userId])).map((row) => row.flag);
}

export async function clearFlagPrefix(userId: string, prefix: string): Promise<void> {
  await run(SQL_CLEAR_PREFIX, [userId, `${escapeLikePrefix(prefix)}%`]);
}
