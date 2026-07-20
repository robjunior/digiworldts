import { useState } from 'react';

import type { TemplateDigimon } from '@digiworld/shared/digimon';

import type { ActivityByMon, RosterActions, RosterMon } from './types';
import { formatRemaining, isDowned, totalStats, xpPct } from './types';
import { EvolutionChain } from './EvolutionChain';
import { SkillEditor } from './SkillEditor';

type RosterListProps = {
  readonly roster: readonly RosterMon[];
  readonly now: number;
  readonly activityByMon: ActivityByMon;
  readonly actions: RosterActions;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly reverseGraph: ReadonlyMap<string, readonly string[]>;
};

export function RosterList({ roster, now, activityByMon, actions, templateById, reverseGraph }: RosterListProps): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  if (roster.length === 0) return <div className="roster-list-empty">No Digimon to list.</div>;

  return (
    <ul className="roster-list" aria-label="Digimon list">
      {roster.map((mon) => (
        <RosterListRow
          key={mon.id}
          mon={mon}
          now={now}
          activity={activityByMon.get(mon.id) ?? null}
          actions={actions}
          templateById={templateById}
          reverseGraph={reverseGraph}
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
  readonly activity: { readonly readyToCollect: boolean; readonly statKinds: readonly string[] } | null;
  readonly actions: RosterActions;
  readonly templateById: ReadonlyMap<string, TemplateDigimon>;
  readonly reverseGraph: ReadonlyMap<string, readonly string[]>;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
};

function RosterListRow({ mon, now, activity, actions, templateById, reverseGraph, isOpen, onToggle }: RosterListRowProps): JSX.Element {
  const stats = totalStats(mon);
  const downed = isDowned(mon, now);
  const xp = Math.round(xpPct(mon));
  const stage = mon.template?.stage ?? '?';
  const attribute = mon.template?.attribute ?? '?';
  const element = mon.template?.element ?? 'null';
  const training = activity !== null;
  const rowClass = ['roster-list-row', isOpen ? 'is-open' : '', downed ? 'is-downed' : '', typeof mon.slot === 'number' ? 'is-party' : '', training ? 'is-training' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClass} data-mon={mon.id} style={{ ['--el' as string]: `var(--el-${element})` }}>
      <div
        role="button"
        tabIndex={0}
        className="roster-list-head"
        aria-expanded={isOpen}
        aria-controls={`row-body-${mon.id}`}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
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
          {training ? <span className="rl-pill rl-pill--training">{activity.readyToCollect ? 'Ready' : 'Training'}</span> : null}
          <PartyToggle mon={mon} downed={downed} actions={actions} />
        </span>
        <span className="rl-stats" aria-label="Stats">
          <StatCell label="HP" value={stats.hp} />
          <StatCell label="EN" value={stats.en} />
          <StatCell label="ATK" value={stats.atk} />
          <StatCell label="DEF" value={stats.def} />
          <StatCell label="SPD" value={stats.spd} />
        </span>
        <span className="rl-chev" aria-hidden="true">▾</span>
      </div>
      <div className="roster-list-body" id={`row-body-${mon.id}`} role="region" aria-hidden={!isOpen}>
        <div className="rl-body-inner">
          <div className="rl-actions">
            <button className="rl-action-btn rl-action-btn--evolve" type="button" disabled={downed} onClick={(event) => { event.stopPropagation(); actions.onEvolve(mon.id); }}>Digivolve</button>
            <button className="rl-action-btn rl-action-btn--rename" type="button" onClick={(event) => { event.stopPropagation(); actions.onRename(mon); }}>Rename</button>
            {downed ? (
              <button className="rl-action-btn rl-action-btn--revive" type="button" onClick={(event) => { event.stopPropagation(); actions.onRevive(mon.id); }}>
                Revive · {formatRemaining(mon.reviveAt, now)}
              </button>
            ) : null}
          </div>
          <EvolutionChain catalogId={mon.catalogId} templateById={templateById} reverseGraph={reverseGraph} />
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

function PartyToggle({ mon, downed, actions }: { readonly mon: RosterMon; readonly downed: boolean; readonly actions: RosterActions }): JSX.Element {
  const inParty = typeof mon.slot === 'number';
  const listed = mon.listedAt !== null;
  if (listed) {
    return <span className="rl-party-btn is-locked" aria-label="Listed on market">Listed</span>;
  }
  if (inParty) {
    return (
      <button
        type="button"
        className="rl-party-btn is-in-party"
        aria-label={`In party slot ${(mon.slot ?? 0) + 1} — click to remove`}
        onClick={(event) => { event.stopPropagation(); actions.onRemoveSlot(mon.slot ?? 0); }}
      >
        <span className="rl-party-dot" aria-hidden="true" />
        Slot {(mon.slot ?? 0) + 1}
        <span className="rl-party-x" aria-hidden="true">✕</span>
      </button>
    );
  }
  if (downed) {
    return <span className="rl-party-btn is-locked" aria-label="Downed — cannot enter party">Downed</span>;
  }
  return (
    <button
      type="button"
      className="rl-party-btn is-add"
      aria-label={`Add ${mon.nickname} to party`}
      onClick={(event) => { event.stopPropagation(); actions.onAddToParty(mon); }}
    >
      <span className="rl-party-plus" aria-hidden="true">+</span>
      Party
    </button>
  );
}
