import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppNav, NavStat } from '../components/AppNav';
import { useState } from 'react';

import { DigiCredits } from '../components/common/DigiCredits';
import { PageStrip } from '../components/common/PageStrip';
import { FarmBuildingCard } from '../components/farm/FarmBuildingCard';
import { FarmSectionHead } from '../components/farm/FarmSectionHead';
import { useAuth } from '../hooks/useAuth';
import {
  collectFarmAll,
  collectFarmBuilding,
  getFarm,
  type FarmCollectResult,
  type FarmView,
  upgradeFarmBuilding,
} from '../lib/api-farm';
import '../styles/extensions-farm.css';

const FARM_QUERY_KEY = ['farm'] as const;
const RECIPES_QUERY_KEY = ['farm', 'recipes'] as const;

export function Farm(): JSX.Element {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>('');
  const [pendingBuildingId, setPendingBuildingId] = useState<string | null>(null);
  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm, refetchInterval: 3_000 });
  const farm = farmQuery.data ?? emptyFarm;
  const readyCount = farm.buildings.filter((building) => building.produced >= 1).length;

  const collectAllMutation = useMutation({
    mutationFn: collectFarmAll,
    onSuccess: (result) => applyCollectResult(queryClient, result, setNotice),
  });
  const collectOneMutation = useMutation({
    mutationFn: collectFarmBuilding,
    onMutate: (buildingId) => setPendingBuildingId(buildingId),
    onSuccess: (result) => applyCollectResult(queryClient, result, setNotice),
    onSettled: () => setPendingBuildingId(null),
  });
  const upgradeMutation = useMutation({
    mutationFn: upgradeFarmBuilding,
    onMutate: (buildingId) => setPendingBuildingId(buildingId),
    onSuccess: (result) => {
      queryClient.setQueryData<FarmView>(FARM_QUERY_KEY, result.view);
      setNotice('Upgraded');
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'upgrade failed'),
    onSettled: () => setPendingBuildingId(null),
  });

  return (
    <div className="app-shell">
      <AppNav>
        <NavStat tone="meat" label="Meat" value={farm.balances.Meat.toLocaleString()} />
        <NavStat tone="bits" label="Bits" value={farm.balances.Bits.toLocaleString()} />
        <NavStat tone="data" label="Data" value={farm.balances.Data.toLocaleString()} />
        <NavStat tone="credits" label="Credits" value={farm.credits.toLocaleString()} />
      </AppNav>
      <main className="app-main">
        <PageStrip
          name="Farm"
          tone={readyCount > 0 ? 'reward' : 'action'}
          metrics={[
            { label: <span className="ps-res ps-res--meat"><span className="ps-dot" /><span className="ps-lbl">Meat</span> <b>{fmt(farm.balances.Meat)}</b></span> },
            { label: <span className="ps-res ps-res--bits"><span className="ps-dot" /><span className="ps-lbl">Bits</span> <b>{fmt(farm.balances.Bits)}</b></span> },
            { label: <span className="ps-res ps-res--data"><span className="ps-dot" /><span className="ps-lbl">Data</span> <b>{fmt(farm.balances.Data)}</b></span> },
            { label: <><b>{farm.buildings.length}</b> buildings</> },
            { label: readyCount > 0 ? <><b>{readyCount}</b> ready</> : 'nothing ready', className: readyCount > 0 ? 'reward' : 'muted' },
          ]}
          actions={<DigiCredits value={farm.credits} />}
        />
        <FarmSectionHead farm={farm} pending={collectAllMutation.isPending} onCollectAll={() => collectAllMutation.mutate()} />
        {farmQuery.error instanceof Error ? <div className="farm-alert" role="alert">{farmQuery.error.message}</div> : null}
        <div className="farm-alert" role="status" aria-live="polite">{notice}</div>
        <section className="city" aria-label="Production buildings">
          {farm.buildings.map((building) => (
            <FarmBuildingCard key={building.id} building={building} bits={farm.balances.Bits} pendingBuildingId={pendingBuildingId} onCollect={(buildingId) => collectOneMutation.mutate(buildingId)} onUpgrade={(buildingId) => upgradeMutation.mutate(buildingId)} />
          ))}
        </section>
      </main>
    </div>
  );
}

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  buildings: [],
};

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function applyCollectResult(queryClient: ReturnType<typeof useQueryClient>, result: FarmCollectResult, setNotice: (notice: string) => void): void {
  queryClient.setQueryData<FarmView>(FARM_QUERY_KEY, result.view);
  queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
  setNotice(result.gained.length > 0 ? result.gained.map((gain) => `+${gain.amount} ${gain.resource}`).join(', ') : 'Nothing to collect yet');
}
