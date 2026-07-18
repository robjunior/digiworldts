import { useState } from 'react';

import type { InventoryItemView, ShopItemView } from '../../lib/api-shop';
import { isQuantityItem, itemOwnedQty, kindLabel, kindStyle } from './types';

export function ShopItem({ item, inventory, credits, busy, onBuy }: { readonly item: ShopItemView; readonly inventory: readonly InventoryItemView[]; readonly credits: number; readonly busy: boolean; readonly onBuy: (itemId: string, qty: number) => void }): JSX.Element {
  const [qty, setQty] = useState(1);
  const ownedQty = itemOwnedQty(item, inventory);
  const canAfford = credits >= item.priceCredits * qty;
  const quantityItem = isQuantityItem(item.kind);
  return (
    <div className="card shop-item-card">
      <div className="card-inner">
        <div className="icon-slot">{item.id.slice(4, 7).toUpperCase()}</div>
        <div className="badge-row"><span className="kind-badge" style={kindStyle(item.kind)}>{kindLabel(item.kind)}</span></div>
        <div className="name">{item.name}</div>
        <div className="desc">{item.description}</div>
        <div className="price-row"><div className="price">{item.priceCredits} <small>cr</small></div></div>
        <ExtraDescription kind={item.kind} />
        {quantityItem ? (
          <div className="buy-actions">
            <input className="qty-input" type="number" min={1} max={99} value={qty} disabled={busy} onChange={(event) => setQty(Math.max(1, Math.min(99, event.currentTarget.valueAsNumber || 1)))} />
            <button className="btn btn--sm" type="button" disabled={busy || !canAfford} onClick={() => onBuy(item.id, qty)}>Buy</button>
          </div>
        ) : <button className="btn btn--sm btn--wide" type="button" disabled={busy || !canAfford} onClick={() => onBuy(item.id, 1)}>Buy (x1)</button>}
        {ownedQty > 0 ? <div className="owned">Owned: {ownedQty}</div> : null}
      </div>
    </div>
  );
}

function ExtraDescription({ kind }: { readonly kind: string }): JSX.Element | null {
  if (kind === 'building_placement') return <div className="extra-buy-desc">Auto-placed at your Training Ground on purchase.</div>;
  if (kind === 'evolve') return <div className="extra-buy-desc">Use from Roster page to digivolve a Digimon.</div>;
  if (kind === 'revive') return <div className="extra-buy-desc">Use from Roster page on recovering Digimon.</div>;
  return null;
}
