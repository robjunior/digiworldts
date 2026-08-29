import type {
  Ailment,
  Element,
  PvpQuestCategory,
  PvpQuestParams,
  PvpQuestPeriod,
  PvpQuestReward,
  PvpQuestTemplate,
} from '@digiworld/shared/pvp-quest';
import { ELEMENTS, AILMENTS } from '@digiworld/shared/digimon';
import { DEBUFF_AILMENTS } from '@digiworld/shared/pvp-quest';
import { newId } from '../util/ids.js';
import { ELEMENT_POOL } from './registry.js';

/**
 * Procedural generator.
 *
 * Quests are not hand-authored. A small set of *templates* (category + parameter
 * space) is combined with per-period *scaling ranges* (how big the target gets)
 * and a seeded RNG to produce a deterministic-but-varied board of quests each
 * period. Everything is config-driven — no values are hard-coded in logic.
 */

export interface Range {
  min: number;
  max: number;
}

/** How each category's numeric `target` scales with the period. */
export type ScalingMap = Partial<Record<PvpQuestCategory, Range>>;

/**
 * Per-period difficulty bands. Tunable in one place. `null` range on a category
 * means "do not generate this category for that period".
 */
export interface PeriodScaling {
  DAILY: ScalingMap;
  WEEKLY: ScalingMap;
  MONTHLY: ScalingMap;
}

export const DEFAULT_SCALING: PeriodScaling = {
  DAILY: {
    VICTORY: { min: 1, max: 5 },
    WIN_STREAK: { min: 2, max: 3 },
    BATTLE_COUNT: { min: 3, max: 8 },
    KILLS: { min: 3, max: 10 },
    ELEMENT_KILLS: { min: 3, max: 10 },
    UNIQUE_ELEMENTS: { min: 1, max: 3 },
    SUPER_EFFECTIVE: { min: 1, max: 5 },
    DISADVANTAGE: { min: 1, max: 3 },
    TEAM_SURVIVAL: { min: 1, max: 3 },
    PERFECT_WIN: { min: 1, max: 3 },
    COMEBACK: { min: 1, max: 2 },
    DAMAGE: { min: 3000, max: 12000 },
    CRITICAL: { min: 1, max: 5 },
    STATUS: { min: 1, max: 5 },
    DEBUFF: { min: 1, max: 5 },
    TURNS: { min: 1, max: 3 },
    DIVERSE_TEAM: { min: 1, max: 3 },
    OPPONENT_COMPOSITION: { min: 1, max: 3 },
  },
  WEEKLY: {
    VICTORY: { min: 5, max: 25 },
    WIN_STREAK: { min: 3, max: 5 },
    BATTLE_COUNT: { min: 10, max: 40 },
    KILLS: { min: 15, max: 100 },
    ELEMENT_KILLS: { min: 10, max: 50 },
    UNIQUE_ELEMENTS: { min: 3, max: 6 },
    SUPER_EFFECTIVE: { min: 5, max: 50 },
    DISADVANTAGE: { min: 3, max: 10 },
    TEAM_SURVIVAL: { min: 3, max: 10 },
    PERFECT_WIN: { min: 3, max: 10 },
    COMEBACK: { min: 2, max: 5 },
    DAMAGE: { min: 30000, max: 150000 },
    CRITICAL: { min: 10, max: 50 },
    STATUS: { min: 5, max: 25 },
    DEBUFF: { min: 5, max: 25 },
    TURNS: { min: 3, max: 10 },
    DIVERSE_TEAM: { min: 3, max: 10 },
    OPPONENT_COMPOSITION: { min: 3, max: 10 },
  },
  MONTHLY: {
    VICTORY: { min: 25, max: 150 },
    WIN_STREAK: { min: 5, max: 10 },
    BATTLE_COUNT: { min: 50, max: 200 },
    KILLS: { min: 100, max: 500 },
    ELEMENT_KILLS: { min: 50, max: 300 },
    UNIQUE_ELEMENTS: { min: 6, max: ELEMENTS.filter((e) => e !== 'null').length },
    SUPER_EFFECTIVE: { min: 25, max: 250 },
    DISADVANTAGE: { min: 10, max: 50 },
    TEAM_SURVIVAL: { min: 10, max: 30 },
    PERFECT_WIN: { min: 10, max: 30 },
    COMEBACK: { min: 5, max: 15 },
    DAMAGE: { min: 200000, max: 1000000 },
    CRITICAL: { min: 50, max: 250 },
    STATUS: { min: 25, max: 100 },
    DEBUFF: { min: 25, max: 100 },
    TURNS: { min: 5, max: 25 },
    DIVERSE_TEAM: { min: 10, max: 40 },
    OPPONENT_COMPOSITION: { min: 10, max: 40 },
  },
};

/**
 * Rewards scale with the period too, so a monthly grant dwarfs a daily one
 * without any per-quest hard-coding. Reward kind is intentionally generic.
 */
export interface RewardTier {
  kind: PvpQuestReward['kind'];
  perTarget: number;
  min: number;
  max: number;
}

export const REWARD_TIERS: Record<PvpQuestPeriod, RewardTier> = {
  DAILY: { kind: 'netcore', perTarget: 2, min: 20, max: 200 },
  WEEKLY: { kind: 'netcore', perTarget: 3, min: 200, max: 1500 },
  MONTHLY: { kind: 'pvp_points', perTarget: 1, min: 1000, max: 10000 },
};

