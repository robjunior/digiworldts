/**
 * Daily rewards: a 7-day rotating cycle. Streak advances by 1 each day the
 * player claims within the 48h grace window; misses a day → resets to 1.
 *
 *   GET  /api/daily          → { streakDay, canClaim, secondsUntilNext, cycle, lastClaimAt }
 *   POST /api/daily/claim    → grants today's reward, updates wallet + resources
 *
 * The cycle definition is deliberately in code (not DB) so admins can tweak
 * without a migration. Rewards mix resources + credits.
 *
 * Async by construction — routes through the DbAdapter (SQLite or Postgres).
 */
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { one, run, tx, type WalletRow } from '../db/index.js';
import { log } from '../util/log.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 48 * 60 * 60 * 1000;

export type DayReward = {
  day: number;
  meat?: number;
  bits?: number;
  data?: number;
  credits?: number;
};

const CYCLE: readonly DayReward[] = [
  { day: 1, meat: 40, credits: 20 },
  { day: 2, bits: 30, credits: 25 },
  { day: 3, data: 20, credits: 35 },
  { day: 4, meat: 60, bits: 40, credits: 40 },
  { day: 5, data: 50, credits: 60 },
  { day: 6, meat: 100, bits: 80, data: 40, credits: 80 },
  { day: 7, credits: 250, meat: 120, bits: 120, data: 80 },
];

const SQL_SELECT_WALLET = `SELECT * FROM player_wallet WHERE user_id = ?`;
const SQL_INSERT_WALLET = `INSERT INTO player_wallet (user_id, credits, streak_day, last_claim_at, updated_at) VALUES (?, 0, 0, NULL, ?)
     ON CONFLICT(user_id) DO NOTHING`;
const SQL_UPDATE_WALLET = `UPDATE player_wallet SET credits = credits + ?, streak_day = ?, last_claim_at = ?, updated_at = ? WHERE user_id = ?`;
const SQL_UPSERT_RESOURCE = `INSERT INTO resources (user_id, resource, amount, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, resource) DO UPDATE SET amount = resources.amount + excluded.amount, updated_at = excluded.updated_at`;

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
  return { nextDay: currentStreak >= 7 ? 1 : currentStreak + 1, reset: currentStreak >= 7 };
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
    return reply.send({
      streakDay: w.streak_day,
      canClaim,
      wouldGrantDay: step.nextDay,
      wouldReset: step.reset,
      secondsUntilNext,
      lastClaimAt: w.last_claim_at,
      cycle: CYCLE,
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
    const rewardIdx = Math.max(0, Math.min(CYCLE.length - 1, step.nextDay - 1));
    const reward = CYCLE[rewardIdx]!;
    await tx(async (t) => {
      await t.run(SQL_UPDATE_WALLET, [reward.credits ?? 0, step.nextDay, now, now, me.id]);
      if (reward.meat) await t.run(SQL_UPSERT_RESOURCE, [me.id, 'Meat', reward.meat, now]);
      if (reward.bits) await t.run(SQL_UPSERT_RESOURCE, [me.id, 'Bits', reward.bits, now]);
      if (reward.data) await t.run(SQL_UPSERT_RESOURCE, [me.id, 'Data', reward.data, now]);
    });
    log.info('daily.claim', { userId: me.id, day: step.nextDay, reset: step.reset });
    return reply.send({
      streakDay: step.nextDay,
      reset: step.reset,
      granted: reward,
    });
  });
};
