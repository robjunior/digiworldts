import { apiFetch } from './api';
import type { OkResponse } from './api-roster';

export type ShopItemKind = 'consumable' | 'evolve' | 'building_placement' | 'cosmetic' | 'xp_mult' | 'revive' | string;
export type ShopItemClass = 'product' | 'item';
export type ShopCurrency = 'credits' | 'netcore';

export type ShopItemView = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly price: number;
  readonly currency: ShopCurrency;
  readonly kind: ShopItemKind;
  readonly class?: ShopItemClass;
  readonly shopCategory?: string;
  readonly oneTime?: boolean;
  readonly owned?: boolean;
  readonly sprite?: string | null;
  readonly mono?: string | null;
};

export type InventoryItemView = {
  readonly itemId: string;
  readonly name: string;
  readonly description: string;
  readonly qty: number;
};

export type BundleItemView = {
  readonly itemId: string;
  readonly name: string;
  readonly description: string;
  readonly qty: number;
  readonly unitPrice: number;
  readonly sprite: string | null;
  readonly mono: string | null;
};

export type BundleView = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly currency: ShopCurrency;
  readonly discountPct: number;
  readonly shopCategory: string;
  readonly featured: boolean;
  readonly quickOffer: boolean;
  readonly items: readonly BundleItemView[];
  readonly originalPrice: number;
  readonly discountedPrice: number;
  readonly savings: number;
};

export type ShopResponse = {
  readonly featured: ShopItemView | null;
  readonly quick: readonly ShopItemView[];
  readonly catalog: readonly ShopItemView[];
  readonly bundles: readonly BundleView[];
  readonly categories: readonly string[];
  readonly wallet: {
    readonly credits: number;
    readonly netcore: number;
  };
  readonly inventory: readonly InventoryItemView[];
};

export type ItemsResponse = {
  readonly items: readonly InventoryItemView[];
};

export type BuyResponse = {
  readonly ok: true;
  readonly credits: number;
  readonly netcore: number;
};

export type ApplyEffectKind = 'hp_pct' | 'en_pct' | 'xp_mult';

export type ApplyResponse = {
  readonly ok: true;
  readonly applied: {
    readonly effectKind: ApplyEffectKind;
    readonly magnitude: number;
    readonly monId: string | null;
  };
};

export function getShop(): Promise<ShopResponse> {
  return apiFetch<ShopResponse>('/api/shop');
}

export function getInventory(): Promise<Pick<ShopResponse, 'inventory' | 'wallet'>> {
  return apiFetch<ShopResponse>('/api/shop');
}

export function getItems(): Promise<ItemsResponse> {
  return apiFetch<ItemsResponse>('/api/items');
}

export function buyShopItem(itemId: string, qty: number): Promise<BuyResponse> {
  return apiFetch<BuyResponse>('/api/shop/buy', { method: 'POST', body: { itemId, qty } });
}

export function buyBundle(id: string): Promise<BuyResponse> {
  return apiFetch<BuyResponse>(`/api/shop/buy/bundle/${id}`, { method: 'POST' });
}

export function coinClass(currency: ShopCurrency): 'gem' | 'cred' {
  return currency === 'credits' ? 'gem' : 'cred';
}

export function applyShopItem(itemId: string, monId?: string): Promise<ApplyResponse> {
  const body = monId === undefined ? { itemId } : { itemId, monId };
  return apiFetch<ApplyResponse>('/api/shop/apply', { method: 'POST', body });
}

export function useShopItem(itemId: string, qty: number): Promise<OkResponse> {
  return apiFetch<OkResponse>('/api/shop/use', { method: 'POST', body: { itemId, qty } });
}
