import { Navigate, Outlet } from 'react-router';

import { useAuth } from '../hooks/useAuth';

export function ProtectedRoute(): JSX.Element {
  const { status } = useAuth();

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

  return <Outlet />;
}
