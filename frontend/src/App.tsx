import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { ProtectedRoute } from './components/ProtectedRoute';
import { AUTH_ME_KEY } from './hooks/useAuth';
import { useWebSocket } from './hooks/useWebSocket';
import { Admin } from './routes/Admin';
import { Combat } from './routes/Combat';
import { Digdex } from './routes/Digdex';
import { Farm } from './routes/Farm';
import { Home } from './routes/Home';
import { Lobby } from './routes/Lobby';
import { Login } from './routes/Login';
import { Market } from './routes/Market';
import { Nursery } from './routes/Nursery';
import { Onboarding } from './routes/Onboarding';
import { Roster } from './routes/Roster';
import { Shop } from './routes/Shop';
import { Training } from './routes/Training';
import { World } from './routes/World';
import { useWsStore } from './state/wsStore';

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="/combat" element={<Combat />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/farm" element={<Farm />} />
          <Route path="/training" element={<Training />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/market" element={<Market />} />
          <Route path="/nursery" element={<Nursery />} />
          <Route path="/world" element={<World />} />
          <Route path="/digdex" element={<Digdex />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