/** Mulberry32 — tiny, fast, seedable PRNG so a period board is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function quantizeDamage(rng: () => number, r: Range): number {
  // Damage targets land on friendly steps (e.g. x1000) for readability.
  const base = randInt(rng, r.min, r.max);
  return Math.max(r.min, Math.round(base / 1000) * 1000);
}

function buildParams(rng: () => number, category: PvpQuestCategory): PvpQuestParams {
  switch (category) {
    case 'ELEMENT_KILLS':
      return { element: pick(rng, ELEMENT_POOL) } as PvpQuestParams;
    case 'DISADVANTAGE':
      return { mode: pick(rng, ['kill', 'victory'] as const) } as PvpQuestParams;
    case 'TEAM_SURVIVAL': {
      const mode = rng();
      if (mode < 0.34) return { minimumSurvivors: randInt(rng, 2, 3) } as PvpQuestParams;
      if (mode < 0.67) return { maximumSurvivors: randInt(rng, 1, 2) } as PvpQuestParams;
      return { minimumSurvivors: 3, maximumSurvivors: 3 } as PvpQuestParams;
    }
    case 'STATUS': {
      const t = rng() < 0.4 ? pick(rng, AILMENTS as readonly Ailment[]) : undefined;
      return (t ? { statusType: t } : {}) as PvpQuestParams;
    }
    case 'DEBUFF': {
      const t = rng() < 0.4 ? pick(rng, DEBUFF_AILMENTS) : undefined;
      return (t ? { debuffType: t } : {}) as PvpQuestParams;
    }
    case 'TURNS': {
      const op: '<=' | '>=' = rng() < 0.5 ? '<=' : '>=';
      return { operator: op, requiredTurns: randInt(rng, 5, 20), requireWin: rng() < 0.6 } as PvpQuestParams;
    }
    case 'DIVERSE_TEAM':
      return { requiredUniqueElements: randInt(rng, 2, 3) } as PvpQuestParams;
    case 'OPPONENT_COMPOSITION': {
      if (rng() < 0.5) return { requiredUniqueElements: randInt(rng, 2, 3) } as PvpQuestParams;
      return { requiredSameElementPair: true } as PvpQuestParams;
    }
    default:
      return {} as PvpQuestParams;
  }
}

function targetFor(category: PvpQuestCategory, period: PvpQuestPeriod, scaling: PeriodScaling, rng: () => number): number {
  const range = scaling[period][category];
  if (!range) return 1;
  if (category === 'DAMAGE') return quantizeDamage(rng, range);
  return randInt(rng, range.min, range.max);
}

function rewardFor(period: PvpQuestPeriod, target: number, rng: () => number, tier: RewardTier): PvpQuestReward {
  const raw = tier.perTarget * target + randInt(rng, 0, Math.max(0, Math.floor(target / 4)));
  const amount = Math.min(tier.max, Math.max(tier.min, raw));
  switch (tier.kind) {
    case 'netcore':
      return { kind: 'netcore', amount };
    case 'credits':
      return { kind: 'credits', amount };
    case 'pvp_points':
      return { kind: 'pvp_points', amount };
    case 'xp':
      return { kind: 'xp', amount };
    case 'item':
      return { kind: 'item', itemId: 'itm_generic', qty: amount };
    case 'cosmetic':
      return { kind: 'cosmetic', cosmeticId: 'cos_generic' };
  }
}

export interface GenerateOptions {
  /** How many quests per period. */
  count?: number;
  scaling?: PeriodScaling;
  /** Seed the RNG for reproducible boards (default: hash of period window). */
  seed?: number;
}

const ALL_CATEGORIES = [
  'VICTORY', 'WIN_STREAK', 'BATTLE_COUNT', 'KILLS', 'ELEMENT_KILLS', 'UNIQUE_ELEMENTS',
  'SUPER_EFFECTIVE', 'DISADVANTAGE', 'TEAM_SURVIVAL', 'PERFECT_WIN', 'COMEBACK',
  'DAMAGE', 'CRITICAL', 'STATUS', 'DEBUFF', 'TURNS', 'DIVERSE_TEAM', 'OPPONENT_COMPOSITION',
] as const;

/**
 * Generate one period's board. `seed` should be derived from the period window
 * (see periods.ts) so the same window always yields the same quests, but a new
 * window yields a fresh set. The caller (repo) dedupes by (period, window,
 * instanceId) so re-generation never double-counts.
 */
export function generateBoard(
  period: PvpQuestPeriod,
  opts: GenerateOptions = {},
): PvpQuestTemplate[] {
  const scaling = opts.scaling ?? DEFAULT_SCALING;
  const count = opts.count ?? 8;
  const rng = makeRng(opts.seed ?? 0x9e3779b9);
  const out: PvpQuestTemplate[] = [];
  const used = new Set<string>();
  let guard = 0;
  while (out.length < count && guard < count * 12) {
    guard += 1;
    const category = pick(rng, ALL_CATEGORIES) as PvpQuestCategory;
    if (!scaling[period][category]) continue;
    const params = buildParams(rng, category);
    const target = targetFor(category, period, scaling, rng);
    const dedupKey = `${category}:${JSON.stringify(params)}:${target}`;
    if (used.has(dedupKey)) continue;
    used.add(dedupKey);
    const tier = REWARD_TIERS[period];
    out.push({
      // Deterministic id from generation order so the same window always yields
      // the same instances (reset-safe dedup by period+windowId+instanceId).
      instanceId: `pvq_${out.length}`,
      period,
      category,
      params,
      target,
      reward: rewardFor(period, target, rng, tier),
    });
  }
  return out;
}
