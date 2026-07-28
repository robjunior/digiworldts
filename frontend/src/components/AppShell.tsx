import { useQuery } from '@tanstack/react-query';
import type { CSSProperties, ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { useAuth } from '../hooks/useAuth';
import { getFarm } from '../lib/api-farm';
import { getRoster } from '../lib/api';

type NavEntry = {
  readonly to: string;
  readonly label: string;
  readonly svg: ReactNode;
};

type AdminNavEntry = NavEntry & {
  readonly tab?: string;
  readonly route?: string;
};

const PAGE_LABELS: Readonly<Record<string, string>> = {
  '/': 'Lobby',
  '/lobby': 'Lobby',
  '/combat': 'Combat',
  '/roster': 'Roster',
  '/factory': 'Factory',
  '/farm': 'Farm',
  '/adventure': 'Adventure',
  '/nursery': 'Nursery',
  '/training': 'Training',
  '/market': 'Market',
  '/digdex': 'Digidex',
  '/dungeon': 'Dungeon',
  '/world': 'World',
  '/admin': 'Admin',
  '/intro': 'Intro',
};

/**
 * Per-route class applied to <main class="main"> so page CSS (extensions-*.css)
 * can scope selectors without needing an invented wrapper <div> inside each route.
 * These class names MIRROR the pre-existing scope prefixes in the extension CSS files
 * (e.g. extensions-adventure.css uses `.adv-page .foo`, so /adventure gets `adv-page`).
 * The mockup HTML files use only `<main class="main">` — adding one page-scope class here
 * is the minimum deviation needed to keep 8 extension CSS files' selectors valid.
 */
const PAGE_SCOPE: Readonly<Record<string, string>> = {
  '/lobby': '',
  '/combat': '',
  '/roster': 'roster-layout',
  '/factory': 'factory-page',
  '/farm': 'farm-page',
  '/adventure': 'adv-page',
  '/nursery': 'nursery-page',
  '/training': 'training-page',
  '/market': 'market-page',
  '/digdex': 'digdex-container',
  '/dungeon': 'dungeon-page',
  '/world': 'world-page-layout',
  '/admin': 'admin-layout',
};

function pageLabelFor(pathname: string): string {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname];
  const first = pathname.split('/').filter(Boolean)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Lobby';
}

function pageScopeFor(pathname: string): string {
  const exact = PAGE_SCOPE[pathname];
  if (exact !== undefined) return exact;
  if (pathname.startsWith('/dungeon/')) return 'dungeon-page';
  if (pathname.startsWith('/admin/dungeons/')) return 'admin-dungeon-layout';
  if (pathname === '/admin/world') return 'admin-world-layout';
  return '';
}

const ICON_FACTORY: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M3 20V10l5 3V10l5 3V6l6 4v10z" />
    <path d="M7 20v-4M12 20v-4M17 20v-4" />
  </svg>
);
const ICON_FARM: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M4 20v-6a8 8 0 0 1 16 0v6" />
    <path d="M4 20h16M9 20v-4a3 3 0 0 1 6 0v4M12 6V3" />
  </svg>
);
const ICON_ADVENTURE: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z" />
    <path d="M9.5 12l1.8 1.8L15 10" />
  </svg>
);
const ICON_NURSERY: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M12 21c-4-2.5-7-5.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 12c0 3.5-3 6.5-7 9z" />
  </svg>
);
const ICON_TRAINING: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M6.5 6.5l11 11" />
    <path d="M4 9l-1.5-1.5 2-2L6 7M15 18l1.5 1.5 2-2L17 15" />
    <path d="M9 4l2 2M18 13l2 2M4 15l2 2M13 6l2 2" />
  </svg>
);
const ICON_MARKET: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M4 7h16l-1.2 4.5H5.2L4 7z" />
    <path d="M5.2 11.5V19h13.6v-7.5" />
    <path d="M4 7l1-3h14l1 3" />
  </svg>
);
const ICON_DIGIDEX: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 3v18M4 7.5l8 4.5 8-4.5" />
  </svg>
);
const ICON_ROSTER: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.5a3 3 0 0 1 0 5.4M18 19c0-2.4-1.4-4.3-3.4-5" />
  </svg>
);
const ICON_WORLD: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5S14.5 18.1 12 20.5C9.5 18.1 8.2 15.1 8.2 12S9.5 5.9 12 3.5z" />
  </svg>
);
const ICON_ARENA: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M14 3l-2 5h4l-4 8 2-5h-4l4-8z" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);
const ICON_DUNGEON: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
  </svg>
);

