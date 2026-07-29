import { useQuery } from '@tanstack/react-query';
import type { CSSProperties, ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import {
  AdminCogIcon,
  AdminDotIcon,
  AdventureIcon,
  ArenaIcon,
  BackIcon,
  DigidexIcon,
  DungeonIcon,
  FactoryIcon,
  FarmIcon,
  MarketIcon,
  NurseryIcon,
  RosterIcon,
  TrainingIcon,
  WorldIcon,
} from './common/icons';
import { useAuth } from '../hooks/useAuth';
import { useLocale } from '../hooks/useLocale';
import { setLocale } from '../lib/locale';
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

const ICON_FACTORY: ReactNode = <FactoryIcon />;
const ICON_FARM: ReactNode = <FarmIcon />;
const ICON_ADVENTURE: ReactNode = <AdventureIcon />;
const ICON_NURSERY: ReactNode = <NurseryIcon />;
const ICON_TRAINING: ReactNode = <TrainingIcon />;
const ICON_MARKET: ReactNode = <MarketIcon />;
const ICON_DIGIDEX: ReactNode = <DigidexIcon />;
const ICON_ROSTER: ReactNode = <RosterIcon />;
const ICON_WORLD: ReactNode = <WorldIcon />;
const ICON_ARENA: ReactNode = <ArenaIcon />;
const ICON_DUNGEON: ReactNode = <DungeonIcon />;
const ICON_ADMIN_DOT: ReactNode = <AdminDotIcon />;
const ICON_ADMIN_COG: ReactNode = <AdminCogIcon />;
const ICON_BACK: ReactNode = <BackIcon />;

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
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const pageLabel = pageLabelFor(pathname);
  const pageScope = pageScopeFor(pathname);
  const authed = !!user;
  const isAdminMode = pathname.startsWith('/admin');
  const activeAdminTab = new URLSearchParams(search).get('tab') ?? 'overview';

  const farmQuery = useQuery({ queryKey: ['farm'] as const, queryFn: getFarm, enabled: authed, staleTime: 15_000 });
  const rosterQuery = useQuery({ queryKey: ['roster'] as const, queryFn: getRoster, enabled: authed, staleTime: 15_000 });

  const credits = farmQuery.data?.credits ?? null;
  const bits = farmQuery.data?.balances?.Bits ?? null;
  const roster = rosterQuery.data?.roster ?? [];
  const party = roster.filter((mon) => mon.status === 'party');
  const partyMax = 3;
  const tamerLv = user?.mmr ?? null;

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
        <div className="win-locale" role="group" aria-label="Language">
          <button
            type="button"
            className={`win-locale-btn ${locale === 'en' ? 'is-active' : ''}`}
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={`win-locale-btn ${locale === 'pt' ? 'is-active' : ''}`}
            aria-pressed={locale === 'pt'}
            onClick={() => setLocale('pt')}
          >
            PT
          </button>
        </div>
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
                <div className="pill"><span>Credits</span><b>{credits !== null ? credits.toLocaleString('en-US') : '—'}</b></div>
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
