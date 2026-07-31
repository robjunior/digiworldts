import type { ReactElement } from 'react';

type DungeonActionBarProps = {
  readonly canMove: boolean;
  readonly onMove: (dx: number, dy: number) => void;
  readonly activeSheet: 'log' | 'items' | 'quest' | null;
  readonly onToggleSheet: (sheet: 'log' | 'items' | 'quest') => void;
};

export function DungeonActionBar({
  canMove,
  onMove,
  activeSheet,
  onToggleSheet,
}: DungeonActionBarProps): ReactElement {
  return (
    <div className="action-bar">
      <div className="dpad-compact">
        <div className="dpad-row">
          <button type="button" aria-label="Move up" disabled={!canMove} onClick={() => onMove(0, -1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
        </div>
        <div className="dpad-row">
          <button type="button" aria-label="Move left" disabled={!canMove} onClick={() => onMove(-1, 0)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <button type="button" aria-label="Move down" disabled={!canMove} onClick={() => onMove(0, 1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
          </button>
          <button type="button" aria-label="Move right" disabled={!canMove} onClick={() => onMove(1, 0)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
      <div className="action-toggles">
        <button
          type="button"
          aria-label="Toggle Log"
          aria-expanded={activeSheet === 'log'}
          aria-controls="sheet-log"
          onClick={() => onToggleSheet('log')}
          className={activeSheet === 'log' ? 'is-active' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <button
          type="button"
          aria-label="Toggle Items"
          aria-expanded={activeSheet === 'items'}
          aria-controls="sheet-items"
          onClick={() => onToggleSheet('items')}
          className={activeSheet === 'items' ? 'is-active' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12c0 1.1.9 2 2 2h14v-4H6a2 2 0 0 1-2-2z"/></svg>
        </button>
        <button
          type="button"
          aria-label="Toggle Quest"
          aria-expanded={activeSheet === 'quest'}
          aria-controls="sheet-quest"
          onClick={() => onToggleSheet('quest')}
          className={activeSheet === 'quest' ? 'is-active' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        </button>
      </div>
    </div>
  );
}