const ICON_ADMIN_DOT: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </svg>
);
const ICON_ADMIN_COG: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M19.8 7.5 17.2 9M6.8 15l-2.6 1.5" />
  </svg>
);
const ICON_BACK: ReactNode = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M10 6 4 12l6 6" />
    <path d="M5 12h15" />
  </svg>
);

const TOWN: readonly NavEntry[] = [
  { to: '/factory',   label: 'Factory',    svg: ICON_FACTORY },
  { to: '/farm',      label: 'Farm',       svg: ICON_FARM },
  { to: '/adventure', label: 'Adventure',  svg: ICON_ADVENTURE },
  { to: '/nursery',   label: 'Nursery',    svg: ICON_NURSERY },
  { to: '/training',  label: 'Training',   svg: ICON_TRAINING },
];

const BEYOND: readonly NavEntry[] = [
  { to: '/market',    label: 'The Market', svg: ICON_MARKET },
  { to: '/items',     label: 'Inventory',  svg: ICON_MARKET },
  { to: '/digdex',    label: 'DigiDex',    svg: ICON_DIGIDEX },
  { to: '/roster',    label: 'Roster',     svg: ICON_ROSTER },
  { to: '/world',     label: 'The World',  svg: ICON_WORLD },
  { to: '/dungeon',   label: 'Dungeon',    svg: ICON_DUNGEON },
  { to: '/lobby',     label: 'The Arena',  svg: ICON_ARENA },
];

const ADMIN_NAV: readonly AdminNavEntry[] = [
  { to: '/admin?tab=overview', label: 'Overview', svg: ICON_ADMIN_DOT, tab: 'overview' },
  { to: '/admin?tab=users', label: 'Users', svg: ICON_ROSTER, tab: 'users' },
  { to: '/admin?tab=scraped', label: 'Scraped', svg: ICON_ADMIN_DOT, tab: 'scraped' },
  { to: '/admin?tab=catalog', label: 'Catalog', svg: ICON_DIGIDEX, tab: 'catalog' },
  { to: '/admin?tab=skills', label: 'Skills', svg: ICON_TRAINING, tab: 'skills' },
  { to: '/admin?tab=shop', label: 'Shop Admin', svg: ICON_MARKET, tab: 'shop' },
  { to: '/admin?tab=quests', label: 'Quests', svg: ICON_ADVENTURE, tab: 'quests' },
  { to: '/admin?tab=dungeons', label: 'Dungeons', svg: ICON_DUNGEON, tab: 'dungeons' },
  { to: '/admin?tab=biomes', label: 'Biome scenes', svg: ICON_WORLD, tab: 'biomes' },
  { to: '/admin?tab=scene', label: 'Scene (per-arena)', svg: ICON_ARENA, tab: 'scene' },
  { to: '/admin?tab=settings', label: 'Settings', svg: ICON_ADMIN_COG, tab: 'settings' },
  { to: '/admin/world', label: 'World Map Editor', svg: ICON_WORLD, route: '/admin/world' },
  { to: '/lobby', label: 'Back to game', svg: ICON_BACK, route: '/lobby' },
];
const ADMIN_BACK_ENTRY: AdminNavEntry = { to: '/lobby', label: 'Back to game', svg: ICON_BACK, route: '/lobby' };

