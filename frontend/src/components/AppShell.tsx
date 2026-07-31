import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
import { TopBarRight } from './topbar/TopBarRight';
import { useAuth } from '../hooks/useAuth';
import { useT } from '../hooks/useLocale';
import { getFarm } from '../lib/api-farm';
import { getRoster } from '../lib/api';

type NavEntry = {
  readonly to: string;
  readonly label: string;
  readonly labelKey?: string;
  readonly svg: ReactNode;
};

type AdminNavEntry = NavEntry & {
  readonly tab?: string;
  readonly route?: string;
};

const PAGE_LABEL_KEYS: Readonly<Record<string, string>> = {
  '/': 'lobby.title',
  '/account': 'account.title',
  '/lobby': 'lobby.title',
  '/combat': 'combat.your_team',
  '/roster': 'roster.title',
  '/factory': 'nav.factory',
  '/farm': 'farm.title',
  '/adventure': 'adventure.title',
  '/nursery': 'nursery.title',
  '/training': 'training.title',
  '/market': 'market.title',
  '/digdex': 'digidex.title',
  '/dungeon': 'nav.dungeon',
  '/world': 'world.title',
  '/admin': 'hud.admin',
  '/intro': 'auth.enter_arena',
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
  '/account': 'account-page',
  '/roster': 'roster-layout',
  '/factory': 'factory-page',
  '/farm': 'farm-page',
  '/adventure': 'adv-page',
  '/nursery': 'nursery-page',
  '/training': 'training-page',
  '/market': 'market-page',
  '/shop': 'shop-page',
  '/digdex': 'digdex-container',
  '/dungeon': 'dungeon-page',
  '/world': 'world-page-layout',
  '/admin': 'admin-layout',
};

function pageLabelKeyFor(pathname: string): string | null {
  if (PAGE_LABEL_KEYS[pathname]) return PAGE_LABEL_KEYS[pathname];
  return null;
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
  { to: '/factory',   label: 'Factory',    labelKey: 'nav.factory',   svg: ICON_FACTORY },
  { to: '/farm',      label: 'Farm',       labelKey: 'nav.farm',      svg: ICON_FARM },
  { to: '/adventure', label: 'Adventure',  labelKey: 'nav.adventure', svg: ICON_ADVENTURE },
  { to: '/nursery',   label: 'Nursery',    labelKey: 'nav.nursery',   svg: ICON_NURSERY },
  { to: '/training',  label: 'Training',   labelKey: 'nav.training',  svg: ICON_TRAINING },
];

const BEYOND: readonly NavEntry[] = [
  { to: '/market',    label: 'The Market', labelKey: 'nav.market',    svg: ICON_MARKET },
  { to: '/items',     label: 'Inventory',  labelKey: 'nav.inventory', svg: ICON_MARKET },
  { to: '/digdex',    label: 'DigiDex',    labelKey: 'nav.digidex',   svg: ICON_DIGIDEX },
  { to: '/roster',    label: 'Roster',     labelKey: 'nav.roster',    svg: ICON_ROSTER },
  { to: '/world',     label: 'The World',  labelKey: 'nav.world',     svg: ICON_WORLD },
  { to: '/lobby',     label: 'The Arena',  labelKey: 'nav.arena',     svg: ICON_ARENA },
];

const ADMIN_NAV_OVERVIEW: AdminNavEntry = { to: '/admin?tab=overview', label: 'Overview', svg: ICON_ADMIN_DOT, tab: 'overview' };

type AdminNavGroup = {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly AdminNavEntry[];
};

