import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useMemo, useState } from 'react';

import { PageStrip } from '../components/common/PageStrip';
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

  const assignMutation = useMutation({
    mutationFn: (draft: TrainingDraft) => assignTrainingStation(draft.buildingId, { monId: draft.monId, statKinds: draft.statKinds, durationMs: draft.durationMin * 60_000 }),
    onMutate: (draft) => setPendingBuildingId(draft.buildingId),
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(TRAINING_QUERY_KEY, result.view);
      setSelectedBuildingId(null);
      setNotice('Training started');
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'assign failed'),
    onSettled: () => setPendingBuildingId(null),
  });
  const collectMutation = useMutation({
    mutationFn: collectTrainingStation,
    onMutate: (buildingId) => setPendingBuildingId(buildingId),
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(TRAINING_QUERY_KEY, result.view);
      void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      setNotice(`Gained ${formatGains(result.gained)}. Mood: ${result.moodDelta >= 0 ? '+' : ''}${result.moodDelta} (now ${result.newMood}/100).`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'collect failed'),
    onSettled: () => setPendingBuildingId(null),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelTrainingStation,
    onMutate: (buildingId) => setPendingBuildingId(buildingId),
    onSuccess: (result) => {
      queryClient.setQueryData<TrainingView>(TRAINING_QUERY_KEY, result.view);
      void queryClient.invalidateQueries({ queryKey: ROSTER_QUERY_KEY });
      setNotice('Training cancelled');
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'cancel failed'),
    onSettled: () => setPendingBuildingId(null),
  });

  return (
    <div className="app-shell">
      <main className="app-main">
        <PageStrip
          name="Training"
          tone={activeCount > 0 ? 'reward' : 'action'}
          metrics={[
            { label: <><b>{view?.stations.length ?? 0}</b> stations</> },
            { label: <><b>{activeCount}</b> active</>, className: activeCount > 0 ? 'reward' : 'muted' },
          ]}
        />
        <div className="sec-head training-sec-head"><h2>Training Stations</h2></div>
        {trainingQuery.error instanceof Error ? <div className="training-alert" role="alert">{trainingQuery.error.message}</div> : null}
        <div className="training-alert" role="status" aria-live="polite">{notice}</div>
        <section className="city training-grid" aria-label="Training Stations">
          {view && view.stations.length > 0 ? view.stations.map((station) => <TrainingStationCard key={station.buildingId} station={station} rosterMon={rosterForStation(station.active?.monId ?? null, rosterById)} now={now} pendingBuildingId={pendingBuildingId} onAssign={setSelectedBuildingId} onCancel={(buildingId) => { if (window.confirm('Cancel training? No stats gained, no mood penalty.')) cancelMutation.mutate(buildingId); }} onCollect={(buildingId) => collectMutation.mutate(buildingId)} />) : <EmptyTrainingHelp />}
        </section>
      </main>
      <TrainingAssignModal station={selectedStation} view={view} pending={assignMutation.isPending} onClose={() => setSelectedBuildingId(null)} onConfirm={(draft) => assignMutation.mutate(draft)} />
    </div>
  );
}

function rosterForStation(monId: string | null, roster: ReadonlyMap<string, RosterView>): RosterView | null {
  if (monId === null) return null;
  return roster.get(monId) ?? null;
}

function EmptyTrainingHelp(): JSX.Element {
  return <div className="empty-help"><h3>No Training Stations</h3><p>Buy a Training Station from the Shop (500 credits) or a Premium Training Station (2000 credits).</p></div>;
}

function formatGains(gained: Readonly<Record<string, number | undefined>>): string {
  const parts = Object.entries(gained)
    .flatMap(([stat, value]) => (typeof value === 'number' ? [`+${value} ${stat.toUpperCase()}`] : []));
  return parts.length > 0 ? parts.join(', ') : 'no stats';
}
