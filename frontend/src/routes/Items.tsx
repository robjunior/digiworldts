import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { PageStrip } from '../components/common/PageStrip';
import { getItems } from '../lib/api-shop';
import type { InventoryItemView } from '../lib/api-shop';

const ITEMS_QUERY_KEY = ['items'] as const;

type Tab = 'dungeon' | 'consumables';

function isDungeonItem(item: InventoryItemView): boolean {
  const id = item.itemId.toLowerCase();
  return id.startsWith('itm-key-') || id.startsWith('itm-quest-') || id.includes('-key-') || id.includes('-quest-');
}

export function Items(): JSX.Element {
  const itemsQuery = useQuery({ queryKey: ITEMS_QUERY_KEY, queryFn: getItems });
  const items = itemsQuery.data?.items ?? [];
  const [tab, setTab] = useState<Tab>('dungeon');

  const { dungeon, consumables } = useMemo(() => {
    const dungeon: InventoryItemView[] = [];
    const consumables: InventoryItemView[] = [];
    for (const item of items) {
      if (isDungeonItem(item)) dungeon.push(item);
      else consumables.push(item);
    }
    return { dungeon, consumables };
  }, [items]);

  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
  const active = tab === 'dungeon' ? dungeon : consumables;

  return (
    <div className="app-shell">
      <main className="app-main">
        <PageStrip
          name="Inventory"
          tone="reward"
          metrics={[
            { label: <><b>{items.length}</b> types</> },
            { label: <><b>{totalQty}</b> total</> },
          ]}
          actions={<span className="muted">Earn drops from PVE · Pick up from dungeons · Craft at the farm</span>}
        />

        <div className="inv-tabs" role="tablist" aria-label="Inventory categories">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'dungeon'}
            className={`inv-tab ${tab === 'dungeon' ? 'is-on' : ''}`}
            onClick={() => setTab('dungeon')}
          >
            <span className="k">Dungeon Items</span>
            <span className="n">{dungeon.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'consumables'}
            className={`inv-tab ${tab === 'consumables' ? 'is-on' : ''}`}
            onClick={() => setTab('consumables')}
          >
            <span className="k">Consumables</span>
            <span className="n">{consumables.length}</span>
          </button>
        </div>

        {itemsQuery.isPending ? (
          <p className="muted">Loading inventory…</p>
        ) : active.length === 0 ? (
          <div className="empty-state inv-empty">
            <b>{tab === 'dungeon' ? 'No dungeon items yet.' : 'No consumables yet.'}</b>
            <p className="muted">
              {tab === 'dungeon'
                ? 'Walk over keys and quest tokens inside dungeons to collect them.'
                : 'Fight wild Digimon or craft at the farm to stock potions, revives, and buffs.'}
            </p>
          </div>
        ) : (
          <section className="items-grid" aria-label={tab === 'dungeon' ? 'Dungeon items' : 'Consumables'}>
            {active.map((item) => (
              <article key={item.itemId} className="item-card" data-kind={isDungeonItem(item) ? 'dungeon' : 'consumable'}>
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
