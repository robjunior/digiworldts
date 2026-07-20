import type { ActivityByMon, RosterActions, RosterMon } from './types';
import { elementStyle, formatRemaining, isDowned, moodInfo, percentStyle, totalStats, xpPct } from './types';

export function CreatureCard({ mon, now, activityByMon, actions, onTouchAssign }: { readonly mon: RosterMon; readonly now: number; readonly activityByMon: ActivityByMon; readonly actions: RosterActions; readonly onTouchAssign: (monId: string) => void }): JSX.Element {
  const stats = totalStats(mon);
  const mood = moodInfo(mon);
  const downed = isDowned(mon, now);
  const activity = activityByMon.get(mon.id) ?? null;
  const inParty = typeof mon.slot === 'number';
  return (
    <article
      className={`creature-card ${inParty ? 'is-selected' : ''} ${downed ? 'is-downed' : ''}`}
      draggable={!downed}
      style={elementStyle(mon.template?.element)}
      data-id={mon.id}
      data-od-id={`card-${mon.id}`}
      onDragStart={(event) => event.dataTransfer.setData('text/plain', mon.id)}
      onClick={() => { if (!downed && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) onTouchAssign(mon.id); }}
    >
      <div className="creature-card-inner">
        <span className="rail" aria-hidden="true" />
        {downed ? <DownedOverlay mon={mon} now={now} onRevive={actions.onRevive} /> : null}
        <div className="card-meta">
          <div className="name-row">
            <div className="name-group">
              <img className="mon-icon" src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" loading="lazy" />
              <div className="name">{mon.nickname}</div>
            </div>
            <span className="lvl"><span>LV</span> {mon.level}</span>
          </div>
          <div className="xp-track" title={`XP ${Math.max(0, mon.xp - mon.xpFloor)} / ${Math.max(1, mon.xpNext - mon.xpFloor)}`}>
            <div className={`xp-fill ${mon.xpNext <= mon.xpFloor ? 'is-max' : ''}`} style={percentStyle(xpPct(mon))} />
          </div>
        </div>
        <div className="art">
          <div className="tile"><img src={mon.template?.assets.portrait ?? ''} alt={mon.nickname} loading="lazy" /></div>
          <StatsOverlay stats={stats} stage={mon.template?.stage ?? '?'} />
          <div className="hint" aria-hidden="true"><span className="hint-plus">＋</span><span className="h-lbl">Hover/Drag to Party</span></div>
        </div>
        <div className="card-foot">
          <div className="subline">
            <span className="pill"><span className="dot" />{mon.template?.element ?? 'null'}</span>
            <span className={`pill mood-${mood.state}`}><span className="dot" />{mood.label}</span>
            <ActivityPill slot={mon.slot} activity={activity} />
            <span className="stage-inline">{mon.template?.attribute ?? '?'}</span>
          </div>
          <div className="mon-actions">
            <button className="btn btn--secondary" type="button" onClick={(event) => { event.stopPropagation(); actions.onRename(mon); }}>Rename</button>
            <button className="btn btn--secondary" type="button" onClick={(event) => { event.stopPropagation(); actions.onEvolve(mon.id); }}>Evolve</button>
          </div>
        </div>
      </div>
    </article>
  );
}

function DownedOverlay({ mon, now, onRevive }: { readonly mon: RosterMon; readonly now: number; readonly onRevive: (monId: string) => void }): JSX.Element {
  return <div className="downed-overlay"><div className="down-icon" aria-hidden="true">×</div><div className="timer">{formatRemaining(mon.reviveAt, now)}</div><button className="revive-btn" type="button" onClick={(event) => { event.stopPropagation(); onRevive(mon.id); }}>Use Digi-Revive</button></div>;
}

function StatsOverlay({ stats, stage }: { readonly stats: ReturnType<typeof totalStats>; readonly stage: string }): JSX.Element {
  return (
    <div className="stats" aria-hidden="true">
      <div className="stat role-line"><span className="role-cap">Stage</span><span className="role-tag">{stage}</span></div>
      <Stat label="ATK" value={stats.atk} /><Stat label="DEF" value={stats.def} /><Stat label="INT" value={stats.int} /><Stat label="SPD" value={stats.spd} />
      <BarStat label="HP" value={stats.hp} className="hp" /><BarStat label="EN" value={stats.en} className="energy" />
    </div>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: number }): JSX.Element {
  return <div className="stat"><div className="k">{label}</div><div className="v">{value}</div></div>;
}

function BarStat({ label, value, className }: { readonly label: string; readonly value: number; readonly className: string }): JSX.Element {
  return <div className={`stat ${className}`}><div className="k">{label}</div><div className={`bar ${className === 'energy' ? 'energy-bar' : ''}`}><i style={percentStyle(100)} /></div><div className="v">{value}</div></div>;
}

function ActivityPill({ slot, activity }: { readonly slot: number | null; readonly activity: { readonly readyToCollect: boolean; readonly statKinds: readonly string[] } | null }): JSX.Element | null {
  if (activity !== null) {
    return <span className={`activity-pill training ${activity.readyToCollect ? 'is-ready' : ''}`}>{activity.readyToCollect ? 'Ready to Collect' : `Training ${activity.statKinds.map((stat) => stat.toUpperCase()).join('+')}`}</span>;
  }
  if (slot !== null) {
    return <span className="activity-pill party">Slot {slot + 1}</span>;
  }
  return null;
}
