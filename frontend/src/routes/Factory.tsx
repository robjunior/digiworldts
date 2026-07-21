import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { AppNav, NavStat } from '../components/AppNav';
import { PageStrip } from '../components/common/PageStrip';
import { craftFarmRecipe, getFarm, getFarmRecipes, type FarmView } from '../lib/api-farm';
import '../styles/extensions-farm.css';

const FARM_QUERY_KEY = ['farm'] as const;
const RECIPES_QUERY_KEY = ['farm', 'recipes'] as const;

export function Factory(): JSX.Element {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>('');
  const [pendingRecipeId, setPendingRecipeId] = useState<string | null>(null);
  const farmQuery = useQuery({ queryKey: FARM_QUERY_KEY, queryFn: getFarm });
  const recipesQuery = useQuery({ queryKey: RECIPES_QUERY_KEY, queryFn: getFarmRecipes });
  const farm = farmQuery.data ?? emptyFarm;
  const recipes = recipesQuery.data?.recipes ?? [];
  const craftableCount = recipes.filter((recipe) => recipe.canCraft).length;

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
      </AppNav>
      <main className="app-main">
        <PageStrip
          name="Factory"
          tone={craftableCount > 0 ? 'reward' : 'action'}
          metrics={[
            { label: <span className="ps-res ps-res--meat"><span className="ps-dot" /><span className="ps-lbl">Meat</span> <b>{fmt(farm.balances.Meat)}</b></span> },
            { label: <span className="ps-res ps-res--bits"><span className="ps-dot" /><span className="ps-lbl">Bits</span> <b>{fmt(farm.balances.Bits)}</b></span> },
            { label: <span className="ps-res ps-res--data"><span className="ps-dot" /><span className="ps-lbl">Data</span> <b>{fmt(farm.balances.Data)}</b></span> },
            { label: <><b>{recipes.length}</b> recipes</> },
            { label: craftableCount > 0 ? <><b>{craftableCount}</b> ready</> : 'nothing ready', className: craftableCount > 0 ? 'reward' : 'muted' },
          ]}
          actions={<span className="muted">Spend farm resources to craft consumables for PVE combat.</span>}
        />
        {farmQuery.error instanceof Error ? <div className="farm-alert" role="alert">{farmQuery.error.message}</div> : null}
        <div className="farm-alert" role="status" aria-live="polite">{notice}</div>
        <section className="farm-recipes" aria-label="Craftable items">
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