const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: 'community',
    label: 'Community',
    entries: [
      { to: '/admin?tab=users', label: 'Users', svg: ICON_ROSTER, tab: 'users' },
      { to: '/admin?tab=seasons', label: 'Seasons', svg: ICON_ARENA, tab: 'seasons' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    entries: [
      { to: '/admin?tab=catalog', label: 'Catalog', svg: ICON_DIGIDEX, tab: 'catalog' },
      { to: '/admin?tab=skills', label: 'Skills', svg: ICON_TRAINING, tab: 'skills' },
      { to: '/admin?tab=shop', label: 'Shop Admin', svg: ICON_MARKET, tab: 'shop' },
      { to: '/admin?tab=quests', label: 'Quests', svg: ICON_ADVENTURE, tab: 'quests' },
      { to: '/admin?tab=scraped', label: 'Scraped', svg: ICON_ADMIN_DOT, tab: 'scraped' },
    ],
  },
  {
    id: 'world',
    label: 'World',
    entries: [
      { to: '/admin?tab=dungeons', label: 'Dungeons', svg: ICON_DUNGEON, tab: 'dungeons' },
      { to: '/admin?tab=tilesets', label: 'Tilesets', svg: ICON_DIGIDEX, tab: 'tilesets' },
      { to: '/admin?tab=biomes', label: 'Biome scenes', svg: ICON_WORLD, tab: 'biomes' },
      { to: '/admin?tab=scene', label: 'Scene (per-arena)', svg: ICON_ARENA, tab: 'scene' },
      { to: '/admin/world', label: 'World Map Editor', svg: ICON_WORLD, route: '/admin/world' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    entries: [
      { to: '/admin?tab=settings', label: 'Settings', svg: ICON_ADMIN_COG, tab: 'settings' },
    ],
  },
];

const ADMIN_BACK_ENTRY: AdminNavEntry = { to: '/lobby', label: 'Back to game', svg: ICON_BACK, route: '/lobby' };

const BEYOND_STYLE: CSSProperties = { marginTop: 6 };

function isActive(pathname: string, target: string): boolean {
  return pathname === target || pathname.startsWith(`${target}/`);
}

function isAdminEntryActive(entry: AdminNavEntry, pathname: string, activeTab: string): boolean {
  if (entry.route !== undefined && pathname === entry.route) return true;
  if (entry.tab === 'dungeons' && pathname.startsWith('/admin/dungeons/')) return true;
  if (pathname === '/admin' && entry.tab === activeTab) return true;
  return false;
}

export function AppShell(): JSX.Element {
  const { user } = useAuth();
  const t = useT();
  const { pathname, search } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((prev) => !prev), []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname, search]);
  const pageLabelKey = pageLabelKeyFor(pathname);
  const pageLabel = pageLabelKey ? t(pageLabelKey) : (pathname.split('/').filter(Boolean)[0] ?? t('lobby.title'));
  const pageScope = pageScopeFor(pathname);
  const authed = !!user;
  const isAdminMode = pathname.startsWith('/admin');
  const isDungeonMode = pathname.startsWith('/dungeon/');
  const activeAdminTab = new URLSearchParams(search).get('tab') ?? 'overview';

  const farmQuery = useQuery({ queryKey: ['farm'] as const, queryFn: getFarm, enabled: authed, staleTime: 15_000 });
  const rosterQuery = useQuery({ queryKey: ['roster'] as const, queryFn: getRoster, enabled: authed, staleTime: 15_000 });

  const credits = farmQuery.data?.credits ?? null;
  const netcore = farmQuery.data?.netcore ?? null;
  const bits = farmQuery.data?.balances?.Bits ?? null;
  const roster = rosterQuery.data?.roster ?? [];
  const party = roster.filter((mon) => mon.status === 'party');
  const partyMax = 3;
  const tamerLv = user?.mmr ?? null;

  const renderNav = (entry: NavEntry): JSX.Element => {
    const active = isActive(pathname, entry.to);
    const label = entry.labelKey ? t(entry.labelKey) : entry.label;
    return (
      <Link
        key={entry.to}
        to={entry.to}
        className="navbtn"
        aria-label={label}
        {...(active ? { 'aria-current': 'page' as const } : {})}
      >
        {entry.svg}
        <span>{label}</span>
      </Link>
    );
  };

  const renderAdminNav = (entry: AdminNavEntry): JSX.Element => {
    const active = isAdminEntryActive(entry, pathname, activeAdminTab);
    const label = entry.labelKey ? t(entry.labelKey) : entry.label;
    return (
      <Link
        key={entry.to}
        to={entry.to}
        className="navbtn"
        aria-label={label}
        {...(active ? { 'aria-current': 'page' as const } : {})}
      >
        {entry.svg}
        <span>{label}</span>
      </Link>
    );
  };

  const mainClassName = pageScope ? `main ${pageScope}` : 'main';

  return (
    <div className={`win${isDungeonMode ? ' is-dungeon' : ''}${sidebarOpen ? ' has-sidebar-open' : ''}`}>
      <header className="titlebar">
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={t('hud.menu')}
          aria-controls="primary-sidebar"
          aria-expanded={sidebarOpen}
          onClick={toggleSidebar}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <div className="lights"><i /><i /><i /></div>
        <div className="win-meta">{t('header.tamer_terminal')} · {pageLabel}</div>
        <TopBarRight />
      </header>
      <div className="body">
        <div className="sidebar-backdrop" aria-hidden={!sidebarOpen} onClick={closeSidebar} />
        <nav
          id="primary-sidebar"
          className={`side${sidebarOpen ? ' is-open' : ''}`}
          aria-label="Primary"
          aria-hidden={!sidebarOpen && undefined}
        >
          {isAdminMode ? (
              <>
                <div className="grp">{t('hud.admin')}</div>
                {renderAdminNav(ADMIN_NAV_OVERVIEW)}
                {ADMIN_NAV_GROUPS.map((group) => {
                  const containsActive = group.entries.some((entry) => isAdminEntryActive(entry, pathname, activeAdminTab));
                  return (
                    <details key={group.id} className="nav-group" open={containsActive}>
                      <summary className="nav-group-summary">{group.label}</summary>
                      <div className="nav-group-body">
                        {group.entries.map(renderAdminNav)}
                      </div>
                    </details>
                  );
                })}
                <div className="grp" style={BEYOND_STYLE}>─</div>
                {renderAdminNav(ADMIN_BACK_ENTRY)}
              </>
            ) : (
              <>
                <div className="grp">{t('nav.town')}</div>
                {TOWN.map(renderNav)}
                <div className="grp" style={BEYOND_STYLE}>{t('nav.beyond')}</div>
                {BEYOND.map(renderNav)}
              </>
            )}
          <div className="spring">
            {isAdminMode ? (
              <div className="hud">
                <div className="pill"><span>{t('hud.admin')}</span><b>{user?.username ?? '—'}</b></div>
              </div>
            ) : (
              <div className="hud">
                <Link to="/account" className="pill" aria-label={t('account.title')}><span>{t('hud.tamer_lv')}</span><b>{tamerLv ?? '—'}</b></Link>
                <div className="pill"><span>{t('hud.credits')}</span><b>{credits !== null ? credits.toLocaleString('en-US') : '—'}</b></div>
                <div className="pill"><span>{t('hud.netcore')}</span><b>{netcore !== null ? netcore.toLocaleString('en-US') : '—'}</b></div>
                <div className="pill"><span>{t('hud.bits')}</span><b>{bits !== null ? bits.toLocaleString('en-US') : '—'}</b></div>
                <div className="pill"><span>{t('hud.party')}</span><b>{party.length}/{partyMax}</b></div>
              </div>
            )}
            {!isAdminMode && user?.isAdmin === true ? (
              <Link to="/admin" className="admin-link">{t('hud.admin')}</Link>
            ) : null}
          </div>
        </nav>
        <main className={mainClassName}><Outlet /></main>
      </div>
    </div>
  );
}
