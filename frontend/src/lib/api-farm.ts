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

export type RecipeView = {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly itemDescription: string;
  readonly meatCost: number;
  readonly bitsCost: number;
  readonly dataCost: number;
  readonly canCraft: boolean;
};

export type RecipesResponse = {
  readonly recipes: readonly RecipeView[];
  readonly balances: Record<FarmResourceKind, number>;
};

export type CraftResult = {
  readonly ok: true;
  readonly itemId: string;
  readonly itemName: string;
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

export function getFarmRecipes(): Promise<RecipesResponse> {
  return apiFetch<RecipesResponse>('/api/farm/recipes');
}

export function craftFarmRecipe(recipeId: string): Promise<CraftResult> {
  return apiFetch<CraftResult>('/api/farm/craft', { method: 'POST', body: { recipeId } });
}
