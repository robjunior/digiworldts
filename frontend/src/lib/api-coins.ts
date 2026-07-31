import { apiFetch } from './api';

export type CoinOffer = {
  readonly id: string;
  readonly side: 'sell' | 'buy';
  readonly sellerName: string;
  readonly lotsRemaining: number;
  readonly pricePerLot: number;
  readonly totalNetcore: number;
  readonly isMine: boolean;
};

export type CoinMarketResponse = {
  readonly lotSize: number;
  readonly sellOffers: readonly CoinOffer[];
  readonly buyOffers: readonly CoinOffer[];
  readonly myOffers: readonly CoinOffer[];
  readonly wallet: {
    readonly credits: number;
    readonly netcore: number;
  };
  readonly lastPrice: number | null;
};

export type PostOfferBody = {
  readonly side: 'sell' | 'buy';
  readonly lots: number;
  readonly pricePerLot: number;
};

export type PostOfferResponse = {
  readonly ok: true;
  readonly id: string;
};

export type FillOfferBody = {
  readonly lots: number;
};

export type OkResponse = {
  readonly ok: true;
};

export function getCoinMarket(): Promise<CoinMarketResponse> {
  return apiFetch<CoinMarketResponse>('/api/market/coins');
}

export function postCoinOffer(body: PostOfferBody): Promise<PostOfferResponse> {
  return apiFetch<PostOfferResponse>('/api/market/coins/offer', {
    method: 'POST',
    body,
  });
}

export function cancelCoinOffer(id: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/api/market/coins/cancel/${encodeURIComponent(id)}`, {
    method: 'POST',
  });
}

export function fillCoinOffer(id: string, lots: number): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/api/market/coins/fill/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: { lots },
  });
}
