import type { CSSProperties } from 'react';

import type { RosterView } from '../../lib/api';
import type { TrainingStationView } from '../../lib/api-training';
import { clamp, formatCountdown, formatStat, moodColor, previewGainsText, computeGainsPreview } from './training-utils';

type TrainingStationCardProps = {
  readonly station: TrainingStationView;
  readonly rosterMon: RosterView | null;
  readonly now: number;
  readonly pendingBuildingId: string | null;
  readonly onAssign: (buildingId: string) => void;
  readonly onCancel: (buildingId: string) => void;
  readonly onCollect: (buildingId: string) => void;
};

const STATION_ICON = <path d="M6.5 6.5l11 11 M4 9l-1.5-1.5 2-2L6 7M15 18l1.5 1.5 2-2L17 15" />;
const STAT_LABEL: Record<string, string> = {hp:'HP',en:'EN',atk:'ATK',def:'DEF',int:'INT',spd:'SPD'};

export function TrainingStationCard(props: TrainingStationCardProps): JSX.Element {
  const { station, rosterMon, now, pendingBuildingId, onAssign, onCancel, onCollect } = props;
  const supported = station.buildingType === 'training_premium' ? 2 : 1;
  const label = station.buildingType === 'training_premium' ? 'Premium · 2 stats' : 'Basic · 1 stat';
  const pending = pendingBuildingId === station.buildingId;
  const typeStyle: CSSProperties & Record<'--sc', string> = { '--sc': station.buildingType === 'training_premium' ? 'var(--good)' : 'var(--signal)' };

  let body: JSX.Element;

  if (station.active) {
    const a = station.active;
    const m = rosterMon;
    const total = a.durationMs;
    const done = Math.min(total, now - a.startedAt);
    const rem = Math.max(0, a.startedAt + a.durationMs - now);
    const ready = rem <= 0;
    const pct = Math.min(100, (done / total) * 100);
    const gains = computeGainsPreview(a.durationMs / 60000, a.statKinds);
    const md = a.previewMoodDelta;

    body = (
      <div className="sactive">
        <div className="trainee">
          <span className="spr"><img src={m?.template?.assets.portrait ?? ''} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /></span>
          <div><div className="tnm">{a.monNickname}</div><div className="tsub">{a.monStage} · Lv {a.monLevel}</div></div>
        </div>
        <div className="statchips">
          {a.statKinds.map((k) => (
            <span key={k} className="schip" data-stat={k}><span className="cd"></span>{STAT_LABEL[k]} <span className="gv">+{gains[k]}</span></span>
          ))}
        </div>
        <div className="tprog">
          <div className="pl">
            <span>{ready ? 'Complete' : 'Time left'}</span>
            <span className={`clock ${ready ? 'ready' : ''}`}>{ready ? 'READY' : formatClock(rem)}</span>
          </div>
          <div className="pbar"><i style={{ width: `${pct}%` }}></i></div>
        </div>
        <div className={`mood-note ${md < 0 ? 'neg' : ''}`}>Mood {md > 0 ? '+' + md : md === 0 ? '±0' : md} on collect</div>
        <div className={`sfoot ${ready ? '' : 'single'}`}>
          {ready ? (
            <>
              <button className="btn primary" disabled={pending} onClick={() => onCollect(station.buildingId)}>Collect gains</button>
              <button className="btn danger" disabled={pending} onClick={() => onCancel(station.buildingId)}>Cancel</button>
            </>
          ) : (
            <button className="btn danger block" disabled={pending} onClick={() => onCancel(station.buildingId)}>Cancel session</button>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="sempty">
        <span className="ei"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 5v14M5 12h14"/></svg></span>
        <div className="et">Idle — bench a Digimon<br/>and train {supported === 2 ? 'two stats' : 'one stat'}.</div>
        <button className="btn primary block" disabled={pending} onClick={() => onAssign(station.buildingId)}>Assign trainee</button>
      </div>
    );
  }

  return (
    <article className="station" data-type={station.buildingType} data-station={station.buildingId} aria-label={`${station.kind}, ${label}`} style={typeStyle}>
      <div className="shead">
        <span className="sic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{STATION_ICON}</svg></span>
        <div><div className="snm">{station.kind}</div><div className="ssub">{label}</div></div>
        <span className="slots-tag">{supported} slot{supported > 1 ? 's' : ''}</span>
      </div>
      <div className="sbody">{body}</div>
    </article>
  );
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}
