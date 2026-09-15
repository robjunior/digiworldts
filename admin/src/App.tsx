import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { EnvBadge } from './components/EnvBadge';
import { AdminGuard } from './components/admin/AdminGuard';
import { Login } from './routes/Login';

const Admin = lazy(() => import('./routes/Admin').then((m) => ({ default: m.Admin })));
const AdminParticleEditor = lazy(() => import('./routes/AdminParticleEditor').then((m) => ({ default: m.AdminParticleEditor })));
const AdminSkillVfxEditor = lazy(() => import('./routes/AdminSkillVfxEditor').then((m) => ({ default: m.AdminSkillVfxEditor })));
const AdminSimulator = lazy(() => import('./routes/AdminSimulator').then((m) => ({ default: m.AdminSimulator })));

/**
 * Admin app root.
 *
 * The whole surface is gated by `AdminGuard` — it walks the /auth/me
 * session, redirects anonymous visitors to /login, and rejects
 * non-admin users. This mirrors the backend's `is_admin=1` requirement
 * on every `/api/admin/*` route, so a compromised UI still cannot grant
 * privilege it didn't have.
 */
export function App(): JSX.Element {
  return (
    <>
      <EnvBadge />
      <Suspense fallback={<div className="admin-boot-fallback" aria-hidden="true" />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <AdminGuard>
                <Admin />
              </AdminGuard>
            }
          />
          <Route
            path="/particles"
            element={
              <AdminGuard>
                <AdminParticleEditor />
              </AdminGuard>
            }
          />
          <Route
            path="/skill-vfx"
            element={
              <AdminGuard>
                <AdminSkillVfxEditor />
              </AdminGuard>
            }
          />
          <Route
            path="/dialogues/:id/simulate"
            element={
              <AdminGuard>
                <AdminSimulator />
              </AdminGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
