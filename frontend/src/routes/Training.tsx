import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { TrainingAssignModal, type TrainingDraft } from '../components/training/TrainingAssignModal';
import { TrainingStationCard } from '../components/training/TrainingStationCard';
import { useAuth } from '../hooks/useAuth';
import { getRoster, type RosterView } from '../lib/api';
import { assignTrainingStation, cancelTrainingStation, collectTrainingStation, getTraining, type TrainingView } from '../lib/api-training';
import '../styles/extensions-training.css';

const TRAINING_QUERY_KEY = ['training'] as const;
const ROSTER_QUERY_KEY = ['roster'] as const;

export function Training(): JSX.Element {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [pendingBuildingId, setPendingBuildingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const trainingQuery = useQuery({ queryKey: TRAINING_QUERY_KEY, queryFn: getTraining, refetchInterval: 30_000 });
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster, refetchInterval: 30_000 });
  
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const view = trainingQuery.data ?? null;
  const rosterById = useMemo(() => new Map((rosterQuery.data?.roster ?? []).map((mon) => [mon.id, mon])), [rosterQuery.data]);
  const selectedStation = view?.stations.find((station) => station.buildingId === selectedBuildingId) ?? null;
  const activeCount = view?.stations.filter((station) => station.active !== null).length ?? 0;
  const readyCount = view?.stations.filter((station) => station.active !== null && now >= station.active.startedAt + station.active.durationMs).length ?? 0;

  const assignMutation = useMutation({
    mutationFn: (draft: TrainingDraft) => assignTrainingStation(draft.buildingId, { monId: draft.monId, statKinds: draft.statKinds, durationMs: draft.durationMin * 60_000 }),
    onMutate: (draft) => setPendingBuildingId(draft.buildingId),
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(TRAINING_QUERY_KEY, result.view);
      setSelectedBuildingId(null);
      showToast('Training started');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'assign failed'),
    onSettled: () => setPendingBuildingId(null),
  });
  const collectMutation = useMutation({
    mutationFn: collectTrainingStation,
    onMutate: (buildingId) => setPendingBuildingId(buildingId),
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(TRAINING_QUERY_KEY, result.view);
      void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      const gainsText = formatGains(result.gained);
      showToast(`Collected — ${gainsText}${result.moodDelta ? ` · mood ${result.moodDelta > 0 ? '+' + result.moodDelta : result.moodDelta}` : ''}`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'collect failed'),
    onSettled: () => setPendingBuildingId(null),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelTrainingStation,
    onMutate: (buildingId) => setPendingBuildingId(buildingId),
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(TRAINING_QUERY_KEY, result.view);
      void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      showToast('Training cancelled');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'cancel failed'),
    onSettled: () => setPendingBuildingId(null),
  });

  function showToast(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 2200);
  }

  const stationsCount = view?.stations.length ?? 0;

  return (
    <>
      <div className="tbar" data-od-id="training-bar" id="tbar">
        <div className="tstat"><span className="k">Stations</span><span className="v">{activeCount}<small>/{stationsCount} busy</small></span></div>
        <div className="tstat"><span className="k">Ready to collect</span><span className="v" style={readyCount > 0 ? { color: 'var(--good)' } : {}}>{readyCount}</span></div>
        <div className="strip-title">
          <div className="k">Training</div>
          <div className="s">{activeCount ? `${activeCount} session${activeCount === 1 ? '' : 's'} running` : 'all stations idle'}</div>
        </div>
      </div>

      <div className="stage">
        <div className="col">
          <h3 className="stitle">Training Stations <span className="cnt">{stationsCount} built</span></h3>
          <div className="stations" data-od-id="stations-grid">
            {view && view.stations.length > 0 ? view.stations.map((station) => (
              <TrainingStationCard 
                key={station.buildingId} 
                station={station} 
                rosterMon={rosterForStation(station.active?.monId ?? null, rosterById)} 
                now={now} 
                pendingBuildingId={pendingBuildingId} 
                onAssign={setSelectedBuildingId} 
                onCancel={(buildingId) => { if (window.confirm('Cancel training? No stats gained, no mood penalty.')) cancelMutation.mutate(buildingId); }} 
                onCollect={(buildingId) => collectMutation.mutate(buildingId)} 
              />
            )) : <div style={{ color: 'var(--muted)', fontSize: '11px' }}>No training stations. Buy one from the Shop.</div>}
          </div>
        </div>
      </div>

      <TrainingAssignModal 
        station={selectedStation} 
        view={view} 
        pending={assignMutation.isPending} 
        onClose={() => setSelectedBuildingId(null)} 
        onConfirm={(draft) => assignMutation.mutate(draft)} 
      />
      
      <div className={`toast ${notice ? 'show' : ''}`} id="toast" role="status" aria-live="polite">{notice}</div>
    </>
  );
}

function rosterForStation(monId: string | null, roster: ReadonlyMap<string, RosterView>): RosterView | null {
  if (monId === null) return null;
  return roster.get(monId) ?? null;
}

function formatGains(gained: Readonly<Record<string, number | undefined>>): string {
  const parts = Object.entries(gained)
    .flatMap(([stat, value]) => (typeof value === 'number' ? [`+${value} ${stat.toUpperCase()}`] : []));
  return parts.length > 0 ? parts.join(', ') : 'no stats';
}
