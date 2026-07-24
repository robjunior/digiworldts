import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from '../hooks/useAuth';

export function ProtectedRoute(): JSX.Element {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="app-shell">
        <nav className="app-nav">
          <span className="brand">
            Digi<b>World</b>
          </span>
        </nav>
      </div>
    );
  }

  if (status === 'anon') {
    return <Navigate to="/login" replace />;
  }

  if (user !== null && !user.onboardingCompleted && location.pathname !== '/intro') {
    return <Navigate to="/intro" replace />;
  }

  return <Outlet />;
}
