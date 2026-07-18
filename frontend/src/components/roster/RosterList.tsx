import { useState } from 'react';

import type { RosterMon } from './types';
import { isDowned, totalStats, xpPct } from './types';
import { SkillEditor } from './SkillEditor';

type RosterListProps = {
  readonly roster: readonly RosterMon[];
  readonly now: number;
};

export function RosterList({ roster, now }: RosterListProps): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  if (roster.length === 0) return <div className="roster-list-empty">No Digimon to list.</div>;

  return (
    <ul className="roster-list" aria-label="Digimon list">
      {roster.map((mon) => (
        <RosterListRow
          key={mon.id}
          mon={mon}
          now={now}
          isOpen={openId === mon.id}
          onToggle={() => setOpenId(openId === mon.id ? null : mon.id)}
        />
      ))}
    </ul>
  );
}

type RosterListRowProps = {
  readonly mon: RosterMon;
  readonly now: number;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
};

function RosterListRow({ mon, now, isOpen, onToggle }: RosterListRowProps): JSX.Element {
  const stats = totalStats(mon);
  const downed = isDowned(mon, now);
  const xp = Math.round(xpPct(mon));
  const stage = mon.template?.stage ?? '?';
  const attribute = mon.template?.attribute ?? '?';
  const element = mon.template?.element ?? 'neutral';
  const rowClass = ['roster-list-row', isOpen ? 'is-open' : '', downed ? 'is-downed' : '', typeof mon.slot === 'number' ? 'is-party' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClass} data-mon={mon.id} style={{ ['--el' as string]: `var(--el-${element})` }}>
      <button
        type="button"
        className="roster-list-head"
        aria-expanded={isOpen}
        aria-controls={`row-body-${mon.id}`}
        onClick={onToggle}
      >
        <span className="rl-icon">
          <img src={`/assets/digimon/${mon.catalogId}/dot.gif`} alt="" loading="lazy" />
        </span>
        <span className="rl-name">
          <span className="rl-nick">{mon.nickname}</span>
          <span className="rl-species">{mon.template?.name ?? mon.catalogId}</span>
        </span>
        <span className="rl-level" aria-label={`Level ${mon.level}`}>
          <span className="rl-lvl-k">LV</span>
          <b>{mon.level}</b>
        </span>
        <span className="rl-xp" title={`XP ${Math.max(0, mon.xp - mon.xpFloor)} / ${Math.max(1, mon.xpNext - mon.xpFloor)}`}>
          <span className="rl-xp-track"><i style={{ width: `${xp}%` }} /></span>
          <span className="rl-xp-num">{xp}%</span>
        </span>
        <span className="rl-pills">
          <span className="rl-pill rl-pill--stage">{stage}</span>
          <span className="rl-pill rl-pill--attr">{attribute}</span>
          <span className="rl-pill rl-pill--el"><span className="rl-el-dot" />{element}</span>
        </span>
        <span className="rl-stats" aria-label="Stats">
          <StatCell label="HP" value={stats.hp} />
          <StatCell label="EN" value={stats.en} />
          <StatCell label="ATK" value={stats.atk} />
          <StatCell label="DEF" value={stats.def} />
          <StatCell label="SPD" value={stats.spd} />
        </span>
        <span className="rl-chev" aria-hidden="true">▾</span>
      </button>
      <div className="roster-list-body" id={`row-body-${mon.id}`} role="region" aria-hidden={!isOpen}>
        <div className="rl-body-inner">
          {isOpen ? <SkillEditor monId={mon.id} /> : null}
        </div>
      </div>
    </li>
  );
}

function StatCell({ label, value }: { readonly label: string; readonly value: number }): JSX.Element {
  return (
    <span className="rl-stat">
      <span className="rl-stat-k">{label}</span>
      <b className="rl-stat-v">{value}</b>
    </span>
  );
}
