import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useWebSocket } from '../../hooks/useWebSocket';
import { useWsStore } from '../../state/wsStore';

type GameMode = {
  readonly id: string;
  readonly label: string;
  readonly meta: string;
  readonly live?: boolean;
};

const GAME_MODES: readonly GameMode[] = [
  { id: 'ranked', label: 'Ranked', meta: '3v3 · ELO', live: true },
  { id: 'casual', label: 'Casual', meta: '3v3 · Unranked' },
  { id: 'tournament', label: 'Tournament', meta: 'Single Elim', live: true },
  { id: 'training', label: 'Training', meta: 'vs CPU' },
];

/**
 * Universal JOGAR button, replaces the logo in the shared topbar.
 *
 * Idle: flashes "JOGAR"; click opens a downward menu of game modes.
 * Picking a mode joins the real matchmaking queue, closes the menu, and
 * routes to the lobby. The queue lives in the global wsStore, so it keeps
 * running while the user roams any page (collection, farm, …).
 *
 * Waiting/matched: becomes a "Queue" button; clicking cancels the queue
 * (or jumps to the arena when a match is found). The shared TopBar is only
 * rendered inside AppShell, so this button never appears during battle.
 */
export function PlayMenu(): JSX.Element {
  const { send } = useWebSocket();
  const navigate = useNavigate();
  const queue = useWsStore((s) => s.queue);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const waiting = queue.status === 'waiting';
  const matched = queue.status === 'matched';

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current === null) return;
      if (e.target instanceof Node && rootRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
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

  const pickMode = (): void => {
    setOpen(false);
    send({ type: 'queue', join: true });
    void navigate('/lobby');
  };

  const label = waiting ? 'Queue' : matched ? 'Match' : 'Jogar';
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

      <div
        className={`play-drop${open ? ' open' : ''}`}
        role="menu"
        aria-label="Game modes"
        data-od-id="play-drop"
      >
        <div className="play-drop-hd">Selecionar modo</div>
        {GAME_MODES.map((mode) => (
          <button type="button" className="play-drop-item" role="menuitem" key={mode.id} onClick={pickMode}>
            <span className="pdi-ic" aria-hidden="true">
              <ModeIcon id={mode.id} />
            </span>
            <span className="pdi-tx">
              <span className="pdi-lb">
                {mode.label}
                {mode.live ? <span className="pdi-live">LIVE</span> : null}
              </span>
              <span className="pdi-mt">{mode.meta}</span>
            </span>
          </button>
        ))}
      </div>
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

function ModeIcon({ id }: { readonly id: string }): JSX.Element {
  const path =
    id === 'ranked'
      ? 'M12 2l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z'
      : id === 'casual'
        ? 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'
        : id === 'tournament'
          ? 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z'
          : 'M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83';
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}