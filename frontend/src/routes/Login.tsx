import type { PublicUser } from '@digiworld/shared/auth';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';

import { useAuth } from '../hooks/useAuth';
import { ApiError, authMe, authStatus } from '../lib/api';
import { OAuthButtons } from '../components/auth/OAuthButtons';

type AuthTab = 'signin' | 'register';

const AUTH_STATUS_QUERY_KEY = ['auth', 'status'] as const;

function targetForUser(user: PublicUser, nextTarget: string): string {
  if (user.onboardingCompleted !== true) return '/intro';
  return nextTarget;
}

export function Login(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, user, login, register } = useAuth();
  const authStatusQuery = useQuery({ queryKey: AUTH_STATUS_QUERY_KEY, queryFn: authStatus, retry: false });
  const [tab, setTab] = useState<AuthTab>('signin');
  const [signinUsername, setSigninUsername] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [registerUsername, setRegisterUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [signinError, setSigninError] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [pendingTab, setPendingTab] = useState<AuthTab | null>(null);
  const nextTarget = useMemo(() => getNextTarget(location.search), [location.search]);
  const redirected = useMemo(() => new URLSearchParams(location.search).get('redirected') === '1', [location.search]);
  const registrationOpen = authStatusQuery.data?.registrationOpen ?? true;
  const userCount = authStatusQuery.data?.userCount ?? null;
  const activeTab = registrationOpen ? tab : 'signin';

  useEffect(() => {
    if (!registrationOpen && tab === 'register') {
      setTab('signin');
    }
  }, [registrationOpen, tab]);

  useEffect(() => {
    let active = true;
    authMe()
      .then((response) => {
        if (active && response.user) {
          navigate(targetForUser(response.user, nextTarget), { replace: true });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return;
        throw error;
      });
    return () => {
      active = false;
    };
  }, [navigate, nextTarget]);

  useEffect(() => {
    if (status === 'authed' && user !== null) {
      navigate(targetForUser(user, nextTarget), { replace: true });
    }
  }, [navigate, nextTarget, status, user]);

  const switchTab = (nextTab: AuthTab): void => {
    setTab(nextTab);
    setSigninError('');
    setRegisterError('');
  };

  const submitSignin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSigninError('');
    setPendingTab('signin');
    try {
      const signed = await login({ username: signinUsername.trim(), password: signinPassword });
      navigate(targetForUser(signed, nextTarget), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setSigninError(error.message);
        return;
      }
      throw error;
    } finally {
      setPendingTab(null);
    }
  };

  const submitRegister = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setRegisterError('');
    setPendingTab('register');
    const trimmedDisplayName = displayName.trim();
    const base = {
      username: registerUsername.trim(),
      password: registerPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: registerEmail.trim(),
    };
    const body = trimmedDisplayName.length > 0 ? { ...base, displayName: trimmedDisplayName } : base;
    try {
      const registered = await register(body);
      navigate(targetForUser(registered, nextTarget), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setRegisterError(error.message);
        if (error.status === 403) {
          void authStatusQuery.refetch();
        }
        return;
      }
      throw error;
    } finally {
      setPendingTab(null);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-label="DigiWorld sign in">
        <div className="auth-card-in">
          <div>
            <div className="eyebrow">DigiWorld</div>
            <h1>Enter the arena</h1>
            <p className="lede">3v3 real-time Digimon battles.</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" className={activeTab === 'signin' ? 'is-active' : undefined} onClick={() => switchTab('signin')} role="tab" aria-selected={activeTab === 'signin'}>
              Sign in
            </button>
            {registrationOpen ? (
              <button type="button" className={activeTab === 'register' ? 'is-active' : undefined} onClick={() => switchTab('register')} role="tab" aria-selected={activeTab === 'register'}>
                Register
              </button>
            ) : null}
          </div>

          {redirected ? <div className="auth-hint">Sign in to continue to DigiWorld.</div> : null}
          {registrationOpen && userCount === 0 ? (
            <div id="admin-hint" className="auth-hint">
              The <b>first account</b> you register will be the game admin — the only one who can seed the Digimon catalog. Choose wisely.
            </div>
          ) : null}
          {!registrationOpen ? (
            <div id="closed-hint" className="auth-hint">
              Registration is closed on this server. Ask the admin for an account.
            </div>
          ) : null}

          <form id="form-signin" className={activeTab === 'signin' ? 'stack' : 'stack hidden'} noValidate onSubmit={submitSignin}>
            <label className="field">
              Username
              <input className="input" type="text" name="username" autoComplete="username" required minLength={3} maxLength={24} value={signinUsername} onChange={(event) => setSigninUsername(event.currentTarget.value)} />
            </label>
            <label className="field">
              Password
              <input className="input" type="password" name="password" autoComplete="current-password" required minLength={8} value={signinPassword} onChange={(event) => setSigninPassword(event.currentTarget.value)} />
            </label>
            <div className="auth-error" id="err-signin" role="alert">{signinError}</div>
            <button className="btn btn--wide" type="submit" disabled={pendingTab === 'signin' || status === 'loading'}>
              Sign in
            </button>
          </form>

          <form id="form-register" className={activeTab === 'register' ? 'stack' : 'stack hidden'} noValidate onSubmit={submitRegister}>
            <label className="field">
              Username
              <input className="input" type="text" name="username" autoComplete="username" required minLength={3} maxLength={24} pattern="[-A-Za-z0-9_.]+" value={registerUsername} onChange={(event) => setRegisterUsername(event.currentTarget.value)} />
            </label>
            <label className="field">
              First name
              <input className="input" type="text" name="firstName" autoComplete="given-name" required minLength={1} maxLength={64} value={firstName} onChange={(event) => setFirstName(event.currentTarget.value)} />
            </label>
            <label className="field">
              Last name
              <input className="input" type="text" name="lastName" autoComplete="family-name" required minLength={1} maxLength={64} value={lastName} onChange={(event) => setLastName(event.currentTarget.value)} />
            </label>
            <label className="field">
              Email
              <input className="input" type="email" name="email" autoComplete="email" required maxLength={254} value={registerEmail} onChange={(event) => setRegisterEmail(event.currentTarget.value)} />
            </label>
            <label className="field">
              Display name (optional)
              <input className="input" type="text" name="displayName" autoComplete="nickname" maxLength={32} value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} />
            </label>
            <label className="field">
              Password
              <input className="input" type="password" name="password" autoComplete="new-password" required minLength={8} value={registerPassword} onChange={(event) => setRegisterPassword(event.currentTarget.value)} />
            </label>
            <div className="auth-error" id="err-register" role="alert">{registerError}</div>
            <button className="btn btn--wide" type="submit" disabled={pendingTab === 'register' || status === 'loading'}>
              Create account
            </button>
          </form>

          <OAuthButtons mode="login" returnTo={nextTarget} label="ou continue com" />
        </div>
      </section>
    </main>
  );
}

function getNextTarget(search: string): string {
  const next = new URLSearchParams(search).get('next') ?? '/lobby';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/lobby';
}
