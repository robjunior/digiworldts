import type { TrainingStat } from '@digiworld/shared/digimon';
import { useMemo, useState } from 'react';

import type { TrainingRosterEntry, TrainingStationView, TrainingView } from '../../lib/api-training';
import { computeGainsPreview, formatDuration, formatStat, moodDeltaForMinutes, previewGainsText } from './training-utils';

const PICKER_PER_PAGE = 6;

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

export function TrainingAssignModal(props: TrainingAssignModalProps): JSX.Element {
  const { station, view, pending, onClose, onConfirm } = props;
  const [monId, setMonId] = useState<string | null>(null);
  const [statKinds, setStatKinds] = useState<readonly TrainingStat[]>([]);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const eligible = view?.eligibleMons ?? [];
  const maxStats = station?.supportedStatCount ?? 1;
  const selectedMon = eligible.find((mon) => mon.monId === monId) ?? null;
  const totalPages = Math.max(1, Math.ceil(eligible.length / PICKER_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => eligible.slice((safePage - 1) * PICKER_PER_PAGE, safePage * PICKER_PER_PAGE), [eligible, safePage]);
  const ready = station !== null && selectedMon !== null && durationMin !== null && statKinds.length === maxStats;

  return (
    <div id="training-assign-modal" className={`modal-overlay ${station ? 'show' : ''}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-card">
        <div className="modal-header">
          <h3 id="training-assign-title">Assign to {station?.kind ?? 'Training Station'}</h3>
          <button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div id="assign-body">
          <div className="training-assign-inst">Choose a Digimon (must not be in party) and {maxStats} stat{maxStats > 1 ? 's' : ''}.</div>
          <div id="assign-mon-picker" className="picker-grid">
            {eligible.length === 0 || eligible.every((mon) => mon.inParty)
              ? <div className="picker-empty">No available Digimon.<br />Remove a Digimon from your party first (via Roster).</div>
              : pageItems.map((mon) => <MonPickCard key={mon.monId} mon={mon} selected={mon.monId === monId} onSelect={(nextMonId) => setMonId(nextMonId)} />)}
          </div>
          {eligible.length > PICKER_PER_PAGE ? <Pagination page={safePage} totalPages={totalPages} totalItems={eligible.length} onPage={setPage} /> : null}
          <h4 className="picker-title">Pick Stats</h4>
          <div id="assign-stat-picker" className="btn-group">
            {(view?.trainableStats ?? []).map((stat) => <PickButton key={stat} label={formatStat(stat)} active={statKinds.includes(stat)} onClick={() => setStatKinds(toggleStat(statKinds, stat, maxStats))} />)}
          </div>
          <h4 className="picker-title">Duration</h4>
          <div id="assign-dur-picker" className="btn-group">
            {(view?.durationPresetsMin ?? []).map((duration) => <PickButton key={duration} label={formatDuration(duration)} active={durationMin === duration} onClick={() => setDurationMin(duration)} />)}
          </div>
          <div id="training-assign-preview" className="training-assign-preview">{previewText(selectedMon, durationMin, statKinds, maxStats)}</div>
          <div className="training-modal-actions">
            <button className="btn btn--secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="btn" type="button" disabled={!ready || pending || station === null || durationMin === null || monId === null} onClick={() => station && durationMin && monId && onConfirm({ buildingId: station.buildingId, monId, statKinds, durationMin })}>Confirm</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MonPickCard({ mon, selected, onSelect }: { readonly mon: TrainingRosterEntry; readonly selected: boolean; readonly onSelect: (monId: string) => void }): JSX.Element {
  return (
    <button className={`mon-pick-card ${mon.inParty ? 'is-disabled' : ''} ${selected ? 'is-selected' : ''}`} type="button" disabled={mon.inParty} title={mon.inParty ? 'In party (remove first)' : undefined} onClick={() => onSelect(mon.monId)}>
      <img src={mon.portrait} alt="" onError={(event) => event.currentTarget.classList.add('is-faded')} />
      <span className="info"><span className="name">{mon.nickname}</span><span className="sub">Lv {mon.level} {mon.stage}</span></span>
    </button>
  );
}

function PickButton({ label, active, onClick }: { readonly label: string; readonly active: boolean; readonly onClick: () => void }): JSX.Element {
  return <button className={`btn ${active ? 'btn--primary is-picked' : 'btn--secondary'}`} type="button" onClick={onClick}>{label}</button>;
}

function Pagination({ page, totalPages, totalItems, onPage }: { readonly page: number; readonly totalPages: number; readonly totalItems: number; readonly onPage: (page: number) => void }): JSX.Element {
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);
  return (
    <div className="pagination">
      <div className="page-info">Showing {(page - 1) * PICKER_PER_PAGE + 1}-{Math.min(page * PICKER_PER_PAGE, totalItems)} of {totalItems}</div>
      <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)}>← Prev</button>
      {pages.map((item) => <button key={item} type="button" className={item === page ? 'active' : ''} onClick={() => onPage(item)}>{item}</button>)}
      <button type="button" disabled={page === totalPages} onClick={() => onPage(page + 1)}>Next →</button>
    </div>
  );
}

function toggleStat(stats: readonly TrainingStat[], stat: TrainingStat, maxStats: number): readonly TrainingStat[] {
  if (maxStats === 1) {
    if (stats[0] === stat) return [];
    return [stat];
  }
  if (stats.includes(stat)) return stats.filter((item) => item !== stat);
  if (stats.length >= maxStats) return stats;
  return [...stats, stat];
}

function previewText(mon: TrainingRosterEntry | null, durationMin: number | null, statKinds: readonly TrainingStat[], maxStats: number): string {
  if (mon === null || durationMin === null || statKinds.length !== maxStats) return 'Select a Digimon, stats, and duration to see preview.';
  const moodDelta = moodDeltaForMinutes(durationMin);
  const gains = computeGainsPreview(durationMin, statKinds);
  return `This will grant ${previewGainsText(gains, statKinds)}. Mood ${moodDelta > 0 ? '+' : ''}${moodDelta}.`;
}
