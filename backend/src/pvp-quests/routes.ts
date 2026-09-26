import type { FastifyPluginAsync } from 'fastify';
import type { PvpQuestPeriod, PvpQuestTemplate } from '@digiworld/shared/pvp-quest';
import { PVP_QUEST_PERIODS } from '@digiworld/shared/pvp-quest';
import { requireAdmin, requireAuth } from '../auth/routes.js';
import { log } from '../util/log.js';
import { emit } from '../telemetry/emit.js';
import {
  claimQuest,
  getAllUserQuests,
  getUserPeriodQuests,
} from './repo.js';
import { describeQuest } from './registry.js';
import { generateBoard } from './generator.js';
import { windowFor, windowSeed } from './periods.js';
import { run } from '../db/index.js';

/** Ensure a wallet row exists so claiming netcore/credits can never hit a FK/conflict gap. */
async function ensureUserWallet(userId: string): Promise<void> {
  const now = Date.now();
  await run(
    `INSERT INTO player_wallet (user_id, credits, netcore, streak_day, updated_at) VALUES (?, 0, 0, 0, ?)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, now],
  );
}

function describeTemplate(t: PvpQuestTemplate): { instanceId: string; title: string; template: PvpQuestTemplate } {
  return { instanceId: t.instanceId, title: describeQuest(t), template: t };
}

export const pvpQuestsPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  // Player: list all active PvP quests across the three periods.
  app.get('/api/pvp-quests', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const data = await getAllUserQuests(user.id);
    return reply.send({
      periods: data.map((d) => ({
        period: d.window.period,
        windowId: d.window.windowId,
        startsAt: d.window.startsAt,
        endsAt: d.window.endsAt,
        quests: d.quests,
      })),
    });
  });

  // Player: list quests for a single period.
  app.get<{ Params: { period: string } }>('/api/pvp-quests/:period', async (req, reply) => {
    const user = await requireAuth(req, reply);
    if (!user) return;
    const period = req.params.period.toUpperCase();
    if (!PVP_QUEST_PERIODS.includes(period as PvpQuestPeriod)) {
      return reply.code(400).send({ error: 'invalid-period' });
    }
    const { window, quests } = await getUserPeriodQuests(user.id, period as PvpQuestPeriod);
    return reply.send({ period, windowId: window.windowId, startsAt: window.startsAt, endsAt: window.endsAt, quests });
  });

  // Player: claim a completed quest's reward exactly once.
  app.post<{ Params: { period: string; windowId: string; instanceId: string } }>(
    '/api/pvp-quests/:period/:windowId/:instanceId/claim',
    async (req, reply) => {
      const user = await requireAuth(req, reply);
      if (!user) return;
      const period = req.params.period.toUpperCase();
      if (!PVP_QUEST_PERIODS.includes(period as PvpQuestPeriod)) {
        return reply.code(400).send({ error: 'invalid-period' });
      }
      await ensureUserWallet(user.id);
      const result = await claimQuest(user.id, period as PvpQuestPeriod, req.params.windowId, req.params.instanceId);
      if (!result.ok && !result.alreadyClaimed) {
        return reply.code(409).send({ error: 'not-claimable', alreadyClaimed: result.alreadyClaimed });
      }
      log.info('pvpquest.claim', { userId: user.id, period, instanceId: req.params.instanceId, reward: result.reward });
      emit({
        event: 'pvpquest.claim',
        userId: user.id,
        distinctId: user.id,
        props: { period, instance_id: req.params.instanceId, reward_kind: result.reward?.kind ?? 'none' },
      });
      return reply.send({ ok: true, alreadyClaimed: result.alreadyClaimed, reward: result.reward, premium: result.premium, premiumBonus: result.premiumBonus });
    },
  );

  // Admin: preview the board that WOULD be generated for a period+window, without
  // persisting. Lets designers tune the generator / scaling ranges.
  app.post('/api/admin/pvp-quests/preview', async (req, reply) => {
    await requireAdmin(req, reply);
    const body = req.body as { period?: string; seed?: number; count?: number } | undefined;
    const period = (body?.period ?? 'DAILY').toUpperCase();
    if (!PVP_QUEST_PERIODS.includes(period as PvpQuestPeriod)) {
      return reply.code(400).send({ error: 'invalid-period' });
    }
    const window = windowFor(period as PvpQuestPeriod);
    const seed = body?.seed ?? windowSeed(period as PvpQuestPeriod, window.windowId);
    const board = generateBoard(period as PvpQuestPeriod, { count: body?.count ?? 8, seed });
    return reply.send({ period, windowId: window.windowId, quests: board.map(describeTemplate) });
  });

  // Admin: force (re)generate + persist a fresh board for the current window of a period.
  app.post<{ Params: { period: string } }>('/api/admin/pvp-quests/:period/regenerate', async (req, reply) => {
    await requireAdmin(req, reply);
    const period = req.params.period.toUpperCase();
    if (!PVP_QUEST_PERIODS.includes(period as PvpQuestPeriod)) {
      return reply.code(400).send({ error: 'invalid-period' });
    }
    const window = windowFor(period as PvpQuestPeriod);
    // Explicit admin action: drop the current window's board, then regenerate.
    // Idempotent-only normally — this one intentionally refreshes the quests.
    await run(`DELETE FROM pvp_quest_boards WHERE period = ? AND window_id = ?`, [period, window.windowId]);
    const { ensureBoard } = await import('./repo.js');
    const board = await ensureBoard(period as PvpQuestPeriod, window);
    return reply.send({ period, windowId: window.windowId, count: board.length });
  });
};
