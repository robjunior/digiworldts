import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { adminEnv } from '../env';

/**
 * Minimal admin login page.
 *
 * Deliberately spartan compared to the player /login:
 *   - no OAuth buttons (admins shouldn't federate identity)
 *   - no register form (admin accounts are provisioned, never self-signed-up)
 *   - no password recovery (admin lost passwords are recovered via DB shell)
 */
export function Login(): JSX.Element {
  const { login, user, status } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nextParam = params.get('next');
  const nextPath = nextParam && nextParam.startsWith('/') ? nextParam : '/';

  if (status === 'authed' && user?.isAdmin === true) {
    navigate(nextPath, { replace: true });
    return <div aria-hidden="true" />;
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const authenticated = await login({ username: username.trim(), password });
      if (authenticated.isAdmin !== true) {
        setError(`This account (${authenticated.displayName ?? authenticated.username}) is not an admin.`);
        setSubmitting(false);
        return;
      }
      navigate(nextPath, { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Login failed';
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: 'var(--surface-1, #0b0d12)',
        color: 'var(--text-strong, #f0f0f0)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 'min(380px, 100%)',
          background: 'var(--surface-2, #14171f)',
          padding: '2rem',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>SOULXENON — Admin</h1>
          <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: 12 }}>
            Connected to <b>{adminEnv.label}</b> · {adminEnv.backendUrl}
          </p>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Username</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
        </label>

        {error ? (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              borderRadius: 6,
              background: 'rgba(180, 30, 30, 0.15)',
              border: '1px solid rgba(220, 60, 60, 0.35)',
              color: '#ffb0b0',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || username.trim().length === 0 || password.length === 0}
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.1)',
            background: submitting ? '#3a3f4b' : '#4a63ff',
            color: '#fff',
            fontWeight: 600,
            cursor: submitting ? 'wait' : 'pointer',
            fontSize: 14,
          }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

const inputStyle = {
  padding: '10px 12px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(0,0,0,0.35)',
  color: 'inherit',
  fontSize: 14,
  fontFamily: 'inherit',
} as const;
