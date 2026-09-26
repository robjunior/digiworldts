/**
 * Adventure engine — idle 3-mon expeditions.
 *
 * Storage model:
 *   adventures                  = one row per expedition. Partial UNIQUE on
 *                                 (user_id, slot) WHERE collected_at IS NULL
 *                                 enforces at most ADVENTURE_MAX_ACTIVE
 *                                 concurrent expeditions per user.
 *   player_roster.status        = 'adventure' while a mon is on a run;
 *                                 flipped back to 'resting' on collect.
 *   resources[Meat]            is decremented at start with a progressive
 *                                 cost that grows with duration.
 *
 * Rewards:
 *   - Meat / Bits / Data / NetCore: scaled per encounter, aggregated
 *     into a report and awarded via SQL_UPSERT_RESOURCE + SQL_ADD_NETCORE.
 *   - Found digimons: every encounter rolls a real wild species from the
 *     catalog (stage-gated by hours, weighted by rarity). The unique
 *     species seen are listed in the report (`foundDigimons`) AND upserted
 *     into player_species_data so adventure encounters register in the
 *     Digidex (percent fill per encounter, kills per encounter).
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
import type { Catalog, Element, Stage, StagePools } from '../digimon/types.js';
import { awardXp } from '../progression/xp.js';
import { getXpRate } from '../settings/engine.js';
import { newId } from '../util/ids.js';
import { log } from '../util/log.js';
import { applyPremiumBonus, isUserPremium } from '../premium/index.js';

const MS_PER_HOUR = 3_600_000;
export const ADVENTURE_MIN_HOURS = 1;
export const ADVENTURE_MAX_HOURS = 8;
/** Base meat rate for the first hour of an expedition. */
export const MEAT_PER_HOUR = 10;
/** Each additional hour adds this to the hourly rate (progressive cost). */
export const MEAT_ESCALATION_PER_HOUR = 5;
/** Concurrent expeditions allowed per user (team slots 0..N-1). */
export const ADVENTURE_MAX_ACTIVE = 3;
export const MEAT_RESOURCE = 'Meat';
const ENCOUNTERS_PER_HOUR = 3;
const KO_CHANCE_ON_LOSS = 0.3;
const KO_REVIVE_MS = 30 * 60 * 1000;
const PARTY_SIZE = 3;
/** player_species_data.percent gained per found encounter (capped at 100). */
const SPECIES_PERCENT_PER_ENCOUNTER = 4;

/**
 * Progressive meat cost: hour i costs MEAT_PER_HOUR + ESCALATION*(i-1), so
 * longer runs pay an increasing per-hour rate. Sum of the arithmetic
 * progression: 1h=10, 2h=25, 3h=45, 4h=70, 5h=100, 6h=135, 7h=175, 8h=220.
 */
export function meatCostForHours(hours: number): number {
  const n = Math.max(1, Math.floor(hours));
  return Math.ceil((n * (2 * MEAT_PER_HOUR + (n - 1) * MEAT_ESCALATION_PER_HOUR)) / 2);
}

const SQL_SELECT_ACTIVE_ADVENTURE = `SELECT * FROM adventures WHERE user_id = ? AND collected_at IS NULL ORDER BY started_at LIMIT 1`;
const SQL_SELECT_ACTIVE_ADVENTURES = `SELECT * FROM adventures WHERE user_id = ? AND collected_at IS NULL ORDER BY started_at`;
const SQL_SELECT_ACTIVE_ADVENTURE_BY_ID = `SELECT * FROM adventures WHERE id = ? AND user_id = ? AND collected_at IS NULL`;
const SQL_SELECT_ACTIVE_SLOTS = `SELECT slot FROM adventures WHERE user_id = ? AND collected_at IS NULL`;
const SQL_SELECT_LAST_COLLECTED = `SELECT * FROM adventures WHERE user_id = ? AND collected_at IS NOT NULL ORDER BY collected_at DESC LIMIT 1`;
const SQL_INSERT_ADVENTURE = `INSERT INTO adventures (id, user_id, mon_ids, distance_ms, meat_spent, started_at, collected_at, seed, report, slot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`;
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
const SQL_UPSERT_SPECIES = `INSERT INTO player_species_data (user_id, catalog_id, percent, kills, updated_at)
     VALUES (?, ?, ?, 1, ?)
  ON CONFLICT(user_id, catalog_id) DO UPDATE
     SET percent = CASE
            WHEN player_species_data.percent + excluded.percent > 100 THEN 100
            ELSE player_species_data.percent + excluded.percent
          END,
         kills = player_species_data.kills + 1,
         updated_at = excluded.updated_at`;

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
  /** Wild species identity rolled from the catalog (Digidex-visible). */
  readonly wildCatalogId: string;
  readonly wildName: string;
  readonly wildStage: Stage;
  readonly wildElement: Element;
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

