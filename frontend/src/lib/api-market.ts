import type { BaseStats, TemplateDigimon } from '@digiworld/shared/digimon';

import { apiFetch, type RosterResponse } from './api';

export const MARKET_STAGES = ['Baby', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega'] as const;
export const MARKET_ELEMENTS = ['fire', 'water', 'nature', 'electric', 'neutral'] as const;
export const MARKET_SORTS = ['newest', 'price_asc', 'price_desc', 'level_desc'] as const;

export type MarketStage = (typeof MARKET_STAGES)[number];
export type MarketElement = (typeof MARKET_ELEMENTS)[number];
export type MarketSort = (typeof MARKET_SORTS)[number];
export type MarketTab = 'browse' | 'mine' | 'sell';

export type MarketFilters = {
  readonly q: string;
  readonly stage: '' | MarketStage;
  readonly element: '' | MarketElement;
  readonly minLevel: string;
  readonly maxLevel: string;
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly sort: MarketSort;
};

export type MarketSeller = {
  readonly id: string;
  readonly displayName: string;
};

export type MarketListing = {
  readonly listingId: string;
  readonly monId: string;
  readonly catalogId: string;
  readonly nickname: string;
  readonly level: number;
  readonly xp: number;
  readonly mood: number;
  readonly statBonus: BaseStats;
  readonly price: number;
  readonly listedAt: number;
  readonly seller: MarketSeller;
  readonly isMine: boolean;
  readonly template: TemplateDigimon | null;
};

export type MarketBrowseResponse = {
  readonly items: readonly MarketListing[];
  readonly total: number;
  readonly page: number;
  readonly perPage: number;
  readonly sort: MarketSort;
};

export type MyListingStatus = 'active' | 'sold' | 'canceled';

export type MyMarketListing = {
  readonly listingId: string;
  readonly monId: string;
  readonly catalogId: string;
  readonly nickname: string;
  readonly level: number;
  readonly price: number;
  readonly listedAt: number;
  readonly status: MyListingStatus;
  readonly soldAt: number | null;
  readonly soldTo: string | null;
  readonly template: TemplateDigimon | null;
};

export type MyMarketListingsResponse = {
  readonly listings: readonly MyMarketListing[];
};

export type MarketListResponse = {
  readonly ok: true;
  readonly listingId: string;
  readonly monId: string;
  readonly price: number;
};

export type MarketOkResponse = {
  readonly ok: true;
};

export type MarketBuyResponse = {
  readonly ok: true;
  readonly monId: string;
  readonly price: number;
};

export type FarmCreditsResponse = {
  readonly credits?: number;
};

export const DEFAULT_MARKET_FILTERS: MarketFilters = {
  q: '',
  stage: '',
  element: '',
  minLevel: '',
  maxLevel: '',
  minPrice: '',
  maxPrice: '',
  sort: 'newest',
};

export function getMarket(page: number, perPage: number, filters: MarketFilters): Promise<MarketBrowseResponse> {
  return apiFetch<MarketBrowseResponse>(`/api/market?${marketQuery(page, perPage, filters)}`);
}

export function getMyMarketListings(): Promise<MyMarketListingsResponse> {
  return apiFetch<MyMarketListingsResponse>('/api/market/mine');
}

export function listMarketMon(monId: string, price: number): Promise<MarketListResponse> {
  return apiFetch<MarketListResponse>('/api/market/list', { method: 'POST', body: { monId, price } });
}

export function cancelMarketListing(listingId: string): Promise<MarketOkResponse> {
  return apiFetch<MarketOkResponse>(`/api/market/cancel/${encodeURIComponent(listingId)}`, { method: 'POST' });
}

export function buyMarketListing(listingId: string): Promise<MarketBuyResponse> {
  return apiFetch<MarketBuyResponse>(`/api/market/buy/${encodeURIComponent(listingId)}`, { method: 'POST' });
}

export function getMarketRoster(): Promise<RosterResponse> {
  return apiFetch<RosterResponse>('/api/roster');
}

export async function getFarmCredits(): Promise<number> {
  const farm = await apiFetch<FarmCreditsResponse>('/api/farm');
  return farm.credits ?? 0;
}

function marketQuery(page: number, perPage: number, filters: MarketFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('perPage', String(perPage));
  appendParam(params, 'q', filters.q);
  appendParam(params, 'stage', filters.stage);
  appendParam(params, 'element', filters.element);
  appendParam(params, 'minLevel', filters.minLevel);
  appendParam(params, 'maxLevel', filters.maxLevel);
  appendParam(params, 'minPrice', filters.minPrice);
  appendParam(params, 'maxPrice', filters.maxPrice);
  params.set('sort', filters.sort);
  return params.toString();
}

function appendParam(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    params.set(key, trimmed);
  }
}
