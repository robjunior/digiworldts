/**
 * Daily rewards: continuous progression with escalating cycles and long-term milestones.
 *
 * Design goals:
 * - Competitive: a full week of claims ≈ what a player earns in active play.
 * - Exclusive: milestone days grant items unavailable anywhere else.
 * - Progressive: each cycle's payout dwarfs the previous one.
 * - Retention: streak counter tracks long-term consistency (shown in UI).
 * - Long-term: milestones at 60/90/180/365 days with unique rewards.
 * - Seasonal: every 90 days a new season with themed exclusive rewards.
 *
 *   GET  /api/daily          → { streakDay, cycleDay, canClaim, secondsUntilNext, cycle, lastClaimAt, longestStreak, season, totalCycles }
 *   POST /api/daily/claim    → grants today's reward, updates wallet + resources + streak
 *
 * Rewards mix resources + credits + exclusive items.
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { one, run, tx, type WalletRow } from '../db/index.js';
import { log } from '../util/log.js';
import { emit } from '../telemetry/emit.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 48 * 60 * 60 * 1000;
const CYCLE_LENGTH = 30;
const SEASON_LENGTH = 90;

export type DayReward = {
  day: number;
  meat?: number;
  bits?: number;
  data?: number;
  netcore?: number;
  credits?: number;
  exclusiveItem?: string;
  exclusiveItem2?: string;
};

/**
 * Base 30-day cycle. Milestone days (7/14/21/30) grant exclusive items:
 * - Day 7:  Evolution Fragment (random element) — needed for crafting/evolution
 * - Day 14: Cypher (evolution key) — used in evolution for element affinity
 * - Day 21: Premium 3-day trial — convenience + production boost
 * - Day 30: Gold Badge (cosmetic) + massive netcore + premium 7-day
 *
 * Netcore totals: Week 1 ≈ 1,500 · Week 2 ≈ 3,000 · Week 3 ≈ 4,500 · Week 4 ≈ 6,000+ (day 30 = 3,000 alone)
 * Full cycle ≈ 15,000+ netcore + 4 exclusive items.
 */
const BASE_CYCLE: readonly DayReward[] = [
  // ── Week 1 (days 1-7) ── netcore ~1500
  { day: 1,  meat: 50,  bits: 30,  netcore: 100, credits: 25 },
  { day: 2,  data: 30,  netcore: 150, credits: 30 },
  { day: 3,  meat: 80,  netcore: 200, credits: 35 },
  { day: 4,  bits: 60,  data: 50,  netcore: 250, credits: 40 },
  { day: 5,  meat: 100, netcore: 300, credits: 45 },
  { day: 6,  bits: 80,  netcore: 350, credits: 50 },
  { day: 7,  meat: 120, bits: 100, data: 60, netcore: 400, credits: 60, exclusiveItem: 'evo-fragment' },

  // ── Week 2 (days 8-14) ── netcore ~3000
  { day: 8,  data: 80,  netcore: 400, credits: 65 },
  { day: 9,  meat: 150, netcore: 450, credits: 70 },
  { day: 10, bits: 100, netcore: 500, credits: 75 },
  { day: 11, meat: 180, data: 100, netcore: 550, credits: 80 },
  { day: 12, bits: 120, netcore: 600, credits: 85 },
  { day: 13, meat: 200, netcore: 700, credits: 90 },
  { day: 14, meat: 220, bits: 150, data: 120, netcore: 800, credits: 100, exclusiveItem: 'cypher' },

  // ── Week 3 (days 15-21) ── netcore ~4500
  { day: 15, data: 150, netcore: 600, credits: 100 },
  { day: 16, meat: 250, netcore: 700, credits: 110 },
  { day: 17, bits: 180, netcore: 750, credits: 120 },
  { day: 18, meat: 280, data: 150, netcore: 800, credits: 130 },
  { day: 19, bits: 200, netcore: 900, credits: 140 },
  { day: 20, meat: 300, netcore: 1000, credits: 150 },
  { day: 21, meat: 320, bits: 220, data: 180, netcore: 1200, credits: 175, exclusiveItem: 'premium-3d' },

  // ── Week 4 (days 22-30) ── netcore ~6000 + day 30 jackpot
  { day: 22, data: 200, netcore: 800, credits: 150 },
  { day: 23, meat: 350, netcore: 900, credits: 160 },
  { day: 24, bits: 250, netcore: 1000, credits: 170 },
  { day: 25, meat: 400, data: 220, netcore: 1100, credits: 180 },
  { day: 26, bits: 280, netcore: 1200, credits: 190 },
  { day: 27, meat: 450, netcore: 1300, credits: 200 },
  { day: 28, meat: 500, bits: 300, data: 250, netcore: 1400, credits: 225 },
  { day: 29, netcore: 1500, credits: 250 },
  { day: 30, meat: 600, bits: 400, data: 300, netcore: 3000, credits: 500, exclusiveItem: 'gold-badge', exclusiveItem2: 'premium-7d' },
];

