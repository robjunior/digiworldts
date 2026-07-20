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
  craftFarmRecipe,
  getFarm,
  getFarmRecipes,
  type FarmCollectResult,
  type FarmView,
  type RecipesResponse,
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
  const [pendingRecipeId, setPendingRecipeId] = useState<string | null>(null);
  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm, refetchInterval: 3_000 });
  const recipesQuery = useQuery({ queryKey: RECIPES_QUERY_KEY, queryFn: getFarmRecipes });
  const farm = farmQuery.data ?? emptyFarm;
  const recipes = recipesQuery.data?.recipes ?? [];
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
  const craftMutation = useMutation({
    mutationFn: craftFarmRecipe,
    onMutate: (recipeId) => setPendingRecipeId(recipeId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: FARM_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      setNotice(`Crafted ${result.itemName}`);
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'craft failed'),
    onSettled: () => setPendingRecipeId(null),
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
        <section className="farm-recipes" aria-label="Craftable items">
          <header className="farm-recipes-head">
            <h2>Crafting</h2>
            <span className="muted">Spend resources to craft consumables for PVE combat.</span>
          </header>
          {recipesQuery.isPending ? (
            <p className="muted">Loading recipes…</p>
          ) : recipes.length === 0 ? (
            <p className="muted">No recipes available.</p>
          ) : (
            <div className="recipes-grid">
              {recipes.map((recipe) => (
                <article key={recipe.id} className={`recipe-card${recipe.canCraft ? '' : ' recipe-card--locked'}`}>
                  <header className="recipe-card-head">
                    <b className="recipe-card-name">{recipe.itemName}</b>
                  </header>
                  <p className="recipe-card-desc muted">{recipe.itemDescription}</p>
                  <div className="recipe-costs">
                    {recipe.meatCost > 0 ? <span className="ps-res ps-res--meat" title="Meat"><span className="ps-dot" />{recipe.meatCost}</span> : null}
                    {recipe.bitsCost > 0 ? <span className="ps-res ps-res--bits" title="Bits"><span className="ps-dot" />{recipe.bitsCost}</span> : null}
                    {recipe.dataCost > 0 ? <span className="ps-res ps-res--data" title="Data"><span className="ps-dot" />{recipe.dataCost}</span> : null}
                  </div>
                  <button
                    className="btn btn--sm"
                    type="button"
                    disabled={!recipe.canCraft || (pendingRecipeId === recipe.id && craftMutation.isPending)}
                    onClick={() => craftMutation.mutate(recipe.id)}
                  >
                    {pendingRecipeId === recipe.id && craftMutation.isPending ? 'Crafting…' : 'Craft'}
                  </button>
                </article>
              ))}
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

function applyCollectResult(queryClient: ReturnType<typeof useQueryClient>, result: FarmCollectResult, setNotice: (notice: string) => void): void {
  queryClient.setQueryData<FarmView>(FARM_QUERY_KEY, result.view);
  queryClient.invalidateQueries({ queryKey: RECIPES_QUERY_KEY });
  setNotice(result.gained.length > 0 ? result.gained.map((gain) => `+${gain.amount} ${gain.resource}`).join(', ') : 'Nothing to collect yet');
}
