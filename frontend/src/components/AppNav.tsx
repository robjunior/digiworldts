import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { useAuth } from '../hooks/useAuth';

type NavItem = { readonly to: string; readonly label: string };

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/lobby', label: 'Lobby' },
  { to: '/world', label: 'World' },
  { to: '/roster', label: 'Roster' },
  { to: '/farm', label: 'Farm' },
  { to: '/training', label: 'Training' },
  { to: '/shop', label: 'Shop' },
  { to: '/market', label: 'Market' },
  { to: '/nursery', label: 'Nursery' },
];

function isPathActive(current: string, target: string): boolean {
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
}

export type AppNavProps = {
  readonly children?: ReactNode;
};

export function AppNav({ children }: AppNavProps): JSX.Element {
  const { user, logout } = useAuth();
  const location = useLocation();
  const active = (to: string): boolean => isPathActive(location.pathname, to);

  return (
    <nav className="app-nav" aria-label="Primary">
      <Link to="/" className="brand" aria-label="DigiWorld home">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-word">
          Digi<b>World</b>
        </span>
      </Link>
      <div className="nav-links" role="tablist">
        {NAV_ITEMS.map((item) =>
          active(item.to) ? (
            <span key={item.to} className="nav-link is-active" role="tab" aria-current="page">
              {item.label}
            </span>
          ) : (
            <Link key={item.to} to={item.to} className="nav-link" role="tab">
              {item.label}
            </Link>
          ),
        )}
        {user?.isAdmin ? (
          active('/admin') ? (
            <span className="nav-link nav-link--admin is-active" role="tab" aria-current="page">
              Admin
            </span>
          ) : (
            <Link to="/admin" className="nav-link nav-link--admin" role="tab">
              Admin
            </Link>
          )
        ) : null}
      </div>
      {children !== undefined && children !== null && children !== false ? (
        <div className="nav-context" aria-label="Page context">
          {children}
        </div>
      ) : null}
      <div className="nav-account">
        {user !== null ? (
          <>
            <span className="nav-user-mmr" title="Ranked MMR (PVP)">MMR <b>{user.mmr}</b></span>
            <span className="nav-user" title={`Signed in as ${user.displayName}`}>
              <span className="nav-user-dot" aria-hidden="true" />
              <b>{user.displayName}</b>
            </span>
            <button
              className="btn btn--secondary btn--sm nav-logout"
              type="button"
              onClick={() => {
                void logout();
              }}
            >
              Logout
            </button>
          </>
        ) : null}
      </div>
    </nav>
  );
}

export type NavStatTone = 'meat' | 'bits' | 'data' | 'credits' | 'signal' | 'battle' | 'gold' | 'nature' | 'muted';

export type NavStatProps = {
  readonly label: string;
  readonly value: ReactNode;
  readonly tone?: NavStatTone;
  readonly title?: string;
};

export function NavStat({ label, value, tone = 'muted', title }: NavStatProps): JSX.Element {
  const scalar = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return (
    <span className={`nav-stat nav-stat--${tone}`} title={title ?? `${label}: ${scalar}`}>
      <span className="nav-stat-dot" aria-hidden="true" />
      <span className="nav-stat-lbl">{label}</span>
      <b className="nav-stat-val">{value}</b>
    </span>
  );
}