/**
 * Long-term milestone rewards. These are granted ONCE when the player reaches
 * the specified streak day. They are not part of the repeating cycle.
 */
const MILESTONES: Record<number, { itemId: string; qty: number; description: string; netcore?: number; credits?: number }> = {
  60:  { itemId: 'itm-cos-badge-platinum', qty: 1, description: 'Platinum Badge', netcore: 5000, credits: 1000 },
  90:  { itemId: 'itm-cos-badge-diamond', qty: 1, description: 'Diamond Badge', netcore: 10000, credits: 2000 },
  180: { itemId: 'itm-cos-badge-legend', qty: 1, description: 'Legend Badge', netcore: 25000, credits: 5000 },
  365: { itemId: 'itm-cos-badge-mythic', qty: 1, description: 'Mythic Badge', netcore: 100000, credits: 20000 },
};

/**
 * Seasonal exclusive rewards. Each season (90 days) has a themed reward
 * granted on day 30 of that season. The season is determined by the
 * player's total streak day.
 */
const SEASON_REWARDS: Record<number, { itemId: string; qty: number; description: string }> = {
  1: { itemId: 'itm-cos-season1', qty: 1, description: 'Season 1 Champion' },
  2: { itemId: 'itm-cos-season2', qty: 1, description: 'Season 2 Champion' },
  3: { itemId: 'itm-cos-season3', qty: 1, description: 'Season 3 Champion' },
  4: { itemId: 'itm-cos-season4', qty: 1, description: 'Season 4 Champion' },
};

const EXCLUSIVE_ITEMS: Record<string, { itemId: string; qty: number; description: string }> = {
  'evo-fragment': { itemId: 'itm-essence-fire', qty: 1, description: 'Fire Essence' },
  'cypher': { itemId: 'itm-core-rare', qty: 1, description: 'Rare Core' },
  'premium-3d': { itemId: 'itm-premium-7d', qty: 1, description: 'Premium 7 days' },
  'gold-badge': { itemId: 'itm-cos-badge-gold', qty: 1, description: 'Gold Badge' },
  'premium-7d': { itemId: 'itm-premium-7d', qty: 1, description: 'Premium 7 days' },
};

const SQL_SELECT_WALLET = `SELECT * FROM player_wallet WHERE user_id = ?`;
const SQL_INSERT_WALLET = `INSERT INTO player_wallet (user_id, credits, netcore, streak_day, last_claim_at, longest_streak, total_cycles, season, updated_at) VALUES (?, 0, 0, 0, NULL, 0, 0, 1, ?)
     ON CONFLICT(user_id) DO NOTHING`;
const SQL_UPDATE_WALLET = `UPDATE player_wallet SET netcore = netcore + ?, credits = credits + ?, streak_day = ?, last_claim_at = ?, longest_streak = ?, total_cycles = ?, season = ?, updated_at = ? WHERE user_id = ?`;
const SQL_UPSERT_RESOURCE = `INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, resource) DO UPDATE SET amount = resources.amount + excluded.amount, updated_at = excluded.updated_at`;
const SQL_UPSERT_INVENTORY = `INSERT INTO player_inventory (user_id, item_id, qty, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = player_inventory.qty + excluded.qty, updated_at = excluded.updated_at`;
const SQL_GRANT_PREMIUM = `UPDATE player_wallet SET premium_until = ?, updated_at = ? WHERE user_id = ?`;

