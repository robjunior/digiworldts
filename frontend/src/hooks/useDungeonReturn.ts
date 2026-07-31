import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

import { useWsStore } from '../state/wsStore';

const DUNGEON_RETURN_KEY = 'dungeon-return';

type DungeonReturn = {
  readonly dungeonId: string;
  readonly encounterId?: string;
};

export function useDungeonReturn(): void {
  const navigate = useNavigate();
  const activeBattle = useWsStore((state) => state.activeBattle);
  const hadActiveBattleRef = useRef(activeBattle !== null);

  useEffect(() => {
    const hadActiveBattle = hadActiveBattleRef.current;
    hadActiveBattleRef.current = activeBattle !== null;
    if (!hadActiveBattle || activeBattle !== null) return;

    const rawReturn = sessionStorage.getItem(DUNGEON_RETURN_KEY);
    if (rawReturn !== null) {
      sessionStorage.removeItem(DUNGEON_RETURN_KEY);
      const parsedReturn = parseDungeonReturn(rawReturn);
      if (parsedReturn !== null) {
        navigate(`/dungeon/${parsedReturn.dungeonId}`, { replace: true });
        return;
      }
    }
    navigate('/lobby', { replace: true });
  }, [activeBattle, navigate]);
}

function parseDungeonReturn(rawReturn: string): DungeonReturn | null {
  try {
    const parsed: unknown = JSON.parse(rawReturn);
    if (typeof parsed !== 'object' || parsed === null || !('dungeonId' in parsed)) return null;
    const dungeonId = parsed.dungeonId;
    if (typeof dungeonId !== 'string' || dungeonId.length === 0) return null;
    return { dungeonId };
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
