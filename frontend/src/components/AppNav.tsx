import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { useAuth } from '../hooks/useAuth';

type LeafNavItem = { readonly to: string; readonly label: string };
type ParentNavItem = { readonly label: string; readonly submenu: readonly LeafNavItem[] };
type NavItem = LeafNavItem | ParentNavItem;

function isParent(item: NavItem): item is ParentNavItem {
  return 'submenu' in item;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/lobby', label: 'Lobby' },
  { to: '/world', label: 'World' },
  { to: '/combat3d', label: '3D Combat' },
  { to: '/roster', label: 'Roster' },
  { to: '/digdex', label: 'Digdex' },
  {
    label: 'City',
    submenu: [
      { to: '/factory', label: 'Factory' },
      { to: '/farm', label: 'Farm' },
      { to: '/nursery', label: 'Nursery' },
      { to: '/adventure', label: 'Adventure' },
    ],
  },
  { to: '/training', label: 'Training' },
  { to: '/shop', label: 'Shop' },
  { to: '/items', label: 'Items' },
  { to: '/market', label: 'Market' },
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
  const [openParent, setOpenParent] = useState<string | null>(null);
  const navLinksRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOpenParent(null);
  }, [location.pathname]);

  useEffect(() => {
    if (openParent === null) return;
    const handleDocClick = (event: globalThis.MouseEvent): void => {
      const container = navLinksRef.current;
      if (container !== null && event.target instanceof Node && !container.contains(event.target)) {
        setOpenParent(null);
      }
    };
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenParent(null);
    };
    document.addEventListener('mousedown', handleDocClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openParent]);

  const toggleParent = (label: string): void => {
    setOpenParent((current) => (current === label ? null : label));
  };

  const onParentKey = (event: KeyboardEvent<HTMLDivElement>, label: string): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleParent(label);
    } else if (event.key === 'Escape') {
      setOpenParent(null);
    }
  };

  const onSubmenuItemClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.stopPropagation();
    setOpenParent(null);
  };

  return (
    <nav className="app-nav" aria-label="Primary">
      <Link to="/" className="brand" aria-label="DigiWorld home">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-word">
          Digi<b>World</b>
        </span>
      </Link>
      <div className="nav-links" role="tablist" ref={navLinksRef}>
        {NAV_ITEMS.map((item) => {
          if (isParent(item)) {
            const anyActive = item.submenu.some((s) => active(s.to));
            const isOpen = openParent === item.label;
            return (
              <div
                key={item.label}
                className={`nav-link nav-link--parent${anyActive ? ' is-active' : ''}${isOpen ? ' is-open' : ''}`}
                role="tab"
                tabIndex={0}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-current={anyActive ? 'page' : undefined}
                onClick={() => toggleParent(item.label)}
                onKeyDown={(event) => onParentKey(event, item.label)}
              >
                <span className="nav-link-label">{item.label}</span>
                <span className="nav-link-chev" aria-hidden="true">▾</span>
                <div className="nav-submenu" role="menu">
                  {item.submenu.map((sub) => (
                    <Link
                      key={sub.to}
                      to={sub.to}
                      role="menuitem"
                      className={`nav-submenu-item${active(sub.to) ? ' is-active' : ''}`}
                      onClick={onSubmenuItemClick}
                    >
                      {sub.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          }
          return active(item.to) ? (
            <span key={item.to} className="nav-link is-active" role="tab" aria-current="page">
              {item.label}
            </span>
          ) : (
            <Link key={item.to} to={item.to} className="nav-link" role="tab">
              {item.label}
            </Link>
          );
        })}
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
