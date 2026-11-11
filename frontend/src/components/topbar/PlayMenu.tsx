import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useT } from '../../hooks/useLocale';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useWsStore } from '../../state/wsStore';

type GameMode = {
  readonly id: string;
  readonly labelKey: string;
  readonly descKey: string;
  readonly to?: string;
  readonly live?: boolean;
};

const GAME_MODES: readonly GameMode[] = [
  { id: 'ranked', labelKey: 'topbar.mode.ranked', descKey: 'topbar.mode.ranked.desc', live: true },
  { id: 'normal', labelKey: 'topbar.mode.normal', descKey: 'topbar.mode.normal.desc' },
  { id: 'world', labelKey: 'topbar.mode.world', descKey: 'topbar.mode.world.desc', to: '/world' },
];

/**
 * Universal JOGAR button, replaces the logo in the shared topbar.
 *
 * Idle: flashes \"JOGAR\"; click opens a full-screen mode menu (animated top
 * down, columns with self-explanatory descriptions). Picking a PvP mode joins
 * the real matchmaking queue, closes the menu, and routes to the lobby. The
 * queue lives in the global wsStore, so it keeps running while the user roams
 * any page (collection, farm, …). \"O Mundo\" routes to the PvE world instead of
 * joining a queue.
 *
 * Waiting/matched: becomes a \"Queue\" button; clicking cancels the queue (or
 * jumps to the arena when a match is found). The shared TopBar is only
 * rendered inside AppShell, so this button never appears during battle.
 */
export function PlayMenu(): JSX.Element {
  const { send } = useWebSocket();
  const navigate = useNavigate();
  const t = useT();
  const queue = useWsStore((s) => s.queue);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const waiting = queue.status === 'waiting';
  const matched = queue.status === 'matched';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleMainClick = (): void => {
    if (matched) {
      void navigate('/combat');
      return;
    }
    if (waiting) {
      // Cancel the running queue.
      send({ type: 'queue', join: false });
      setOpen(false);
      return;
    }
    setOpen((cur) => !cur);
  };

  const pickMode = (mode: GameMode): void => {
    setOpen(false);
    if (mode.to) {
      void navigate(mode.to);
      return;
    }
    send({ type: 'queue', join: true });
    void navigate('/');
  };

  const label = waiting ? 'Queue' : matched ? 'Match' : t('topbar.nav.play');
  const stateClass = matched ? 'is-matched' : waiting ? 'is-waiting' : 'is-idle';

  return (
    <div className={`playmenu${open ? ' is-open' : ''}`} ref={rootRef} data-od-id="play-menu">
      <button
        type="button"
        className={`play-btn ${stateClass}`}
        aria-haspopup={waiting || matched ? undefined : 'menu'}
        aria-expanded={open}
        onClick={handleMainClick}
        data-od-id="play-btn"
      >
        {waiting ? <SpinnerIcon /> : <PlayIcon />}
        <span>{label}</span>
        {!waiting && !matched ? <ChevronIcon /> : null}
      </button>

      {open ? (
        <div className="play-menu-overlay" role="dialog" aria-modal="true" aria-label="Game modes" data-od-id="play-mega">
          <button type="button" className="ov-veil" aria-label="Fechar" onClick={() => setOpen(false)} />
          <section className="ov-panel">
            <header className="ov-head">
              <span className="ov-kicker">{t('topbar.menu.play.kicker')}</span>
              <h2 className="ov-title">{t('topbar.menu.play.title')}</h2>
              <p className="ov-sub">{t('topbar.menu.play.sub')}</p>
              <button type="button" className="ov-close" aria-label="Fechar" onClick={() => setOpen(false)}>
                <CloseIcon />
              </button>
            </header>
            <div className="ov-cols">
              {GAME_MODES.map((mode) => (
                <button
                  type="button"
                  className="ov-card"
                  role="menuitem"
                  key={mode.id}
                  data-od-id={`play-mode-${mode.id}`}
                  onClick={() => pickMode(mode)}
                >
                  <span className="ov-card-ic" aria-hidden="true">
                    <ModeIcon id={mode.id} />
                  </span>
                  <span className="ov-card-lb">
                    {t(mode.labelKey)}
                    {mode.live ? <span className="ov-live">LIVE</span> : null}
                  </span>
                  <span className="ov-card-desc">{t(mode.descKey)}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SpinnerIcon(): JSX.Element {
  return (
    <svg className="play-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function CloseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ModeIcon({ id }: { readonly id: string }): JSX.Element {
  const path =
    id === 'ranked'
      ? 'M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z'
      : id === 'normal'
        ? 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'
        : 'M12 2C7 4 3 10 3 15a9 9 0 0 0 18 0c0-5-4-11-9-13zm0 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6z';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}