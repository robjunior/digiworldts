import type { RosterMon } from './types';
import { elementStyle, isDowned } from './types';

type SubstitutionDialogProps = {
  readonly incoming: RosterMon | null;
  readonly party: readonly (RosterMon | null)[];
  readonly now: number;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onPick: (slot: number) => void;
};

export function SubstitutionDialog({ incoming, party, now, busy, onClose, onPick }: SubstitutionDialogProps): JSX.Element {
  const open = incoming !== null;
  return (
    <div className={`modal-overlay ${open ? 'show' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card subst-card">
        <div className="modal-header">
          <h3>{incoming ? `Substitute for ${incoming.nickname}` : 'Substitute'}</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="subst-hint">Your party is full. Pick a Digimon to swap out — it returns to the roster and {incoming?.nickname ?? 'the incoming Digimon'} takes its slot.</p>
        <div className="subst-grid">
          {party.map((mon, idx) => (
            <SubstitutionOption key={idx} slot={idx} mon={mon} now={now} busy={busy} onPick={onPick} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn--secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

type SubstitutionOptionProps = {
  readonly slot: number;
  readonly mon: RosterMon | null;
  readonly now: number;
  readonly busy: boolean;
  readonly onPick: (slot: number) => void;
};

function SubstitutionOption({ slot, mon, now, busy, onPick }: SubstitutionOptionProps): JSX.Element {
  if (mon === null) {
    return (
      <button className="subst-option is-empty" type="button" disabled={busy} onClick={() => onPick(slot)}>
        <span className="subst-slot">Slot {slot + 1}</span>
        <span className="subst-empty-mark">—</span>
        <span className="subst-name">Empty</span>
        <span className="subst-sub">Assign here</span>
      </button>
    );
  }
  const downed = isDowned(mon, now);
  return (
    <button
      className={`subst-option ${downed ? 'is-downed' : ''}`}
      type="button"
      disabled={busy}
      style={elementStyle(mon.template?.element)}
      onClick={() => onPick(slot)}
    >
      <span className="subst-slot">Slot {slot + 1}</span>
      <img src={mon.template?.assets.portrait ?? ''} alt={mon.nickname} loading="lazy" />
      <span className="subst-name">{mon.nickname}</span>
      <span className="subst-sub">Lv {mon.level} · {mon.template?.stage ?? '?'}</span>
      <span className="subst-swap">Swap out →</span>
    </button>
  );
}
