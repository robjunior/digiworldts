import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useEffect, useMemo, useState } from 'react';

import { DigiCredits } from '../components/common/DigiCredits';
import { PageStrip } from '../components/common/PageStrip';
import { ApplyDialog } from '../components/shop/ApplyDialog';
import { InventoryItem } from '../components/shop/InventoryItem';
import { ShopFilters } from '../components/shop/ShopFilters';
import { ShopItem } from '../components/shop/ShopItem';
import { ShopPagination } from '../components/shop/Pagination';
import type { ShopFilter } from '../components/shop/types';
import { useAuth } from '../hooks/useAuth';
import { getRoster } from '../lib/api';
import { applyShopItem, buyShopItem, getShop } from '../lib/api-shop';
import type { InventoryItemView, ShopItemView } from '../lib/api-shop';
import '../styles/extensions-shop.css';

const SHOP_QUERY_KEY = ['shop'] as const;
const ROSTER_QUERY_KEY = ['roster'] as const;
const PER_PAGE = 9;

export function Shop(): JSX.Element {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const shopQuery = useQuery({ queryKey: SHOP_QUERY_KEY, queryFn: getShop });
  const rosterQuery = useQuery({ queryKey: ROSTER_QUERY_KEY, queryFn: getRoster, enabled: false });
  const [filter, setFilter] = useState<ShopFilter>('all');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [applyingItem, setApplyingItem] = useState<InventoryItemView | null>(null);

  const items = shopQuery.data?.products ?? [];
  const inventory = shopQuery.data?.inventory ?? [];
  const credits = shopQuery.data?.credits ?? 0;
  const filtered = useMemo(() => items.filter((item) => filter === 'all' || (filter === 'consumable' ? item.kind === 'consumable' || item.kind === 'xp_mult' || item.kind === 'revive' : item.kind === filter)), [filter, items]);
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const itemById = useMemo<ReadonlyMap<string, ShopItemView>>(() => new Map(items.map((item) => [item.id, item])), [items]);
  const totalInventory = inventory.reduce((sum, item) => sum + item.qty, 0);

  useEffect(() => setPage(1), [filter]);
  const invalidateShop = (): void => { void queryClient.invalidateQueries({ queryKey: SHOP_QUERY_KEY }); };
  const buyMutation = useMutation({ mutationFn: ({ itemId, qty }: { readonly itemId: string; readonly qty: number }) => buyShopItem(itemId, qty), onSuccess: (_result, variables) => { const bought = itemById.get(variables.itemId); setMessage(bought?.kind === 'building_placement' ? 'Placed! Visit Training to assign a Digimon.' : `Bought ${variables.qty}x ${bought?.name ?? 'item'}.`); invalidateShop(); } });
  const applyMutation = useMutation({ mutationFn: ({ itemId, monId }: { readonly itemId: string; readonly monId?: string }) => applyShopItem(itemId, monId), onSuccess: () => { setMessage('Item applied successfully.'); setApplyingItem(null); invalidateShop(); } });

  const openApply = (itemId: string): void => {
    const item = inventory.find((entry) => entry.itemId === itemId) ?? null;
    setApplyingItem(item);
    void rosterQuery.refetch();
  };

  return (
    <div className="app-shell shop-shell">
      <main className="app-main">
        <PageStrip
          name="Shop"
          tone="action"
          metrics={[
            { label: <><b>{filtered.length}</b> items</> },
            { label: <><b>{totalInventory}</b> in inventory</> },
          ]}
          actions={<DigiCredits value={credits} />}
        />
        {message ? <div className="banner shop-message"><div className="b-s">{message}</div></div> : null}
        <div className="layout">
          <div className="shop-main"><ShopFilters active={filter} onFilter={setFilter} /><div className="shop-grid" id="shop-grid">{paginated.length === 0 ? <div className="shop-empty">No items found.</div> : paginated.map((item) => <ShopItem key={item.id} item={item} inventory={inventory} credits={credits} busy={buyMutation.isPending} onBuy={(itemId, qty) => buyMutation.mutate({ itemId, qty })} />)}<ShopPagination total={filtered.length} page={page} perPage={PER_PAGE} onPage={setPage} /></div></div>
          <aside className="inventory"><h2>Inventory <span>{totalInventory} item{totalInventory === 1 ? '' : 's'}</span></h2><div className="inv-list">{inventory.length === 0 ? <div className="inv-empty">Nothing yet, buy something above.</div> : inventory.map((entry) => <InventoryItem key={entry.itemId} inventoryItem={entry} shopItem={itemById.get(entry.itemId) ?? null} onApply={openApply} onActivate={(itemId) => applyMutation.mutate({ itemId })} />)}</div></aside>
        </div>
      </main>
      <ApplyDialog item={applyingItem} roster={rosterQuery.data?.roster ?? []} loading={rosterQuery.isFetching} onClose={() => setApplyingItem(null)} onApply={(monId) => { if (applyingItem) applyMutation.mutate({ itemId: applyingItem.itemId, monId }); }} />
    </div>
  );
}
