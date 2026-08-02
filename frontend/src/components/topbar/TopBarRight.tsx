import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAuth } from '../../hooks/useAuth';
import { useLocale, useT } from '../../hooks/useLocale';
import { getFriends } from '../../lib/api';
import { getFarm } from '../../lib/api-farm';
import { collectTrainingStation, getTraining, type TrainingView } from '../../lib/api-training';

type MenuKind = 'notif' | 'user' | null;

type NotificationItem = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
};

export function TopBarRight(): JSX.Element | null {
  const { user, logout } = useAuth();
  const t = useT();
  useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [openMenu, setOpenMenu] = useState<MenuKind>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const authed = user !== null;

  const farmQuery = useQuery({
    queryKey: ['farm'] as const,
    queryFn: getFarm,
    enabled: authed,
    staleTime: 15_000,
  });
  const friendsQuery = useQuery({
    queryKey: ['friends'] as const,
    queryFn: getFriends,
    enabled: authed,
    staleTime: 30_000,
  });
  const trainingQuery = useQuery({
    queryKey: ['training'] as const,
    queryFn: getTraining,
    enabled: authed,
    staleTime: 15_000,
  });

  const collectTrainingMutation = useMutation({
    mutationFn: collectTrainingStation,
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(['training'], result.view);
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
  });

  const notifications: NotificationItem[] = [];
  const buildings = farmQuery.data?.buildings ?? [];
  const producedTotal = buildings.reduce((sum, b) => sum + Math.floor(b.produced), 0);
  if (producedTotal > 0) {
    const detailKey = producedTotal === 1 ? 'topbar.notif.farm.detail_one' : 'topbar.notif.farm.detail_other';
    notifications.push({
      id: 'farm-harvest',
      title: t('topbar.notif.farm.title'),
      detail: t(detailKey, { count: producedTotal }),
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

  if (!authed) return null;

  const initialLetter = (user.displayName?.[0] ?? user.username?.[0] ?? '?').toUpperCase();
  const tamerLevel = user.mmr;
  const hasNotifs = notifications.length > 0;

  return (
    <div className="topright" ref={rootRef} data-od-id="topbar-right">
      <div className="tbwrap">
        <button
          type="button"
          className="tbtn icon"
          aria-label={t('topbar.notifications.aria')}
          aria-haspopup="true"
          aria-expanded={openMenu === 'notif'}
          onClick={() => toggleMenu('notif')}
          data-od-id="tb-notif"
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
          {hasNotifs ? (
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
            <div className="nrow">
              <span className="nm">{t('topbar.notifications.empty')}</span>
            </div>
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
          data-od-id="tb-user"
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
          <button type="button" className="mi" role="menuitem" onClick={() => goto('/account')}>
            <ConnectionsIcon />
            <span>{t('topbar.menu.connections')}</span>
          </button>
          <button type="button" className="mi" role="menuitem" onClick={() => goto('/account')}>
            <SettingsIcon />
            <span>{t('topbar.menu.settings')}</span>
          </button>
          <button type="button" className="mi" role="menuitem" onClick={handleLogout} data-od-id="tb-logout">
            <LogoutIcon />
            <span>{t('topbar.menu.logout')}</span>
          </button>
        </div>
      </div>
    </div>
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
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.3-2.6H9.5l-.3 2.6a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.3 2.6h4.9l.3-2.6a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6a7 7 0 0 0 .1-1z" />
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
