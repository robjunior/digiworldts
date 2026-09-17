/**
 * Adventure engine — idle 3-mon expeditions.
 *
 * Storage model:
 *   adventures                  = one row per expedition. Partial UNIQUE on
 *                                 (user_id) WHERE collected_at IS NULL
 *                                 enforces one active expedition per user.
 *   player_roster.status        = 'adventure' while a mon is on a run;
 *                                 flipped back to 'resting' on collect.
 *   resources[Meat]            is decremented at start
 *                                 (ceil(hours * 10) upfront).
 *
 * Rewards:
 *   - Meat / Bits / Data / NetCore: scaled per encounter, aggregated
 *     into a report and awarded via SQL_UPSERT_RESOURCE + SQL_ADD_NETCORE.
 *   - XP per mon: computed via progression/awardXp using each mon's
 *     current template + stage growth, honoring the global xpRate.
 *   - KO on a lost encounter: 30% chance to knock one random mon —
 *     revive_at = now + 30min. Match pve-battle.ts semantics exactly.
 *
 * Determinism:
 *   - seed is chosen at start (crypto-random 32-bit). collectAdventure
 *     runs a seeded mulberry32 PRNG so the report is fully reproducible
 *     from (seed, distance_ms, party snapshot). Re-collect is idempotent
 *     because collected_at + report_json are written in the same tx.
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import { one, q, run, tx, type AdventureRow, type RosterRow } from '../db/index.js';
import { loadCatalog } from '../digimon/xml.js';
import type { Stage, StagePools } from '../digimon/types.js';
import { awardXp } from '../progression/xp.js';
import { getXpRate } from '../settings/engine.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';

const MS_PER_HOUR = 3_600_000;
export const ADVENTURE_MIN_HOURS = 1;
export const ADVENTURE_MAX_HOURS = 8;
export const MEAT_PER_HOUR = 10;
export const MEAT_RESOURCE = 'Meat';
const ENCOUNTERS_PER_HOUR = 3;
const KO_CHANCE_ON_LOSS = 0.3;
const KO_REVIVE_MS = 30 * 60 * 1000;
const PARTY_SIZE = 3;

const SQL_SELECT_ACTIVE_ADVENTURE = `SELECT * FROM adventures WHERE user_id = ? AND collected_at IS NULL`;
const SQL_SELECT_LAST_COLLECTED = `SELECT * FROM adventures WHERE user_id = ? AND collected_at IS NOT NULL ORDER BY collected_at DESC LIMIT 1`;
const SQL_INSERT_ADVENTURE = `INSERT INTO adventures (id, user_id, mon_ids, distance_ms, meat_spent, started_at, collected_at, seed, report, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`;
const SQL_MARK_ADVENTURE_COLLECTED = `UPDATE adventures SET collected_at = ?, report = ? WHERE id = ? AND collected_at IS NULL`;
const SQL_SELECT_MON_FOR_USER = `SELECT * FROM player_roster WHERE id = ? AND user_id = ?`;
const SQL_UPDATE_MON_STATUS = `UPDATE player_roster SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`;
const SQL_UPDATE_MON_XP = `UPDATE player_roster
     SET level = ?, xp = ?,
         hp_bonus = ?, en_bonus = ?, atk_bonus = ?, def_bonus = ?, int_bonus = ?, spd_bonus = ?,
         updated_at = ?
     WHERE id = ? AND user_id = ?`;
const SQL_SET_REVIVE_AT = `UPDATE player_roster SET revive_at = ?, updated_at = ? WHERE id = ?`;
const SQL_UPSERT_RESOURCE = `INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, resource) DO UPDATE SET amount = resources.amount + excluded.amount, updated_at = excluded.updated_at`;
const SQL_ADD_NETCORE = `INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, 0, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET netcore = player_wallet.netcore + excluded.netcore, updated_at = excluded.updated_at`;
const SQL_SELECT_RESOURCE = `SELECT amount FROM resources WHERE user_id = ? AND resource = ?`;
const SQL_DECREMENT_RESOURCE = `UPDATE resources SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND resource = ? AND amount >= ?`;

export type AdventureMemberView = {
  readonly monId: string;
  readonly nickname: string;
  readonly catalogId: string;
  readonly level: number;
  readonly stage: Stage | 'Unknown';
  readonly reviveAt: number | null;
};

export type AdventureEncounter = {
  readonly index: number;
  readonly wildLevel: number;
  readonly outcome: 'win' | 'loss';
  readonly meat: number;
  readonly bits: number;
  readonly data: number;
  readonly netcore: number;
  readonly xpPerMon: number;
  readonly koMonId: string | null;
};

export type AdventureXpDelta = {
  readonly monId: string;
  readonly xpGained: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly gainedLevels: number;
};

export type AdventureReport = {
  readonly encounters: readonly AdventureEncounter[];
  readonly wins: number;
  readonly losses: number;
  readonly totals: { readonly meat: number; readonly bits: number; readonly data: number; readonly netcore: number };
  readonly xpDeltas: readonly AdventureXpDelta[];
  readonly koedMonIds: readonly string[];
};

export type AdventureView = {
  readonly id: string;
  readonly startedAt: number;
  readonly distanceMs: number;
  readonly finishesAt: number;
  readonly remainingMs: number;
  readonly ready: boolean;
  readonly meatSpent: number;
  readonly party: readonly AdventureMemberView[];
  readonly collectedAt: number | null;
  readonly report: AdventureReport | null;
};

export type AdventureConfigView = {
  readonly minHours: number;
  readonly maxHours: number;
  readonly meatPerHour: number;
  readonly encountersPerHour: number;
  readonly partySize: number;
};

export type AdventurePageView = {
  readonly active: AdventureView | null;
  readonly lastCollected: AdventureView | null;
  readonly meatOwned: number;
  readonly config: AdventureConfigView;
};

export type StartAdventureError =
  | 'invalid-party-size'
  | 'duplicate-mon'
  | 'mon-not-found'
  | 'mon-busy'
  | 'mon-downed'
  | 'mon-listed'
  | 'active-adventure-exists'
  | 'invalid-hours'
  | 'insufficient-meat';

export type CollectAdventureError = 'no-adventure' | 'not-ready';

/**
 * mulberry32 — small, fast, seeded PRNG that produces 32 bits of state
 * per call. Adventure reports must be reproducible from the seed alone
 * so a retried collect on network failure yields the same encounters,
 * loot, and KO decisions.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

function parseMonIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed;
  } catch {}
  return [];
}

function parseReport(raw: string | null): AdventureReport | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as AdventureReport;
  } catch {
    return null;
  }
}

function parseStagePools(raw: string | null): Partial<StagePools> | undefined {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as Partial<StagePools>;
  } catch {
    return undefined;
  }
}

function monToMemberView(row: RosterRow): AdventureMemberView {
  const catalog = loadCatalog();
  const tpl = catalog.digimons.find((d) => d.id === row.catalog_id);
  return {
    monId: row.id,
    nickname: row.nickname,
    catalogId: row.catalog_id,
    level: row.level,
    stage: tpl?.stage ?? 'Unknown',
    reviveAt: row.revive_at,
  };
}

function rowToView(row: AdventureRow, monRows: readonly RosterRow[], now: number): AdventureView {
  const finishesAt = row.started_at + row.distance_ms;
  const remainingMs = row.collected_at !== null ? 0 : Math.max(0, finishesAt - now);
  const ready = row.collected_at === null && now >= finishesAt;
  const ids = parseMonIds(row.mon_ids);
  const byId = new Map(monRows.map((m) => [m.id, m] as const));
  const party = ids
    .map((id) => byId.get(id))
    .filter((m): m is RosterRow => m !== undefined)
    .map(monToMemberView);
  return {
    id: row.id,
    startedAt: row.started_at,
    distanceMs: row.distance_ms,
    finishesAt,
    remainingMs,
    ready,
    meatSpent: row.meat_spent,
    party,
    collectedAt: row.collected_at,
    report: parseReport(row.report),
  };
}

async function loadPartyRows(userId: string, monIds: readonly string[]): Promise<RosterRow[]> {
  const rows: RosterRow[] = [];
  for (const id of monIds) {
    const row = await one<RosterRow>(SQL_SELECT_MON_FOR_USER, id, userId);
    if (row) rows.push(row);
  }
  return rows;
}

function makeConfig(): AdventureConfigView {
  return {
    minHours: ADVENTURE_MIN_HOURS,
    maxHours: ADVENTURE_MAX_HOURS,
    meatPerHour: MEAT_PER_HOUR,
    encountersPerHour: ENCOUNTERS_PER_HOUR,
    partySize: PARTY_SIZE,
  };
}

async function loadMeatOwned(userId: string): Promise<number> {
  const row = await one<{ amount: number }>(SQL_SELECT_RESOURCE, userId, MEAT_RESOURCE);
  return row?.amount ?? 0;
}

export async function readAdventurePage(userId: string): Promise<AdventurePageView> {
  const now = Date.now();
  const active = await one<AdventureRow>(SQL_SELECT_ACTIVE_ADVENTURE, userId);
  const last = await one<AdventureRow>(SQL_SELECT_LAST_COLLECTED, userId);
  const meatOwned = await loadMeatOwned(userId);
  const activeView = active ? await hydrateView(active, userId, now) : null;
  const lastView = last ? await hydrateView(last, userId, now) : null;
  return { active: activeView, lastCollected: lastView, meatOwned, config: makeConfig() };
}

async function hydrateView(row: AdventureRow, userId: string, now: number): Promise<AdventureView> {
  const monIds = parseMonIds(row.mon_ids);
  const monRows = await loadPartyRows(userId, monIds);
  return rowToView(row, monRows, now);
}

export async function startAdventure(
  userId: string,
  monIds: readonly string[],
  hours: number,
): Promise<
  | { ok: true; adventure: AdventureView; meatOwned: number }
  | { ok: false; error: StartAdventureError; details?: Record<string, unknown> }
> {
  if (!Number.isInteger(hours) || hours < ADVENTURE_MIN_HOURS || hours > ADVENTURE_MAX_HOURS) {
    return { ok: false, error: 'invalid-hours' };
  }
  if (monIds.length !== PARTY_SIZE) {
    return { ok: false, error: 'invalid-party-size' };
  }
  const unique = new Set(monIds);
  if (unique.size !== monIds.length) {
    return { ok: false, error: 'duplicate-mon' };
  }
  const existing = await one<AdventureRow>(SQL_SELECT_ACTIVE_ADVENTURE, userId);
  if (existing) {
    return { ok: false, error: 'active-adventure-exists' };
  }
  const monRows = await loadPartyRows(userId, monIds);
  if (monRows.length !== monIds.length) {
    return { ok: false, error: 'mon-not-found' };
  }
  const now = Date.now();
  for (const row of monRows) {
    if (row.status !== 'resting') return { ok: false, error: 'mon-busy', details: { monId: row.id, status: row.status } };
    if (row.listed_at !== null) return { ok: false, error: 'mon-listed', details: { monId: row.id } };
    if (row.revive_at !== null && row.revive_at > now) return { ok: false, error: 'mon-downed', details: { monId: row.id, reviveAt: row.revive_at } };
  }
  const meatNeeded = hours * MEAT_PER_HOUR;
  const meatOwned = await loadMeatOwned(userId);
  if (meatOwned < meatNeeded) {
    return { ok: false, error: 'insufficient-meat', details: { need: meatNeeded, have: meatOwned } };
  }

  const distanceMs = hours * MS_PER_HOUR;
  const adventureId = newId('adv');
  const seed = randomSeed();
  const monIdsJson = JSON.stringify(monIds);

  await tx(async (t) => {
    const info = await t.run(SQL_DECREMENT_RESOURCE, [meatNeeded, now, userId, MEAT_RESOURCE, meatNeeded]);
    if (info.changes === 0) throw new Error('meat-race');
    for (const monId of monIds) {
      await t.run(SQL_UPDATE_MON_STATUS, ['adventure', now, monId, userId]);
    }
    await t.run(SQL_INSERT_ADVENTURE, [adventureId, userId, monIdsJson, distanceMs, meatNeeded, now, seed, now]);
  });

  const inserted = await one<AdventureRow>('SELECT * FROM adventures WHERE id = ?', adventureId);
  if (!inserted) throw new Error('startAdventure: row disappeared after insert');
  const view = await hydrateView(inserted, userId, now);
  const meatAfter = await loadMeatOwned(userId);
  log.info('adventure.start', {
    userId,
    adventureId,
    hours,
    distanceMs,
    meat: meatNeeded,
    party: monIds,
  });
  return { ok: true, adventure: view, meatOwned: meatAfter };
}

function encounterCount(hours: number): number {
  return Math.max(1, Math.round(hours * ENCOUNTERS_PER_HOUR));
}

function partyPower(monRows: readonly RosterRow[]): number {
  let total = 0;
  for (const m of monRows) {
    const bonusSum = m.hp_bonus + m.en_bonus + m.atk_bonus + m.def_bonus + m.int_bonus + m.spd_bonus;
    total += m.level * 12 + Math.floor(bonusSum * 0.4);
  }
  return total;
}

function rollEncounters(
  seed: number,
  hours: number,
  monRows: readonly RosterRow[],
): { encounters: AdventureEncounter[]; koedMonIds: string[] } {
  const rng = mulberry32(seed);
  const n = encounterCount(hours);
  const power = partyPower(monRows);
  const encounters: AdventureEncounter[] = [];
  const koedMonIds: string[] = [];
  const alreadyKoedInRun = new Set<string>();

  for (let i = 0; i < n; i++) {
    const wildLevel = Math.max(1, Math.round(2 + hours * 2 + rng() * hours * 2));
    const wildPower = wildLevel * 10 * PARTY_SIZE;
    const partyRoll = power * (0.9 + rng() * 0.2);
    const wildRoll = wildPower * (0.85 + rng() * 0.3);
    const outcome: 'win' | 'loss' = partyRoll >= wildRoll ? 'win' : 'loss';

    let meat = 0, bits = 0, data = 0, netcore = 0, xpPerMon = 0;
    let koMonId: string | null = null;

    if (outcome === 'win') {
      meat = Math.floor(1 + hours + rng() * 4);
      bits = Math.floor(1 + hours + rng() * 4);
      data = wildLevel >= 4 ? Math.floor(rng() * 3) : 0;
      netcore = Math.floor(3 + wildLevel * 1.5 + hours);
      xpPerMon = Math.floor(6 + wildLevel * 2 + hours);
    } else {
      netcore = Math.floor(1 + hours * 0.5);
      xpPerMon = Math.floor(2 + hours);
      if (rng() < KO_CHANCE_ON_LOSS) {
        const candidates = monRows.filter((m) => !alreadyKoedInRun.has(m.id));
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(rng() * candidates.length)]!;
          koMonId = pick.id;
          alreadyKoedInRun.add(pick.id);
          koedMonIds.push(pick.id);
        }
      }
    }

    encounters.push({ index: i, wildLevel, outcome, meat, bits, data, netcore, xpPerMon, koMonId });
  }

  return { encounters, koedMonIds };
}

export async function collectAdventure(
  userId: string,
): Promise<
  | { ok: true; adventure: AdventureView }
  | { ok: false; error: CollectAdventureError; details?: Record<string, unknown> }
> {
  const active = await one<AdventureRow>(SQL_SELECT_ACTIVE_ADVENTURE, userId);
  if (!active) return { ok: false, error: 'no-adventure' };

  const now = Date.now();
  const finishesAt = active.started_at + active.distance_ms;
  if (now < finishesAt) {
    return { ok: false, error: 'not-ready', details: { remainingMs: finishesAt - now } };
  }

  const hours = Math.max(1, Math.round(active.distance_ms / MS_PER_HOUR));
  const monIds = parseMonIds(active.mon_ids);
  const monRows = await loadPartyRows(userId, monIds);

  const { encounters, koedMonIds } = rollEncounters(active.seed, hours, monRows);
  const wins = encounters.filter((e) => e.outcome === 'win').length;
  const losses = encounters.length - wins;
  const totals = encounters.reduce(
    (acc, e) => ({
      meat: acc.meat + e.meat,
      bits: acc.bits + e.bits,
      data: acc.data + e.data,
      netcore: acc.netcore + e.netcore,
    }),
    { meat: 0, bits: 0, data: 0, netcore: 0 },
  );
  const xpByMon = new Map<string, number>();
  for (const m of monRows) xpByMon.set(m.id, 0);
  for (const e of encounters) {
    for (const monId of monIds) {
      xpByMon.set(monId, (xpByMon.get(monId) ?? 0) + e.xpPerMon);
    }
  }

  const xpRate = await getXpRate();
  const catalog = loadCatalog();
  const xpDeltas: AdventureXpDelta[] = [];

  await tx(async (t) => {
    for (const m of monRows) {
      const rawXp = xpByMon.get(m.id) ?? 0;
      if (rawXp > 0) {
        const scaledXp = Math.max(0, Math.round(rawXp * xpRate));
        const tpl = catalog.digimons.find((d) => d.id === m.catalog_id);
        const stage = tpl?.stage ?? 'Rookie';
        const currentBonus = {
          hp: m.hp_bonus, en: m.en_bonus, atk: m.atk_bonus,
          def: m.def_bonus, int: m.int_bonus, spd: m.spd_bonus,
        };
        const stagePools = parseStagePools(m.stage_pools);
        const grown = awardXp(m.level, m.xp, currentBonus, stage, scaledXp, tpl?.baseStats, stagePools, xpRate);
        await t.run(SQL_UPDATE_MON_XP, [
          grown.level, grown.xp,
          grown.bonus.hp, grown.bonus.en, grown.bonus.atk,
          grown.bonus.def, grown.bonus.int, grown.bonus.spd,
          now, m.id, userId,
        ]);
        xpDeltas.push({
          monId: m.id, xpGained: scaledXp,
          levelBefore: m.level, levelAfter: grown.level, gainedLevels: grown.gainedLevels,
        });
      }
      await t.run(SQL_UPDATE_MON_STATUS, ['resting', now, m.id, userId]);
      if (koedMonIds.includes(m.id)) {
        await t.run(SQL_SET_REVIVE_AT, [now + KO_REVIVE_MS, now, m.id]);
      }
    }
    if (totals.meat > 0) await t.run(SQL_UPSERT_RESOURCE, [userId, 'Meat', totals.meat, now]);
    if (totals.bits > 0) await t.run(SQL_UPSERT_RESOURCE, [userId, 'Bits', totals.bits, now]);
    if (totals.data > 0) await t.run(SQL_UPSERT_RESOURCE, [userId, 'Data', totals.data, now]);
    if (totals.netcore > 0) await t.run(SQL_ADD_NETCORE, [userId, totals.netcore, now]);

    const report: AdventureReport = { encounters, wins, losses, totals, xpDeltas, koedMonIds };
    const info = await t.run(SQL_MARK_ADVENTURE_COLLECTED, [now, JSON.stringify(report), active.id]);
    if (info.changes === 0) throw new Error('collect-race');
  });

  const collected = await one<AdventureRow>('SELECT * FROM adventures WHERE id = ?', active.id);
  if (!collected) throw new Error('collectAdventure: row disappeared after collect');
  const view = await hydrateView(collected, userId, Date.now());
  log.info('adventure.collect', {
    userId, adventureId: active.id, hours,
    encounters: encounters.length, wins, losses,
    totals, koedCount: koedMonIds.length,
  });
  return { ok: true, adventure: view };
}