export type AdventureFoundDigimon = {
  readonly catalogId: string;
  readonly name: string;
  readonly stage: Stage;
  readonly element: Element;
  /** Number of encounters that rolled this species. */
  readonly count: number;
};

export type AdventureReport = {
  readonly encounters: readonly AdventureEncounter[];
  readonly wins: number;
  readonly losses: number;
  readonly totals: { readonly meat: number; readonly bits: number; readonly data: number; readonly netcore: number };
  readonly xpDeltas: readonly AdventureXpDelta[];
  readonly koedMonIds: readonly string[];
  /** Unique wild species encountered, first-seen order. */
  readonly foundDigimons: readonly AdventureFoundDigimon[];
  /** Premium activation at collect time — when true, totals/xp include the +50% bonus. */
  readonly premium: boolean;
  /**
   * The portion of each reward line attributable to the premium bonus (0 when
   * non-premium). Sum(base+bonus) = totals. Lets the UI render the bonus in gold.
   */
  readonly premiumBonus: {
    readonly meat: number;
    readonly bits: number;
    readonly data: number;
    readonly netcore: number;
    readonly xp: number;
  };
};

export type AdventureView = {
  readonly id: string;
  readonly slot: number;
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
  readonly meatEscalationPerHour: number;
  readonly encountersPerHour: number;
  readonly partySize: number;
  readonly maxActive: number;
};

