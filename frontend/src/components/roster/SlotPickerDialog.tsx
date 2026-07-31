import type { RosterMon } from './types';
import { elementStyle, isDowned } from './types';

type SlotPickerDialogProps = {
  readonly slot: number | null;
  readonly roster: readonly RosterMon[];
  readonly now: number;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onPick: (monId: string) => void;
};

export function SlotPickerDialog({ slot, roster, now, busy, onClose, onPick }: SlotPickerDialogProps): JSX.Element {
  const open = slot !== null;
  const available = roster.filter((mon) => {
    if (typeof mon.slot === 'number') return false;
    if (isDowned(mon, now)) return false;
    if (mon.listedAt !== null) return false;
    if (mon.status === 'nursery') return false;
    if (mon.status === 'training') return false;
    return true;
  });

  return (
    <div className={`modal-overlay ${open ? 'show' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card subst-card">
        <div className="modal-header">
          <h3>Assign to Slot {slot !== null ? slot + 1 : ''}</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        
        {available.length === 0 ? (
          <div className="empty">
            <p>No Digimon available to assign.</p>
          </div>
        ) : (
          <div className="subst-grid">
            {available.map((mon) => (
              <button
                key={mon.id}
                className="subst-option"
                type="button"
                disabled={busy}
                style={elementStyle(mon.template?.element)}
                onClick={() => onPick(mon.id)}
              >
                <img src={mon.template?.assets.portrait ?? ''} alt={mon.nickname} loading="lazy" />
                <span className="subst-name">{mon.nickname}</span>
                <span className="subst-sub">Lv {mon.level} · {mon.template?.stage ?? '?'}</span>
              </button>
            ))}
          </div>
        )}
        
        <div className="modal-actions">
          <button className="btn btn--secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