async function loadWallet(userId: string): Promise<WalletRow> {
  let w = await one<WalletRow>(SQL_SELECT_WALLET, userId);
  if (!w) {
    await run(SQL_INSERT_WALLET, userId, Date.now());
    w = await one<WalletRow>(SQL_SELECT_WALLET, userId);
    if (!w) throw new Error(`wallet init failed for ${userId}`);
  }
  return w;
}

/**
 * Given the last claim time and current streak, decide next day + whether we
 * are inside the grace window (streak continues) or beyond it (streak resets).
 */
export function nextDayFor(now: number, lastClaimAt: number | null, currentStreak: number): {
  nextDay: number;
  reset: boolean;
} {
  if (lastClaimAt === null) return { nextDay: 1, reset: currentStreak !== 0 };
  const elapsed = now - lastClaimAt;
  if (elapsed < DAY_MS) return { nextDay: 0, reset: false };
  if (elapsed > GRACE_MS) return { nextDay: 1, reset: true };
  return { nextDay: currentStreak >= CYCLE_LENGTH ? 1 : currentStreak + 1, reset: currentStreak >= CYCLE_LENGTH };
}

/**
 * Calculate the cycle multiplier based on total completed cycles.
 * Each completed cycle increases the multiplier by 0.5x.
 */
function getCycleMultiplier(totalCycles: number): number {
  return 1 + totalCycles * 0.5;
}

/**
 * Calculate the current season based on total streak day.
 * Season 1 = days 1-90, Season 2 = days 91-180, etc.
 */
function getSeason(streakDay: number): number {
  return Math.floor((streakDay - 1) / SEASON_LENGTH) + 1;
}

/**
 * Get the reward for a specific day, applying the cycle multiplier.
 */
function getRewardForDay(day: number, totalCycles: number): DayReward {
  const base = BASE_CYCLE[(day - 1) % CYCLE_LENGTH]!;
  const mult = getCycleMultiplier(totalCycles);
  const reward: DayReward = { day: base.day };
  if (base.meat) reward.meat = Math.floor(base.meat * mult);
  if (base.bits) reward.bits = Math.floor(base.bits * mult);
  if (base.data) reward.data = Math.floor(base.data * mult);
  if (base.netcore) reward.netcore = Math.floor(base.netcore * mult);
  if (base.credits) reward.credits = Math.floor(base.credits * mult);
  if (base.exclusiveItem) reward.exclusiveItem = base.exclusiveItem;
  if (base.exclusiveItem2) reward.exclusiveItem2 = base.exclusiveItem2;
  return reward;
}

/**
 * Get the full cycle with multipliers applied.
 */
function getCycle(totalCycles: number): DayReward[] {
  return BASE_CYCLE.map((_, i) => getRewardForDay(i + 1, totalCycles));
}

function getExclusiveItem(kind: string): { itemId: string; qty: number; description: string } | null {
  const entry = EXCLUSIVE_ITEMS[kind];
  if (!entry) return null;
  return { ...entry };
}

