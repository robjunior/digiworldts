const SLOTS = [0, 1, 2] as const;

export function TouchAssignDialog({ monId, onClose, onAssign }: { readonly monId: string | null; readonly onClose: () => void; readonly onAssign: (slot: number) => void }): JSX.Element {
  return (
    <div className={`modal-overlay ${monId ? 'show' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card touch-assign-card">
        <div className="modal-header">
          <h3>Assign to Party</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="touch-assign-body">
          {SLOTS.map((slot) => <button key={slot} className="btn btn--secondary" type="button" onClick={() => onAssign(slot)}>Slot {slot + 1}</button>)}
        </div>
      </div>
    </div>
  );
}
