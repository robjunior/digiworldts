import type { RosterMon, RosterActions } from './types';
import { elementStyle, formatRemaining, isDowned } from './types';

const PARTY_SLOTS = [0, 1, 2] as const;

export function PartyPicker({ roster, now, actions }: { readonly roster: readonly RosterMon[]; readonly now: number; readonly actions: RosterActions }): JSX.Element {
  return (
    <div className="party-strip" data-od-id="roster-party-strip">
      {PARTY_SLOTS.map((slot) => {
        const mon = roster.find((item) => item.slot === slot) ?? null;
        return <PartySlot key={slot} slot={slot} mon={mon} now={now} actions={actions} />;
      })}
    </div>
  );
}

function PartySlot({ slot, mon, now, actions }: { readonly slot: number; readonly mon: RosterMon | null; readonly now: number; readonly actions: RosterActions }): JSX.Element {
  if (mon === null) {
    return (
      <div
        className="party-slot is-empty"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => actions.onAssign(event.dataTransfer.getData('text/plain'), slot)}
      >
        <div className="party-empty-mark">—</div>
        <div className="name">Slot {slot + 1}</div>
        <div className="sub">empty</div>
        <div className="slot-actions" />
      </div>
    );
  }
  const downed = isDowned(mon, now);
  return (
    <div className={`party-slot ${downed ? 'is-downed' : ''}`} style={elementStyle(mon.template?.element)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => actions.onAssign(event.dataTransfer.getData('text/plain'), slot)}>
      {downed ? <span className="down-badge">{formatRemaining(mon.reviveAt, now)}</span> : null}
      <img src={mon.template?.assets.portrait ?? ''} alt={mon.nickname} loading="lazy" />
      <div className="name">{mon.nickname}</div>
      <div className="sub">Lv {mon.level} · {mon.template?.stage ?? '?'}</div>
      <div className="slot-actions">
        {downed ? <button className="btn btn--secondary" type="button" onClick={() => actions.onRevive(mon.id)}>Revive</button> : null}
        <button className="btn btn--secondary" type="button" onClick={() => actions.onRemoveSlot(slot)}>Remove</button>
      </div>
    </div>
  );
}
