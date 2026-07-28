import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { BalBar, ResourceBal } from '../components/common/BalBar';
import { SectionHead } from '../components/common/SectionHead';
import { Toast } from '../components/common/Toast';
import { BuyFactoryCard } from '../components/factory/BuyFactoryCard';
import { FactoryCard } from '../components/factory/FactoryCard';
import { FactoryOverview } from '../components/factory/FactoryOverview';
import { RecipeDrawer } from '../components/factory/RecipeDrawer';
import { formatDuration } from '../components/factory/utils';
import { useAuth } from '../hooks/useAuth';
import {
  buyFactory,
  cancelFarmCraftJob,
  getFarm,
  getFarmRecipes,
  startFarmCraft,
  upgradeFactoryLevel,
  type FarmView,
} from '../lib/api-farm';
import '../styles/extensions-factory.css';

const FARM_QUERY_KEY = ['farm'] as const;
const RECIPES_QUERY_KEY = ['farm', 'recipes'] as const;

const emptyFarm: FarmView = {
  balances: { Meat: 0, Bits: 0, Data: 0 },
  credits: 0,
  buildings: [],
};

export function Factory(): JSX.Element {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [notice, setNotice] = useState<string>('');
  const [pendingRecipeId, setPendingRecipeId] = useState<string | null>(null);
  const [pendingFactoryType, setPendingFactoryType] = useState<string | null>(null);
  const [pendingUpgradeFactoryId, setPendingUpgradeFactoryId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectedFactoryId, setSelectedFactoryId] = useState<string | null>(null);
  const [countByRecipe, setCountByRecipe] = useState<Record<string, number>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm });
  const pageQuery = useQuery({ queryKey: RECIPES_QUERY_KEY, queryFn: getFarmRecipes, refetchInterval: 15_000 });

  const farm = farmQuery.data ?? emptyFarm;
  const owned = pageQuery.data?.ownedFactories ?? [];
  const available = pageQuery.data?.availableFactories ?? [];
  const recipes = pageQuery.data?.recipes ?? [];
  const queueMaxMs = pageQuery.data?.queueMaxMs ?? 8 * 60 * 60 * 1000;

  // Auto-select the first owned factory when list changes.
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

  // Tick the clock every 500 ms so progress bars animate live.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(''), 1900);
    return () => window.clearTimeout(t);
  }, [notice]);

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
    mutationFn: (params: { readonly recipeId: string; readonly factoryId: string; readonly auto?: boolean; readonly count?: number }) => {
      const opts: { auto?: boolean; count?: number } = {};
      if (params.auto === true) opts.auto = true;
      if (typeof params.count === 'number') opts.count = params.count;
      return startFarmCraft(params.factoryId, params.recipeId, opts);
    },
    onMutate: (p) => setPendingRecipeId(p.recipeId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setCountByRecipe((prev) => ({ ...prev, [result.job.recipeId]: 1 }));
      const label = result.queuedCount > 1 ? `${result.queuedCount}× ${result.job.itemName}` : result.job.itemName;
      setNotice(result.job.isAuto ? `Auto-producing ${label}` : `Queued: ${label}`);
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

  const upgradeFactoryMutation = useMutation({
    mutationFn: upgradeFactoryLevel,
    onMutate: (id) => setPendingUpgradeFactoryId(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      setNotice(`${result.factory.name} upgraded to Lv ${result.factory.level}`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'upgrade failed'),
    onSettled: () => setPendingUpgradeFactoryId(null),
  });

  // Silence unused-var warning while user prop is intentionally reserved for premium checks.
  void user;

  const totalReady = owned.reduce((a, f) => a + f.queue.filter((j) => j.readyToCollect).length, 0);
  const totalCrafting = owned.reduce((a, f) => a + f.queue.filter((j) => j.isActive && !j.readyToCollect).length, 0);

  let nextMs = Number.POSITIVE_INFINITY;
  for (const f of owned) {
    for (const j of f.queue) {
      if (j.isActive && !j.readyToCollect && j.finishesAt !== null) {
        const rem = Math.max(0, j.finishesAt - now);
        if (rem < nextMs) nextMs = rem;
      }
    }
  }
  const nextReadyText = totalReady > 0 ? 'now' : nextMs === Number.POSITIVE_INFINITY ? '—' : formatDuration(nextMs);
  const balSubtitle = totalReady > 0 ? `${totalReady} ready to collect` : `${totalCrafting} crafting`;

  return (
    <>
      <BalBar title="Factory Row" subtitle={balSubtitle} odId="resource-balance">
        <ResourceBal resource="meat" label="Meat" value={farm.balances.Meat} />
        <ResourceBal resource="bits" label="Bits" value={farm.balances.Bits} />
        <ResourceBal resource="data" label="Data" value={farm.balances.Data} />
        <ResourceBal resource="credits" label="Credits" value={farm.credits} />
      </BalBar>

      <div className="scroll">
        <FactoryOverview
          ownedCount={owned.length}
          totalCrafting={totalCrafting}
          totalReady={totalReady}
          nextReadyText={nextReadyText}
        />

        <div className="fac-sec">
          <SectionHead title="Your Factories" count={`${owned.length}/4 built`} />
          <div className="fgrid rail" data-od-id="factory-grid">
            {owned.map((f) => (
              <FactoryCard
                key={f.id}
                factory={f}
                now={now}
                queueMaxMs={queueMaxMs}
                credits={farm.credits}
                upgradePending={pendingUpgradeFactoryId === f.id && upgradeFactoryMutation.isPending}
                cancelPending={cancelMutation.isPending}
                onOpenRecipes={(factoryId) => {
                  setSelectedFactoryId(factoryId);
                  setIsDrawerOpen(true);
                }}
                onUpgrade={(factoryId) => upgradeFactoryMutation.mutate(factoryId)}
                onCancelJob={(jobId) => cancelMutation.mutate(jobId)}
                onCollect={(jobId) => cancelMutation.mutate(jobId)}
              />
            ))}
          </div>
        </div>

        <div className="buy-sec">
          <SectionHead title="Available Factories" />
          <div className="buygrid rail" data-od-id="factory-buy-grid">
            {available.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>
                All factory types built. Your industrial base is complete.
              </div>
            ) : (
              available.map((a) => (
                <BuyFactoryCard
                  key={a.id}
                  available={a}
                  balances={farm.balances}
                  isPending={pendingFactoryType === a.id && buyMutation.isPending}
                  onBuy={(typeId) => buyMutation.mutate(typeId)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <RecipeDrawer
        isOpen={isDrawerOpen}
        selectedFactory={selectedFactory}
        recipes={recipes}
        farm={farm}
        now={now}
        queueMaxMs={queueMaxMs}
        countByRecipe={countByRecipe}
        pendingRecipeId={pendingRecipeId}
        queuePending={queueMutation.isPending}
        onSetCount={(recipeId, count) => setCountByRecipe((prev) => ({ ...prev, [recipeId]: count }))}
        onQueue={(params) => queueMutation.mutate(params)}
        onClose={() => setIsDrawerOpen(false)}
      />

      <Toast message={notice} extraClassName="factory-toast" />
    </>
  );
}
