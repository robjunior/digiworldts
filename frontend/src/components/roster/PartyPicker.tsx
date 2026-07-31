import type { RosterMon, RosterActions } from './types';
import { elementStyle, formatRemaining, isDowned } from './types';

const PARTY_SLOTS = [0, 1, 2] as const;

export function PartyPicker({ roster, now, actions }: { readonly roster: readonly RosterMon[]; readonly now: number; readonly actions: RosterActions }): JSX.Element {
  return (
    <section className="party-picker" data-od-id="roster-party-picker">
      <h2 className="party-picker-header">CURRENT PARTY</h2>
      <div className="party-picker-slots">
        {PARTY_SLOTS.map((slot) => {
          const mon = roster.find((item) => item.slot === slot) ?? null;
          return <PartySlot key={slot} slot={slot} mon={mon} now={now} actions={actions} />;
        })}
      </div>
    </section>
  );
}

function PartySlot({ slot, mon, now, actions }: { readonly slot: number; readonly mon: RosterMon | null; readonly now: number; readonly actions: RosterActions }): JSX.Element {
  const isActive = slot === 0;

  if (mon === null) {
    return (
      <div
        className={`party-slot is-empty ${isActive ? 'is-active' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => actions.onAssign(event.dataTransfer.getData('text/plain'), slot)}
        data-od-id={`party-slot-${slot}`}
      >
        <div className="party-empty-mark">—</div>
        <div className="party-slot-text">
          <div className="name">Slot {slot + 1}</div>
          <div className="sub">empty</div>
        </div>
        <div className="slot-actions">
          <button type="button" className="slot-add" aria-label={`Assign a Digimon to slot ${slot + 1}`} onClick={() => actions.onPickForSlot(slot)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    );
  }

  const downed = isDowned(mon, now);
  return (
    <div 
      className={`party-slot ${downed ? 'is-downed' : ''} ${isActive ? 'is-active' : ''}`} 
      style={elementStyle(mon.template?.element)} 
      onDragOver={(event) => event.preventDefault()} 
      onDrop={(event) => actions.onAssign(event.dataTransfer.getData('text/plain'), slot)}
      data-od-id={`party-slot-${slot}`}
    >
      {downed ? <span className="down-badge">{formatRemaining(mon.reviveAt, now)}</span> : null}
      <img src={mon.template?.assets.portrait ?? ''} alt={mon.nickname} loading="lazy" />
      
      <div className="party-slot-text">
        <div className="name">{mon.nickname}</div>
        <div className="sub">LV {mon.level}</div>
      </div>

      <div className="slot-actions">
        {downed ? <button className="btn btn--secondary" type="button" onClick={() => actions.onRevive(mon.id)}>Revive</button> : null}
        <button className="btn btn--secondary" type="button" onClick={() => actions.onRemoveSlot(slot)}>Remove</button>
      </div>
    </div>
  );
}