const BEYOND_STYLE: CSSProperties = { marginTop: 6 };

function isActive(pathname: string, target: string): boolean {
  return pathname === target || pathname.startsWith(`${target}/`);
}

export function AppShell(): JSX.Element {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const pageLabel = pageLabelFor(pathname);
  const pageScope = pageScopeFor(pathname);
  const authed = !!user;
  const isAdminMode = pathname.startsWith('/admin');
  const activeAdminTab = new URLSearchParams(search).get('tab') ?? 'overview';

  const farmQuery = useQuery({ queryKey: ['farm'] as const, queryFn: getFarm, enabled: authed, staleTime: 15_000 });
  const rosterQuery = useQuery({ queryKey: ['roster'] as const, queryFn: getRoster, enabled: authed, staleTime: 15_000 });

  const credits = farmQuery.data?.credits ?? null;
  const roster = rosterQuery.data?.roster ?? [];
  const party = roster.filter((mon) => mon.status === 'party');
  const partyMax = 3;
  const tamerLv = user?.mmr ?? null;
  const bits = credits;

  const renderNav = (entry: NavEntry): JSX.Element => {
    const active = isActive(pathname, entry.to);
    return (
      <Link
        key={entry.to}
        to={entry.to}
        className="navbtn"
        aria-label={entry.label}
        {...(active ? { 'aria-current': 'page' as const } : {})}
      >
        {entry.svg}
        <span>{entry.label}</span>
      </Link>
    );
  };

  const renderAdminNav = (entry: AdminNavEntry): JSX.Element => {
    const routeActive = entry.route !== undefined && pathname === entry.route;
    const dungeonEditorActive = entry.tab === 'dungeons' && pathname.startsWith('/admin/dungeons/');
    const tabActive = pathname === '/admin' && entry.tab === activeAdminTab;
    const active = routeActive || dungeonEditorActive || tabActive;
    return (
      <Link
        key={entry.to}
        to={entry.to}
        className="navbtn"
        aria-label={entry.label}
        {...(active ? { 'aria-current': 'page' as const } : {})}
      >
        {entry.svg}
        <span>{entry.label}</span>
      </Link>
    );
  };

  const mainClassName = pageScope ? `main ${pageScope}` : 'main';

  return (
    <div className="win">
      <header className="titlebar">
        <div className="lights"><i /><i /><i /></div>
        <div className="app-mark">DIGI<span className="bit">WORLD</span></div>
        <div className="win-meta">Tamer Terminal · {pageLabel}</div>
      </header>
      <div className="body">
        <nav className="side" aria-label="Primary">
          {isAdminMode ? (
            <>
              <div className="grp">Admin</div>
              {ADMIN_NAV.slice(0, 12).map(renderAdminNav)}
              <div className="grp" style={BEYOND_STYLE}>─</div>
              {renderAdminNav(ADMIN_BACK_ENTRY)}
            </>
          ) : (
            <>
              <div className="grp">The Town</div>
              {TOWN.map(renderNav)}
              <div className="grp" style={BEYOND_STYLE}>Beyond</div>
              {BEYOND.map(renderNav)}
            </>
          )}
          <div className="spring">
            {isAdminMode ? (
              <div className="hud">
                <div className="pill"><span>Admin</span><b>{user?.username ?? '—'}</b></div>
              </div>
            ) : (
              <div className="hud">
                <div className="pill"><span>Tamer Lv</span><b>{tamerLv ?? '—'}</b></div>
                <div className="pill"><span>Bits</span><b>{bits !== null ? bits.toLocaleString('en-US') : '—'}</b></div>
                <div className="pill"><span>Party</span><b>{party.length}/{partyMax}</b></div>
              </div>
            )}
            {!isAdminMode && user?.isAdmin === true ? (
              <Link to="/admin" className="admin-link">Admin</Link>
            ) : null}
          </div>
        </nav>
        <main className={mainClassName}><Outlet /></main>
      </div>
    </div>
  );
}
