import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { AppShell } from './components/AppShell';
import { TutorialManager } from './components/tutorial/TutorialManager';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AUTH_ME_KEY } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { Account } from './routes/Account';
import { Adventure } from './routes/Adventure';
import { Digdex } from './routes/Digdex';
import { Factory } from './routes/Factory';
import { Farm } from './routes/Farm';
import { Intro } from './routes/Intro';
import { Inventory } from './routes/Inventory';
import { LoadingTransition } from './routes/LoadingTransition';
import { InventorySpikeDemo } from './features/inventory/InventorySpikeDemo';
import { Lobby } from './routes/Lobby';
import { Login } from './routes/Login';
import { Market } from './routes/Market';
import { Nursery } from './routes/Nursery';
import { OAuthDecide } from './routes/OAuthDecide';
import { Reset } from './routes/Reset';
import { Roster } from './routes/Roster';
import { Creature } from './routes/Creature';
import { Shop } from './routes/Shop';
import { Spectate } from './routes/Spectate';
import { Training } from './routes/Training';
import { useWsStore } from './state/wsStore';
import './styles/extensions-tutorial.css';
import './styles/extensions-auth.css';
import './styles/extensions-transition.css';
import './styles/extensions-premium.css';

const Combat = lazy(() => import('./routes/Combat').then((m) => ({ default: m.Combat })));

function SuspenseFallback(): JSX.Element {
  return (
    <div className="transition-screen" data-mode="generic" role="status" aria-live="polite">
      <div className="tr-card">
        <div className="tr-kicker">DigiWorld</div>
        <h1 className="tr-title">Loading…</h1>
        <div className="tr-progress" aria-hidden="true">
          <div className="tr-progress-bar tr-progress-indeterminate" />
        </div>
        <div className="tr-hint">Preparing the terminal…</div>
      </div>
    </div>
  );
}

function RealtimeBridge(): JSX.Element | null {
  useWebSocket();
  const activeBattleId = useWsStore((state) => state.activeBattle?.id ?? null);
  const activeBattleMode = useWsStore((state) => state.activeBattle?.mode ?? null);
  const activeBattleStatus = useWsStore((state) => state.activeBattle?.status ?? null);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (
      activeBattleId !== null &&
      activeBattleMode === 'pvp' &&
      activeBattleStatus !== 'ended' &&
      location.pathname !== '/combat'
    ) {
      navigate('/combat');
    }
  }, [activeBattleId, activeBattleMode, activeBattleStatus, location.pathname, navigate]);

  useEffect(() => {
    if (activeBattleMode === 'pvp' && activeBattleStatus === 'ended') {
      void queryClient.invalidateQueries({ queryKey: AUTH_ME_KEY });
    }
  }, [activeBattleId, activeBattleMode, activeBattleStatus, queryClient]);

  return null;
}

export function App(): JSX.Element {
  return (
    <>
      <RealtimeBridge />
      <TutorialManager />
      <Suspense fallback={<SuspenseFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/oauth/decide" element={<OAuthDecide />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/intro" element={<Intro />} />
            <Route path="/loading" element={<LoadingTransition />} />
            <Route path="/combat" element={<Combat />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Lobby />} />
              <Route path="/lobby" element={<Navigate to="/" replace />} />
              <Route path="/account" element={<Account />} />
              <Route path="/roster" element={<Roster />} />
              <Route path="/creature/:monId" element={<Creature />} />
              <Route path="/farm" element={<Farm />} />
              <Route path="/factory" element={<Factory />} />
              <Route path="/adventure" element={<Adventure />} />
              <Route path="/training" element={<Training />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/items" element={<Inventory />} />
              <Route path="/inv-spike" element={<InventorySpikeDemo />} />
              <Route path="/market" element={<Market />} />
              <Route path="/nursery" element={<Nursery />} />
              <Route path="/digdex" element={<Digdex />} />
              <Route path="/world" element={<Navigate to="/" replace />} />
              <Route path="/spectate" element={<Spectate />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
