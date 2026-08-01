import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from '../../hooks/useAuth';

/**
 * Gate for every admin route.
 *
 *  - `loading` → render nothing (avoids login-flash while /auth/me is pending)
 *  - `anon`    → redirect to `/login?next=<current>`
 *  - authed but NOT admin → hard 403 message (no auto-redirect,
 *    so a mis-logged operator sees exactly why)
 *  - admin     → render children
 *
 * The backend enforces `is_admin=1` on every `/api/admin/*` route on top of
 * this — a compromised UI still cannot grant privilege it didn't have.
 */
export function AdminGuard({ children }: { readonly children: ReactNode }): JSX.Element {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <div className="admin-guard-loading" aria-hidden="true" />;
  }

  if (status === 'anon' || user === null) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  if (user.isAdmin !== true) {
    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--surface-1, #0b0d12)',
          color: 'var(--text-strong, #f0f0f0)',
        }}
      >
        <div>
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>403 — Not an admin</h1>
          <p style={{ opacity: 0.7 }}>
            You're logged in as <b>{user.displayName ?? user.username}</b>, but this account isn't flagged as admin.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
