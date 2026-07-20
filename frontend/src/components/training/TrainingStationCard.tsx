import type { CSSProperties } from 'react';

import type { RosterView } from '../../lib/api';
import type { TrainingStationView } from '../../lib/api-training';
import { clamp, formatCountdown, formatStat, moodColor, previewGainsText } from './training-utils';

type TrainingStationCardProps = {
  readonly station: TrainingStationView;
  readonly rosterMon: RosterView | null;
  readonly now: number;
  readonly pendingBuildingId: string | null;
  readonly onAssign: (buildingId: string) => void;
  readonly onCancel: (buildingId: string) => void;
  readonly onCollect: (buildingId: string) => void;
};

export function TrainingStationCard(props: TrainingStationCardProps): JSX.Element {
  const { station, rosterMon, now, pendingBuildingId, onAssign, onCancel, onCollect } = props;
  if (station.active === null) {
    return <EmptyStationCard station={station} pending={pendingBuildingId === station.buildingId} onAssign={onAssign} />;
  }

  const active = station.active;
  const pct = clamp(Math.floor(((now - active.startedAt) / active.durationMs) * 100), 0, 100);
  const ready = pct >= 100 || active.readyToCollect;
  const remainingMs = active.finishesAt - now;
  const fillStyle: CSSProperties & Record<'--pct', string> = { '--pct': `${pct}%` };
  const mood = rosterMon?.mood ?? 50;
  const portrait = rosterMon?.template?.assets.portrait ?? '';
  const pending = pendingBuildingId === station.buildingId;

  return (
    <article className={`bld ${ready ? 'is-ready' : ''}`} data-bld={station.buildingId} data-finishes={active.finishesAt}>
      <div className="art has-mon">
        <div className="lv">Lv {active.monLevel}</div>
        {ready ? <div className="ready-dot" /> : null}
        <img src={portrait} alt={active.monNickname} onError={(event) => event.currentTarget.classList.add('is-faded')} />
      </div>
      <div className="body">
        <div className="top training-top">
          <span className="bname">{station.kind}</span>
          <span className="rate"><b>{station.buildingType === 'training_premium' ? 'PREMIUM' : 'BASIC'}</b></span>
        </div>
        <div className="mon-info">
          <div className="mon-name">
            <span className="mood-dot" style={{ background: moodColor(mood) }} title={`Mood: ${mood}`} />
            {active.monNickname}
            <span className="mon-stage">{active.monStage}</span>
          </div>
        </div>
        <div className="training-stat-list">
          {active.statKinds.map((stat) => <span key={stat} className="pill">{formatStat(stat)}</span>)}
        </div>
        <div className="store">
          <div className="store-head">
            <span className="status-txt">{ready ? 'Ready to collect!' : 'Training...'}</span>
            <span className="v countdown">{ready ? '0m 0s' : formatCountdown(remainingMs)}</span>
          </div>
          <div className="fill" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <i style={fillStyle} />
          </div>
        </div>
        <div className="training-preview-line">Will gain {previewGainsText(active.previewGains, active.statKinds)}. Mood {active.previewMoodDelta >= 0 ? '+' : ''}{active.previewMoodDelta}.</div>
        <div className="foot">
          <button className="btn btn--secondary" type="button" disabled={pending} onClick={() => onCancel(station.buildingId)}>Cancel</button>
          <button className="btn btn-collect" type="button" disabled={!ready || pending} onClick={() => onCollect(station.buildingId)}>Collect</button>
        </div>
      </div>
    </article>
  );
}

function EmptyStationCard({ station, pending, onAssign }: { readonly station: TrainingStationView; readonly pending: boolean; readonly onAssign: (buildingId: string) => void }): JSX.Element {
  const premium = station.buildingType === 'training_premium';
  return (
    <article className="bld">
      <div className="art">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="training-empty-icon" aria-hidden="true">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
        </svg>
      </div>
      <div className="body">
        <div className="top">
          <span className="bname">{station.kind}</span>
          <span className="rate"><b>{premium ? 'PREMIUM' : 'BASIC'}</b> · {station.supportedStatCount} stat{station.supportedStatCount > 1 ? 's' : ''}</span>
        </div>
        <div className="training-empty-copy">Empty station.<br />Assign a Digimon to train.</div>
        <div className="foot">
          <button className="btn btn--wide" type="button" disabled={pending} onClick={() => onAssign(station.buildingId)}>Assign Digimon</button>
        </div>
      </div>
    </article>
  );
}
