import { apiFetch } from './api';
import type { OkResponse } from './api-roster';

export type ShopItemKind = 'consumable' | 'evolve' | 'building_placement' | 'cosmetic' | 'xp_mult' | 'revive' | string;

export type ShopItemClass = 'product' | 'item';

export type ShopItemView = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priceCredits: number;
  readonly kind: ShopItemKind;
  readonly class: ShopItemClass;
};

export type InventoryItemView = {
  readonly itemId: string;
  readonly name: string;
  readonly description: string;
  readonly qty: number;
};

export type ShopResponse = {
  readonly products: readonly ShopItemView[];
  readonly inventory: readonly InventoryItemView[];
  readonly credits: number;
};

export type ItemsResponse = {
  readonly items: readonly InventoryItemView[];
};

export type BuyResponse = {
  readonly ok: true;
  readonly credits: number;
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

export function getInventory(): Promise<Pick<ShopResponse, 'inventory' | 'credits'>> {
  return apiFetch<ShopResponse>('/api/shop');
}

export function getItems(): Promise<ItemsResponse> {
  return apiFetch<ItemsResponse>('/api/items');
}

export function buyShopItem(itemId: string, qty: number): Promise<BuyResponse> {
  return apiFetch<BuyResponse>('/api/shop/buy', { method: 'POST', body: { itemId, qty } });
}

export function applyShopItem(itemId: string, monId?: string): Promise<ApplyResponse> {
  const body = monId === undefined ? { itemId } : { itemId, monId };
  return apiFetch<ApplyResponse>('/api/shop/apply', { method: 'POST', body });
}

export function useShopItem(itemId: string, qty: number): Promise<OkResponse> {
  return apiFetch<OkResponse>('/api/shop/use', { method: 'POST', body: { itemId, qty } });
}
