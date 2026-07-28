import { useEffect, type JSX } from 'react';

import { CloseIcon } from '../common/icons';
import { formatDuration, maxAffordableCount, queueUsedMs } from './utils';
import type { FarmView, PlayerFactoryView, RecipeView } from '../../lib/api-farm';

/**
 * The bottom-sheet drawer that pops up when the player clicks "Craft item"
 * on a factory card. Shows all recipes for the selected factory type,
 * their costs, ETA, and a quantity picker.
 *
 * Previously inline in Factory.tsx (~80 lines within the JSX).
 */
export function RecipeDrawer({
  isOpen,
  selectedFactory,
  recipes,
  farm,
  now,
  queueMaxMs,
  countByRecipe,
  pendingRecipeId,
  queuePending,
  onSetCount,
  onQueue,
  onClose,
}: {
  readonly isOpen: boolean;
  readonly selectedFactory: PlayerFactoryView | null;
  readonly recipes: readonly RecipeView[];
  readonly farm: FarmView;
  readonly now: number;
  readonly queueMaxMs: number;
  readonly countByRecipe: Readonly<Record<string, number>>;
  readonly pendingRecipeId: string | null;
  readonly queuePending: boolean;
  readonly onSetCount: (recipeId: string, count: number) => void;
  readonly onQueue: (params: { readonly factoryId: string; readonly recipeId: string; readonly count: number }) => void;
  readonly onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredRecipes = selectedFactory ? recipes.filter((r) => r.category === selectedFactory.type) : [];

  return (
    <div
      className={`drawer factory-drawer ${isOpen ? 'open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div className="scrim" onClick={onClose} />
      {selectedFactory ? (
        <div className="panel" data-fac={selectedFactory.type}>
          <div className="dhead">
            <div>
              <div className="dk">{selectedFactory.name} · Recipes</div>
              <h2 id="drawer-title">Factory</h2>
            </div>
            <button className="dclose" aria-label="Close recipes" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div className="dlist">
            {filteredRecipes.map((r) => (
              <RecipeRow
                key={r.id}
                recipe={r}
                factory={selectedFactory}
                farm={farm}
                now={now}
                queueMaxMs={queueMaxMs}
                count={countByRecipe[r.id] ?? 1}
                rowPending={pendingRecipeId === r.id && queuePending}
                onSetCount={onSetCount}
                onQueue={onQueue}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RecipeRow({
  recipe,
  factory,
  farm,
  now,
  queueMaxMs,
  count,
  rowPending,
  onSetCount,
  onQueue,
}: {
  readonly recipe: RecipeView;
  readonly factory: PlayerFactoryView;
  readonly farm: FarmView;
  readonly now: number;
  readonly queueMaxMs: number;
  readonly count: number;
  readonly rowPending: boolean;
  readonly onSetCount: (recipeId: string, count: number) => void;
  readonly onQueue: (params: { readonly factoryId: string; readonly recipeId: string; readonly count: number }) => void;
}): JSX.Element {
  const missing = [
    farm.balances.Meat < recipe.meatCost ? 'Meat' : null,
    farm.balances.Bits < recipe.bitsCost ? 'Bits' : null,
    farm.balances.Data < recipe.dataCost ? 'Data' : null,
  ].filter(Boolean) as string[];

  const usedMs = queueUsedMs(factory.queue, now);
  const effectiveMs = Math.max(1, Math.round(recipe.craftTimeMs * factory.craftTimeMultiplier));
  const overflows = usedMs + effectiveMs > queueMaxMs;
  const canCraft = missing.length === 0 && !overflows;

  const timeMax = Math.max(0, Math.floor((queueMaxMs - usedMs) / effectiveMs));
  const affordCount = maxAffordableCount(recipe, farm.balances);
  const maxN = Math.max(1, Math.min(timeMax, affordCount, 99));
  const clampedCount = Math.max(1, Math.min(maxN, count));

  const hint =
    missing.length > 0
      ? `Need more ${missing.join(', ')}`
      : overflows
        ? `Queue full — ${formatDuration(queueMaxMs)} cap`
        : '';

  return (
    <div className="recipe" data-recipe={recipe.id}>
      <div className="rtop">
        <div>
          <div className="rn">{recipe.itemName}</div>
          <div className="rd">{recipe.itemDescription}</div>
        </div>
        <div className="rtime">{formatDuration(effectiveMs)}</div>
      </div>
      <div className="costs">
        {recipe.meatCost === 0 && recipe.bitsCost === 0 && recipe.dataCost === 0 ? (
          <span className="cchip">
            <span className="cd" />
            Free
          </span>
        ) : (
          <>
            {recipe.meatCost > 0 && (
              <span className={`cchip ${farm.balances.Meat < recipe.meatCost ? 'short' : ''}`} data-res="meat">
                <span className="cd" />
                {recipe.meatCost} Meat
              </span>
            )}
            {recipe.bitsCost > 0 && (
              <span className={`cchip ${farm.balances.Bits < recipe.bitsCost ? 'short' : ''}`} data-res="bits">
                <span className="cd" />
                {recipe.bitsCost} Bits
              </span>
            )}
            {recipe.dataCost > 0 && (
              <span className={`cchip ${farm.balances.Data < recipe.dataCost ? 'short' : ''}`} data-res="data">
                <span className="cd" />
                {recipe.dataCost} Data
              </span>
            )}
          </>
        )}
      </div>
      <div className="ract">
        <span className="rhint" hidden={canCraft}>
          {hint}
        </span>
        <div className="qty" hidden={!canCraft}>
          <button className="qbtn" onClick={() => onSetCount(recipe.id, clampedCount - 1)} disabled={clampedCount <= 1}>
            −
          </button>
          <input
            className="qin"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxN}
            value={clampedCount}
            readOnly
          />
          <button
            className="qbtn"
            onClick={() => onSetCount(recipe.id, clampedCount + 1)}
            disabled={clampedCount >= maxN}
          >
            +
          </button>
        </div>
        <button
          className="craftbtn"
          disabled={!canCraft || rowPending}
          onClick={() => onQueue({ factoryId: factory.id, recipeId: recipe.id, count: clampedCount })}
        >
          {rowPending ? 'Queuing...' : 'Queue craft'}
        </button>
      </div>
    </div>
  );
}
