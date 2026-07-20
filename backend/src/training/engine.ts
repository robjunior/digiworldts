/**
 * Training engine — stat progression via time-based training sessions.
 *
 * Storage model:
 *   farm_buildings.building_type = 'training' | 'training_premium'
 *   training_sessions            = active session per station (UNIQUE building_id)
 *   player_roster.{hp,en,atk,def,int,spd}_bonus   ← stat writes on collect
 *   player_roster.mood            ← 0-100, decays on long sessions
 *
 * Gain per stat = MAX_STAT_GAIN_8H[stat] × (durationHours / 8) / statKinds.length
 *   HP=200, EN=100, combat=50 at 8h. Training two stats halves each gain.
 *   Basic station trains 1 stat; premium trains 2.
 * Mood delta: <30min +3 / 30-120min 0 / 120-240min -5 / 240min+ -15.
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import { one, q, run, tx, type FarmBuildingRow, type RosterRow, type TrainingSessionRow } from '../db/index.js';
import {
  TRAINING_STATS,
  moodState,
  type MoodState,
  type Stage,
  type StagePools,
  type TrainingStat,
} from '../digimon/types.js';
import { loadCatalog } from '../digimon/xml.js';
import { clampBonusToCap } from '../progression/xp.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { starterBlueprintsFor } from '../admin/blueprints.js';

const MS_PER_HOUR = 3_600_000;
const MIN_DURATION_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
const DURATION_PRESETS_MIN = [5, 30, 120, 480] as const;

const MAX_STAT_GAIN_8H: Record<TrainingStat, number> = {
  hp: 200,
  en: 100,
  atk: 50,
  def: 50,
  int: 50,
  spd: 50,
};

const SQL_SELECT_TRAINING_BUILDINGS = `SELECT * FROM farm_buildings WHERE user_id = ? AND building_type IN ('training', 'training_premium') ORDER BY created_at`;
const SQL_SELECT_BUILDING = `SELECT * FROM farm_buildings WHERE id = ? AND user_id = ?`;
const SQL_INSERT_TRAINING_BUILDING = `INSERT INTO farm_buildings (id, user_id, kind, building_type, resource, level, rate_per_hour, capacity, produced, last_touch, upgrade_cost, created_at) VALUES (?, ?, ?, ?, 'Meat', 1, 1, 1, 0, ?, ?, ?)`;
const SQL_COUNT_TRAINING = `SELECT COUNT(*) AS n FROM farm_buildings WHERE user_id = ? AND building_type IN ('training', 'training_premium')`;
const SQL_SELECT_ACTIVE_SESSIONS = `SELECT * FROM training_sessions WHERE user_id = ? AND collected_at IS NULL`;
const SQL_SELECT_SESSION_BY_BUILDING = `SELECT * FROM training_sessions WHERE building_id = ? AND collected_at IS NULL`;
const SQL_SELECT_SESSION_BY_MON = `SELECT * FROM training_sessions WHERE mon_id = ? AND collected_at IS NULL`;
const SQL_INSERT_SESSION = `INSERT INTO training_sessions (id, user_id, building_id, mon_id, stat_kinds, started_at, duration_ms, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`;
const SQL_MARK_COLLECTED = `UPDATE training_sessions SET collected_at = ? WHERE id = ?`;
const SQL_DELETE_SESSION = `DELETE FROM training_sessions WHERE id = ?`;
const SQL_UPDATE_MON_TRAINING = `UPDATE player_roster SET hp_bonus = hp_bonus + ?, en_bonus = en_bonus + ?, atk_bonus = atk_bonus + ?, def_bonus = def_bonus + ?, int_bonus = int_bonus + ?, spd_bonus = spd_bonus + ?, mood = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_UPDATE_MON_STATUS = `UPDATE player_roster SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_SELECT_MON = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_SELECT_USER_ROSTER = `SELECT * FROM player_roster WHERE user_id = ? ORDER BY created_at`;

export type TrainingActiveView = {
  sessionId: string;
  monId: string;
  monNickname: string;
  monLevel: number;
  monStage: Stage;
  statKinds: TrainingStat[];
  startedAt: number;
  durationMs: number;
  finishesAt: number;
  progressPct: number;
  readyToCollect: boolean;
  previewGains: Partial<Record<TrainingStat, number>>;
  previewMoodDelta: number;
};

export type TrainingSlotView = {
  buildingId: string;
  kind: string;
  buildingType: 'training' | 'training_premium';
  supportedStatCount: number;
  active: TrainingActiveView | null;
};

export type TrainingRosterEntry = {
  monId: string;
  nickname: string;
  level: number;
  stage: Stage;
  mood: number;
  moodState: MoodState;
  portrait: string;
  inParty: boolean;
};

export type TrainingView = {
  stations: TrainingSlotView[];
  eligibleMons: TrainingRosterEntry[];
  durationPresetsMin: number[];
  trainableStats: TrainingStat[];
};

function statCountForType(bt: 'training' | 'training_premium'): number {
  return bt === 'training_premium' ? 2 : 1;
}

function progressPct(startedAt: number, durationMs: number, now: number): number {
  return Math.min(100, Math.max(0, ((now - startedAt) / durationMs) * 100));
}

function moodDeltaFor(durationMs: number): number {
  const minutes = durationMs / 60_000;
  if (minutes < 30) return 3;
  if (minutes < 120) return 0;
  if (minutes < 240) return -5;
  return -15;
}

function computeGains(durationMs: number, statKinds: readonly TrainingStat[]): Partial<Record<TrainingStat, number>> {
  const hours = Math.min(8, Math.max(0, durationMs / MS_PER_HOUR));
  const durationScale = hours / 8;
  const statCount = Math.max(1, statKinds.length);
  const result: Partial<Record<TrainingStat, number>> = {};
  for (const stat of statKinds) {
    const max = MAX_STAT_GAIN_8H[stat];
    result[stat] = Math.max(1, Math.round((max * durationScale) / statCount));
  }
  return result;
}

export async function readTraining(userId: string): Promise<TrainingView> {
  const now = Date.now();
  const buildings = await q<FarmBuildingRow>(SQL_SELECT_TRAINING_BUILDINGS, userId);
  const sessions = await q<TrainingSessionRow>(SQL_SELECT_ACTIVE_SESSIONS, userId);
  const sessionByBuilding = new Map(sessions.map((s) => [s.building_id, s]));
  const rosterRows = await q<RosterRow>(SQL_SELECT_USER_ROSTER, userId);
  const rosterById = new Map(rosterRows.map((r) => [r.id, r]));
  const catalog = loadCatalog();
  const templateById = new Map(catalog.digimons.map((t) => [t.id, t]));

  const stations: TrainingSlotView[] = buildings
    .filter((s): s is FarmBuildingRow & { building_type: 'training' | 'training_premium' } =>
      s.building_type === 'training' || s.building_type === 'training_premium',
    )
    .map((s) => {
      const session = sessionByBuilding.get(s.id);
      let active: TrainingActiveView | null = null;
      if (session) {
        const mon = rosterById.get(session.mon_id);
        const tpl = mon ? templateById.get(mon.catalog_id) : null;
        if (mon && tpl) {
          const statKinds = JSON.parse(session.stat_kinds) as TrainingStat[];
          active = {
            sessionId: session.id,
            monId: mon.id,
            monNickname: mon.nickname,
            monLevel: mon.level,
            monStage: tpl.stage,
            statKinds,
            startedAt: session.started_at,
            durationMs: session.duration_ms,
            finishesAt: session.started_at + session.duration_ms,
            progressPct: progressPct(session.started_at, session.duration_ms, now),
            readyToCollect: now >= session.started_at + session.duration_ms,
            previewGains: computeGains(session.duration_ms, statKinds),
            previewMoodDelta: moodDeltaFor(session.duration_ms),
          };
        }
      }
      return {
        buildingId: s.id,
        kind: s.kind,
        buildingType: s.building_type,
        supportedStatCount: statCountForType(s.building_type),
        active,
      };
    });

  const busyMonIds = new Set(sessions.map((s) => s.mon_id));
  const eligibleMons: TrainingRosterEntry[] = rosterRows
    .filter((r) => !busyMonIds.has(r.id))
    .map((r) => {
      const tpl = templateById.get(r.catalog_id);
      return {
        monId: r.id,
        nickname: r.nickname,
        level: r.level,
        stage: tpl?.stage ?? 'Rookie',
        mood: r.mood,
        moodState: moodState(r.mood),
        portrait: tpl?.assets.portrait ?? '',
        inParty: r.slot_index !== null,
      };
    });

  return {
    stations,
    eligibleMons,
    durationPresetsMin: [...DURATION_PRESETS_MIN],
    trainableStats: [...TRAINING_STATS],
  };
}

export async function seedTrainingStationForUser(userId: string): Promise<void> {
  const existing = await one<{ n: number }>(SQL_COUNT_TRAINING, userId);
  if ((existing?.n ?? 0) > 0) return;
  const training = await starterBlueprintsFor('training');
  const premium = await starterBlueprintsFor('training_premium');
  const blueprints = [...training, ...premium];
  if (blueprints.length === 0) {
    log.warn('training.seed.no-blueprints', { userId });
    return;
  }
  const now = Date.now();
  await tx(async (t) => {
    for (const bp of blueprints) {
      await t.run(SQL_INSERT_TRAINING_BUILDING, [
        newId('bld'), userId, bp.name, bp.buildingType, now, bp.upgradeCost, now,
      ]);
    }
  });
  log.info('training.seed.ok', { userId, count: blueprints.length });
}

export async function placeTrainingBuilding(
  userId: string,
  buildingType: 'training' | 'training_premium',
  kind: string,
  upgradeCost: number,
): Promise<string> {
  const now = Date.now();
  const id = newId('bld');
  await run(SQL_INSERT_TRAINING_BUILDING, id, userId, kind, buildingType, now, upgradeCost, now);
  log.info('training.place', { userId, buildingType, kind });
  return id;
}

export type TrainingError =
  | 'building-not-found'
  | 'building-not-training'
  | 'building-busy'
  | 'mon-not-found'
  | 'mon-busy'
  | 'mon-in-party'
  | 'invalid-stat'
  | 'wrong-stat-count'
  | 'duplicate-stat'
  | 'invalid-duration'
  | 'session-not-found'
  | 'not-finished';

export type AssignOutcome =
  | { ok: true; view: TrainingView }
  | { ok: false; error: TrainingError };

export async function assignTraining(
  userId: string,
  buildingId: string,
  monId: string,
  statKinds: TrainingStat[],
  durationMs: number,
): Promise<AssignOutcome> {
  if (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    return { ok: false, error: 'invalid-duration' };
  }
  if (statKinds.some((k) => !(TRAINING_STATS as readonly string[]).includes(k))) {
    return { ok: false, error: 'invalid-stat' };
  }
  if (new Set(statKinds).size !== statKinds.length) {
    return { ok: false, error: 'duplicate-stat' };
  }
  const building = await one<FarmBuildingRow>(SQL_SELECT_BUILDING, buildingId, userId);
  if (!building) return { ok: false, error: 'building-not-found' };
  if (building.building_type !== 'training' && building.building_type !== 'training_premium') {
    return { ok: false, error: 'building-not-training' };
  }
  const supported = statCountForType(building.building_type);
  if (statKinds.length !== supported) return { ok: false, error: 'wrong-stat-count' };
  const busySession = await one<TrainingSessionRow>(SQL_SELECT_SESSION_BY_BUILDING, buildingId);
  if (busySession) return { ok: false, error: 'building-busy' };
  const mon = await one<RosterRow>(SQL_SELECT_MON, monId, userId);
  if (!mon) return { ok: false, error: 'mon-not-found' };
  if (mon.slot_index !== null) return { ok: false, error: 'mon-in-party' };
  const monBusy = await one<TrainingSessionRow>(SQL_SELECT_SESSION_BY_MON, monId);
  if (monBusy) return { ok: false, error: 'mon-busy' };

  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_INSERT_SESSION, [
      newId('trn'), userId, buildingId, monId,
      JSON.stringify(statKinds), now, durationMs,
    ]);
    await t.run(SQL_UPDATE_MON_STATUS, ['training', now, monId, userId]);
  });
  log.info('training.assign', { userId, buildingId, monId, statKinds, durationMs });
  return { ok: true, view: await readTraining(userId) };
}

export type CollectOutcome =
  | { ok: true; view: TrainingView; gained: Partial<Record<TrainingStat, number>>; moodDelta: number; newMood: number }
  | { ok: false; error: TrainingError };

export async function collectTraining(userId: string, buildingId: string): Promise<CollectOutcome> {
  const session = await one<TrainingSessionRow>(SQL_SELECT_SESSION_BY_BUILDING, buildingId);
  if (!session || session.user_id !== userId) return { ok: false, error: 'session-not-found' };
  const now = Date.now();
  if (now < session.started_at + session.duration_ms) return { ok: false, error: 'not-finished' };
  const mon = await one<RosterRow>(SQL_SELECT_MON, session.mon_id, userId);
  if (!mon) return { ok: false, error: 'mon-not-found' };
  const catalog = loadCatalog();
  const tpl = catalog.digimons.find((t) => t.id === mon.catalog_id);
  const stage: Stage = tpl?.stage ?? 'Rookie';
  const statKinds = JSON.parse(session.stat_kinds) as TrainingStat[];
  const gained = computeGains(session.duration_ms, statKinds);
  const moodDelta = moodDeltaFor(session.duration_ms);
  const newMood = Math.max(0, Math.min(100, mon.mood + moodDelta));
  const rawBonus = {
    hp: mon.hp_bonus + (gained.hp ?? 0),
    en: mon.en_bonus + (gained.en ?? 0),
    atk: mon.atk_bonus + (gained.atk ?? 0),
    def: mon.def_bonus + (gained.def ?? 0),
    int: mon.int_bonus + (gained.int ?? 0),
    spd: mon.spd_bonus + (gained.spd ?? 0),
  };
  const stagePools = mon.stage_pools ? JSON.parse(mon.stage_pools) as StagePools : undefined;
  const cappedBonus = tpl ? clampBonusToCap(rawBonus, tpl.baseStats, stage, stagePools) : rawBonus;
  const delta = {
    hp: cappedBonus.hp - mon.hp_bonus,
    en: cappedBonus.en - mon.en_bonus,
    atk: cappedBonus.atk - mon.atk_bonus,
    def: cappedBonus.def - mon.def_bonus,
    int: cappedBonus.int - mon.int_bonus,
    spd: cappedBonus.spd - mon.spd_bonus,
  };
  const appliedGains: Partial<Record<TrainingStat, number>> = {};
  for (const k of statKinds) {
    const applied = delta[k as keyof typeof delta];
    if (applied > 0) appliedGains[k] = applied;
  }
  await tx(async (t) => {
    await t.run(SQL_UPDATE_MON_TRAINING, [
      delta.hp, delta.en, delta.atk, delta.def, delta.int, delta.spd,
      newMood, 'resting', now,
      mon.id, userId,
    ]);
    await t.run(SQL_MARK_COLLECTED, [now, session.id]);
  });
  log.info('training.collect', { userId, buildingId, monId: mon.id, statKinds, gained: appliedGains, moodDelta, newMood });
  return { ok: true, view: await readTraining(userId), gained: appliedGains, moodDelta, newMood };
}

export type CancelOutcome =
  | { ok: true; view: TrainingView }
  | { ok: false; error: TrainingError };

export async function cancelTraining(userId: string, buildingId: string): Promise<CancelOutcome> {
  const session = await one<TrainingSessionRow>(SQL_SELECT_SESSION_BY_BUILDING, buildingId);
  if (!session || session.user_id !== userId) return { ok: false, error: 'session-not-found' };
  const now = Date.now();
  await tx(async (t) => {
    await t.run(SQL_DELETE_SESSION, [session.id]);
    await t.run(SQL_UPDATE_MON_STATUS, ['resting', now, session.mon_id, userId]);
  });
  log.info('training.cancel', { userId, buildingId, monId: session.mon_id });
  return { ok: true, view: await readTraining(userId) };
}
