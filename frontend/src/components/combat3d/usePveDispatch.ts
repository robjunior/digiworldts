import { useCallback, useState } from 'react';
import type { Action, BattleView } from '@digiworld/shared/battle';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { actInWorldBattle } from '../../lib/api-world';
import type { ItemDrop, XpAward } from '../../lib/api-world';
import { useWsStore } from '../../state/wsStore';

export type PveRewards = {
  readonly xpAwards: readonly XpAward[];
  readonly itemDrops?: readonly ItemDrop[];
  readonly netcoreGained?: number;
  readonly bitsGained?: number;
};

/**
 * Dispatches an action against the world-battle endpoint for PvE matches:
 * splices new server events into the store, invalidates the item query for
 * item use, and routes the end-of-battle payload (rewards + results callback)
 * or the updated view back to the store. Errors surface via `error`.
 */
export function usePveDispatch(
  activeBattle: BattleView | null,
  onResults: (results: PveRewards) => void,
): { dispatch: (action: Action) => Promise<void>; error: string | null; setError: (e: string | null) => void } {
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(
    async (action: Action): Promise<void> => {
      if (!activeBattle || activeBattle.mode !== 'pve') return;

      try {
        const response = await actInWorldBattle(action);
        const previousLogLength = activeBattle.log.length;
        const newEvents = response.battle.log.slice(previousLogLength);

        if (newEvents.length > 0) {
          handleServerMessage({ type: 'event', matchId: response.battle.id, events: newEvents });
        }

        if (action.type === 'use_item') {
          void queryClient.invalidateQueries({ queryKey: ['items'] });
        }

        if (response.ended) {
          handleServerMessage({
            type: 'end',
            matchId: response.battle.id,
            view: response.battle,
            outcome: response.battle.outcome ?? 'abandoned',
          });
          const rewards: PveRewards = {
            xpAwards: response.xpAwards ?? [],
            ...(response.itemDrops && response.itemDrops.length > 0 ? { itemDrops: response.itemDrops } : {}),
            ...(response.netcoreGained !== undefined && response.netcoreGained > 0
              ? { netcoreGained: response.netcoreGained }
              : {}),
            ...(response.bitsGained !== undefined && response.bitsGained > 0 ? { bitsGained: response.bitsGained } : {}),
          };
          onResults(rewards);
        } else {
          handleServerMessage({ type: 'battle', matchId: response.battle.id, view: response.battle });
        }
      } catch (err) {
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      }
    },
    [activeBattle, handleServerMessage, queryClient, onResults],
  );

  return { dispatch, error, setError };
}
