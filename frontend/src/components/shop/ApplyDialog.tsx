import type { RosterView } from '../../lib/api';
import type { InventoryItemView } from '../../lib/api-shop';

export function ApplyDialog({ item, roster, loading, onClose, onApply }: { readonly item: InventoryItemView | null; readonly roster: readonly RosterView[]; readonly loading: boolean; readonly onClose: () => void; readonly onApply: (monId: string) => void }): JSX.Element {
  return (
    <div className={`modal-overlay ${item ? 'show' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="modal-header">
          <h3>Apply {item?.name ?? 'Item'}</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {loading ? <div className="inv-empty">Loading roster...</div> : null}
        {!loading && roster.length === 0 ? <div className="inv-empty">No Digimon in your roster.</div> : null}
        <div className="picker-grid">
          {roster.map((mon) => (
            <button key={mon.id} className="mon-option" type="button" onClick={() => onApply(mon.id)}>
              <img src={mon.template?.assets.portrait ?? ''} alt={mon.nickname} loading="lazy" />
              <span className="info"><span className="name">{mon.nickname}</span><span className="sub">Lv {mon.level} · {mon.template?.stage ?? '?'}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
