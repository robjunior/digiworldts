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
import {
  buyMarketListing,
  cancelMarketListing,
  DEFAULT_MARKET_FILTERS,
  getFarmCredits,
  getMarket,
  getMarketRoster,
  getMyMarketListings,
  listMarketMon,
  type MarketFilters as MarketFiltersValue,
  type MarketSort,
  type MarketTab
} from '../lib/api-market';
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
  const sellRosterQuery = useQuery({ queryKey: SELL_QUERY_KEY, queryFn: getMarketRoster, enabled: tab === 'sell' });
  const creditsQuery = useQuery({ queryKey: CREDITS_QUERY_KEY, queryFn: getFarmCredits });

  const handleSuccess = async (message: string) => {
    setNotice(message);
    setError(null);
    setDialog({ kind: 'none' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: MARKET_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: MINE_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: SELL_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CREDITS_QUERY_KEY }),
    ]);
  };

  const handleError = (caught: Error) => {
    setError(caught.message);
    setNotice(null);
  };

  const buyMutation = useMutation({
    mutationFn: (listingId: string) => buyMarketListing(listingId),
    onSuccess: () => handleSuccess('Purchased! Digimon added to your roster.'),
    onError: handleError,
  });

  const cancelMutation = useMutation({
    mutationFn: (listingId: string) => cancelMarketListing(listingId),
    onSuccess: () => handleSuccess('Listing canceled.'),
    onError: handleError,
  });

  const listMutation = useMutation({
    mutationFn: ({ monId, price }: { readonly monId: string; readonly price: number }) => listMarketMon(monId, price),
    onSuccess: (_, { price }) => handleSuccess(`Listed for ${price.toLocaleString()} DigiCredits.`),
    onError: handleError,
  });

  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);

  }, [notice]);

  const eligibleMons = useMemo(() => eligibleForMarket(sellRosterQuery.data?.roster ?? []), [sellRosterQuery.data]);
  const busy = buyMutation.isPending || cancelMutation.isPending || listMutation.isPending;

  return (
    <>
      <div className="mbar">
          <MarketTabs activeTab={tab} onTab={setTab} />
          <MarketChrome credits={creditsQuery.data ?? 0}>
            <button className="listbtn" onClick={() => setTab('sell')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              List Digimon
            </button>
          </MarketChrome>
        </div>

        <div className="stage">
          {tab === 'browse' ? <MarketFilters filters={filters} onFilters={setFilters} /> : null}

          <div className="gridwrap" style={tab !== 'browse' ? { gridColumn: '1 / -1' } : undefined}>
            {tab === 'browse' && (
              <>
                <div className="gridhead">
                  <span className="gt">
                    <b>{browseQuery.data?.total ?? 0}</b> listing{(browseQuery.data?.total === 1) ? '' : 's'}
                  </span>
                  <div className="sort">
                    <label htmlFor="market-sort">Sort</label>
                    <select
                      id="market-sort"
                      value={filters.sort}
                      onChange={(e) => setFilters({ ...filters, sort: e.target.value as MarketSort })}
                    >
                      <option value="newest">Newest</option>
                      <option value="price_asc">Price ↑</option>
                      <option value="price_desc">Price ↓</option>
                      <option value="level_desc">Level ↓</option>
                    </select>
                  </div>
                </div>
                <div className="grid">
                  {browseQuery.isPending ? (
                    <div className="gridempty">Loading…</div>
                  ) : browseQuery.data?.items.length === 0 ? (
                    <div className="gridempty">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <br />
                      No listings match your filters.<br />Try clearing a filter above.
                    </div>
                  ) : (
                    browseQuery.data?.items.map((listing) => (
                      <MarketListingCard
                        key={listing.listingId}
                        kind="browse"
                        listing={listing}
                        onBuy={(item) => setDialog({ kind: 'buy', listing: item })}
                      />
                    ))
                  )}
                  {browseQuery.data ? (
                    <MarketPagination
                      total={browseQuery.data.total}
                      page={browseQuery.data.page}
                      perPage={browseQuery.data.perPage}
                      onPage={setPage}
                    />
                  ) : null}
                </div>
              </>
            )}

            {tab === 'mine' && (
              <>
                <div className="gridhead">
                  <span className="gt">
                    <b>{mineQuery.data?.listings.length ?? 0}</b> of your listing{(mineQuery.data?.listings.length === 1) ? '' : 's'}
                  </span>
                </div>
                <div className="grid">
                  {mineQuery.isPending ? (
                    <div className="gridempty">Loading…</div>
                  ) : mineQuery.data?.listings.length === 0 ? (
                    <div className="gridempty">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <br />
                      You haven't listed anything yet. Head to the Sell tab.
                    </div>
                  ) : (
                    mineQuery.data?.listings.map((listing) => (
                      <MarketListingCard
                        key={listing.listingId}
                        kind="mine"
                        listing={listing}
                        onCancel={(item) => setDialog({ kind: 'cancel', listing: item })}
                      />
                    ))
                  )}
                </div>
              </>
            )}

            {tab === 'sell' && (
              <>
                <div className="gridhead">
                  <span className="gt">
                    <b>{eligibleMons.length}</b> eligible Digimon
                  </span>
                </div>
                <div style={{ padding: '0 24px 10px', fontSize: '12px', color: 'var(--muted)' }}>
                  Pick a Digimon to list on the market. Party mons, training mons, downed mons, and already-listed mons are hidden.
                </div>
                <div className="grid">
                  {sellRosterQuery.isPending ? (
                    <div className="gridempty">Loading…</div>
                  ) : eligibleMons.length === 0 ? (
                    <div className="gridempty">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <br />
                      No Digimon are eligible to list. Try removing one from your party.
                    </div>
                  ) : (
                    eligibleMons.map((mon) => (
                      <MarketListingCard
                        key={mon.id}
                        kind="sell"
                        listing={mon}
                        onSell={(item) => setDialog({ kind: 'sell', mon: item, price: '100' })}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>

      <StatusToast notice={notice} error={error ?? queryError(browseQuery.error, mineQuery.error, sellRosterQuery.error)} />

      <MarketDialogs
        state={dialog}
        busy={busy}
        onClose={() => setDialog({ kind: 'none' })}
        onBuy={(listing) => buyMutation.mutate(listing.listingId)}
        onCancel={(listing) => cancelMutation.mutate(listing.listingId)}
        onSellPrice={(price) => setDialog((current) => (current.kind === 'sell' ? { ...current, price } : current))}
        onSell={(mon, price) => listMutation.mutate({ monId: mon.id, price })}
      />
    </>
  );
}

function eligibleForMarket(roster: readonly RosterView[]): readonly RosterView[] {
  const now = Date.now();
  return roster.filter(
    (mon) =>
      mon.listedAt === null &&
      mon.status !== 'party' &&
      mon.status !== 'training' &&
      (mon.reviveAt === null || mon.reviveAt <= now)
  );
}

function StatusToast({ notice, error }: { readonly notice: string | null; readonly error: string | null }): JSX.Element | null {
  const msg = error ?? notice;
  if (!msg) return null;
  return (
    <div
      className={`toast show ${error ? 'is-error' : ''}`}
      role="status"
      aria-live="polite"
      style={error ? { background: 'var(--battle)', color: '#fff' } : undefined}
    >
      {msg}
    </div>
  );
}

function queryError(...errors: readonly (Error | null)[]): string | null {
  const found = errors.find((item) => item !== null);
  if (found instanceof ApiError || found instanceof Error) {
    return found.message;
  }
  return null;
}
