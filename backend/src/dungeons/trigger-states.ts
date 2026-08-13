/**
 * Group-scoped fired-trigger state.
 *
 * The scope key is the dungeon's `dungeonGroupId` when it has one, else the
 * dungeon id itself — so a lever pulled on floor A is visible to floor B of
 * the same group (cross-map triggers). Rows are cleared when the run ends or
 * resets.
 */
import { one, q, run } from '../db/index.js';

export type TriggerStateRow = {
  readonly user_id: string;
  readonly dungeon_group_id: string;
  readonly trigger_id: string;
  readonly state: string;
  readonly changed_at: number;
};

const SQL_LIST_FIRED = `SELECT trigger_id FROM user_dungeon_trigger_states WHERE user_id = ? AND dungeon_group_id = ? AND state = 'used'`;
const SQL_GET_STATE = `SELECT state FROM user_dungeon_trigger_states WHERE user_id = ? AND dungeon_group_id = ? AND trigger_id = ?`;
export const SQL_UPSERT_TRIGGER_STATE = `INSERT INTO user_dungeon_trigger_states (user_id, dungeon_group_id, trigger_id, state, changed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, dungeon_group_id, trigger_id) DO UPDATE SET state = excluded.state, changed_at = excluded.changed_at`;
const SQL_CLEAR_SCOPE = `DELETE FROM user_dungeon_trigger_states WHERE user_id = ? AND dungeon_group_id = ?`;

/** Trigger ids already fired in this run scope (cross-map). */
export async function listFiredTriggerIds(userId: string, scopeKey: string): Promise<readonly string[]> {
  const rows = await q<{ readonly trigger_id: string }>(SQL_LIST_FIRED, userId, scopeKey);
  return rows.map((row) => row.trigger_id);
}

export async function triggerState(userId: string, scopeKey: string, triggerId: string): Promise<boolean> {
  const row = await one<TriggerStateRow>(SQL_GET_STATE, userId, scopeKey, triggerId);
  return row?.state === 'used';
}

/** True when at least one of `triggerIds` has fired in this scope. */
export async function anyTriggerFired(userId: string, scopeKey: string, triggerIds: readonly string[]): Promise<boolean> {
  for (const triggerId of triggerIds) {
    if (await triggerState(userId, scopeKey, triggerId)) return true;
  }
  return false;
}

export async function markTriggerFired(userId: string, scopeKey: string, triggerId: string): Promise<void> {
  await run(SQL_UPSERT_TRIGGER_STATE, userId, scopeKey, triggerId, 'used', Date.now());
}

export async function clearTriggerStates(userId: string, scopeKey: string): Promise<void> {
  await run(SQL_CLEAR_SCOPE, userId, scopeKey);
}