export type AdventurePageView = {
  readonly active: readonly AdventureView[];
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
  | 'active-adventures-limit'
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

/**
 * True when a thrown error is a UNIQUE constraint violation — SQLite raises
 * `SQLITE_CONSTRAINT_UNIQUE`, Postgres `23505`. Used to map a slot-claim
 * race on startAdventure into a clean 'active-adventures-limit' error.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code ?? '';
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505';
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
    slot: row.slot,
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
    meatEscalationPerHour: MEAT_ESCALATION_PER_HOUR,
    encountersPerHour: ENCOUNTERS_PER_HOUR,
    partySize: PARTY_SIZE,
    maxActive: ADVENTURE_MAX_ACTIVE,
  };
}

async function loadMeatOwned(userId: string): Promise<number> {
  const row = await one<{ amount: number }>(SQL_SELECT_RESOURCE, userId, MEAT_RESOURCE);
  return row?.amount ?? 0;
}

export async function readAdventurePage(userId: string): Promise<AdventurePageView> {
  const now = Date.now();
  const activeRows = await q<AdventureRow>(SQL_SELECT_ACTIVE_ADVENTURES, userId);
  const last = await one<AdventureRow>(SQL_SELECT_LAST_COLLECTED, userId);
  const meatOwned = await loadMeatOwned(userId);
  const activeView = await Promise.all(activeRows.map((row) => hydrateView(row, userId, now)));
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
  const activeSlots = await q<{ slot: number }>(SQL_SELECT_ACTIVE_SLOTS, userId);
  if (activeSlots.length >= ADVENTURE_MAX_ACTIVE) {
    return { ok: false, error: 'active-adventures-limit', details: { maxActive: ADVENTURE_MAX_ACTIVE } };
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
  const meatNeeded = meatCostForHours(hours);
  const meatOwned = await loadMeatOwned(userId);
  if (meatOwned < meatNeeded) {
    return { ok: false, error: 'insufficient-meat', details: { need: meatNeeded, have: meatOwned } };
  }

  const distanceMs = hours * MS_PER_HOUR;
  const adventureId = newId('adv');
  const seed = randomSeed();
  const monIdsJson = JSON.stringify(monIds);

  try {
    await tx(async (t) => {
      // Re-read active slots INSIDE the tx for an authoritative view: the
      // partial UNIQUE (user_id, slot) is the race-safe backstop — if a
      // concurrent start claims the same slot, this insert fails and the
      // whole tx (meat deduction included) rolls back.
      const used = new Set((await t.query<{ slot: number }>(SQL_SELECT_ACTIVE_SLOTS, [userId])).map((r) => r.slot));
      let slot = 0;
      while (used.has(slot) && slot < ADVENTURE_MAX_ACTIVE) slot += 1;
      if (slot >= ADVENTURE_MAX_ACTIVE) throw new Error('adventure-slot-race');
      const info = await t.run(SQL_DECREMENT_RESOURCE, [meatNeeded, now, userId, MEAT_RESOURCE, meatNeeded]);
      if (info.changes === 0) throw new Error('meat-race');
      for (const monId of monIds) {
        await t.run(SQL_UPDATE_MON_STATUS, ['adventure', now, monId, userId]);
      }
      await t.run(SQL_INSERT_ADVENTURE, [adventureId, userId, monIdsJson, distanceMs, meatNeeded, now, seed, slot, now]);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Two concurrent starts picked the same slot — someone else won it.
      return { ok: false, error: 'active-adventures-limit', details: { maxActive: ADVENTURE_MAX_ACTIVE } };
    }
    throw err;
  }

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

// ---------------------------------------------------------------------------
// Wild species roll — "digimons encontrados".
//
// Every encounter picks a real species from the catalog so the report can
// show what was found and the Digidex can register the encounter. Longer
// expeditions unlock stronger stages; within the unlocked pool, rarer stages
// carry lower weights.
// ---------------------------------------------------------------------------
const STAGE_RANK: Record<Stage, number> = { Baby: 0, 'In-Training': 1, Rookie: 2, Champion: 3, Ultimate: 4, Mega: 5 };
const WILD_STAGE_WEIGHTS: Record<Stage, number> = {
  Baby: 1,
  'In-Training': 2,
  Rookie: 12,
  Champion: 6,
  Ultimate: 3,
  Mega: 1,
};

function maxWildStageForHours(hours: number): Stage {
  if (hours >= 7) return 'Mega';
  if (hours >= 5) return 'Ultimate';
  if (hours >= 3) return 'Champion';
  return 'Rookie';
}

function pickWildDigimon(
  rng: () => number,
  catalog: Catalog,
  hours: number,
): { catalogId: string; name: string; stage: Stage; element: Element } {
  const maxRank = STAGE_RANK[maxWildStageForHours(hours)];
  const pool = catalog.digimons.filter(
    (d) => (d.status ?? 'published') !== 'draft' && STAGE_RANK[d.stage] <= maxRank,
  );
  if (pool.length === 0) {
    // Catalog empty/absent (fresh install) — degrade to a nameless wild mon.
    return { catalogId: 'wild-unknown', name: 'Wild Digimon', stage: 'Rookie', element: 'null' };
  }
  const total = pool.reduce((acc, d) => acc + WILD_STAGE_WEIGHTS[d.stage], 0);
  let roll = rng() * total;
  for (const d of pool) {
    roll -= WILD_STAGE_WEIGHTS[d.stage];
    if (roll <= 0) return { catalogId: d.id, name: d.name, stage: d.stage, element: d.element };
  }
  const last = pool[pool.length - 1]!;
  return { catalogId: last.id, name: last.name, stage: last.stage, element: last.element };
}

function rollEncounters(
  seed: number,
  hours: number,
  monRows: readonly RosterRow[],
  catalog: Catalog,
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
    const wild = pickWildDigimon(rng, catalog, hours);

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

    encounters.push({
      index: i,
      wildLevel,
      wildCatalogId: wild.catalogId,
      wildName: wild.name,
      wildStage: wild.stage,
      wildElement: wild.element,
      outcome,
      meat,
      bits,
      data,
      netcore,
      xpPerMon,
      koMonId,
    });
  }

  return { encounters, koedMonIds };
}

/** Unique species encountered, first-seen order, with per-species counts. */
function collectFoundDigimons(encounters: readonly AdventureEncounter[]): AdventureFoundDigimon[] {
  const counts = new Map<string, number>();
  const order = new Map<string, AdventureFoundDigimon>();
  for (const e of encounters) {
    counts.set(e.wildCatalogId, (counts.get(e.wildCatalogId) ?? 0) + 1);
    if (!order.has(e.wildCatalogId)) {
      order.set(e.wildCatalogId, {
        catalogId: e.wildCatalogId,
        name: e.wildName,
        stage: e.wildStage,
        element: e.wildElement,
        count: 0,
      });
    }
  }
  return [...order.values()].map((f) => ({ ...f, count: counts.get(f.catalogId) ?? 0 }));
}

export async function collectAdventure(
  userId: string,
  adventureId?: string,
): Promise<
  | { ok: true; adventure: AdventureView }
  | { ok: false; error: CollectAdventureError; details?: Record<string, unknown> }
> {
  const active = adventureId
    ? await one<AdventureRow>(SQL_SELECT_ACTIVE_ADVENTURE_BY_ID, adventureId, userId)
    : await one<AdventureRow>(SQL_SELECT_ACTIVE_ADVENTURE, userId);
  if (!active) return { ok: false, error: 'no-adventure' };

  const now = Date.now();
  const finishesAt = active.started_at + active.distance_ms;
  if (now < finishesAt) {
    return { ok: false, error: 'not-ready', details: { remainingMs: finishesAt - now } };
  }

  const hours = Math.max(1, Math.round(active.distance_ms / MS_PER_HOUR));
  const monIds = parseMonIds(active.mon_ids);
  const monRows = await loadPartyRows(userId, monIds);
  const catalog = loadCatalog();

  const { encounters, koedMonIds } = rollEncounters(active.seed, hours, monRows, catalog);
  const wins = encounters.filter((e) => e.outcome === 'win').length;
  const losses = encounters.length - wins;
  const premium = await isUserPremium(userId, now);
  const baseTotals = encounters.reduce(
    (acc, e) => ({
      meat: acc.meat + e.meat,
      bits: acc.bits + e.bits,
      data: acc.data + e.data,
      netcore: acc.netcore + e.netcore,
    }),
    { meat: 0, bits: 0, data: 0, netcore: 0 },
  );
  const totals = {
    meat: applyPremiumBonus(baseTotals.meat, premium),
    bits: applyPremiumBonus(baseTotals.bits, premium),
    data: applyPremiumBonus(baseTotals.data, premium),
    netcore: applyPremiumBonus(baseTotals.netcore, premium),
  };
  const premiumBonus = {
    meat: totals.meat - baseTotals.meat,
    bits: totals.bits - baseTotals.bits,
    data: totals.data - baseTotals.data,
    netcore: totals.netcore - baseTotals.netcore,
    xp: 0, // filled below per-mon (bonus on top of the applied xp)
  };
  const xpByMon = new Map<string, number>();
  for (const m of monRows) xpByMon.set(m.id, 0);
  for (const e of encounters) {
    for (const monId of monIds) {
      xpByMon.set(monId, (xpByMon.get(monId) ?? 0) + e.xpPerMon);
    }
  }
  const foundDigimons = collectFoundDigimons(encounters);

  const xpRate = await getXpRate();
  const xpDeltas: AdventureXpDelta[] = [];
  let totalXpBonus = 0;

  await tx(async (t) => {
    for (const m of monRows) {
      const rawXp = xpByMon.get(m.id) ?? 0;
      if (rawXp > 0) {
        const scaledXp = Math.max(0, Math.round(rawXp * xpRate));
        const boostedXp = applyPremiumBonus(scaledXp, premium);
        totalXpBonus += boostedXp - scaledXp;
        const tpl = catalog.digimons.find((d) => d.id === m.catalog_id);
        const stage = tpl?.stage ?? 'Rookie';
        const currentBonus = {
          hp: m.hp_bonus, en: m.en_bonus, atk: m.atk_bonus,
          def: m.def_bonus, int: m.int_bonus, spd: m.spd_bonus,
        };
        const stagePools = parseStagePools(m.stage_pools);
        const grown = awardXp(m.level, m.xp, currentBonus, stage, boostedXp, tpl?.baseStats, stagePools, xpRate);
        await t.run(SQL_UPDATE_MON_XP, [
          grown.level, grown.xp,
          grown.bonus.hp, grown.bonus.en, grown.bonus.atk,
          grown.bonus.def, grown.bonus.int, grown.bonus.spd,
          now, m.id, userId,
        ]);
        xpDeltas.push({
          monId: m.id, xpGained: boostedXp,
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
    // Register found species in the Digidex (met + kills + percent fill).
    for (const f of foundDigimons) {
      if (f.catalogId === 'wild-unknown') continue;
      await t.run(SQL_UPSERT_SPECIES, [userId, f.catalogId, SPECIES_PERCENT_PER_ENCOUNTER * f.count, now]);
    }

    const report: AdventureReport = {
      encounters, wins, losses, totals, xpDeltas, koedMonIds, foundDigimons,
      premium,
      premiumBonus: { ...premiumBonus, xp: totalXpBonus },
    };
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
