import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { AppShell } from './components/AppShell';
import { IntroTour } from './components/intro/IntroTour';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AUTH_ME_KEY } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { Adventure } from './routes/Adventure';
import { Digdex } from './routes/Digdex';
import { Dungeon } from './routes/Dungeon';
import { Factory } from './routes/Factory';
import { Farm } from './routes/Farm';
import { Home } from './routes/Home';
import { Intro } from './routes/Intro';
import { Items } from './routes/Items';
import { Lobby } from './routes/Lobby';
import { Login } from './routes/Login';
import { Market } from './routes/Market';
import { Nursery } from './routes/Nursery';
import { Reset } from './routes/Reset';
import { Roster } from './routes/Roster';
import { Shop } from './routes/Shop';
import { Spectate } from './routes/Spectate';
import { Training } from './routes/Training';
import { useWsStore } from './state/wsStore';
import './styles/extensions-intro.css';

const World = lazy(() => import('./routes/World').then((m) => ({ default: m.World })));
const Admin = lazy(() => import('./routes/Admin').then((m) => ({ default: m.Admin })));
const Combat = lazy(() => import('./routes/Combat').then((m) => ({ default: m.Combat })));

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
      <IntroTour />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset" element={<Reset />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/intro" element={<Intro />} />
            <Route path="/combat" element={<Combat />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/lobby" element={<Lobby />} />
              <Route path="/roster" element={<Roster />} />
              <Route path="/farm" element={<Farm />} />
              <Route path="/factory" element={<Factory />} />
              <Route path="/adventure" element={<Adventure />} />
              <Route path="/training" element={<Training />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/items" element={<Items />} />
              <Route path="/market" element={<Market />} />
              <Route path="/nursery" element={<Nursery />} />
              <Route path="/world" element={<World />} />
              <Route path="/digdex" element={<Digdex />} />
              <Route path="/dungeon" element={<Dungeon />} />
              <Route path="/spectate" element={<Spectate />} />
              <Route path="/admin" element={<Admin />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
