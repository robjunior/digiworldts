import { useCallback, useMemo } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { BattleView } from '@digiworld/shared/battle';

import { TransitionScreen } from '../components/TransitionScreen';

type LoadingTransitionState = {
  readonly mode: 'dungeon' | 'combat';
  readonly dungeonId?: string;
  readonly battle?: BattleView;
  readonly returnTo: string;
};

function parseState(raw: unknown): LoadingTransitionState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as LoadingTransitionState;
  if (candidate.mode !== 'dungeon' && candidate.mode !== 'combat') return null;
  if (typeof candidate.returnTo !== 'string' || candidate.returnTo.length === 0) return null;
  if (candidate.mode === 'dungeon' && (typeof candidate.dungeonId !== 'string' || candidate.dungeonId.length === 0)) return null;
  if (candidate.mode === 'combat' && candidate.battle === undefined) return null;
  return {
    mode: candidate.mode,
    ...(candidate.dungeonId !== undefined ? { dungeonId: candidate.dungeonId } : {}),
    ...(candidate.battle !== undefined ? { battle: candidate.battle } : {}),
    returnTo: candidate.returnTo,
  };
}

export function LoadingTransition(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const state = useMemo(() => parseState(location.state), [location.state]);

  const handleComplete = useCallback(() => {
    if (state === null) return;
    navigate(state.returnTo, { replace: true });
  }, [navigate, state]);

  if (state === null) {
    return <Navigate to="/world" replace />;
  }

  return (
    <TransitionScreen
      mode={state.mode}
      {...(state.dungeonId !== undefined ? { dungeonId: state.dungeonId } : {})}
      {...(state.battle !== undefined ? { battle: state.battle } : {})}
      onComplete={handleComplete}
    />
  );
}
