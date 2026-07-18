import type { ReactNode } from 'react';
import { Navigate } from 'react-router';

import { useAuth } from '../../hooks/useAuth';

export function AdminGuard({ children }: { readonly children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  if (user?.isAdmin === true) {
    return <>{children}</>;
  }
  return <Navigate to="/" replace />;
}
