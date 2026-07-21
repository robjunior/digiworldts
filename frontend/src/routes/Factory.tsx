import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { AppNav, NavStat } from '../components/AppNav';
import { PageStrip } from '../components/common/PageStrip';
import { useAuth } from '../hooks/useAuth';
import {
  cancelFarmCraft,
  collectFarmCraft,
  getFarm,
  getFarmRecipes,
  startFarmCraft,
  type FarmView,
} from '../lib/api-farm';
import '../styles/extensions-farm.css';

const FARM_QUERY_KEY = ['farm'] as const;
const RECIPES_QUERY_KEY = ['farm', 'recipes'] as const;

export function Factory(): JSX.Element {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [notice, setNotice] = useState<string>('');
  const [pendingRecipeId, setPendingRecipeId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm });
  const recipesQuery = useQuery({ queryKey: RECIPES_QUERY_KEY, queryFn: getFarmRecipes, refetchInterval: 30_000 });

  const farm = farmQuery.data ?? emptyFarm;
  const recipes = recipesQuery.data?.recipes ?? [];
  const activeJob = recipesQuery.data?.activeJob ?? null;
  const factoryBusy = activeJob !== null;
  const remainingMs = activeJob === null ? 0 : Math.max(0, activeJob.finishesAt - now);
  const progressPct = activeJob === null ? 0 : Math.min(100, Math.max(0, ((now - activeJob.startedAt) / activeJob.durationMs) * 100));
  const readyToCollect = activeJob !== null && remainingMs === 0;
  const craftableCount = recipes.filter((recipe) => recipe.canCraft && !factoryBusy).length;
  const isPremium = user?.premiumUntil != null && user.premiumUntil > now;
  const isAutoJob = activeJob?.isAuto === true;

  useEffect(() => {
    if (activeJob === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [activeJob]);

  useEffect(() => {
    if (activeJob !== null && readyToCollect) {
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
    }
  }, [activeJob, readyToCollect, queryClient]);

  const startMutation = useMutation({
    mutationFn: (params: { readonly recipeId: string; readonly auto?: boolean }) =>
      startFarmCraft(params.recipeId, params.auto === true ? { auto: true } : undefined),
    onMutate: (params) => setPendingRecipeId(params.recipeId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setNotice(
        result.job.isAuto
          ? `Auto-producing ${result.job.itemName} (${formatDuration(result.job.durationMs)} per unit until resources deplete)`
          : `Crafting started: ${result.job.itemName} (${formatDuration(result.job.durationMs)})`,
      );
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'craft failed'),
    onSettled: () => setPendingRecipeId(null),
  });

  const collectMutation = useMutation({
    mutationFn: collectFarmCraft,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setNotice(`Collected: ${result.itemName}`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'collect failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelFarmCraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setNotice('Craft cancelled — resources refunded');
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'cancel failed'),
  });

  return (
    <div className="app-shell">
      <AppNav>
        <NavStat tone="meat" label="Meat" value={farm.balances.Meat.toLocaleString()} />
        <NavStat tone="bits" label="Bits" value={farm.balances.Bits.toLocaleString()} />
        <NavStat tone="data" label="Data" value={farm.balances.Data.toLocaleString()} />
      </AppNav>
      <main className="app-main">
        <PageStrip
          name="Factory"
          tone={readyToCollect ? 'reward' : factoryBusy ? 'action' : craftableCount > 0 ? 'reward' : 'action'}
          metrics={[
            { label: <span className="ps-res ps-res--meat"><span className="ps-dot" /><span className="ps-lbl">Meat</span> <b>{fmt(farm.balances.Meat)}</b></span> },
            { label: <span className="ps-res ps-res--bits"><span className="ps-dot" /><span className="ps-lbl">Bits</span> <b>{fmt(farm.balances.Bits)}</b></span> },
            { label: <span className="ps-res ps-res--data"><span className="ps-dot" /><span className="ps-lbl">Data</span> <b>{fmt(farm.balances.Data)}</b></span> },
            { label: <><b>{recipes.length}</b> recipes</> },
            factoryBusy
              ? { label: readyToCollect ? <>craft <b>ready</b></> : <>crafting <b>{formatCountdown(remainingMs)}</b></>, className: readyToCollect ? 'reward' : 'muted' }
              : { label: craftableCount > 0 ? <><b>{craftableCount}</b> ready</> : 'nothing ready', className: craftableCount > 0 ? 'reward' : 'muted' },
          ]}
          actions={<span className="muted">Spend farm resources to craft consumables. One at a time.</span>}
        />
        {farmQuery.error instanceof Error ? <div className="farm-alert" role="alert">{farmQuery.error.message}</div> : null}
        <div className="farm-alert" role="status" aria-live="polite">{notice}</div>

        {activeJob ? (
          <section className={`factory-active-job${isAutoJob ? ' is-auto' : ''}`} aria-label="Active crafting job">
            <div className="factory-active-job-head">
              <div>
                <span className="factory-active-job-lbl">{isAutoJob ? 'Auto-producing' : 'Crafting'}</span>
                <b className="factory-active-job-name">{activeJob.itemName}</b>
              </div>
              <div className={`factory-active-job-timer${readyToCollect ? ' is-ready' : ''}`}>
                {readyToCollect ? (isAutoJob ? 'Cycling…' : 'Ready') : formatCountdown(remainingMs)}
              </div>
            </div>
            <div
              className={`factory-active-job-progress${readyToCollect ? ' is-ready' : ''}`}
              role="progressbar"
              aria-valuenow={Math.round(progressPct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="factory-active-job-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="factory-active-job-actions">
              <button
                className="btn btn--secondary btn--sm"
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                {cancelMutation.isPending ? 'Cancelling…' : isAutoJob ? 'Stop auto-produce' : 'Cancel + refund'}
              </button>
              {!isAutoJob ? (
                <button
                  className="btn btn--sm"
                  type="button"
                  disabled={!readyToCollect || collectMutation.isPending}
                  onClick={() => collectMutation.mutate()}
                >
                  {collectMutation.isPending ? 'Collecting…' : readyToCollect ? 'Collect' : `Waiting ${formatCountdown(remainingMs)}`}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="farm-recipes" aria-label="Craftable items">
          {recipesQuery.isPending ? (
            <p className="muted">Loading recipes…</p>
          ) : recipes.length === 0 ? (
            <p className="muted">No recipes available.</p>
          ) : (
            <div className="recipes-grid">
              {recipes.map((recipe) => {
                const rowPending = pendingRecipeId === recipe.id && startMutation.isPending;
                const disabled = !recipe.canCraft || factoryBusy || rowPending;
                const buttonLabel = factoryBusy
                  ? 'Factory busy'
                  : rowPending
                  ? 'Starting…'
                  : `Craft — ${formatDuration(recipe.craftTimeMs)}`;
                return (
                  <article key={recipe.id} className={`recipe-card${recipe.canCraft && !factoryBusy ? '' : ' recipe-card--locked'}`}>
                    <header className="recipe-card-head">
                      <b className="recipe-card-name">{recipe.itemName}</b>
                      <span className="recipe-card-time" title={`Craft time: ${formatDuration(recipe.craftTimeMs)}`}>{formatDuration(recipe.craftTimeMs)}</span>
                    </header>
                    <p className="recipe-card-desc muted">{recipe.itemDescription}</p>
                    <div className="recipe-costs">
                      {recipe.meatCost > 0 ? <span className="ps-res ps-res--meat" title="Meat"><span className="ps-dot" />{recipe.meatCost}</span> : null}
                      {recipe.bitsCost > 0 ? <span className="ps-res ps-res--bits" title="Bits"><span className="ps-dot" />{recipe.bitsCost}</span> : null}
                      {recipe.dataCost > 0 ? <span className="ps-res ps-res--data" title="Data"><span className="ps-dot" />{recipe.dataCost}</span> : null}
                    </div>
                    <div className="recipe-card-actions">
                      <button
                        className="btn btn--sm"
                        type="button"
                        disabled={disabled}
                        onClick={() => startMutation.mutate({ recipeId: recipe.id })}
                        title={factoryBusy ? 'The factory is already crafting an item. Collect or cancel first.' : undefined}
                      >
                        {buttonLabel}
                      </button>
                      {isPremium ? (
                        <button
                          className="btn btn--sm btn--premium"
                          type="button"
                          disabled={disabled}
                          onClick={() => startMutation.mutate({ recipeId: recipe.id, auto: true })}
                          title={factoryBusy ? 'The factory is already crafting an item. Collect or cancel first.' : 'Premium: auto-produce this item nonstop until resources deplete'}
                        >
                          {rowPending ? 'Starting…' : 'Produce ∞'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
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

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
