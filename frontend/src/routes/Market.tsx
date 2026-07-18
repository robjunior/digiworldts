import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { MarketChrome } from '../components/market/MarketChrome';
import { MarketDialogs, type MarketDialogState } from '../components/market/MarketDialogs';
import { MarketFilters } from '../components/market/MarketFilters';
import { MarketListingCard } from '../components/market/MarketListingCard';
import { MarketPagination } from '../components/market/MarketPagination';
import { MarketTabs } from '../components/market/MarketTabs';
import type { RosterView } from '../lib/api';
import { ApiError } from '../lib/api';
import { buyMarketListing, cancelMarketListing, DEFAULT_MARKET_FILTERS, getFarmCredits, getMarket, getMarketRoster, getMyMarketListings, listMarketMon, type MarketFilters as MarketFiltersValue, type MarketListing, type MarketTab, type MyMarketListing } from '../lib/api-market';
import '../styles/extensions-market.css';

const MARKET_PER_PAGE = 12;
const MARKET_QUERY_KEY = ['market'] as const;
const MINE_QUERY_KEY = ['market', 'mine'] as const;
const SELL_QUERY_KEY = ['market', 'sell-roster'] as const;
const CREDITS_QUERY_KEY = ['farm', 'credits'] as const;

export function Market(): JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MarketTab>('browse');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<MarketFiltersValue>(DEFAULT_MARKET_FILTERS);
  const [dialog, setDialog] = useState<MarketDialogState>({ kind: 'none' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const browseQuery = useQuery({ queryKey: [...MARKET_QUERY_KEY, page, filters], queryFn: () => getMarket(page, MARKET_PER_PAGE, filters) });
  const mineQuery = useQuery({ queryKey: MINE_QUERY_KEY, queryFn: getMyMarketListings, enabled: tab === 'mine' });
  const sellQuery = useQuery({ queryKey: SELL_QUERY_KEY, queryFn: getMarketRoster, enabled: tab === 'sell' });
  const creditsQuery = useQuery({ queryKey: CREDITS_QUERY_KEY, queryFn: getFarmCredits });

  const mutation = useMutation({
    mutationFn: runDialogMutation,
    onSuccess: async (message) => {
      setNotice(message);
      setError(null);
      setDialog({ kind: 'none' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MARKET_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: MINE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SELL_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: CREDITS_QUERY_KEY }),
      ]);
    },
    onError: (caught: Error) => {
      setError(caught.message);
      setNotice(null);
    },
  });

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const eligibleMons = useMemo(() => eligibleForMarket(sellQuery.data?.roster ?? []), [sellQuery.data]);
  const busy = mutation.isPending;

  return (
    <MarketChrome credits={creditsQuery.data ?? 0}>
      <MarketTabs activeTab={tab} onTab={setTab} />
      <StatusLine notice={notice} error={error ?? queryError(browseQuery.error, mineQuery.error, sellQuery.error)} />
      <section id="tab-browse" className={tab === 'browse' ? 'tab-panel' : 'tab-panel hidden'}>
        <MarketFilters filters={filters} onFilters={setFilters} />
        <ListingGrid loading={browseQuery.isPending} emptyText="No listings match your filters.">
          {(browseQuery.data?.items ?? []).map((listing) => <MarketListingCard key={listing.listingId} kind="browse" listing={listing} onBuy={(item) => setDialog({ kind: 'buy', listing: item })} />)}
        </ListingGrid>
        {browseQuery.data ? <MarketPagination total={browseQuery.data.total} page={browseQuery.data.page} perPage={browseQuery.data.perPage} onPage={setPage} /> : null}
      </section>
      <section id="tab-mine" className={tab === 'mine' ? 'tab-panel' : 'tab-panel hidden'}>
        <ListingGrid loading={mineQuery.isPending} emptyText="You haven't listed anything yet. Head to the Sell tab.">
          {(mineQuery.data?.listings ?? []).map((listing) => <MarketListingCard key={listing.listingId} kind="mine" listing={listing} onCancel={(item) => setDialog({ kind: 'cancel', listing: item })} />)}
        </ListingGrid>
      </section>
      <section id="tab-sell" className={tab === 'sell' ? 'tab-panel' : 'tab-panel hidden'}>
        <p className="market-sell-copy">Pick a Digimon to list on the market. Party mons, training mons, downed mons, and already-listed mons are hidden.</p>
        <ListingGrid loading={sellQuery.isPending} emptyText="No Digimon are eligible to list. Try removing one from your party.">
          {eligibleMons.map((mon) => <MarketListingCard key={mon.id} kind="sell" listing={mon} onSell={(item) => setDialog({ kind: 'sell', mon: item, price: '100' })} />)}
        </ListingGrid>
      </section>
      <MarketDialogs state={dialog} busy={busy} onClose={() => setDialog({ kind: 'none' })} onBuy={(listing) => mutation.mutate({ kind: 'buy', listing })} onCancel={(listing) => mutation.mutate({ kind: 'cancel', listing })} onSellPrice={(price) => setDialog((current) => current.kind === 'sell' ? { ...current, price } : current)} onSell={(mon, price) => mutation.mutate({ kind: 'sell', mon, price })} />
    </MarketChrome>
  );
}

type MarketMutation =
  | { readonly kind: 'buy'; readonly listing: MarketListing }
  | { readonly kind: 'cancel'; readonly listing: MyMarketListing }
  | { readonly kind: 'sell'; readonly mon: RosterView; readonly price: number };

async function runDialogMutation(action: MarketMutation): Promise<string> {
  switch (action.kind) {
    case 'buy':
      await buyMarketListing(action.listing.listingId);
      return 'Purchased! Digimon added to your roster.';
    case 'cancel':
      await cancelMarketListing(action.listing.listingId);
      return 'Listing canceled.';
    case 'sell':
      await listMarketMon(action.mon.id, action.price);
      return `Listed for ${action.price.toLocaleString()} DigiCredits.`;
  }
}

function eligibleForMarket(roster: readonly RosterView[]): readonly RosterView[] {
  const now = Date.now();
  return roster.filter((mon) => mon.listedAt === null && mon.status !== 'party' && mon.status !== 'training' && (mon.reviveAt === null || mon.reviveAt <= now));
}

function ListingGrid({ loading, emptyText, children }: { readonly loading: boolean; readonly emptyText: string; readonly children: readonly JSX.Element[] }): JSX.Element {
  if (loading) {
    return <div className="listing-grid"><div className="empty market-grid-empty">Loading…</div></div>;
  }
  if (children.length === 0) {
    return <div className="listing-grid"><div className="empty market-grid-empty">{emptyText}</div></div>;
  }
  return <div className="listing-grid">{children}</div>;
}

function StatusLine({ notice, error }: { readonly notice: string | null; readonly error: string | null }): JSX.Element | null {
  if (notice === null && error === null) {
    return null;
  }
  return <div className={error ? 'market-status is-error' : 'market-status'} role="status" aria-live="polite">{error ?? notice}</div>;
}

function queryError(...errors: readonly (Error | null)[]): string | null {
  const found = errors.find((item) => item !== null);
  if (found instanceof ApiError || found instanceof Error) {
    return found.message;
  }
  return null;
}
