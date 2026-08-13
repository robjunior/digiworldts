/**
 * Global fired-trigger state.
 *
 * Keyed per user by trigger id — no dungeon/group scope — because lever
 * targets are referenced by id from ANY map (global pool). A lever pulled on
 * one map affects its target wherever it lives. Rows are cleared when any run
 * of the user ends or resets.
 */
import { one, q, run } from '../db/index.js';

export type TriggerStateRow = {
  readonly user_id: string;
  readonly trigger_id: string;
  readonly state: string;
  readonly changed_at: number;
};

const SQL_LIST_FIRED = `SELECT trigger_id FROM user_dungeon_trigger_states WHERE user_id = ? AND state = 'used'`;
const SQL_GET_STATE = `SELECT state FROM user_dungeon_trigger_states WHERE user_id = ? AND trigger_id = ?`;
export const SQL_UPSERT_TRIGGER_STATE = `INSERT INTO user_dungeon_trigger_states (user_id, trigger_id, state, changed_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, trigger_id) DO UPDATE SET state = excluded.state, changed_at = excluded.changed_at`;
const SQL_CLEAR = `DELETE FROM user_dungeon_trigger_states WHERE user_id = ?`;

/** Trigger ids already fired this run (global across all maps). */
export async function listFiredTriggerIds(userId: string): Promise<readonly string[]> {
  const rows = await q<{ readonly trigger_id: string }>(SQL_LIST_FIRED, userId);
  return rows.map((row) => row.trigger_id);
}

export async function triggerState(userId: string, triggerId: string): Promise<boolean> {
  const row = await one<TriggerStateRow>(SQL_GET_STATE, userId, triggerId);
  return row?.state === 'used';
}

/** True when at least one of `triggerIds` has fired. */
export async function anyTriggerFired(userId: string, triggerIds: readonly string[]): Promise<boolean> {
  for (const triggerId of triggerIds) {
    if (await triggerState(userId, triggerId)) return true;
  }
  return false;
}

export async function markTriggerFired(userId: string, triggerId: string): Promise<void> {
  await run(SQL_UPSERT_TRIGGER_STATE, userId, triggerId, 'used', Date.now());
}

export async function clearTriggerStates(userId: string): Promise<void> {
  await run(SQL_CLEAR, userId);
}
