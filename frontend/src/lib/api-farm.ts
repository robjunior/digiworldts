import { apiFetch } from './api';

export type FarmResourceKind = 'Meat' | 'Bits' | 'Data';

export type FarmBuildingView = {
  readonly id: string;
  readonly kind: string;
  readonly resource: FarmResourceKind;
  readonly level: number;
  readonly ratePerHour: number;
  readonly capacity: number;
  readonly produced: number;
  readonly upgradeCost: number;
  readonly full: boolean;
};

export type FarmView = {
  readonly balances: Record<FarmResourceKind, number>;
  readonly credits: number;
  readonly buildings: readonly FarmBuildingView[];
};

export type FarmGain = {
  readonly resource: FarmResourceKind;
  readonly amount: number;
};

export type FarmCollectResult = {
  readonly gained: readonly FarmGain[];
  readonly view: FarmView;
};

export type FarmUpgradeResult = {
  readonly view: FarmView;
};

export type FactoryTypeId = 'med' | 'chip' | 'rare' | 'pantry';

export type FactoryPurchaseCost = {
  readonly meat: number;
  readonly bits: number;
  readonly data: number;
};

export type FactoryTypeInfo = {
  readonly id: FactoryTypeId;
  readonly name: string;
  readonly description: string;
  readonly cost: FactoryPurchaseCost;
};

export type RecipeView = {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly itemDescription: string;
  readonly meatCost: number;
  readonly bitsCost: number;
  readonly dataCost: number;
  readonly craftTimeMs: number;
  readonly category: FactoryTypeId | null;
  readonly canCraft: boolean;
};

export type CraftingJobView = {
  readonly id: string;
  readonly factoryId: string;
  readonly recipeId: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly startedAt: number | null;
  readonly durationMs: number;
  readonly finishesAt: number | null;
  readonly progressPct: number;
  readonly readyToCollect: boolean;
  readonly isAuto: boolean;
  readonly isActive: boolean;
};

export type PlayerFactoryView = {
  readonly id: string;
  readonly type: FactoryTypeId;
  readonly name: string;
  readonly description: string;
  readonly createdAt: number;
  readonly level: number;
  readonly maxLevel: number;
  readonly craftTimeMultiplier: number;
  readonly craftSpeedPct: number;
  readonly upgradeCost: number;
  readonly canUpgrade: boolean;
  readonly nextCraftTimeMultiplier: number | null;
  readonly queue: readonly CraftingJobView[];
  readonly queueTotalMs: number;
  readonly queueRemainingCapMs: number;
};

export type FactoryPageView = {
  readonly balances: Record<FarmResourceKind, number>;
  readonly recipes: readonly RecipeView[];
  readonly ownedFactories: readonly PlayerFactoryView[];
  readonly availableFactories: readonly FactoryTypeInfo[];
  readonly queueMaxMs: number;
};

export type BuyFactoryResult = {
  readonly ok: true;
  readonly factory: PlayerFactoryView;
  readonly balances: Record<FarmResourceKind, number>;
};

export type UpgradeFactoryResult = {
  readonly ok: true;
  readonly factory: PlayerFactoryView;
  readonly balances: Record<FarmResourceKind, number>;
};

export type QueueCraftResult = {
  readonly ok: true;
  readonly job: CraftingJobView;
  readonly queuedCount: number;
  readonly balances: Record<FarmResourceKind, number>;
};

export type CancelCraftJobResult = {
  readonly ok: true;
  readonly refunded: Partial<Record<FarmResourceKind, number>>;
  readonly balances: Record<FarmResourceKind, number>;
};

export function getFarm(): Promise<FarmView> {
  return apiFetch<FarmView>('/api/farm');
}

export function collectFarmAll(): Promise<FarmCollectResult> {
  return apiFetch<FarmCollectResult>('/api/farm/collect', { method: 'POST' });
}

export function collectFarmBuilding(buildingId: string): Promise<FarmCollectResult> {
  return apiFetch<FarmCollectResult>(`/api/farm/collect/${encodeURIComponent(buildingId)}`, { method: 'POST' });
}

export function upgradeFarmBuilding(buildingId: string): Promise<FarmUpgradeResult> {
  return apiFetch<FarmUpgradeResult>(`/api/farm/upgrade/${encodeURIComponent(buildingId)}`, { method: 'POST' });
}

export function getFarmRecipes(): Promise<FactoryPageView> {
  return apiFetch<FactoryPageView>('/api/farm/recipes');
}

export function buyFactory(type: FactoryTypeId): Promise<BuyFactoryResult> {
  return apiFetch<BuyFactoryResult>('/api/farm/factories/buy', { method: 'POST', body: { type } });
}

export function upgradeFactoryLevel(factoryId: string): Promise<UpgradeFactoryResult> {
  return apiFetch<UpgradeFactoryResult>(`/api/farm/factory/upgrade/${encodeURIComponent(factoryId)}`, { method: 'POST' });
}

export function startFarmCraft(
  factoryId: string,
  recipeId: string,
  opts?: { readonly auto?: boolean; readonly count?: number },
): Promise<QueueCraftResult> {
  const body: Record<string, unknown> = { factoryId, recipeId };
  if (opts?.auto === true) body.auto = true;
  if (typeof opts?.count === 'number') body.count = opts.count;
  return apiFetch<QueueCraftResult>('/api/farm/craft', { method: 'POST', body });
}

export function cancelFarmCraftJob(jobId: string): Promise<CancelCraftJobResult> {
  return apiFetch<CancelCraftJobResult>(`/api/farm/craft/cancel/${encodeURIComponent(jobId)}`, { method: 'POST' });
}
