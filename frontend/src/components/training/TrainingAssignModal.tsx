import type { TrainingStat } from '@digiworld/shared/digimon';
import { useMemo, useState, useEffect } from 'react';

import type { TrainingRosterEntry, TrainingStationView, TrainingView } from '../../lib/api-training';
import { computeGainsPreview, formatDuration, formatStat, moodDeltaForMinutes, previewGainsText } from './training-utils';

export type TrainingDraft = {
  readonly buildingId: string;
  readonly monId: string;
  readonly statKinds: readonly TrainingStat[];
  readonly durationMin: number;
};

type TrainingAssignModalProps = {
  readonly station: TrainingStationView | null;
  readonly view: TrainingView | null;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (draft: TrainingDraft) => void;
};

const TRAIN_STATS = ['hp','en','atk','def','int','spd'] as const;
const STAT_LABEL: Record<string, string> = {hp:'HP',en:'EN',atk:'ATK',def:'DEF',int:'INT',spd:'SPD'};

export function TrainingAssignModal(props: TrainingAssignModalProps): JSX.Element {
  const { station, view, pending, onClose, onConfirm } = props;
  const eligible = view?.eligibleMons ?? [];
  const maxStats = station?.supportedStatCount ?? 1;
  const supported = maxStats;

  const [monId, setMonId] = useState<string | null>(null);
  const [statKinds, setStatKinds] = useState<readonly TrainingStat[]>([]);
  const [durationMin, setDurationMin] = useState<number | null>(null);

  // Set defaults when opening
  useEffect(() => {
    if (station && durationMin === null) {
      setDurationMin(30);
    }
  }, [station, durationMin]);
  useEffect(() => {
    if (station && !monId && eligible.length > 0) {
      setMonId(eligible[0]?.monId ?? null);
    }
  }, [station, monId, eligible]);

  const selectedMon = eligible.find((mon) => mon.monId === monId) ?? null;
  const ready = station !== null && selectedMon !== null && durationMin !== null && statKinds.length === maxStats;

  if (!station) return <div className="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"></div>;

  const dm = durationMin ?? 30;
  const md = moodDeltaForMinutes(dm);
  
  let hint = '';
  let hintClass = 'dhint';
  if (!eligible.length) {
    hint = 'No eligible Digimon to train.';
    hintClass = 'dhint warn';
  } else if (statKinds.length !== supported) {
    hint = `Select exactly ${supported} stat${supported > 1 ? 's' : ''} to train.`;
  } else {
    hint = `${formatDuration(dm)} session · mood ${md > 0 ? '+' + md : md === 0 ? '±0' : md}.`;
    if (md < 0) hintClass = 'dhint warn';
  }

  const moodStateLabel = (v: number) => v >= 70 ? 'Content' : v >= 35 ? 'Neutral' : 'Restless';
  
  const gains = statKinds.length ? computeGainsPreview(dm, statKinds) : {};

  return (
    <div className={`drawer ${station ? 'open' : ''}`} id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div className="scrim" id="scrim" onClick={onClose}></div>
      <div className="dpanel" id="dpanel" style={{ '--sc': station.buildingType === 'training_premium' ? 'var(--good)' : 'var(--signal)' } as React.CSSProperties}>
        <div className="dhead">
          <div>
            <div className="dk" id="drawer-kick">{station.kind} · {supported === 2 ? '2 stats' : '1 stat'}</div>
            <h2 id="drawer-title">Train a Digimon</h2>
          </div>
          <button className="dclose" id="drawer-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div className="dbody" id="drawer-body">
          {!eligible.length ? (
            <div className="rempty">No eligible Digimon. Party members can't train — <a href="/roster" style={{ color: 'var(--signal)', textDecoration: 'underline' }}>bench one from the Roster page</a> first.</div>
          ) : (
            <>
              <div className="field">
                <div className="flabel"><span>Trainee</span><b>{eligible.length} on the bench</b></div>
                <div className="monpick">
                  {eligible.map(m => (
                    <button key={m.monId} className={`mp ${monId === m.monId ? 'on' : ''}`} onClick={() => setMonId(m.monId)}>
                      <span className="mps"><img src={m.portrait} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /></span>
                      <div>
                        <div className="mpn">{m.nickname}</div>
                        <div className="mpsub">{m.stage} · Lv {m.level} · {moodStateLabel(m.mood)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="field">
                <div className="flabel"><span>Stats to train</span><b id="stat-count">{statKinds.length}/{supported}</b></div>
                <div className="stattoggles" id="stattoggles">
                  {TRAIN_STATS.map(k => {
                    const on = statKinds.includes(k);
                    const g = computeGainsPreview(dm, [k])[k];
                    return (
                      <button key={k} className={`sttog ${on ? 'on' : ''}`} data-stat={k} onClick={() => {
                        if (on) {
                          setStatKinds(statKinds.filter(s => s !== k));
                        } else {
                          if (statKinds.length >= supported) {
                            if (supported === 1) setStatKinds([k]);
                            // else ignore (toast is in mockup but we don't have to reproduce the strict ignoring)
                          } else {
                            setStatKinds([...statKinds, k]);
                          }
                        }
                      }}>
                        <span className="sd"></span><span className="sn">{STAT_LABEL[k]}</span><span className="sg">+{g}{on ? '' : ' max'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="field">
                <div className="flabel"><span>Session length</span><b>{formatDuration(dm)}</b></div>
                <div className="durseg">
                  {(view?.durationPresetsMin ?? [5, 30, 120, 480]).map(d => {
                    const lbl = d === 5 ? 'Quick' : d === 30 ? 'Short' : d === 120 ? 'Long' : 'Full';
                    return (
                      <button key={d} className={durationMin === d ? 'on' : ''} onClick={() => setDurationMin(d)}>
                        <span>{d >= 60 ? `${d/60}h` : `${d}m`}</span><span className="dm">{lbl}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="preview" id="preview">
                <div className="pk">On collect</div>
                {statKinds.length > 0 ? (
                  <div className="gains">
                    {statKinds.map(k => (
                      <span key={k} className="schip" data-stat={k}><span className="cd"></span>{STAT_LABEL[k]} <span className="gv">+{gains[k]}</span></span>
                    ))}
                  </div>
                ) : (
                  <div className="prow"><span style={{ color: 'var(--muted)', fontWeight: 700 }}>Pick {supported} stat{supported > 1 ? 's' : ''} to preview gains</span></div>
                )}
                <div className="prow mood">
                  <span style={{ color: 'var(--muted)', fontWeight: 700, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase' }}>Mood</span>
                  <span className={`pv ${md < 0 ? 'neg' : ''}`}>{md > 0 ? '+' + md : md === 0 ? '±0' : md}</span>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="dfoot">
          <span className={hintClass} id="drawer-hint">{hint}</span>
          <button 
            className="btn primary" 
            id="start-btn" 
            disabled={!ready || pending || !eligible.length} 
            onClick={() => {
              if (monId && durationMin && statKinds.length === supported) {
                onConfirm({ buildingId: station.buildingId, monId, statKinds, durationMin });
                setMonId(null);
                setStatKinds([]);
                setDurationMin(null);
              }
            }}
          >
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
