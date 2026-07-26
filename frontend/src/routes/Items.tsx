import { useQuery } from '@tanstack/react-query';

import { PageStrip } from '../components/common/PageStrip';
import { getItems } from '../lib/api-shop';

const ITEMS_QUERY_KEY = ['items'] as const;

export function Items(): JSX.Element {
  const itemsQuery = useQuery({ queryKey: ITEMS_QUERY_KEY, queryFn: getItems });
  const items = itemsQuery.data?.items ?? [];
  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);

  return (
    <div className="app-shell">
      <main className="app-main">
        <PageStrip
          name="Items"
          tone="reward"
          metrics={[
            { label: <><b>{items.length}</b> types</> },
            { label: <><b>{totalQty}</b> total</> },
          ]}
          actions={<span className="muted">Earn drops from PVE · Craft at the farm</span>}
        />
        {itemsQuery.isPending ? (
          <p className="muted">Loading inventory…</p>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <b>No items yet.</b>
            <p className="muted">Fight wild Digimon in the World or craft consumables at the Farm to fill your bag.</p>
          </div>
        ) : (
          <section className="items-grid" aria-label="Inventory">
            {items.map((item) => (
              <article key={item.itemId} className="item-card">
                <header className="item-card-head">
                  <h3 className="item-card-name">{item.name}</h3>
                  <span className="item-card-qty">×{item.qty}</span>
                </header>
                <p className="item-card-desc muted">{item.description}</p>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