export const dailyPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/daily', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const w = await loadWallet(me.id);
    const now = Date.now();
    const step = nextDayFor(now, w.last_claim_at, w.streak_day);
    const canClaim = step.nextDay > 0;
    const secondsUntilNext = !canClaim && w.last_claim_at
      ? Math.max(0, Math.ceil((w.last_claim_at + DAY_MS - now) / 1000))
      : 0;
    const season = getSeason(w.streak_day);
    return reply.send({
      streakDay: w.streak_day,
      cycleDay: step.nextDay,
      longestStreak: w.longest_streak,
      canClaim,
      wouldGrantDay: step.nextDay,
      wouldReset: step.reset,
      secondsUntilNext,
      lastClaimAt: w.last_claim_at,
      cycle: getCycle(w.total_cycles ?? 0),
      season,
      totalCycles: w.total_cycles ?? 0,
    });
  });

  app.post('/api/daily/claim', async (req, reply) => {
    const me = await requireAuth(req, reply);
    const w = await loadWallet(me.id);
    const now = Date.now();
    const step = nextDayFor(now, w.last_claim_at, w.streak_day);
    if (step.nextDay === 0) {
      const secondsUntilNext = w.last_claim_at
        ? Math.max(0, Math.ceil((w.last_claim_at + DAY_MS - now) / 1000))
        : 0;
      return reply.code(409).send({ error: 'already claimed today', secondsUntilNext });
    }

    const totalCycles = w.total_cycles ?? 0;
    const reward = getRewardForDay(step.nextDay, totalCycles);
    const newLongest = Math.max(w.longest_streak, step.nextDay);
    const newTotalCycles = step.nextDay === 1 && w.streak_day >= CYCLE_LENGTH
      ? totalCycles + 1
      : totalCycles;
    const newSeason = getSeason(step.nextDay);

    // Build item grants list
    const itemGrants: Array<{ itemId: string; qty: number; description: string }> = [];
    if (reward.exclusiveItem) {
      const item = getExclusiveItem(reward.exclusiveItem);
      if (item) itemGrants.push(item);
    }
    if (reward.exclusiveItem2) {
      const item = getExclusiveItem(reward.exclusiveItem2);
      if (item) itemGrants.push(item);
    }

    // Check for long-term milestone rewards
    const milestone = MILESTONES[step.nextDay];
    if (milestone) {
      itemGrants.push({ itemId: milestone.itemId, qty: milestone.qty, description: milestone.description });
    }

    // Check for seasonal rewards (day 30 of each season)
    if (step.nextDay % SEASON_LENGTH === 0) {
      const seasonNum = getSeason(step.nextDay);
      const seasonReward = SEASON_REWARDS[seasonNum];
      if (seasonReward) {
        itemGrants.push({ ...seasonReward });
      }
    }

    await tx(async (t) => {
      // Update wallet: netcore + credits + streak + cycles + season
      await t.run(SQL_UPDATE_WALLET, [
        reward.netcore ?? 0,
        reward.credits ?? 0,
        step.nextDay,
        now,
        newLongest,
        newTotalCycles,
        newSeason,
        now,
        me.id,
      ]);

      // Update resources
      if (reward.meat) await t.run(SQL_UPSERT_RESOURCE, [me.id, 'Meat', reward.meat, now]);
      if (reward.bits) await t.run(SQL_UPSERT_RESOURCE, [me.id, 'Bits', reward.bits, now]);
      if (reward.data) await t.run(SQL_UPSERT_RESOURCE, [me.id, 'Data', reward.data, now]);

      // Grant exclusive items
      for (const item of itemGrants) {
        await t.run(SQL_UPSERT_INVENTORY, [me.id, item.itemId, item.qty, now]);
      }

      // Handle premium grants
      if (reward.exclusiveItem === 'premium-3d' || reward.exclusiveItem2 === 'premium-7d') {
        const days = reward.exclusiveItem === 'premium-3d' ? 3 : 7;
        const walletRow = await t.one<{ premium_until: number | null }>(
          `SELECT premium_until FROM player_wallet WHERE user_id = ?`,
          [me.id],
        );
        const cur = walletRow?.premium_until ?? 0;
        const base = cur > now ? cur : now;
        const premiumUntil = base + days * 86_400_000;
        await t.run(SQL_GRANT_PREMIUM, [premiumUntil, now, me.id]);
      }

      // Handle milestone netcore/credits
      if (milestone?.netcore) {
        await t.run(SQL_UPDATE_WALLET, [
          milestone.netcore,
          milestone.credits ?? 0,
          step.nextDay,
          now,
          newLongest,
          newTotalCycles,
          newSeason,
          now,
          me.id,
        ]);
      }
    });

    log.info('daily.claim', { userId: me.id, day: step.nextDay, reset: step.reset, items: itemGrants.length, season: newSeason, totalCycles: newTotalCycles });
    emit({
      event: 'daily.claim',
      userId: me.id,
      distinctId: me.id,
      props: {
        streak_day: step.nextDay,
        streak_reset: step.reset,
        longest_streak: newLongest,
        netcore_reward: reward.netcore ?? 0,
        credits_reward: reward.credits ?? 0,
        meat_reward: reward.meat ?? 0,
        bits_reward: reward.bits ?? 0,
        data_reward: reward.data ?? 0,
        exclusive_items: itemGrants.map((i) => i.description).join(', '),
        season: newSeason,
        total_cycles: newTotalCycles,
      },
    });
    return reply.send({
      streakDay: step.nextDay,
      reset: step.reset,
      longestStreak: newLongest,
      granted: reward,
      itemsGranted: itemGrants,
      season: newSeason,
      totalCycles: newTotalCycles,
    });
  });
};
