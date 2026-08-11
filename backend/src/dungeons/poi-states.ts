import type { DungeonRunPoiState, PoiRunState } from '@digiworld/shared';
import { one, q, run } from '../db/index.js';

type PoiKind = 'door' | 'trap' | 'chest';

type PoiStateRow = {
  readonly user_id: string;
  readonly dungeon_id: string;
  readonly poi_kind: PoiKind;
  readonly poi_id: string;
  readonly state: PoiRunState;
  readonly changed_at: number;
};

const SQL_LIST_POI_STATES = `SELECT * FROM user_dungeon_run_poi_states WHERE user_id = ? AND dungeon_id = ?`;
const SQL_GET_POI_STATE = `SELECT * FROM user_dungeon_run_poi_states WHERE user_id = ? AND dungeon_id = ? AND poi_kind = ? AND poi_id = ?`;
const SQL_UPSERT_POI_STATE = `INSERT INTO user_dungeon_run_poi_states (user_id, dungeon_id, poi_kind, poi_id, state, changed_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, dungeon_id, poi_kind, poi_id) DO UPDATE SET state = excluded.state, changed_at = excluded.changed_at`;

function poiStateFromRow(row: PoiStateRow): DungeonRunPoiState {
  return {
    userId: row.user_id,
    dungeonId: row.dungeon_id,
    poiKind: row.poi_kind,
    poiId: row.poi_id,
    state: row.state,
    changedAt: row.changed_at,
  };
}

export async function listPoiStatesForRun(userId: string, dungeonId: string): Promise<readonly DungeonRunPoiState[]> {
  return (await q<PoiStateRow>(SQL_LIST_POI_STATES, userId, dungeonId)).map(poiStateFromRow);
}

export async function getPoiState(userId: string, dungeonId: string, poiKind: PoiKind, poiId: string): Promise<PoiRunState> {
  const row = await one<PoiStateRow>(SQL_GET_POI_STATE, userId, dungeonId, poiKind, poiId);
  return row ? row.state : 'unused';
}

export async function setPoiState(userId: string, dungeonId: string, poiKind: PoiKind, poiId: string, state: PoiRunState): Promise<void> {
  await run(SQL_UPSERT_POI_STATE, userId, dungeonId, poiKind, poiId, state, Date.now());
}
