import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties, type ReactNode } from 'react';

import { BalBar, ResourceBal } from '../components/common/BalBar';
import { ResourceIcon } from '../components/common/ResourceIcon';
import { DownArrowIcon, UpArrowIcon } from '../components/common/icons';
import { useAuth } from '../hooks/useAuth';
import {
  collectFarmAll,
  collectFarmBuilding,
  getFarm,
  upgradeFarmBuilding,
  type FarmCollectResult,
  type FarmView,
  type FarmBuildingView,
} from '../lib/api-farm';
import '../styles/extensions-farm.css';

const FARM_QUERY_KEY = ['farm'] as const;
const RECIPES_QUERY_KEY = ['farm', 'recipes'] as const;

function fmt(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}

const RES_VAR: Record<string, string> = {
  Meat: 'var(--meat)',
  Bits: 'var(--bits)',
  Data: 'var(--data)',
};

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  buildings: [],
};

function applyCollectResult(
  queryClient: ReturnType<typeof useQueryClient>,
  result: FarmCollectResult,
  setNotice: (notice: string) => void,
): void {
  queryClient.setQueryData<FarmView>(FARM_QUERY_KEY, result.view);
  queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
  setNotice(
    result.gained.length > 0
      ? `Collected ${result.gained.map((g) => `${fmt(g.amount)} ${g.resource}`).join(' · ')}.`
      : 'Nothing to collect yet.',
  );
}

export function Farm(): JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>('');
  const [pendingBuildingId, setPendingBuildingId] = useState<string | null>(null);

  const farmQuery = useQuery({
    queryKey: FARM_QUERY_KEY,
    queryFn: getFarm,
    refetchInterval: 3_000,
    enabled: !!user,
  });

  const farm = farmQuery.data ?? emptyFarm;

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
      setNotice('Upgraded successfully.');
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Upgrade failed'),
    onSettled: () => setPendingBuildingId(null),
  });

  let readyCount = 0;
  let totalCollectable = 0;
  let rateMeat = 0;
  let rateBits = 0;
  let rateData = 0;

  for (const b of farm.buildings) {
    const collectable = Math.floor(b.produced);
    if (collectable > 0) readyCount++;
    totalCollectable += collectable;

    if (b.resource === 'Meat') rateMeat += b.ratePerHour;
    if (b.resource === 'Bits') rateBits += b.ratePerHour;
    if (b.resource === 'Data') rateData += b.ratePerHour;
  }

  const isAllPending = collectAllMutation.isPending;
  const subtitle = `+${fmt(rateMeat + rateBits + rateData)}/hr${readyCount > 0 ? ` · ${readyCount} ready` : ''}`;

  return (
    <>
      <BalBar title="Farm Yield" subtitle={subtitle} odId="resource-balance">
        <ResourceBal resource="meat" label="Meat" value={farm.balances.Meat} format={fmt} />
        <ResourceBal resource="bits" label="Bits" value={farm.balances.Bits} format={fmt} />
        <ResourceBal resource="data" label="Data" value={farm.balances.Data} format={fmt} />
        <ResourceBal resource="credits" label="Credits" value={farm.credits} format={fmt} />
      </BalBar>

      <div className="mhead">
        <h1>Production Buildings</h1>
        <span className="sub">
          <b>{readyCount}</b> ready to collect · upgrade with <b>Bits</b>
        </span>
        <button
          type="button"
          className="collect-all"
          aria-label="Collect from all buildings"
          disabled={readyCount <= 0 || isAllPending}
          onClick={() => collectAllMutation.mutate()}
        >
          <span className="cai" aria-hidden="true">
            <DownArrowIcon />
          </span>
          <span>Collect all{totalCollectable > 0 ? ` · ${fmt(totalCollectable)}` : ''}</span>
        </button>
      </div>

      {farmQuery.error instanceof Error && (
        <div className="farm-notice" style={{ color: 'var(--battle)' }} role="alert">
          {farmQuery.error.message}
        </div>
      )}
      {notice && (
        <div className="farm-notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

      <div className="grid" data-od-id="building-grid">
        {farm.buildings.map((b) => (
          <BuildingCard
            key={b.id}
            b={b}
            bits={farm.balances.Bits}
            isPending={pendingBuildingId === b.id}
            onCollect={() => collectOneMutation.mutate(b.id)}
            onUpgrade={() => upgradeMutation.mutate(b.id)}
          />
        ))}
      </div>
    </>
  );
}

function BuildingCard({
  b,
  bits,
  isPending,
  onCollect,
  onUpgrade,
}: {
  readonly b: FarmBuildingView;
  readonly bits: number;
  readonly isPending: boolean;
  readonly onCollect: () => void;
  readonly onUpgrade: () => void;
}): JSX.Element {
  const prod = b.produced;
  const pct = b.capacity > 0 ? (prod / b.capacity) * 100 : 0;
  const full = prod >= b.capacity - 0.5; // Handle float math imprecision
  const collectable = Math.floor(prod);
  const canAfford = bits >= b.upgradeCost;
  const resourceKind = b.resource.toLowerCase() as 'meat' | 'bits' | 'data';

  let hintNode: ReactNode = null;
  let hintClass = 'thint';

  if (full) {
    hintClass = 'thint warn';
    hintNode = (
      <>
        <span className="hdot" />
        Storage full — collect to resume production
      </>
    );
  } else if (!canAfford) {
    hintClass = 'thint warn';
    hintNode = (
      <>
        <span className="hdot" />
        Need {fmt(b.upgradeCost - bits)} more Bits to upgrade
      </>
    );
  }

  return (
    <article
      className="tile"
      data-id={b.id}
      style={{ '--r': RES_VAR[b.resource] } as CSSProperties}
      data-od-id={`building-${b.id}`}
      aria-label={`${b.kind}, level ${b.level}, produces ${b.ratePerHour} ${b.resource} per hour`}
    >
      <div className="thead">
        <span className="ticon">
          <ResourceIcon kind={resourceKind} />
        </span>
        <span className="tnm">
          <span className="tn">{b.kind}</span>
          <span className="tr">
            {b.resource} &middot; <b>+{b.ratePerHour}</b>/hr
          </span>
        </span>
        <span className="tlvl">Lv {b.level}</span>
      </div>
      <div className={`tmeter ${full ? 'is-full' : ''}`}>
        <div className="ml">
          <span>Stored</span>
          <span className="mv">
            <span>{fmt(prod)}</span> <span className="mcap">/ {fmt(b.capacity)}</span>
          </span>
        </div>
        <div className="mbar">
          <i style={{ width: `${Math.min(100, Math.max(0, pct)).toFixed(1)}%` }} />
        </div>
        <div className="mfull">Storage full — collect to resume</div>
      </div>
      <div className={hintClass} aria-live="polite">
        {hintNode}
      </div>
      <div className="tfoot">
        <button
          type="button"
          className="tbtn collect"
          disabled={collectable <= 0 || isPending}
          onClick={onCollect}
        >
          Collect {collectable > 0 && <span className="bn">{fmt(collectable)}</span>}
        </button>
        <button
          type="button"
          className="tbtn"
          disabled={!canAfford || isPending}
          onClick={onUpgrade}
        >
          <span className="bicon" aria-hidden="true">
            <UpArrowIcon />
          </span>
          Upgrade &middot; <span className="bn">{fmt(b.upgradeCost)}</span>
        </button>
      </div>
    </article>
  );
}
