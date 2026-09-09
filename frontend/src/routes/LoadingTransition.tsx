import { useCallback, useMemo } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { BattleView } from '@digiworld/shared/battle';

import { TransitionScreen } from '../components/TransitionScreen';

type LoadingTransitionState = {
  readonly battle?: BattleView;
  readonly returnTo: string;
};

function parseState(raw: unknown): LoadingTransitionState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as LoadingTransitionState;
  if (typeof candidate.returnTo !== 'string' || candidate.returnTo.length === 0) return null;
  if (candidate.battle === undefined) return null;
  return {
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
    return <Navigate to="/lobby" replace />;
  }

  return (
    <TransitionScreen
      mode="combat"
      {...(state.battle !== undefined ? { battle: state.battle } : {})}
      onComplete={handleComplete}
    />
  );
}
