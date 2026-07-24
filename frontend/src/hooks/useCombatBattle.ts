import { useCallback, useEffect, useState } from 'react';

import { useWsStore } from '../state/wsStore';
import { ApiError, getBattleView, startWildEncounter } from '../lib/api';

export function useCombatBattle(fetchOnMount: boolean): { readonly loadError: string | null; readonly startEncounter: () => void } {
  const activeBattle = useWsStore((state) => state.activeBattle);
  const handleServerMessage = useWsStore((state) => state.handleServerMessage);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!fetchOnMount) return;
    if (activeBattle !== null) return;
    let cancelled = false;
    void getBattleView().then((battle) => {
      if (!cancelled) {
        setLoadError(null);
        handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
      }
    }).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return;
      if (error instanceof Error) {
        setLoadError(error.message);
        return;
      }
      throw error;
    });
    return () => {
      cancelled = true;
    };
  }, [activeBattle, fetchOnMount, handleServerMessage]);

  const startEncounter = useCallback((): void => {
    void startWildEncounter().then((battle) => {
      setLoadError(null);
      handleServerMessage({ type: 'match', matchId: battle.id, view: battle });
    }).catch((error: unknown) => {
      if (error instanceof Error) {
        setLoadError(error.message);
        return;
      }
      throw error;
    });
  }, [handleServerMessage]);

  return { loadError, startEncounter };
}
