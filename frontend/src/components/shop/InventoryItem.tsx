import type { InventoryItemView, ShopItemView } from '../../lib/api-shop';

export function InventoryItem({ inventoryItem, shopItem, onApply, onActivate }: { readonly inventoryItem: InventoryItemView; readonly shopItem: ShopItemView | null; readonly onApply: (itemId: string) => void; readonly onActivate: (itemId: string) => void }): JSX.Element {
  const kind = shopItem?.kind ?? 'unknown';
  return (
    <div className="inv-item">
      <div className="inv-name"><span>{inventoryItem.name}</span><span className="inv-qty">x{inventoryItem.qty}</span></div>
      <div className="inv-desc">{inventoryItem.description}</div>
      <div className="inv-action"><InventoryAction kind={kind} itemId={inventoryItem.itemId} onApply={onApply} onActivate={onActivate} /></div>
    </div>
  );
}

function InventoryAction({ kind, itemId, onApply, onActivate }: { readonly kind: string; readonly itemId: string; readonly onApply: (itemId: string) => void; readonly onActivate: (itemId: string) => void }): JSX.Element {
  if (kind === 'consumable' || kind === 'revive') return <button className="btn btn--sm btn--secondary btn--wide" type="button" onClick={() => onApply(itemId)}>Apply to a Mon</button>;
  if (kind === 'xp_mult') return <button className="btn btn--sm btn--secondary btn--wide" type="button" onClick={() => onActivate(itemId)}>Activate for next win</button>;
  if (kind === 'evolve') return <div className="inv-info">Use from Roster page (click Evolve on a mon)</div>;
  if (kind === 'cosmetic') return <div className="inv-info">Equipped by default</div>;
  if (kind === 'key' || itemId.includes('key')) return <div className="inv-info">Auto-used at locked doors in Dungeons</div>;
  if (kind === 'quest' || itemId.includes('quest')) return <div className="inv-info">Quest item — turn in via the World map</div>;
  return <div className="inv-info">Consumed during combat or by opening doors in Dungeons</div>;
}
