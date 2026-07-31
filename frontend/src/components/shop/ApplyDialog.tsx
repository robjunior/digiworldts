import type { RosterView } from '../../lib/api';
import type { InventoryItemView } from '../../lib/api-shop';

export function ApplyDialog({ item, roster, loading, onClose, onApply }: { readonly item: InventoryItemView | null; readonly roster: readonly RosterView[]; readonly loading: boolean; readonly onClose: () => void; readonly onApply: (monId: string) => void }): JSX.Element {
  return (
    <div className={`cov ${item ? 'show' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="cmodal" style={{ width: 'min(600px, 92vw)' }}>
        <div className="ek">Aplicar Item</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>{item?.name ?? 'Item'}</h3>
          <button className="buy ghost" type="button" aria-label="Close" onClick={onClose} style={{ padding: '4px 8px' }}>×</button>
        </div>
        <div className="cline">
          <div className="cinfo">
            <div className="s">{item?.description}</div>
            <div className="s" style={{ marginTop: 8 }}>Selecione um Digimon:</div>
          </div>
        </div>
        {loading ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '24px' }}>Loading roster...</div> : null}
        {!loading && roster.length === 0 ? <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '24px' }}>No Digimon in your roster.</div> : null}
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
