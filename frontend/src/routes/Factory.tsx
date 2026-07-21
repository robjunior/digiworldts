import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { AppNav, NavStat } from '../components/AppNav';
import { PageStrip } from '../components/common/PageStrip';
import { useAuth } from '../hooks/useAuth';
import {
  buyFactory,
  cancelFarmCraftJob,
  getFarm,
  getFarmRecipes,
  startFarmCraft,
  type CraftingJobView,
  type FactoryTypeId,
  type FarmView,
  type PlayerFactoryView,
  type RecipeView,
} from '../lib/api-farm';
import '../styles/extensions-farm.css';

const FARM_QUERY_KEY = ['farm'] as const;
const RECIPES_QUERY_KEY = ['farm', 'recipes'] as const;

export function Factory(): JSX.Element {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [notice, setNotice] = useState<string>('');
  const [pendingRecipeId, setPendingRecipeId] = useState<string | null>(null);
  const [pendingFactoryType, setPendingFactoryType] = useState<FactoryTypeId | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);

  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm });
  const pageQuery = useQuery({ queryKey: RECIPES_QUERY_KEY, queryFn: getFarmRecipes, refetchInterval: 15_000 });

  const farm = farmQuery.data ?? emptyFarm;
  const owned = pageQuery.data?.ownedFactories ?? [];
  const available = pageQuery.data?.availableFactories ?? [];
  const recipes = pageQuery.data?.recipes ?? [];
  const queueMaxMs = pageQuery.data?.queueMaxMs ?? 8 * 60 * 60 * 1000;

  useEffect(() => {
    if (owned.length === 0) return;
    if (selectedFactoryId === null || !owned.some((f) => f.id === selectedFactoryId)) {
      setSelectedFactoryId(owned[0]!.id);
    }
  }, [owned, selectedFactoryId]);

  const selectedFactory = useMemo(
    () => owned.find((f) => f.id === selectedFactoryId) ?? null,
    [owned, selectedFactoryId],
  );
  const filteredRecipes = useMemo(
    () => (selectedFactory ? recipes.filter((r) => r.category === selectedFactory.type) : []),
    [recipes, selectedFactory],
  );

  const anyActive = owned.some((f) => f.queue.some((j) => j.isActive));
  const isPremium = user?.premiumUntil != null && user.premiumUntil > now;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const buyMutation = useMutation({
    mutationFn: buyFactory,
    onMutate: (type) => setPendingFactoryType(type),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setSelectedFactoryId(result.factory.id);
      setNotice(`Purchased ${result.factory.name}`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'purchase failed'),
    onSettled: () => setPendingFactoryType(null),
  });

  const queueMutation = useMutation({
    mutationFn: (params: { readonly recipeId: string; readonly factoryId: string; readonly auto?: boolean }) =>
      startFarmCraft(params.factoryId, params.recipeId, params.auto === true ? { auto: true } : undefined),
    onMutate: (p) => setPendingRecipeId(p.recipeId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setNotice(
        result.job.isAuto
          ? `Auto-producing ${result.job.itemName}`
          : `Queued: ${result.job.itemName}`,
      );
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'queue failed'),
    onSettled: () => setPendingRecipeId(null),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelFarmCraftJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setNotice('Item cancelled — resources refunded');
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'cancel failed'),
  });

  const totalQueued = owned.reduce((s, f) => s + f.queue.length, 0);

  return (
    <div className="app-shell">
      <AppNav>
        <NavStat tone="meat" label="Meat" value={farm.balances.Meat.toLocaleString()} />
        <NavStat tone="bits" label="Bits" value={farm.balances.Bits.toLocaleString()} />
        <NavStat tone="data" label="Data" value={farm.balances.Data.toLocaleString()} />
      </AppNav>
      <main className="app-main factory-main">
        <PageStrip
          name="Factory"
          tone="action"
          metrics={[
            { label: <><b>{owned.length}</b> factories</> },
            { label: <><b>{totalQueued}</b> queued</> },
            { label: <>up to <b>8h</b> per queue</>, className: 'muted' },
          ]}
          actions={<span className="muted">Buy factories to unlock item categories. Queue items on each.</span>}
        />
        {farmQuery.error instanceof Error ? <div className="farm-alert" role="alert">{farmQuery.error.message}</div> : null}
        <div className="farm-alert" role="status" aria-live="polite">{notice}</div>

        <div className="factory-layout">
          <aside className="factory-sidebar" aria-label="Factories">
            <h3 className="factory-sidebar-header">Your factories</h3>
            {owned.length === 0 && !pageQuery.isPending ? (
              <p className="muted factory-sidebar-empty">No factories yet.</p>
            ) : null}
            <ul className="factory-sidebar-list">
              {owned.map((f) => {
                const active = f.queue.find((j) => j.isActive);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      className={`factory-sidebar-item factory-sidebar-item--${f.type}${selectedFactoryId === f.id ? ' is-active' : ''}`}
                      onClick={() => setSelectedFactoryId(f.id)}
                    >
                      <div className="factory-sidebar-item-head">
                        <b className="factory-sidebar-item-name">{f.name}</b>
                        <span className={`factory-type-badge factory-type-badge--${f.type}`}>{f.type}</span>
                      </div>
                      <div className="factory-sidebar-item-meta muted">
                        {f.queue.length === 0
                          ? 'Idle'
                          : `${f.queue.length} · ${formatDuration(f.queueTotalMs)}`}
                        {active ? (
                          <span className="factory-sidebar-item-active"> · {active.itemName}</span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {available.length > 0 ? (
              <>
                <h4 className="factory-sidebar-subheader">Buy new</h4>
                <ul className="factory-sidebar-list">
                  {available.map((meta) => {
                    const canAfford =
                      farm.balances.Meat >= meta.cost.meat &&
                      farm.balances.Bits >= meta.cost.bits &&
                      farm.balances.Data >= meta.cost.data;
                    const rowPending = pendingFactoryType === meta.id && buyMutation.isPending;
                    return (
                      <li key={meta.id}>
                        <div className={`factory-buy-card factory-buy-card--${meta.id}`}>
                          <div className="factory-buy-head">
                            <b>{meta.name}</b>
                            <span className={`factory-type-badge factory-type-badge--${meta.id}`}>{meta.id}</span>
                          </div>
                          <p className="factory-buy-desc muted">{meta.description}</p>
                          <div className="factory-buy-costs">
                            {meta.cost.meat > 0 ? <span className="ps-res ps-res--meat"><span className="ps-dot" />{meta.cost.meat}</span> : null}
                            {meta.cost.bits > 0 ? <span className="ps-res ps-res--bits"><span className="ps-dot" />{meta.cost.bits}</span> : null}
                            {meta.cost.data > 0 ? <span className="ps-res ps-res--data"><span className="ps-dot" />{meta.cost.data}</span> : null}
                          </div>
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={!canAfford || rowPending}
                            onClick={() => buyMutation.mutate(meta.id)}
                          >
                            {rowPending ? 'Buying…' : canAfford ? 'Buy' : 'Insufficient'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </aside>

          <section className="factory-content" aria-label="Selected factory">
            {selectedFactory === null ? (
              <p className="muted factory-content-empty">Select or buy a factory to start crafting.</p>
            ) : (
              <FactoryContent
                factory={selectedFactory}
                recipes={filteredRecipes}
                queueMaxMs={queueMaxMs}
                now={now}
                isPremium={isPremium}
                pendingRecipeId={pendingRecipeId}
                queueBusy={queueMutation.isPending}
                cancelBusy={cancelMutation.isPending}
                onQueue={(recipeId, auto) =>
                  queueMutation.mutate({
                    factoryId: selectedFactory.id,
                    recipeId,
                    ...(auto === true ? { auto: true } : {}),
                  })
                }
                onCancel={(jobId) => cancelMutation.mutate(jobId)}
              />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function FactoryContent({
  factory,
  recipes,
  queueMaxMs,
  now,
  isPremium,
  pendingRecipeId,
  queueBusy,
  cancelBusy,
  onQueue,
  onCancel,
}: {
  readonly factory: PlayerFactoryView;
  readonly recipes: readonly RecipeView[];
  readonly queueMaxMs: number;
  readonly now: number;
  readonly isPremium: boolean;
  readonly pendingRecipeId: string | null;
  readonly queueBusy: boolean;
  readonly cancelBusy: boolean;
  readonly onQueue: (recipeId: string, auto?: boolean) => void;
  readonly onCancel: (jobId: string) => void;
}): JSX.Element {
  const queuePct = Math.min(100, (factory.queueTotalMs / queueMaxMs) * 100);
  return (
    <>
      <header className="factory-content-head">
        <div>
          <h2 className="factory-content-title">{factory.name}</h2>
          <p className="factory-content-desc muted">{factory.description}</p>
        </div>
        <div className="factory-content-meta">
          <div className="factory-queue-cap">
            <div className="factory-queue-cap-lbl">
              Queue <b>{formatDuration(factory.queueTotalMs)}</b> / {formatDuration(queueMaxMs)}
            </div>
            <div className="factory-queue-cap-bar" role="progressbar" aria-valuenow={Math.round(queuePct)} aria-valuemin={0} aria-valuemax={100}>
              <div className="factory-queue-cap-fill" style={{ width: `${queuePct}%` }} />
            </div>
          </div>
        </div>
      </header>

      <section className="factory-queue" aria-label="Queue">
        <h3 className="factory-section-h">Queue ({factory.queue.length})</h3>
        {factory.queue.length === 0 ? (
          <p className="muted">Nothing crafting — pick a recipe below.</p>
        ) : (
          <ol className="factory-queue-list">
            {factory.queue.map((j) => (
              <QueueRow key={j.id} job={j} now={now} disabled={cancelBusy} onCancel={onCancel} />
            ))}
          </ol>
        )}
      </section>

      <section className="factory-recipes" aria-label="Recipes">
        <h3 className="factory-section-h">Recipes for {factory.name}</h3>
        {recipes.length === 0 ? (
          <p className="muted">No recipes for this factory.</p>
        ) : (
          <ul className="recipe-list">
            {recipes.map((recipe) => {
              const rowPending = pendingRecipeId === recipe.id && queueBusy;
              const queueFull = factory.queueRemainingCapMs < recipe.craftTimeMs;
              const disabled = !recipe.canCraft || queueFull || rowPending;
              const buttonLabel = rowPending
                ? 'Queuing…'
                : queueFull
                ? 'Queue full'
                : !recipe.canCraft
                ? 'Need resources'
                : 'Queue';
              return (
                <li key={recipe.id} className={`recipe-list-row${disabled && !rowPending ? ' recipe-list-row--locked' : ''}`}>
                  <div className="recipe-list-name">
                    <b>{recipe.itemName}</b>
                    <p className="muted">{recipe.itemDescription}</p>
                  </div>
                  <div className="recipe-list-costs">
                    {recipe.meatCost > 0 ? <span className="ps-res ps-res--meat" title="Meat"><span className="ps-dot" />{recipe.meatCost}</span> : null}
                    {recipe.bitsCost > 0 ? <span className="ps-res ps-res--bits" title="Bits"><span className="ps-dot" />{recipe.bitsCost}</span> : null}
                    {recipe.dataCost > 0 ? <span className="ps-res ps-res--data" title="Data"><span className="ps-dot" />{recipe.dataCost}</span> : null}
                  </div>
                  <div className="recipe-list-time">{formatDuration(recipe.craftTimeMs)}</div>
                  <div className="recipe-list-actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={disabled}
                      onClick={() => onQueue(recipe.id)}
                      title={queueFull ? 'Queue full (8h max)' : undefined}
                    >
                      {buttonLabel}
                    </button>
                    {isPremium ? (
                      <button
                        type="button"
                        className="btn btn--sm btn--premium"
                        disabled={disabled}
                        onClick={() => onQueue(recipe.id, true)}
                        title="Premium: auto-refill when queue empties, until resources deplete"
                      >
                        Auto ∞
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

function QueueRow({
  job,
  now,
  disabled,
  onCancel,
}: {
  readonly job: CraftingJobView;
  readonly now: number;
  readonly disabled: boolean;
  readonly onCancel: (jobId: string) => void;
}): JSX.Element {
  const remainingMs = job.finishesAt !== null ? Math.max(0, job.finishesAt - now) : job.durationMs;
  const progressPct =
    job.isActive && job.startedAt !== null
      ? Math.min(100, Math.max(0, ((now - job.startedAt) / job.durationMs) * 100))
      : 0;
  return (
    <li className={`queue-item${job.isActive ? ' is-active' : ''}${job.isAuto ? ' is-auto' : ''}`}>
      <div className="queue-item-head">
        <span className="queue-item-name">
          <b>{job.itemName}</b>
          {job.isAuto ? <span className="queue-item-auto">AUTO</span> : null}
        </span>
        <span className="queue-item-timer">
          {job.isActive ? formatCountdown(remainingMs) : `~${formatDuration(job.durationMs)} wait`}
        </span>
      </div>
      {job.isActive ? (
        <div className="queue-item-progress">
          <div className="queue-item-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn--secondary btn--sm queue-item-cancel"
        disabled={disabled}
        onClick={() => onCancel(job.id)}
      >
        Cancel
      </button>
    </li>
  );
}

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  buildings: [],
};

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return min === 0 ? `${hr}h` : `${hr}h ${min}m`;
  if (min === 0) return `${sec}s`;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
