import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties, type ReactNode } from 'react';

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

const RES_ICON: Record<string, ReactNode> = {
  Meat: (
    <>
      <path d="M14 3c3 0 5 2 5 5 0 2-1 3-2 4l-6 6c-1 1-2 2-4 2a3 3 0 0 1-3-3c0-2 1-3 2-4l6-6c1-1 2-2 4-2z" />
      <path d="M6 15l-2 2M9 18l-2 2" />
    </>
  ),
  Bits: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  Data: (
    <>
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>
  ),
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

  return (
    <>
      <div className="balbar" data-od-id="resource-balance">
        <div className="bal" data-res="meat">
          <span className="ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{RES_ICON.Meat}</svg>
          </span>
          <span className="col"><span className="k">Meat</span><span className="v">{fmt(farm.balances.Meat)}</span></span>
        </div>
        <div className="bal" data-res="bits">
          <span className="ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{RES_ICON.Bits}</svg>
          </span>
          <span className="col"><span className="k">Bits</span><span className="v">{fmt(farm.balances.Bits)}</span></span>
        </div>
        <div className="bal" data-res="data">
          <span className="ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{RES_ICON.Data}</svg>
          </span>
          <span className="col"><span className="k">Data</span><span className="v">{fmt(farm.balances.Data)}</span></span>
        </div>
        <div className="bal" data-res="credits">
          <span className="ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.5h3.5a1.5 1.5 0 0 1 0 3H9.5"/></svg>
          </span>
          <span className="col"><span className="k">Credits</span><span className="v">{fmt(farm.credits)}</span></span>
        </div>
        <div className="strip-title">
          <div className="k">Farm Yield</div>
          <div className="s">+{fmt(rateMeat + rateBits + rateData)}/hr {readyCount > 0 ? `· ${readyCount} ready` : ''}</div>
        </div>
      </div>

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
          <svg className="cai" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M12 3v14M6 11l6 6 6-6" strokeLinecap="square" strokeLinejoin="miter" />
          </svg>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            {RES_ICON[b.resource]}
          </svg>
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
          <svg className="bicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
          Upgrade &middot; <span className="bn">{fmt(b.upgradeCost)}</span>
        </button>
      </div>
    </article>
  );
}
