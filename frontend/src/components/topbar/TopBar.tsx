import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../hooks/useAuth';
import { useT } from '../../hooks/useLocale';
import { apiFetch } from '../../lib/api';
import { getFarm } from '../../lib/api-farm';
import { getAdventure } from '../../lib/api-adventure';
import { collectTrainingStation, getTraining, type TrainingView } from '../../lib/api-training';
import { useWsStore } from '../../state/wsStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { PlayMenu } from './PlayMenu';

type MenuKind = 'notif' | 'user' | null;

type NotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
};

type FriendRequest = {
  readonly userId: string;
  readonly displayName: string;
};

type FriendsResponse = {
  readonly incoming: readonly FriendRequest[];
};

type NavLeaf = {
  readonly key: string;
  readonly to: string;
};

type NavItem =
  | ({ readonly kind: 'link' } & NavLeaf)
  | { readonly kind: 'parent'; readonly key: string; readonly children: readonly NavLeaf[] };

const NAV_ITEMS: readonly NavItem[] = [
  { kind: 'link', key: 'topbar.nav.lobby', to: '/' },
  {
    kind: 'parent',
    key: 'topbar.nav.town',
    children: [
      { key: 'nav.factory', to: '/factory' },
      { key: 'nav.farm', to: '/farm' },
      { key: 'nav.nursery', to: '/nursery' },
      { key: 'nav.training', to: '/training' },
    ],
  },
  { kind: 'link', key: 'nav.roster', to: '/roster' },
  { kind: 'link', key: 'topbar.nav.explore', to: '/adventure' },
  { kind: 'link', key: 'topbar.nav.inventory', to: '/items' },
  { kind: 'link', key: 'topbar.nav.shop', to: '/shop' },
];

function navActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function TopBar(): JSX.Element | null {
  const { user, logout } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [openMenu, setOpenMenu] = useState<MenuKind>(null);
  const [townOpen, setTownOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const socialNotifyVersion = useWsStore((s) => s.socialNotifyVersion);
  const pvpInvite = useWsStore((s) => s.pvpInvite);
  const pvpNotice = useWsStore((s) => s.pvpNotice);
  const clearPvpInvite = useWsStore((s) => s.clearPvpInvite);
  const clearPvpNotice = useWsStore((s) => s.clearPvpNotice);
  const { send } = useWebSocket();

  const authed = user !== null;

  const farmQuery = useQuery({
    queryKey: ['farm'] as const,
    queryFn: getFarm,
    enabled: authed,
    staleTime: 15_000,
  });
  const friendsQuery = useQuery({
    queryKey: ['friends'] as const,
    queryFn: async (): Promise<FriendsResponse> => apiFetch<FriendsResponse>('/api/friends'),
    enabled: authed,
    staleTime: 30_000,
  });
  const trainingQuery = useQuery({
    queryKey: ['training'] as const,
    queryFn: getTraining,
    enabled: authed,
    staleTime: 15_000,
  });
  const adventureQuery = useQuery({
    queryKey: ['adventure'] as const,
    queryFn: getAdventure,
    enabled: authed,
    staleTime: 30_000,
    refetchInterval: 15_000,
  });

  const collectTrainingMutation = useMutation({
    mutationFn: collectTrainingStation,
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(['training'], result.view);
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
  });

  useEffect(() => {
    if (socialNotifyVersion === 0) return;
    void queryClient.invalidateQueries({ queryKey: ['friends'] });
  }, [socialNotifyVersion, queryClient]);

  const notifications: NotificationItem[] = [];
  const buildings = farmQuery.data?.buildings ?? [];
  const fullBuildings = buildings.filter((b) => b.full);
  if (fullBuildings.length > 0) {
    const fullResources = Array.from(
      fullBuildings.reduce((acc, b) => {
        const cur = acc.get(b.resource) ?? 0;
        acc.set(b.resource, cur + Math.floor(b.produced));
        return acc;
      }, new Map<string, number>()),
    )
      .map(([res, amt]) => `${res} (${amt})`)
      .join(', ');
    notifications.push({
      id: 'farm-harvest',
      title: t('topbar.notif.farm.title'),
      detail: t('topbar.notif.farm.full_detail', { resources: fullResources }),
      actionLabel: t('topbar.notif.farm.action'),
      onAction: () => {
        setOpenMenu(null);
        void navigate('/farm');
      },
    });
  }
  for (const station of trainingQuery.data?.stations ?? []) {
    const active = station.active;
    if (active === null || !active.readyToCollect) continue;
    const stats = active.statKinds.map((k) => k.toUpperCase()).join('+');
    notifications.push({
      id: `training-${station.buildingId}`,
      title: t('topbar.notif.training.title'),
      detail: t('topbar.notif.training.detail', { name: active.monNickname, stats }),
      actionLabel: t('topbar.notif.training.action'),
      onAction: () => {
        collectTrainingMutation.mutate(station.buildingId);
        setOpenMenu(null);
      },
    });
  }
  for (const req of friendsQuery.data?.incoming ?? []) {
    notifications.push({
      id: `friend-${req.userId}`,
      title: t('topbar.notif.friend.title', { name: req.displayName }),
      detail: t('topbar.notif.friend.detail'),
      actionLabel: t('topbar.notif.friend.action'),
      onAction: () => {
        setOpenMenu(null);
        void navigate('/account');
      },
    });
  }

  const readyExpeditions = (adventureQuery.data?.active ?? []).filter(
    (a) => a.ready && a.collectedAt === null,
  );
  if (readyExpeditions.length > 0) {
    notifications.push({
      id: 'expedition-ready',
      title: t('topbar.notif.expedition.title'),
      detail: t('topbar.notif.expedition.detail'),
      actionLabel: t('topbar.notif.expedition.action'),
      onAction: () => {
        setOpenMenu(null);
        void navigate('/adventure');
      },
    });
  }

  useEffect(() => {
    if (openMenu === null) return;
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current === null) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return;
      setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!townOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      const wrap = document.getElementById('tnav-town-wrap');
      if (wrap === null) return;
      if (e.target instanceof Node && wrap.contains(e.target)) return;
      setTownOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTownOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [townOpen]);

  const toggleMenu = useCallback((kind: 'notif' | 'user'): void => {
    setOpenMenu((cur) => (cur === kind ? null : kind));
  }, []);

  const goto = useCallback((path: string): void => {
    setOpenMenu(null);
    void navigate(path);
  }, [navigate]);

  const handleLogout = useCallback((): void => {
    setOpenMenu(null);
    void logout().finally(() => {
      void navigate('/login');
    });
  }, [logout, navigate]);

  const handleDuelRespond = useCallback(
    (accept: boolean): void => {
      const invite = useWsStore.getState().pvpInvite;
      if (invite === null) return;
      send({ type: 'pvp:response', inviteId: invite.inviteId, accept });
      clearPvpInvite();
      setOpenMenu(null);
    },
    [send, clearPvpInvite],
  );

  // Show pvp:notice (declined / expired) briefly as a toast, then clear it.
  useEffect(() => {
    if (pvpNotice === null) return;
    const timer = window.setTimeout(() => clearPvpNotice(), 3500);
    return () => window.clearTimeout(timer);
  }, [pvpNotice, clearPvpNotice]);

  if (!authed) return null;

  const initialLetter = (user.displayName?.[0] ?? user.username?.[0] ?? '?').toUpperCase();
  const tamerLevel = user.mmr;
  const hasNotifs = notifications.length > 0 || pvpInvite !== null;
  const credits = farmQuery.data?.credits ?? null;
  const netcore = farmQuery.data?.netcore ?? null;

  return (
    <header className="topbar" role="banner">
      <PlayMenu />

      <nav className="tnav" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          if (item.kind === 'parent') {
            const active = item.children.some((child) => navActive(pathname, child.to));
            return (
              <div
                key={item.key}
                id="tnav-town-wrap"
                className={`tnav-wrap${townOpen ? ' is-open' : ''}`}
              >
                <button
                  type="button"
                  className="tnav-btn"
                  aria-haspopup="true"
                  aria-expanded={townOpen}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setTownOpen((v) => !v)}
                >
                  {t(item.key)}
                  <span className="tnav-caret" aria-hidden="true" />
                </button>
                {townOpen && (
                  <div className="tnav-submenu" role="menu">
                    {item.children.map((child) => (
                      <button
                        key={child.key}
                        type="button"
                        role="menuitem"
                        className="tnav-subitem"
                        aria-current={navActive(pathname, child.to) ? 'page' : undefined}
                        onClick={() => {
                          setTownOpen(false);
                          navigate(child.to);
                        }}
                      >
                        {t(child.key)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          const active = navActive(pathname, item.to);
          return (
            <button
              key={item.key}
              type="button"
              className="tnav-btn"
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.to)}
            >
              {t(item.key)}
            </button>
          );
        })}
      </nav>

      <div className="topright" ref={rootRef}>
        <div className="wallet">
          <span className="wc cred" aria-label={`Créditos: ${credits ?? '—'}`}>
            <CreditsIcon />
            <span className="am">{credits !== null ? credits.toLocaleString('en-US') : '—'}</span>
          </span>
          <span className="wc netcore" aria-label={`NetCore: ${netcore ?? '—'}`}>
            <NetcoreIcon />
            <span className="am b">{netcore !== null ? netcore.toLocaleString('en-US') : '—'}</span>
          </span>
        </div>

        <div className="tbwrap">
          <button
            type="button"
            className="tbtn icon"
            aria-label={t('topbar.notifications.aria')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'notif'}
            onClick={() => toggleMenu('notif')}
          >
            <BellIcon />
            {hasNotifs ? <span className="dot-badge" aria-hidden="true" /> : null}
          </button>
          <div
            className={`tmenu${openMenu === 'notif' ? ' open' : ''}`}
            role="menu"
            aria-label={t('topbar.notifications.title')}
          >
            <div className="mhd">{t('topbar.notifications.title')}</div>
            {pvpInvite !== null && (
              <div className="nrow" role="menuitem">
                <span className="nt">
                  {t('topbar.duel.invite.title', { name: pvpInvite.fromName })}
                </span>
                <span className="nm">{t('topbar.duel.invite.detail')}</span>
                <span className="n-actions">
                  <button type="button" className="na accept" onClick={() => handleDuelRespond(true)}>
                    {t('topbar.duel.accept')}
                  </button>
                  <button type="button" className="na decline" onClick={() => handleDuelRespond(false)}>
                    {t('topbar.duel.decline')}
                  </button>
                </span>
              </div>
            )}
            {notifications.length > 0 ? (
              notifications.map((n) => (
                <div className="nrow" key={n.id} role="menuitem">
                  <span className="nt">{n.title}</span>
                  <span className="nm">{n.detail}</span>
                  <button type="button" className="na" onClick={n.onAction}>
                    {n.actionLabel}
                  </button>
                </div>
              ))
            ) : (
              pvpInvite === null && (
                <div className="nrow">
                  <span className="nm">{t('topbar.notifications.empty')}</span>
                </div>
              )
            )}
          </div>
        </div>

        <div className="tbwrap">
          <button
            type="button"
            className="tbtn"
            aria-label={t('topbar.user_menu.aria')}
            aria-haspopup="true"
            aria-expanded={openMenu === 'user'}
            onClick={() => toggleMenu('user')}
          >
            <span className="uav">{initialLetter}</span>
            <span className="unm">{user.displayName}</span>
            <ChevronIcon />
          </button>
          <div
            className={`tmenu${openMenu === 'user' ? ' open' : ''}`}
            role="menu"
            aria-label={t('topbar.user_menu.aria')}
          >
            <div className="mhd">{t('topbar.user_menu.header', { level: tamerLevel })}</div>
            <button type="button" className="mi" role="menuitem" onClick={() => goto('/account')}>
              <ProfileIcon />
              <span>{t('topbar.menu.view_profile')}</span>
            </button>
            <button type="button" className="mi" role="menuitem" onClick={() => goto('/digdex')}>
              <CollectionIcon />
              <span>{t('topbar.menu.collection')}</span>
            </button>
            <button type="button" className="mi" role="menuitem" onClick={() => goto('/account')}>
              <ConnectionsIcon />
              <span>{t('topbar.menu.connections')}</span>
            </button>
            <button type="button" className="mi" role="menuitem" onClick={() => goto('/account')}>
              <SettingsIcon />
              <span>{t('topbar.menu.settings')}</span>
            </button>
            <button type="button" className="mi" role="menuitem" onClick={handleLogout}>
              <LogoutIcon />
              <span>{t('topbar.menu.logout')}</span>
            </button>
          </div>
        </div>
      </div>

      {pvpNotice !== null && (
        <div className="tb-toast" role="status" aria-live="polite">
          {pvpNotice}
        </div>
      )}
    </header>
  );
}

function BellIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10 21h4" />
    </svg>
  );
}

function CreditsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function NetcoreIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path d="M12 2.5l7.5 4.33v8.66L12 19.83 4.5 15.5V6.83z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ProfileIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
      <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
    </svg>
  );
}

function CollectionIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function ConnectionsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M17.5 20a5.5 5.5 0 0 0-11 0" />
      <path d="M17 11l2 2 3-3" />
    </svg>
  );
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.3-2.6H9.5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h4.9l.3-2.6a7 7 0 0 0 1.7 1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" />
    </svg>
  );
}

function LogoutIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M15 17l5-5-5-5" />
      <path d="M20 12H9" />
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </svg>
  );
}
