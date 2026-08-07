import type { ChallengeConfig, Dungeon, UserDungeonRun } from '@digiworld/shared';

import { one } from '../db/index.js';

const SQL_COUNT_ENCOUNTERS = `SELECT COUNT(*) AS n FROM dungeon_encounters WHERE dungeon_id = ?`;
const SQL_STASH_ITEM_QTY = `SELECT COALESCE(SUM(qty), 0) AS qty FROM dungeon_run_stash WHERE user_id = ? AND dungeon_id = ? AND item_id = ?`;

export type ChallengeVerdict = 'cleared' | 'in-progress' | 'no-op';

export async function evaluateChallenge(dungeon: Dungeon, run: UserDungeonRun): Promise<ChallengeVerdict> {
  const challenge: ChallengeConfig = dungeon.challenge;
  switch (challenge.kind) {
    case 'none':
      return 'no-op';
    case 'boss_defeated':
      if (challenge.bossEncounterId.length === 0) return 'no-op';
      return run.defeatedEncounters.includes(challenge.bossEncounterId) ? 'cleared' : 'in-progress';
    case 'all_encounters_defeated': {
      const row = await one<{ n: number }>(SQL_COUNT_ENCOUNTERS, dungeon.id);
      const total = row?.n ?? 0;
      if (total === 0) return 'no-op';
      return run.defeatedEncounters.length >= total ? 'cleared' : 'in-progress';
    }
    case 'reach_tile':
      return run.currentX === challenge.targetX && run.currentY === challenge.targetY ? 'cleared' : 'in-progress';
    case 'collect_item': {
      if (challenge.itemId.length === 0 || challenge.qty <= 0) return 'no-op';
      const row = await one<{ qty: number }>(SQL_STASH_ITEM_QTY, run.userId, run.dungeonId, challenge.itemId);
      const have = row?.qty ?? 0;
      return have >= challenge.qty ? 'cleared' : 'in-progress';
    }
    case 'survive_waves': {
      const progress = run.challengeProgress ?? {};
      const cleared = typeof progress.wavesCleared === 'number' ? progress.wavesCleared : 0;
      return cleared >= challenge.waveCount ? 'cleared' : 'in-progress';
    }
  }
}
