import type { CraftingJobView, RecipeView } from '../../lib/api-farm';

/**
 * Utility functions shared by factory subcomponents. Keeps FactoryCard,
 * RecipeDrawer, and Factory (orchestrator) DRY.
 */

export function queueUsedMs(queue: readonly CraftingJobView[], now: number): number {
  return queue.reduce((a, j) => {
    if (j.readyToCollect) return a;
    const rem = j.isActive && j.finishesAt !== null ? Math.max(0, j.finishesAt - now) : j.durationMs;
    return a + rem;
  }, 0);
}

export function maxAffordableCount(recipe: RecipeView, balances: Record<'Meat' | 'Bits' | 'Data', number>): number {
  const perResource = [
    recipe.meatCost > 0 ? Math.floor(balances.Meat / recipe.meatCost) : Number.POSITIVE_INFINITY,
    recipe.bitsCost > 0 ? Math.floor(balances.Bits / recipe.bitsCost) : Number.POSITIVE_INFINITY,
    recipe.dataCost > 0 ? Math.floor(balances.Data / recipe.dataCost) : Number.POSITIVE_INFINITY,
  ];
  const min = Math.min(...perResource);
  return Number.isFinite(min) ? min : 999;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hr = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hr > 0) return min === 0 ? `${hr}h` : `${hr}h ${min}m`;
  if (min === 0) return `${sec}s`;
  if (sec === 0) return `${min}m`;
  return `${min}m ${sec}s`;
}

export type QueueGroup = {
  readonly jobs: readonly CraftingJobView[];
  readonly recipeId: string;
  readonly itemName: string;
  readonly count: number;
  readonly hasAuto: boolean;
  readonly hasActive: boolean;
  readonly hasReady: boolean;
};

export function groupQueue(queue: readonly CraftingJobView[]): readonly QueueGroup[] {
  const groups: Array<{
    jobs: CraftingJobView[];
    recipeId: string;
    itemName: string;
    hasAuto: boolean;
  }> = [];
  for (const job of queue) {
    if (job.isActive || job.readyToCollect) continue; // group only pending jobs
    const last = groups[groups.length - 1];
    if (last && last.recipeId === job.recipeId && last.hasAuto === job.isAuto) {
      last.jobs.push(job);
    } else {
      groups.push({ jobs: [job], recipeId: job.recipeId, itemName: job.itemName, hasAuto: job.isAuto });
    }
  }
  return groups.map((g) => ({
    jobs: g.jobs,
    recipeId: g.recipeId,
    itemName: g.itemName,
    count: g.jobs.length,
    hasAuto: g.hasAuto,
    hasActive: false,
    hasReady: false,
  }));
}
