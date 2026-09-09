import { useCallback, useState } from 'react';
import type { Action, BattleView } from '@digiworld/shared/battle';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { useWsStore } from '../../state/wsStore';

export type PveRewards = {
  readonly xpAwards: readonly { readonly monId: string; readonly xpBefore: number; readonly xpAfter: number; readonly xpFloorBefore: number; readonly xpFloor: number; readonly xpNextBefore: number; readonly xpNext: number; readonly gainedLevels: number; readonly delta: number; readonly defeated: boolean }[];
  readonly itemDrops?: readonly { readonly itemId: string; readonly name: string; readonly qty: number }[];
  readonly netcoreGained?: number;
  readonly bitsGained?: number;
};

export function usePveDispatch(
  _activeBattle: BattleView | null,
  _onResults: (results: PveRewards) => void,
): { dispatch: (action: Action) => Promise<void>; error: string | null; setError: (e: string | null) => void } {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(
    async (action: Action): Promise<void> => {
      if (action.type === 'use_item') {
        void queryClient.invalidateQueries({ queryKey: ['items'] });
      }
    },
    [queryClient],
  );

  return { dispatch, error, setError };
}
